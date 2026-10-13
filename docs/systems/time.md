# System: Time (`src/engine/time/`, `src/i18n/calendarFormat.ts`)

## What it does

A single clock, `GameState.clock.minutesElapsed`: minutes since the clock's
epoch. `GameState.clock.epoch` (a `{year, month, day}`) is the calendar date
`minutesElapsed = 0` corresponds to.

**On the website the clock is the visitor's real local time.** `main.ts` builds
the initial state with today's local date as the epoch (`view/wallClock.ts`'s
`localEpoch`), and `TerminalView.startWallClock()` feeds the engine
`syncClock(minutesSinceEpoch(...))` immediately and then every 15 s. The engine
never reads `Date`: converting wall-clock time into minutes is the view's job.
`GameEngine.syncClock` is the ONLY writer of `minutesElapsed`: **travel and
other actions take no time** (the old travel-time system is gone, see
`navigation.md`).

**This absolute calendar date is the ONLY time format the game shows;
there is no relative "Day N" format.** NPCs can reference real dates, and the
status bar shows the real date and time.

A real clock (not abstracted time-of-day blocks) was chosen because the
genre needs precise timestamps (alibis: "where were you at 23:40?"). The
calendar layer extends that same reasoning to actual dates.

## Public capabilities

- `toCalendarDate(epoch, minutesElapsed): CalendarDate`
  (`engine/time/calendar.ts`) — pure absolute calendar math. Returns
  `{ year, month, day, weekday, hour, minute }` as plain numbers — no
  strings, no month/weekday names. `weekday` is `0`(Sunday)`-6`(Saturday),
  matching JS `Date.getUTCDay()`. Uses `Date.UTC` internally so there is
  no local-timezone/DST dependence.
- `GameEngine.getCalendarDate(): CalendarDate` — the current absolute date,
  derived from `state.clock.epoch` + `state.clock.minutesElapsed`. THE
  time display; also what content/logic needing a real date reads (e.g.
  a pass's expiry).
- `calendarDisplayParams(date): Record<string, string>`
  (`engine/time/calendar.ts`) — the `{day, monthKey, year, weekdayKey,
  hour, minute}` shape both `GameEngine.describeTime` (event params, for
  `event.timeChecked`/`event.passPurchased`) and `TerminalView`'s status
  bar build from a `CalendarDate`, so the two can never drift out of
  sync. `monthKey`/`weekdayKey` are dynamically-built i18n KEY
  REFERENCES (e.g. `"calendar.month.9.long"`), not player-facing text
  themselves — the same pattern `GameEngine` already uses for
  `modeKey`/`categoryKey`/`preferenceKey` elsewhere, so building them
  doesn't cross the "engine never produces display strings" line (see
  CLAUDE.md): no language-dependent word is chosen here, only a key path
  built from a number the engine already knows. `hour`/`minute` are
  zero-padded (numeric formatting, not language-dependent — same
  precedent as `formatMoneyParts` padding minor units engine-side).
- `formatCalendarDate(date, pattern): string`
  (`src/i18n/calendarFormat.ts`) — turns a `CalendarDate` into display
  text via a token PATTERN: `YYYY`/`YY`, `MMMM`/`MMM`/`MM`/`M`,
  `DD`/`D`, `dddd`/`ddd`, `HH`/`H`, `mm`/`m`. E.g. `"D MMMM YYYY"` →
  `"18 September 1946"`. Deliberately lives in `src/i18n/`, NOT
  `src/engine/` — month/weekday names are player-facing, language-dependent
  text (resolved via `t()` against `calendar.month.<n>.long/.short` and
  `calendar.weekday.<n>.long/.short` keys in `en.ts`), and the engine
  never produces display strings — see CLAUDE.md.

  **Two separate routes to the same information, and why both exist:**
  `calendarDisplayParams` + `t()`'s named-placeholder substitution is
  what GameEvent text uses (events must stay generic `{textKey, params}`
  data, resolved the same way as everything else — see
  `docs/architecture.md`'s "Why events, not strings"). `formatCalendarDate`
  + a token pattern is what `TerminalView`'s status bar uses directly —
  it's bespoke, always-on view chrome, not an event, so it can call
  straight into `formatCalendarDate` with a pattern read from `en.ts`'s
  `ui.clockDisplay` (a PATTERN string here, not a `{placeholder}`
  template — storing the pattern itself in the translation table, rather
  than hardcoding day/month/year ORDER in view code, is what would let a
  different language pick its own date ordering later).
- `GameEngine.checkTime()` — event with the current calendar params (see
  `calendarDisplayParams`) for the `time`/`clock` command.
- `GameEngine.syncClock(minutesElapsed)` is the only place
  `GameState.clock.minutesElapsed` is mutated. It also resyncs scheduled NPCs
  (`syncNpcLocations`), so they move to where their routine says they are now.
  `travelTo` resyncs NPCs on arrival but does not move the clock.

## Time-sensitive state (deadlines, schedules, and anything like them later)

`engine/time/calendar.ts` is the home of the general pattern this project uses
for ANY time-sensitive/countdown state (case deadlines, NPC schedules, evidence
windows, ...):

**Store an ABSOLUTE trigger minute, computed once; compare it lazily against the
current clock wherever it matters. Never store a "remaining duration" that needs
decrementing as time passes.** With a real-time clock this is even more
important: nothing ticks, the clock just moves underneath the comparison.
`minutesUntilDayAlignedExpiry(now, days)` remains available for "N calendar
days" durations that should end at a midnight boundary rather than drift to the
time of day they started. (It was written for passes, which no longer exist;
nothing calls it today.)

**No universal "time passed" event/tick system is built, and none is
planned until a concrete feature actually needs one.** The
absolute-expiry-plus-lazy-comparison pattern above covers essentially
every case in this category: a deadline is a stored minute value; "is it
past due" is a comparison, computed on demand, not something that needs
to actively fire. A tick system would only be justified for state that
must eagerly CHANGE as a pure side effect of time passing, independent of
anything querying it — and even most of those turn out to be expressible
as "derive current state from the clock reading right now" (a pure
function) instead. Revisit this if a real feature turns up that genuinely
can't be expressed lazily.

## How it interacts with other systems

- **Navigation** takes no time; it only resyncs scheduled NPCs on arrival.
- **View**: `startWallClock` is the sole source of time.
- **Content** sets the epoch once, at world creation
  (`content/world.ts`'s `createInitialState`) — defaulting to 18 September 1946
  when no epoch is passed; the website passes today's local date.
- **View**: `TerminalView`'s persistent clock line and the current-
  location line together answer "when it is and where we are" — see
  `docs/systems/navigation.md`'s "Discovered locations" section for the
  location half.
- **NPC schedules** are the first consumer: `syncClock` calls
  `syncNpcLocations` (`engine/npc/schedule.ts`) right after setting
  `minutesElapsed`, moving scheduled NPCs to where their table says they are
  now. It is a sync at the moment time moves, not a tick loop, and it keeps
  `placement` the single stored truth — see `docs/systems/npcs.md`.
- Nothing else reads the clock to change behavior yet (no day/night state,
  no case deadlines). This is the natural next hook once a case/deduction
  system exists — see "Time-sensitive state" above for the pattern it should
  use.

## Known gaps

- No "wait" or "pass time" action: the clock only follows real time.

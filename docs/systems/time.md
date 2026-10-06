# System: Time (`src/engine/time/`, `src/i18n/calendarFormat.ts`)

## What it does

A single simulated clock, `GameState.clock.minutesElapsed` — minutes
since the game's epoch. `GameState.clock.epoch` (a `{year, month, day}`,
set once by content — see `content/world.ts`, currently 18 September
1946) is the real-world calendar date `minutesElapsed = 0` corresponds
to.

**This absolute calendar date is the ONLY time format the game shows —
there is no relative "Day N" format anymore.** An earlier version of this
system displayed "Day N, HH:MM" and kept the absolute calendar date built
but unused. That was deliberately dropped: a detective game needs NPCs to
reference real past dates, newspapers to carry real dates, and — the
concrete case that forced the removal — a pass system (see
`docs/systems/economy.md`) whose expiry has to read as an actual date
("Expires: 25 September 1946"), not "Day 8." Keeping both formats around
just to eventually retire one wasn't worth the complexity; "Day N" was
removed outright rather than kept as a secondary display.

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
- `GameEngine`'s private `advanceClock(minutes)` is the only place
  `GameState.clock.minutesElapsed` is mutated. Called by `travelTo` after
  a successful move (both the compass fast path and pathfound routes).

## Time-sensitive state (passes, and anything like them later)

`engine/time/calendar.ts` also has `minutesUntilDayAlignedExpiry(now,
days)` and is the home of the general pattern this project uses for ANY
time-sensitive/countdown state — passes today (see
`docs/systems/economy.md`), likely case deadlines, NPC schedules, or
evidence windows later:

**Store an ABSOLUTE trigger minute, computed once; compare it lazily
against the current clock wherever it matters. Never store a "remaining
duration" that needs decrementing as time passes.**

`ActivePass.expiresAtMinutesElapsed` (`types.ts`) is the first real
example: `GameEngine.buyPass` computes it once, and `costOfMode`
(`navigation/transportModes.ts`) checks it with a plain `<` comparison.
Nothing "ticks" a pass down turn by turn — there is no per-turn or
per-minute update loop for this at all, and none is needed. This was an
explicit design discussion (see the pass system's design notes in
`docs/systems/economy.md`): the tempting alternative — store "minutes
remaining" and decrement it somewhere on every clock advance — would
require a universal "time passed" hook threaded through everywhere the
clock moves, just to keep a number that a lazy comparison against
`GameClock.minutesElapsed` makes entirely unnecessary.

**`minutesUntilDayAlignedExpiry(nowMinutesElapsed, days)`** is the other
half of the pass system's design: a duration expressed in "N days" should
always expire at a DAY BOUNDARY (midnight starting the day after the
Nth), not `days * 1440` minutes from the exact moment of purchase — that
would drift to whatever time-of-day the purchase happened to occur at
(a 7-day pass bought at 08:00 would expire at 08:00 seven days later, an
odd time for something framed as calendar-day validity). A partial
"today" counts as the first of the N days: buying a 7-day pass at 08:00
covers the rest of today plus 6 more full days, expiring exactly at
00:00 on day 8.

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

- **Navigation** is the only current source of elapsed time — every
  successful `travelTo` call advances the clock by the actual minutes the
  chosen route/mode costs. `look()`, `takeItem()`, `talkTo()`, `examine()`
  do not advance it.
- **Economy**: the pass system's expiry — see "Time-sensitive state"
  above and `docs/systems/economy.md`.
- **Content** sets the epoch once, at world creation
  (`content/world.ts`'s `createInitialState`) — currently 18 September
  1946. Changing the game's setting/era means changing this one value;
  nothing else references a hardcoded date.
- **View**: `TerminalView`'s persistent clock line and the current-
  location line together answer "when it is and where we are" — see
  `docs/systems/navigation.md`'s "Discovered locations" section for the
  location half.
- **NPC schedules** are the first consumer: `advanceClock` calls
  `syncNpcLocations` (`engine/npc/schedule.ts`) right after bumping
  `minutesElapsed`, moving scheduled NPCs to where their table says they are
  now. It is a sync at the moment time moves, not a tick loop, and it keeps
  `placement` the single stored truth — see `docs/systems/npcs.md`.
- Nothing else reads the clock to change behavior yet (no day/night state,
  no case deadlines). This is the natural next hook once a case/deduction
  system exists — see "Time-sensitive state" above for the pattern it should
  use.

## Known gaps

- No "wait" or "pass time" action yet — the clock only moves via travel.

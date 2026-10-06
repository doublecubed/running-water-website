# System: Visibility (`src/engine/visibility/visibility.ts`)

## What it does

A single computed signal — how well-lit/observable a location is right
now, as one number (0-100) — rather than separate lighting/clutter/noise
subsystems. The design reasoning: visibility has multiple future
consumers (how much `examine` reveals, whether an NPC notices the
player), and those consumers read the SAME underlying number differently
rather than each needing its own authored dimension. Building three
parallel systems (lighting, clutter, noise) before any consumer exists to
tell them apart would be guessing at distinctions nothing yet needs — see
`docs/future_work.md`'s "Stats"/"Stealth" entries, which this system is
the dependency for.

Content authors pick from a small set of named tiers
(`dark`/`dim`/`normal`/`bright`) rather than typing a raw 0-100 number —
there's no way to intuit the difference between 47 and 53, and the tiers
are exactly what a location actually needs to express. Internally each
tier maps to a fixed numeric constant so the engine can still do
arithmetic with it (blend with time-of-day now; combine with a future
stealth stat/NPC perception check later) — same reasoning as
`engine/navigation/transportModes.ts`'s `TRANSPORT_MODE_SPEED_KMH`.

## Public capabilities

- `VisibilityTier` (`engine/types.ts`) — `"dark" | "dim" | "normal" |
  "bright"`.
- `Location.baseVisibility?: VisibilityTier` — the tier before time-of-day
  is applied. Optional on ANY location; defaults to `"normal"` when
  absent, so every pre-existing location/content file stays valid
  untouched.
- `InteriorLocation.affectedByDaylight?: boolean` — whether daylight
  through windows affects THIS interior at all. Optional, defaults to
  `true` (most interiors have at least some window light). Set `false`
  for a windowless basement/warehouse, which then ignores time-of-day
  entirely and stays at its `baseVisibility` around the clock. Exterior
  locations have no equivalent field — they're always time-of-day-
  affected; there'd be nothing meaningful for the toggle to turn off.
- `VISIBILITY_TIER_VALUES: Record<VisibilityTier, number>` — the
  authored-tier-to-number table: `dark: 10, dim: 35, normal: 65, bright:
  100`. Tunable constants, not derived from anything.
- `daylightFactor(hour): number` — fraction of full daylight present at
  that hour (0..1): 0 at night, 1 at midday, ramping linearly through a
  dawn window (05:00-07:00) and a dusk window (19:00-21:00). A simple
  piecewise-linear approximation, not real sun-position math — the
  boundary hours and the linear shape are both tunable, not meant to be
  astronomically accurate for any particular date/latitude.
- `computeVisibility(location, hour): number` — the actual pure
  computation, called with `GameEngine.getCalendarDate().hour`:
  - **Exterior**: `baseVisibility`'s value scaled DIRECTLY by
    `daylightFactor(hour)`. Night pulls even a `bright` exterior down
    toward darkness — no authored tier can defeat nightfall outright,
    which matches the original design goal ("time of day is one of the
    driving factors" for exteriors).
  - **Interior, `affectedByDaylight` true (default)**: the same swing,
    but dampened to `INTERIOR_DAYLIGHT_WEIGHT` (0.3) of an exterior's
    full range — an interior with windows dips at night, but nowhere near
    as far as stepping outside would.
  - **Interior, `affectedByDaylight` false**: `hour` is ignored entirely;
    returns `baseVisibility`'s value, constant around the clock.
- `visibilityTierForValue(value): VisibilityTier` — buckets a computed
  number back to its nearest named tier, for any future consumer that
  wants tier semantics (e.g. a display label) instead of the raw number.
- `GameEngine.getVisibility(locationId?): { tier: VisibilityTier; value:
  number }` — a pure query (no event, no state mutation), defaulting to
  the player's current location. `tier` here is
  `visibilityTierForValue(value)` — the CURRENT effective tier after
  time-of-day, not the location's authored `baseVisibility`.

## Why this is computed lazily, not stored

Same pattern as `docs/systems/time.md`'s pass-expiry design: visibility
is derived on demand from static content (`baseVisibility`/
`affectedByDaylight`) plus the current clock reading, every time it's
queried — nothing is stored on `GameState`. This means:

- No `SAVE_SCHEMA_VERSION` bump for this system at all.
- No per-turn/per-minute update loop is needed — there's nothing to keep
  in sync as time passes, only a cheap function call whenever a consumer
  actually asks.

## How it interacts with other systems

- **Time**: the only other system this reads — `hour` comes straight
  from `GameEngine.getCalendarDate()` (see `docs/systems/time.md`). No
  new dependency in the other direction; time doesn't know visibility
  exists.
- **Content/editor**: `baseVisibility`/`affectedByDaylight` are authored
  exactly like any other optional Location field — see
  `docs/content-schema.md`'s Location section — and editable through the
  map editor's Locations tab (a tier `<select>` for any location, a
  checkbox shown only for `kind: interior`) — see
  `docs/architecture.md`'s "The map editor" section.
- **A player-facing consumer exists**: `GameEngine.describeLocation`
  pushes a `location_visibility` event (resolved via
  `event.locationVisibility`/`visibility.tier.<tier>` i18n keys)
  immediately after the location's full description, gated by the same
  `includeDescription` flag as that description — so it shows on first
  arrival and every explicit `look`, but not on an ordinary revisit. This
  is the only consumer built so far.
- **A stealth check exists, with a verb**: `GameEngine
  .getStealthConcealment()` (see `docs/systems/checks.md`) is the first
  consumer combining this system's `getVisibility()` with
  `docs/systems/stats.md`'s `getPlayerStat("stealth")` — a
  `resolveDifficultyCheck` (visibility never rolls; it isn't an actor).
  The `sneak` verb (`GameEngine.toggleStealth()`) now consumes it too:
  toggling stealth on, and every successful travel while already
  sneaking, re-rolls concealment for the CURRENT (or, after travel, the
  NEW) location.
- **A v1 NPC-notice exists via the witness step** (`docs/systems/npcs.md`):
  a successful concealment roll while sneaking hides the player's actions
  from bystanders; otherwise every NPC present remembers them. Visibility
  itself is not consulted, and a per-NPC perception contest is NOT built —
  that needs a perception stat that doesn't exist in `STAT_DEFINITIONS` yet.
- **`examine` detail-gating is NOT built yet.** See `docs/future_work.md`'s "Stealth" entry.

## Known gaps

- No `wait`/`pass time` action exists yet (see `docs/systems/time.md`'s
  own "Known gaps") — the clock only advances via travel, so in practice
  a location's visibility only changes as a side effect of traveling
  somewhere during a different hour, not by lingering in place.
- Stealth-vs-visibility now has a full consumer (`getStealthConcealment`
  + the `sneak` verb, see `docs/systems/checks.md`); NPC-notice still
  doesn't — see this doc's "How it interacts with other systems" above.

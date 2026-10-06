# System: Skill Checks (`src/engine/checks/checks.ts`)

## What it does

A generic opposed-check resolver — the first real **consumer** of
`docs/systems/stats.md` and `docs/systems/visibility.md`, both of which
were deliberately built ahead of any consumer. It takes one or two
0-100 values (a skill, a difficulty number, another skill) and resolves
them into a `CheckResult`: a six-tier outcome plus the numeric margin
that produced it.

The design goal was a system that's universal the same way Stats and
Visibility are: one shared resolution mechanism any future check (dodge
vs. handguns, intimidation vs. NPC resistance, a lockpicking difficulty)
can call into, rather than a bespoke comparison written per mechanic.

## The roll: 2d10, triangular, hand-tuned modifier table

Rolls are 2d10 (two ten-sided dice, sum 2-20). The sum's distribution is
triangular around 11 — exactly `(10 - |sum - 11|)`% per side, so 11 is a
10% roll and each step away is 1% rarer, down to 1% at the extremes (2
or 20).

Each sum maps to a signed modifier via a lookup table, **not a formula**
— the magnitudes were hand-tuned to accelerate as probability drops, so
a rare roll swings a check hard while the common near-11 rolls barely
move it:

| Distance from 11 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| Sum (above 11)    | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
| Sum (below 11)    | 11 | 10 | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |
| Magnitude         | 0 | 1 | 2 | 3 | 5 | 7 | 10 | 13 | 16 | 20 |

`rollModifier(rng)` is the one function that produces this — `rng` is
always an injected `() => number` in `[0, 1)`, never `Math.random()`
read directly, so the module stays pure and testable. Sums ≥ 11 give a
non-negative modifier, sums < 11 give a non-positive one.

`skill + modifier` is deliberately **left unclamped** past `[0, 100]`.
It's a transient check value, not a stored stat (`getStatValue` still
clamps the underlying stored value — see `docs/systems/stats.md`), and
clamping here would blunt the rare-roll swing at exactly the extremes
where it's supposed to matter.

## Two check kinds — two functions, not a flag

- **`resolveDifficultyCheck(skill, difficulty, rng)`** — rolls **once**,
  compares `skill + modifier` against a static `difficulty` number that
  never rolls. Used when the "opponent" isn't an actor at all — a
  location's visibility, or any future authored difficulty rating.
- **`resolveContestedCheck(skillA, skillB, rng)`** — rolls **twice**,
  independently (two separate 2d10 draws, not one roll read both ways),
  compares `skillA + modifierA` against `skillB + modifierB`. Used when
  both sides are actors with their own stat.

These are deliberately two separate functions rather than one resolver
taking an `isContested` boolean: which one to call is visible at the
call site (stealth-vs-visibility obviously can't call the contested
variant — visibility has no stat to roll for), rather than being a flag
a caller could get backwards. A contested check is also intentionally
**swingier** than a difficulty check — two independent rolls both
contribute to the margin instead of one — which is a deliberate feature
of a check between two actors, not something normalized away.

## The six-tier outcome

`CheckOutcomeTier` (`engine/types.ts`) is symmetric: `failedSpectacularly
/ failedBadly / failed / succeeded / succeededWell / succeededSpectacularly`.
Tiers are bucketed by `margin` against an ordered threshold table (same
"named tier + threshold table" shape as `VISIBILITY_TIER_VALUES`),
walked high-to-low so each tier's `minMargin` is its own floor:

| Tier | minMargin |
|---|---|
| succeededSpectacularly | 40 |
| succeededWell | 15 |
| succeeded | 0 |
| failed | -15 |
| failedBadly | -40 |
| failedSpectacularly | -∞ |

These thresholds are tunable placeholders, not derived from anything
else in the codebase — retune only in `checks.ts`.

`CheckResult.success` is stored as an explicit `boolean` on each tier
entry, not derived from the tier's name (e.g. `startsWith("succeeded")`)
— a binary-only consumer reads `result.success` and never has to know
all six tier names, and renaming a tier later can't silently break that
check. `CheckResult.rolls` is length 1 for a difficulty check, length 2
for a contested check.

## `GameEngine`'s new randomness capability

This is the **first system in the codebase needing randomness**, which
is a genuinely new capability, not just a new module. `GameEngine`'s
constructor gained an optional second parameter:

```ts
constructor(private state: GameState, private rng: () => number = Math.random) {}
```

Production code never passes `rng` — it defaults to real `Math.random`.
Tests inject a stubbed/fixed `rng` sequence for deterministic
assertions, instead of mocking `Math.random` globally. All existing
`new GameEngine(state)` call sites are unaffected (optional, defaulted
param).

## The first consumer: `getStealthConcealment`

```ts
getStealthConcealment(locationId?: LocationId): CheckResult {
  const stealth = this.getPlayerStat("stealth");
  const { value: visibility } = this.getVisibility(locationId);
  return resolveDifficultyCheck(stealth, visibility, this.rng);
}
```

A pure query — no event, no state mutation, no player-facing verb. It's
the first place `getPlayerStat` and `getVisibility` are read together.
Defaults to the player's current location, same as `getVisibility()`
itself.

## The first player-facing verb: `sneak`

`GameEngine.toggleStealth()` flips `Player.stealthMode` — a persistent
player intent, not a one-shot roll. Two fields on `Player`, kept
deliberately separate:

- `stealthMode: boolean` — set only by `toggleStealth`. Survives a failed
  roll; it's "am I trying to sneak," not "did the last roll succeed."
- `concealment?: CheckOutcomeTier` — the last roll's outcome, refreshed
  only when a roll actually happens; `undefined` whenever `stealthMode`
  is `false`.

Rolls happen at exactly two triggers, both re-rolling
`getStealthConcealment()` for the CURRENT location via a private
`rerollConcealment()` helper:

1. **Turning `stealthMode` on** — rolls immediately, so the player learns
   their status the instant they engage rather than after their next
   move.
2. **Every successful `travelTo`/`executeHop` arrival while `stealthMode`
   is already `true`** — both call sites gate the re-roll on
   `this.state.player.stealthMode` right after `moveTo`, so
   `getStealthConcealment()`'s location-defaulting reads the NEW
   location.

Turning `stealthMode` off clears `concealment` back to `undefined` and
does **not** roll. There is deliberately no idle re-roll while standing
still — there's no `wait`/`pass time` verb to hang one off yet (see
`docs/systems/time.md`'s own known gap), and nothing changes if the
player doesn't move.

`concealment`'s tier is surfaced as flavor text via
`concealment.tier.<tier>` i18n keys (`event.concealmentUpdated`),
mirroring `visibility.tier.<tier>`/`event.locationVisibility`'s exact
precedent.

Both fields are in the saved/mutable slice — added in
`SAVE_SCHEMA_VERSION` 9 (see `docs/systems/save.md`).

## How it interacts with other systems

- **Stats** (`docs/systems/stats.md`): `getStealthConcealment`/`sneak`
  are the stealth check consumer that doc said was "NOT built yet" — now
  built end-to-end (player-vs-environment half); NPC-notice still isn't.
- **Visibility** (`docs/systems/visibility.md`): same — its "no
  stealth/NPC-notice check consumes `getVisibility()` yet" gap is now
  resolved for the stealth half by this system's `sneak` verb.
- **Engine core** (`docs/systems/engine-core.md`): `getStealthConcealment`,
  `toggleStealth` are both listed in the public capabilities table; the
  constructor's `rng` parameter is the first randomness the engine has
  ever needed.
- **Save** (`docs/systems/save.md`): `Player.stealthMode`/`concealment`
  are why `SAVE_SCHEMA_VERSION` bumped from 8 to 9.

## Known gaps

- **No NPC-notice check.** Would need an NPC perception/awareness
  `StatKey`, which doesn't exist in `STAT_DEFINITIONS` yet — trivial to
  add (one registry entry) when that round comes.
- **No gameplay consequence of being exposed.** `concealment` is purely
  informational this round — no NPC reacts to it, and there's no
  movement/verb restriction while `stealthMode` is true.
- **`resolveContestedCheck` has no caller yet.** Exported and tested,
  built ahead of its consumer — no combat system, no dodge-vs-handguns
  check exists to call it.
- **No idle re-roll.** Only toggle-on and travel trigger a roll; standing
  still never refreshes `concealment` — see "The first player-facing
  verb" above.

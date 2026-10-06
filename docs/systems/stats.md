# System: Stats (`src/engine/stats/stats.ts`)

## What it does

A universal, 0-100 stat lookup shared by Player, NPC, and (later)
Location — one central registry plus one fallback function, instead of
three parallel per-entity implementations. The design reasoning mirrors
`docs/systems/visibility.md`'s: stats have multiple future consumers (a
stealth/notice check, an intimidation-gated dialogue option, a handguns
check for a combat mode), and those consumers all read the SAME kind of
number the same way regardless of whose stat it is — so the lookup and
its fallback behavior belong in one shared place, not duplicated per
entity type.

Every stat uses the same 0-100 scale as
`engine/visibility/visibility.ts`'s `VISIBILITY_TIER_VALUES`, so a future
consumer (e.g. a stealth check) can combine a stat value and a visibility
value arithmetically without a unit conversion.

This round is deliberately **storage + content-authoring + query only** —
no mutation API/verb, no stealth mechanic, no NPC stat changing at
runtime, no combat. See `docs/future_work.md`'s "Stats"/"Stealth"
entries, which this system is the dependency for.

## Public capabilities

- `StatKey` (`engine/types.ts`) — `"stealth" | "intimidation" |
  "handguns"`. The starting set, drawn directly from
  `docs/future_work.md`'s "Stats" idea — small and deliberately not
  over-invented; adding a new one later is a one-entry registry addition,
  not a redesign.
- `StatBlock` (`engine/types.ts`) — `Partial<Record<StatKey, number>>`.
  An optional stat record any entity can carry; a missing key or a
  missing object entirely are both valid and fall back to a default.
- `Npc.stats?: StatBlock` — fixed, content-authored values (e.g. a
  bouncer's high intimidation). No mutation API — NPC stats don't change
  at runtime this round — and no save-schema impact, since NPCs are
  static content, never saved (see `GameState`'s doc comment on why
  `npcs` is never part of the saved slice).
- `Player.stats?: StatBlock` — added in `SAVE_SCHEMA_VERSION` 8, in the
  mutable/saved slice. Optional and NOT eagerly populated for every
  `StatKey`; `content/world.ts`'s `createInitialState` seeds it as `{}`
  for a fresh game (cosmetic — behaves identically to `undefined`).
- `STAT_DEFINITIONS: Record<StatKey, StatDefinition>` — the central
  registry, the ONE place a new stat is added. Each entry:
  `{ key, min, max, default, displayNameKey }`. `displayNameKey` is
  reserved for a future UI (a character sheet, a skill-check message) —
  not consumed anywhere yet, same posture `VisibilityTier` had before any
  view read tier semantics.
- `getStatValue(block, key): number` — THE single shared lookup every
  entity type goes through. `block` may be `undefined` (entity has no
  stats authored/stored at all) or missing `key` specifically (authored
  before this key existed, or never set) — both fall back to that
  stat's OWN registry default, not one single global default, since
  e.g. `handguns` and `stealth` have different sensible baselines.
  Clamps to `[min, max]` even on an already-stored/authored value, so a
  value that predates a later-tightened range doesn't silently misbehave.
- `GameEngine.getPlayerStat(key): number` / `GameEngine.getNpcStat(npcId,
  key): number` — pure queries (no event, no state mutation), both
  thin callers over `getStatValue`. Two concrete, discoverable methods
  rather than one generic dispatcher — matches `getVisibility()`'s own
  naming precedent — leaving room for a natural `getLocationStat(id,
  key)` later without touching either.

## Why NPC stats are content-only and Player stats have no mutation API

Both are explicit v1 scope decisions, not oversights:

- **NPC stats are fixed this round** because nothing yet needs an NPC's
  stat to change during play (no relationship/morale system exists) —
  authoring them like `baseVisibility` is the minimal shape that still
  lets content express "this bouncer is intimidating."
- **Player stats have storage + fallback but no mutation verb** because
  no system yet writes to them (no training/leveling, no skill-check
  outcome loop) — this mirrors the Visibility system's own "computation +
  authoring, no consumer" precedent. A future system can write to
  `Player.stats` once it exists, without any change here.

## How it interacts with other systems

- **Visibility**: both use the same 0-100 scale specifically so a future
  stealth/notice check can combine `getVisibility()`'s value with
  `getStatValue()`'s — see `docs/systems/visibility.md`'s "How it
  interacts with other systems." `GameEngine.getStealthConcealment()`
  and the `sneak` verb (`GameEngine.toggleStealth()`, see
  `docs/systems/checks.md`) are now that consumer, for the
  player-vs-environment half; an NPC-notice check is still not built.
- **Content/editor**: `Npc.stats` is authored exactly like any other
  optional content field — see `docs/content-schema.md`'s Npc section.
  The map editor's NPC tab (added 2026-09-23, `stats` support added in
  its Stage 3 the same day — see `docs/architecture.md`'s "The NPC
  editor") has a plain number `fieldRow` per `StatKey`, with a blank
  field meaning "not authored" (shown via a `placeholder` hint naming
  that stat's registry default) rather than authoring an explicit `0`.
  An out-of-range value is rejected at Save via the shared `notice`
  banner, using each key's `STAT_DEFINITIONS[key].min`/`.max` directly.
- **Save**: `Player.stats?` is the reason `SAVE_SCHEMA_VERSION` bumped
  from 7 to 8 — see `docs/systems/save.md`'s "Versioning" section, and
  the new `migrate()` function this system introduced (the first real
  migration in the codebase; a schema-7 save simply has no `stats` key,
  which is already valid, so no numeric backfill was needed).
- **Checks** (`docs/systems/checks.md`): `getStatValue`'s output (via
  `GameEngine.getPlayerStat`) is one of the two inputs to
  `resolveDifficultyCheck`/`resolveContestedCheck`, the generic opposed-
  check resolver this system was built ahead of.
- **NPC-notice, examine-detail gating, combat: NOT built yet.** Stealth-
  vs-visibility is now fully built end-to-end (`getStealthConcealment` +
  the `sneak` verb); NPC-notice still needs a perception/awareness
  `StatKey` that doesn't exist yet, and no combat system exists to
  consume `resolveContestedCheck`. See `docs/future_work.md`'s
  "Stealth"/"Combat system" entries.

## Known gaps

- No mutation API/verb for stats themselves — nothing in the game can
  currently raise or lower a stat during play, for either Player or NPC.
  (`Player.stealthMode`/`concealment`, added alongside the `sneak` verb,
  are check-outcome state, not a stat mutation.)
- Stealth-vs-visibility now has a full consumer (`getStealthConcealment`
  + `sneak`, see `docs/systems/checks.md`); NPC-notice does not — it
  needs a perception/awareness `StatKey` that doesn't exist in
  `STAT_DEFINITIONS` yet.
- No combat system.
- No `Location.stats` — the registry/`getStatValue` are already generic
  enough to support it later (a location's own "search difficulty" or
  similar) without redesign; nothing here precludes it.

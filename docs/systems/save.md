# Save/Load

**Status: built** — manual save/load, single slot, `localStorage`-backed.
No autosave yet; see "Not yet built" below.

## The prerequisite: separating placement from content

Before any save/load code could be written, `GameState` needed a clean
split between what reloads fresh from content every launch and what a
save file actually has to persist — see `docs/architecture.md`'s "Static
content vs. mutable state". That split is now in place:

- **Static content** (never saved): `locations`, `worldObjects`, `npcs`,
  `transitLines`, `passes` — reloaded from `content/city/world.yaml` via
  `cityLoader.ts` every time `content/world.ts`'s `loadCityContent()` (or
  `createInitialState()`) runs.
- **Mutable state** (the save target): `player`, `clock`, `placement`,
  and `flags` (a flat `Record<string, boolean>` used by dialogue
  conditions — see `docs/systems/dialogue.md`). `placement` holds
  `worldObjectLocationId`/`npcLocationId` (an id -> `LocationId` lookup
  for WHERE every world object/NPC currently is) and `containedIn` (an id
  -> `{containerId, partId}` lookup for a world object placed inside
  another's part instead — see `docs/systems/parts.md`'s "Containment").
  It's populated at case start (today: copied from `world.yaml`'s
  authored `itemIds`/`npcIds`/`locationId`/`containerId`/`containerPartId`
  fields by `cityLoader.ts`, into `CityContent.initialPlacement`; later:
  produced by a procedural case generator) and mutates during play
  (`GameEngine.takeItem` deletes an entry from
  `placement.worldObjectLocationId`/`placement.containedIn`).
  `engine/placement.ts`'s `worldObjectsAtLocation`/`npcsAtLocation`/
  `containedWorldObjectsIn` are the reverse-index lookups `GameEngine`
  uses instead of a field on `Location`/`Npc`.

This is why `Location`/`Npc` don't carry `itemIds`/`npcIds`/`locationId`
at runtime even though `world.yaml` still authors them per-location/
per-NPC — see `docs/content-schema.md`'s note on this. The map editor
still reads/writes those YAML fields; it reconstructs them from
`city.initialPlacement` in `save()` via the same two helpers.

## `SaveData`

A save persists exactly the mutable slice, nothing else:

```ts
interface SaveData {
  schemaVersion: number; // 13
  player: Player; // gained stats?: StatBlock in schema version 8 (docs/systems/stats.md); gained stealthMode/concealment?: CheckOutcomeTier in schema version 9 (docs/systems/checks.md)
  clock: GameClock;
  placement: Placement; // now also carries containedIn — see docs/systems/parts.md
  partStates: GameState["partStates"]; // added in schema version 2 — see docs/systems/parts.md
  notebooks: GameState["notebooks"]; // added in schema version 4; Page's per-page budget reworked in versions 5, 6, and 7 — see docs/systems/notebooks.md
  flags: GameState["flags"]; // added in schema version 10 — see docs/systems/dialogue.md
  npcStates: GameState["npcStates"]; // added in schema version 11 — see docs/systems/npcs.md
  reputation: GameState["reputation"]; // added in schema version 11
  playerFacts: GameState["playerFacts"]; // added in schema version 12 — see docs/systems/case-system.md
  board: GameState["board"]; // added in schema version 13 — see docs/systems/case-board.md
}
```

Not every mutable field is saved: `GameState.focusedWorldObjectId` (which
world object `examine` currently has focused — see
`docs/systems/parts.md`) and `GameState.examinedTarget` (which object or NPC
is being examined, driving the scene image — see `docs/systems/image-pane.md`)
are deliberately excluded, and always reset to
`null` on load — it's a transient interaction mode, not simulation state
worth persisting, the same posture `MenuFlow`'s screen stack already has.

Loading reconstructs a full `GameState` by pairing freshly-loaded static
content with a `SaveData`, via `src/engine/save/save.ts`'s
`buildStateFromSave(content: StaticContent, save: SaveData)` — `StaticContent`
is `Pick<GameState, "locations" | "worldObjects" | "npcs" | "labels" | "transitLines" | "passes" | "notebookProducts">`,
deliberately not `CityContent` itself (which also carries
`initialPlacement`/`initialNpcStates`, irrelevant here), so `engine/save/save.ts` never has to
import from `content/`. `content/world.ts`'s `loadCityContent()` is passed
directly — it structurally satisfies `StaticContent` with one extra field,
which is fine for a function argument (just not for an object literal).

If `save.schemaVersion` doesn't match `SAVE_SCHEMA_VERSION`,
`buildStateFromSave` throws `SaveVersionMismatchError` rather than
guessing — see "Versioning" below. (`StaticContent` also picks `"facts"` —
see docs/systems/case-system.md.)

No reconciliation step is needed — placement is saved and restored
verbatim, unlike an earlier draft of this design that tried to derive item
placement from `player.inventory` at load time (wrong the moment a case
generator or a future NPC-movement event makes placement not fully
recoverable from inventory alone).

**Versioning:** `schemaVersion` started at 1, was bumped to 2 when
`partStates` was added, to 3 when `Placement` gained `containedIn`
and renamed `itemLocationId` to `worldObjectLocationId` (both,
docs/systems/parts.md), to 4 when `notebooks` (`NotebookState`) was
added, to 5 when `Page` gained `maxBlockLines` (a per-entry cap), to
6 when that per-entry-cap approach was replaced with a flat
`Page.charCapacity`, to 7 when `Page`/`NotebookProduct.lineCharCap`
was dropped entirely (docs/systems/notebooks.md's "Page overflow"/"The
notebook page interface" sections, revised across three rounds of
playtesting), to 8 when `Player` gained `stats?: StatBlock` (see
docs/systems/stats.md), to 9 when `Player` gained `stealthMode:
boolean` and `concealment?: CheckOutcomeTier` (see
docs/systems/checks.md's "The first player-facing verb" section), and
to 10 when `GameState` gained `flags: Record<string, boolean>` (see
docs/systems/dialogue.md), to 11 when `GameState` gained `npcStates`
and `reputation` (see docs/systems/npcs.md), to 12 when `GameState`
gained `playerFacts` (see docs/systems/case-system.md), and to 13 when
`GameState` gained `board` (see docs/systems/case-board.md).

Schema 8 introduced the codebase's **first real migration function**:
`save.ts`'s `migrate(save)` upgrades an older `SaveData` to the current
shape when it can, called at the start of `buildStateFromSave` before the
version check. For the 7 → 8 step this is nearly a no-op — a schema-7
save simply has no `player.stats` key, which is already valid (absent
just means `getStatValue`'s per-key fallback applies), so `migrate` only
needs to bump the recorded `schemaVersion`, not backfill any data. Future
bumps that need real backward compatibility (a rename, a newly-required
field) add one more chained `if (current.schemaVersion === N)` step to
the same function, rather than one cumulative rewrite. `migrate` can only
bring a save up to `SAVE_SCHEMA_VERSION`; anything it can't resolve (a
much older or a future/corrupt version) still throws
`SaveVersionMismatchError`, unchanged from before.

The 8 → 9 step is the first migration that actually backfills a value
rather than just accepting the version bump: `stealthMode` is a
non-optional `boolean` (unlike `stats?`, which could stay legitimately
absent), so a schema-8 save with no `stealthMode` key needs it set to
`false` explicitly — `concealment` stays correctly absent either way,
since it's optional.

The 9 → 10 step backfills `flags: {}` — a pre-existing save has no
flags, since nobody had talked to anyone or triggered anything before
`GameState.flags` existed (see docs/systems/dialogue.md).

The 10 → 11 step backfills `npcStates: {}` and `reputation: { global: 0,
byLabel: {} }`. Empty is valid for both (`getNpcState` creates blank state
lazily), but a migrated save does NOT receive each NPC's authored initial
trust/memories/knowledge — only new games seed those.

The 11 → 12 step backfills `playerFacts: {}` — nobody had learned a fact
before `GameState.playerFacts` existed (see docs/systems/case-system.md).

The 12 → 13 step backfills `board: { nodes: [], connections: [] }` — a
REQUIRED field (unlike `stats?`), so this is a real backfill, not just a
version-bump accept; nobody had a case board before `GameState.board`
existed (see docs/systems/case-board.md).

**Extending this for a new system:** any future persistent state (a
case/deduction tracker, NPC schedule/relationship state) must live in
the mutable slice (on `Player`, or a new sibling struct next to it,
`placement`, and now `flags`) — see `CLAUDE.md`'s boundary #6. If a new system's
state can be fully derived from data already in the mutable slice, a
reconciliation step at load time is fine (there wasn't one needed for
placement, but there could be for something else later); if it can't be
derived, it needs its own explicit field, or it will silently fail to
survive a save/load round-trip.

## Where the pieces live

- `src/engine/save/save.ts` — `SaveData`, `serializeState`,
  `buildStateFromSave`, `SaveVersionMismatchError`. Pure, headless, no
  storage — see `save.test.ts` for round-trip and version-mismatch
  coverage, including that an item's removal from its starting location
  (not just its addition to inventory) survives a round-trip.
- `src/view/save/browserSaveStore.ts` — `saveToStorage`/`loadFromStorage`,
  a thin `localStorage` adapter (single fixed key, single slot). The only
  piece that knows a save lives in the browser.
- `GameEngine.loadState(state: GameState): void` — the one path that
  replaces the engine's entire state wholesale, so a view can swap in a
  freshly-loaded `GameState` while keeping the same `GameEngine` instance
  (and every reference to it) rather than reconstructing one.
- `save`/`load` verbs (`Command.ts`, `EnglishCommandParser.ts`) and their
  handlers in `TerminalView.dispatch`/`TerminalView.loadGame` — `loadGame`
  pairs the saved mutable slice with `content/world.ts`'s
  `loadCityContent()` (fresh content, not whatever the engine was already
  holding), calls `engine.loadState`, then re-runs `look()` so the player
  sees where the loaded game left them.

## Not yet built

- **Autosave.** Manual `save`/`load` only, for now — no save-on-quit or
  save-on-travel. Worth revisiting once there's real play-session data to
  judge a sensible cadence against, rather than guessing now.
- **Multiple save slots.** One fixed `localStorage` key; a second save
  overwrites the first.
- **Further schema migrations.** The 7 → 8 step (see "Versioning" above)
  introduced the first real `migrate()` function, but it's a minimal
  case — a purely additive optional field needs no data backfill, only
  the version bump. A future migration that renames a field or adds a
  required one will need to actually transform `save`'s shape inside
  `migrate`, not just accept the new version number.

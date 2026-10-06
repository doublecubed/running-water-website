import type { BoardState, GameClock, GameState, NotebookState, Placement, Player } from "../types";

/**
 * The save/load design this implements — why only `player`/`clock`/
 * `placement` are persisted, never `locations`/`items`/`npcs`/
 * `transitLines`/`passes` — is documented in docs/systems/save.md and
 * docs/architecture.md's "Static content vs. mutable state". This module
 * is pure and headless (no storage, no DOM) — see CLAUDE.md's engine/view
 * boundary; `src/view/save/browserSaveStore.ts` is the only piece that
 * knows a save lives in `localStorage`.
 */

/** Bumped only when the shape of `SaveData` itself changes. `buildStateFromSave` runs `migrate()` first, which brings an older save up to this version when it can — see docs/systems/save.md. */
export const SAVE_SCHEMA_VERSION = 13;

export interface SaveData {
  schemaVersion: number;
  player: Player;
  clock: GameClock;
  placement: Placement;
  /** Every part's current state — see `GameState.partStates` and docs/systems/parts.md. Deliberately does NOT include `focusedWorldObjectId`, which always resets to `null` on load — see `buildStateFromSave`. */
  partStates: GameState["partStates"];
  /** Every notebook the player owns, plus which is active — added in schema version 4; `Page` shape changed in version 5 (`maxBlockLines` added), again in version 6 (`lineCapacity`/`maxBlockLines` replaced by a flat `charCapacity`), and again in version 7 (`lineCharCap` dropped entirely — no character-per-line concept anywhere anymore). See `NotebookState` and docs/systems/notebooks.md. */
  notebooks: NotebookState;
  /** Global dialogue-condition flag store — added in schema version 10. See `GameState.flags` and docs/systems/dialogue.md. */
  flags: GameState["flags"];
  /** Per-NPC trust/memories/opinions/knowledge — added in schema version 11. See `NpcState` and docs/systems/npcs.md. */
  npcStates: GameState["npcStates"];
  /** Global + per-label player reputation — added in schema version 11. */
  reputation: GameState["reputation"];
  /** Facts the player has learned, with when — added in schema version 12. See `GameState.playerFacts` and docs/systems/case-system.md. */
  playerFacts: GameState["playerFacts"];
  /** The player's case board — added in schema version 13. See `BoardState` and docs/systems/case-board.md. */
  board: BoardState;
}

/** The static-content half of `GameState` a save is paired with at load time — everything EXCEPT the mutable slice a `SaveData` carries. See `content/world.ts`'s `loadCityContent()`, which returns exactly this shape (plus its own `initialPlacement`/`initialNpcStates`, unused here). */
export type StaticContent = Pick<GameState, "locations" | "worldObjects" | "npcs" | "labels" | "transitLines" | "passes" | "notebookProducts" | "facts">;

/** Thrown by `buildStateFromSave` when `save.schemaVersion` doesn't match `SAVE_SCHEMA_VERSION` — the caller (a view) is expected to catch this and report it as a normal failed action, not a crash. */
export class SaveVersionMismatchError extends Error {
  constructor(public readonly foundVersion: number) {
    super(`This save is schema version ${foundVersion}, but this build expects version ${SAVE_SCHEMA_VERSION}.`);
    this.name = "SaveVersionMismatchError";
  }
}

/** Captures the current mutable slice of `state` as a `SaveData` — cloned, so later mutating `state` (via GameEngine actions) can never reach back into an already-saved object. */
export function serializeState(state: GameState): SaveData {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    player: structuredClone(state.player),
    clock: structuredClone(state.clock),
    placement: structuredClone(state.placement),
    partStates: structuredClone(state.partStates),
    notebooks: structuredClone(state.notebooks),
    flags: structuredClone(state.flags),
    npcStates: structuredClone(state.npcStates),
    reputation: structuredClone(state.reputation),
    playerFacts: structuredClone(state.playerFacts),
    board: structuredClone(state.board),
  };
}

/**
 * Upgrades a save serialized under an older schema version to the CURRENT
 * shape, so an existing save keeps loading across an additive shape
 * change instead of hard-failing — see docs/systems/save.md's
 * "Versioning" section. This is the first such function in the codebase;
 * each future bump that needs to stay backward-compatible adds one more
 * chained version step here, rather than one big cumulative rewrite.
 */
function migrate(save: SaveData): SaveData {
  let current = save;
  if (current.schemaVersion === 7) {
    // Player gained stats?: StatBlock (schema 8) — an absent field is
    // already valid there (getStatValue's per-key fallback handles it),
    // so no numeric backfill is needed, just accepting the version bump.
    current = { ...current, schemaVersion: 8 };
  }
  if (current.schemaVersion === 8) {
    // Player gained stealthMode/concealment (schema 9). stealthMode
    // defaults false and concealment is absent for every pre-existing
    // save — nobody was mid-sneak before this system existed.
    current = { ...current, schemaVersion: 9, player: { ...current.player, stealthMode: false } };
  }
  if (current.schemaVersion === 9) {
    // GameState gained flags (schema 10) — a pre-existing save has none:
    // nobody had talked to anyone or triggered anything before this
    // system existed.
    current = { ...current, schemaVersion: 10, flags: {} };
  }
  if (current.schemaVersion === 10) {
    // GameState gained npcStates/reputation (schema 11). Empty is valid for
    // both: `getNpcState` creates a blank state lazily, and reputation
    // starts neutral. A pre-existing save simply has no NPC history — but
    // it also loses the NPCs' AUTHORED initial trust/memories/knowledge,
    // which only new games seed; acceptable, since nothing authored
    // existed to lose before this schema.
    current = { ...current, schemaVersion: 11, npcStates: {}, reputation: { global: 0, byLabel: {} } };
  }
  if (current.schemaVersion === 11) {
    // GameState gained playerFacts (schema 12) — nobody had learned
    // anything before this system existed.
    current = { ...current, schemaVersion: 12, playerFacts: {} };
  }
  if (current.schemaVersion === 12) {
    // GameState gained board (schema 13) — nobody had a case board before
    // this system existed; it's a required field (not optional), so this
    // needs a real backfill, not just accepting the version bump.
    current = { ...current, schemaVersion: 13, board: { nodes: [], connections: [] } };
  }
  return current;
}

/**
 * Rebuilds a full `GameState` from freshly-loaded static content plus a
 * saved mutable slice. No reconciliation between the two is needed —
 * `placement` is restored verbatim, since it's case-instance data a save
 * genuinely owns, not something derivable from `content` (see
 * docs/systems/save.md for why an earlier draft of this design tried, and
 * incorrectly, to derive item placement from `player.inventory` instead).
 */
export function buildStateFromSave(content: StaticContent, save: SaveData): GameState {
  const migrated = migrate(save);
  if (migrated.schemaVersion !== SAVE_SCHEMA_VERSION) {
    throw new SaveVersionMismatchError(migrated.schemaVersion);
  }
  return {
    locations: content.locations,
    worldObjects: content.worldObjects,
    npcs: content.npcs,
    labels: content.labels,
    transitLines: content.transitLines,
    passes: content.passes,
    notebookProducts: content.notebookProducts,
    facts: content.facts,
    player: migrated.player,
    clock: migrated.clock,
    placement: migrated.placement,
    partStates: migrated.partStates,
    notebooks: migrated.notebooks,
    flags: migrated.flags,
    npcStates: migrated.npcStates,
    reputation: migrated.reputation,
    playerFacts: migrated.playerFacts,
    board: migrated.board,
    // Focus is a transient interaction mode, not simulation state worth
    // saving — a freshly-loaded game always starts unfocused, the same
    // posture MenuFlow's screen stack already has. See GameState.focusedWorldObjectId.
    focusedWorldObjectId: null,
    examinedTarget: null,
  };
}

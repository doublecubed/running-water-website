import type { FactId, GameState, KnowledgeDisposition, NpcId, NpcState, Reputation } from "../types";

/**
 * Accessors and mutators for the mutable per-NPC layer (`GameState.npcStates`,
 * `GameState.reputation`). Kept as free functions over `GameState` — like
 * `placement.ts` — so the engine, the condition evaluator and tests all go
 * through one place. See docs/systems/npcs.md.
 */

/** Blank state for an NPC with no authored initial values. */
export function newNpcState(): NpcState {
  return { trust: 0, suspicion: 0, memories: [], opinions: {}, knowledge: {} };
}

export function newReputation(): Reputation {
  return { global: 0, byLabel: {} };
}

/**
 * This NPC's mutable state, created on demand. Lazy creation (rather than
 * assuming every NPC has an entry) is what lets an NPC added to content
 * AFTER a save was made simply start blank instead of crashing — the same
 * fall-back-to-default posture `GameEngine.currentPartStateId` takes for
 * parts.
 */
export function getNpcState(state: GameState, npcId: NpcId): NpcState {
  return (state.npcStates[npcId] ??= newNpcState());
}

export function adjustTrust(state: GameState, npcId: NpcId, delta: number): void {
  getNpcState(state, npcId).trust += delta;
}

export function adjustSuspicion(state: GameState, npcId: NpcId, delta: number): void {
  getNpcState(state, npcId).suspicion += delta;
}

/** `subject` is `"player"` or `"npc:<id>"` — see `NpcState.opinions`. */
export function adjustOpinion(state: GameState, npcId: NpcId, subject: string, delta: number): void {
  const opinions = getNpcState(state, npcId).opinions;
  opinions[subject] = (opinions[subject] ?? 0) + delta;
}

/** `scope` is `"global"` or a label id. */
export function adjustReputation(state: GameState, scope: "global" | string, delta: number): void {
  if (scope === "global") {
    state.reputation.global += delta;
  } else {
    state.reputation.byLabel[scope] = (state.reputation.byLabel[scope] ?? 0) + delta;
  }
}

export function setKnowledge(state: GameState, npcId: NpcId, factId: FactId, disposition: KnowledgeDisposition): void {
  getNpcState(state, npcId).knowledge[factId] = disposition;
}

/** An NPC's disposition toward a fact; a fact they have no entry for is `"unaware"`. */
export function getKnowledge(state: GameState, npcId: NpcId, factId: FactId): KnowledgeDisposition {
  return state.npcStates[npcId]?.knowledge[factId] ?? "unaware";
}

/**
 * Records `factId` as learned by the PLAYER, stamped with the current clock
 * time. First-learned time wins — idempotent, like `setKnowledge`'s
 * overwrite-is-safe posture, except here a second call is a no-op rather
 * than an overwrite, since "when did I first learn this" shouldn't move.
 */
export function learnFact(state: GameState, factId: FactId): void {
  if (state.playerFacts[factId] !== undefined) return;
  state.playerFacts[factId] = { atMinutes: state.clock.minutesElapsed };
}

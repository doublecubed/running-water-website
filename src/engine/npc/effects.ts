import type { DialogueEffect, GameState, NpcId } from "../types";
import { addMemory } from "./memory";
import { adjustOpinion, adjustReputation, adjustSuspicion, adjustTrust, learnFact, setKnowledge } from "./state";

/**
 * Applies a selected dialogue rule's effects. This is the first production
 * caller of the NPC mutators: conversation is how the player's words become
 * changes to trust, suspicion, reputation and knowledge. Kept out of
 * `GameEngine` so it stays a pure state transform testable on its own.
 */
export function applyDialogueEffects(state: GameState, npcId: NpcId, effects: readonly DialogueEffect[]): void {
  for (const effect of effects) {
    if ("trust" in effect) adjustTrust(state, npcId, effect.trust);
    else if ("suspicion" in effect) adjustSuspicion(state, npcId, effect.suspicion);
    else if ("opinion" in effect) adjustOpinion(state, npcId, effect.opinion.subject, effect.opinion.delta);
    else if ("reputation" in effect) adjustReputation(state, effect.reputation.scope, effect.reputation.delta);
    else if ("setFlag" in effect) state.flags[effect.setFlag] = true;
    else if ("knowledge" in effect) setKnowledge(state, npcId, effect.knowledge.fact, effect.knowledge.disposition);
    else if ("learnFact" in effect) learnFact(state, effect.learnFact);
    else addMemory(state, npcId, { ...effect.memory, atMinutes: state.clock.minutesElapsed, source: "told", valence: 0 });
  }
}

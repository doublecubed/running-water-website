import type { GameState, NpcId } from "../types";

/**
 * Derived opinions — computed on demand from stored trust/opinions/
 * reputation plus label data, never stored themselves (the lazy-derivation
 * posture docs/systems/time.md describes). See docs/systems/npcs.md.
 */

/**
 * How `npcId` feels about the player right now: their personal trust, plus
 * the player's global reputation, plus the reputation earned under each
 * label the NPC carries, plus each carried label's flat `trustOffset`.
 * Trust is private to the NPC; reputation is public — that split is why
 * both exist.
 */
export function getOpinionOfPlayer(state: GameState, npcId: NpcId): number {
  const npc = state.npcs[npcId];
  if (!npc) return 0;
  let total = (state.npcStates[npcId]?.trust ?? 0) + state.reputation.global;
  for (const labelId of npc.labels) {
    total += state.reputation.byLabel[labelId] ?? 0;
    total += state.labels[labelId]?.trustOffset ?? 0;
  }
  return total;
}

/**
 * How `fromId` feels about `toId`: their stored personal opinion, plus each
 * (carried label -> target's label) offset the FROM NPC's labels declare.
 */
export function getOpinionOfNpc(state: GameState, fromId: NpcId, toId: NpcId): number {
  const from = state.npcs[fromId];
  const to = state.npcs[toId];
  if (!from || !to) return 0;
  let total = state.npcStates[fromId]?.opinions[`npc:${toId}`] ?? 0;
  for (const fromLabel of from.labels) {
    const offsets = state.labels[fromLabel]?.labelOpinions ?? {};
    for (const toLabel of to.labels) total += offsets[toLabel] ?? 0;
  }
  return total;
}

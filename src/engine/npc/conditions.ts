import type { ComparisonOp, Condition, GameState, NpcId } from "../types";
import { npcRemembers } from "./memory";
import { getKnowledge } from "./state";
import { getOpinionOfPlayer } from "./opinion";

/**
 * Evaluates a structured `Condition` in the context of ONE NPC (the one
 * being talked to): `npcStat`/`knows`/`memory`/`hasLabel` all mean "this
 * NPC's". Pure and synchronous — no state mutation. See docs/systems/npcs.md.
 */

export function compare(actual: number, op: ComparisonOp, expected: number): boolean {
  switch (op) {
    case "<":
      return actual < expected;
    case "<=":
      return actual <= expected;
    case ">":
      return actual > expected;
    case ">=":
      return actual >= expected;
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
  }
}

export function evaluateCondition(state: GameState, npcId: NpcId, condition: Condition): boolean {
  if ("flag" in condition) return state.flags[condition.flag] === true;
  if ("not" in condition) return !evaluateCondition(state, npcId, condition.not);
  if ("all" in condition) return condition.all.every((c) => evaluateCondition(state, npcId, c));
  if ("any" in condition) return condition.any.some((c) => evaluateCondition(state, npcId, c));
  if ("npcStat" in condition) {
    const npcState = state.npcStates[npcId];
    const actual =
      condition.npcStat === "opinionOfPlayer" ? getOpinionOfPlayer(state, npcId) : (npcState?.[condition.npcStat] ?? 0);
    return compare(actual, condition.op, condition.value);
  }
  if ("knows" in condition) return getKnowledge(state, npcId, condition.knows) === "knows";
  if ("memory" in condition) return npcRemembers(state, npcId, condition.memory);
  if ("hasLabel" in condition) return state.npcs[npcId]?.labels.includes(condition.hasLabel) ?? false;
  if ("playerKnows" in condition) return state.playerFacts[condition.playerKnows] !== undefined;
  const { scope, op, value } = condition.reputation;
  const actual = scope === "global" ? state.reputation.global : (state.reputation.byLabel[scope] ?? 0);
  return compare(actual, op, value);
}

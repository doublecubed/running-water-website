import type { GameState, Memory, MemoryPattern, MemoryVerb, NpcId, Observation, Ref } from "../types";
import { MEMORY_VERBS, REF_KINDS } from "../types";
import { npcsAtLocation } from "../placement";
import { getNpcState } from "./state";

/**
 * Memories: structured, deterministic, no free text — see
 * docs/systems/npcs.md's "Memory syntax". This module owns parsing the
 * authoring shorthand, matching patterns, and the witness step that turns
 * an `Observation` into `Memory`s.
 */

/** Per-NPC memory cap — oldest dropped first — so a long game can't grow a save without bound. */
export const MAX_MEMORIES_PER_NPC = 50;

const VERB_SET: ReadonlySet<string> = new Set(MEMORY_VERBS);

/** Parses a ref token: `player`, or `kind:id` (`npc:barkeep`, `object:ledger`, `location:docks`, `fact:alibi`). Returns an error string on failure. */
export function parseRef(token: string): Ref | string {
  if (token === "player") return { kind: "player" };
  const colon = token.indexOf(":");
  if (colon <= 0 || colon === token.length - 1) return `"${token}" is not a valid reference (expected "player" or "<kind>:<id>").`;
  const kind = token.slice(0, colon);
  const id = token.slice(colon + 1);
  if (!(REF_KINDS as readonly string[]).includes(kind) || kind === "player") {
    return `"${token}" has unknown reference kind "${kind}" (expected one of: npc, object, location, fact).`;
  }
  return { kind: kind as Ref["kind"], id };
}

/**
 * Parses the authoring shorthand `<subject> <verb> [<object>] [@<location>]`
 * (e.g. `"npc:barkeep saw player @docks"`) into an `Observation`. Returns
 * `{ error }` for malformed input so `cityLoader.ts` can report it as a
 * load-time content error, like every other content validation.
 */
export function parseMemoryShorthand(text: string): Observation | { error: string } {
  const tokens = text.trim().split(/\s+/).filter((t) => t.length > 0);
  let locationId: string | undefined;
  const last = tokens[tokens.length - 1];
  if (last?.startsWith("@")) {
    locationId = last.slice(1);
    tokens.pop();
    if (locationId.length === 0) return { error: `"${text}" has an empty @location.` };
  }
  if (tokens.length < 2 || tokens.length > 3) {
    return { error: `"${text}" must look like "<subject> <verb> [<object>] [@<location>]".` };
  }
  const [subjectToken, verb, objectToken] = tokens as [string, string, string | undefined];
  if (!VERB_SET.has(verb)) return { error: `"${text}" has unknown verb "${verb}" (expected one of: ${MEMORY_VERBS.join(", ")}).` };
  const subject = parseRef(subjectToken);
  if (typeof subject === "string") return { error: `"${text}": ${subject}` };
  let object: Ref | undefined;
  if (objectToken !== undefined) {
    const parsed = parseRef(objectToken);
    if (typeof parsed === "string") return { error: `"${text}": ${parsed}` };
    object = parsed;
  }
  return { verb: verb as MemoryVerb, subject, ...(object ? { object } : {}), ...(locationId ? { locationId } : {}) };
}

function refMatches(want: Ref | undefined, have: Ref | undefined): boolean {
  if (want === undefined) return true;
  if (have === undefined) return false;
  return want.kind === have.kind && (want.id === undefined || want.id === have.id);
}

/** True when `memory` satisfies every present field of `pattern` (absent fields are wildcards). */
export function memoryMatches(memory: Memory, pattern: MemoryPattern, nowMinutes: number): boolean {
  if (pattern.verb !== undefined && pattern.verb !== memory.verb) return false;
  if (!refMatches(pattern.subject, memory.subject)) return false;
  if (!refMatches(pattern.object, memory.object)) return false;
  if (pattern.locationId !== undefined && pattern.locationId !== memory.locationId) return false;
  if (pattern.withinMinutes !== undefined && nowMinutes - memory.atMinutes > pattern.withinMinutes) return false;
  return true;
}

/** Whether `npcId` holds any memory matching `pattern` right now. */
export function npcRemembers(state: GameState, npcId: NpcId, pattern: MemoryPattern): boolean {
  const memories = state.npcStates[npcId]?.memories ?? [];
  return memories.some((m) => memoryMatches(m, pattern, state.clock.minutesElapsed));
}

/** Appends a memory to `npcId`, dropping the oldest beyond `MAX_MEMORIES_PER_NPC`. */
export function addMemory(state: GameState, npcId: NpcId, memory: Memory): void {
  const memories = getNpcState(state, npcId).memories;
  memories.push(memory);
  if (memories.length > MAX_MEMORIES_PER_NPC) memories.splice(0, memories.length - MAX_MEMORIES_PER_NPC);
}

/**
 * Is the PLAYER currently unseen? v1 rule (see docs/systems/npcs.md's
 * "Witness step"): sneaking with a successful concealment roll hides the
 * player's own actions from bystanders. Reads the existing
 * `Player.stealthMode`/`concealment` — no new roll happens here.
 */
export function playerIsConcealed(state: GameState): boolean {
  const { stealthMode, concealment } = state.player;
  return stealthMode && (concealment === "succeeded" || concealment === "succeededWell" || concealment === "succeededSpectacularly");
}

/**
 * The witness step: gives `observation` as a `"witnessed"` memory to every
 * NPC placed at its location. A player-subject observation is skipped for
 * bystanders while `playerIsConcealed`; `participants` (e.g. the NPC being
 * spoken to) always witness regardless, since they're directly involved.
 * Returns the NPC ids that recorded it.
 */
export function witnessObservation(state: GameState, observation: Observation, options: { participants?: NpcId[] } = {}): NpcId[] {
  const locationId = observation.locationId;
  if (locationId === undefined) return [];
  const participants = options.participants ?? [];
  const hidden = observation.subject.kind === "player" && playerIsConcealed(state);
  const recorded: NpcId[] = [];
  const present = new Set([...npcsAtLocation(state.placement, locationId), ...participants]);
  for (const npcId of present) {
    // An NPC never "witnesses" themselves being the subject of their own action.
    if (observation.subject.kind === "npc" && observation.subject.id === npcId) continue;
    if (hidden && !participants.includes(npcId)) continue;
    addMemory(state, npcId, { ...observation, atMinutes: state.clock.minutesElapsed, source: "witnessed", valence: 0 });
    recorded.push(npcId);
  }
  return recorded;
}

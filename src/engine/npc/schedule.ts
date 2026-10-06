import type { GameState, LocationId, Npc, NpcId } from "../types";
import { toCalendarDate } from "../time/calendar";

/**
 * NPC schedules. The seam is `NpcScheduleProvider`: version one is a
 * lookup table, but a future "NPC engine" (travel, autonomous behaviour,
 * an "in transit" state) implements the same interface and is swapped in
 * without touching callers. See docs/systems/npcs.md's "Schedules".
 */
export interface NpcScheduleProvider {
  /** Where `npc` should be at `state.clock`, or `null` for "no opinion — stay put". */
  resolveLocation(npc: Npc, state: GameState): LocationId | null;
}

/** Whether `hour` falls in a slot; `fromHour > toHour` wraps past midnight. */
function hourInSlot(hour: number, fromHour: number, toHour: number): boolean {
  return fromHour <= toHour ? hour >= fromHour && hour < toHour : hour >= fromHour || hour < toHour;
}

/** Reads `Npc.schedule`; the first slot matching the current hour (and weekday, if restricted) wins. */
export const tableScheduleProvider: NpcScheduleProvider = {
  resolveLocation(npc, state) {
    if (!npc.schedule?.length) return null;
    const { hour, weekday } = toCalendarDate(state.clock.epoch, state.clock.minutesElapsed);
    for (const slot of npc.schedule) {
      if (slot.weekdays && !slot.weekdays.includes(weekday)) continue;
      if (hourInSlot(hour, slot.fromHour, slot.toHour)) return slot.locationId;
    }
    return null;
  },
};

/**
 * Writes each scheduled NPC's resolved location into
 * `placement.npcLocationId`. Placement stays the single stored truth (so
 * saves and every existing reader are unchanged); the cost is that a big
 * clock jump teleports an NPC to wherever the schedule says NOW, with no
 * intermediate movement — accepted for v1. Returns the ids that moved.
 */
export function syncNpcLocations(state: GameState, provider: NpcScheduleProvider = tableScheduleProvider): NpcId[] {
  const moved: NpcId[] = [];
  for (const npc of Object.values(state.npcs)) {
    const target = provider.resolveLocation(npc, state);
    if (target === null || target === state.placement.npcLocationId[npc.id]) continue;
    state.placement.npcLocationId[npc.id] = target;
    moved.push(npc.id);
  }
  return moved;
}

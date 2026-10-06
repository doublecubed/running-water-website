import type { LocationId, NpcId, PartId, Placement, WorldObjectId } from "./types";

/**
 * Reverse-index helpers over `Placement` — "what's at this location" or
 * "what's inside this container," given `Placement` only stores the
 * forward direction (id -> locationId, or id -> {containerId, partId}).
 * Shared by `GameEngine` (rendering `look`/`examine`/`takeItem`) and the
 * map editor's `save()` (reconstructing each location's authored
 * `itemIds`/`npcIds` list when writing `world.yaml` back out) — see
 * docs/systems/save.md for why placement lives here instead of on
 * `Location`/`Npc` directly.
 */

export function worldObjectsAtLocation(placement: Placement, locationId: LocationId): WorldObjectId[] {
  return Object.entries(placement.worldObjectLocationId)
    .filter(([, loc]) => loc === locationId)
    .map(([id]) => id);
}

export function npcsAtLocation(placement: Placement, locationId: LocationId): NpcId[] {
  return Object.entries(placement.npcLocationId)
    .filter(([, loc]) => loc === locationId)
    .map(([npcId]) => npcId);
}

/** World objects placed INSIDE `partId` of `containerId` — see `Placement.containedIn` and docs/systems/parts.md's "Containment." */
export function containedWorldObjectsIn(placement: Placement, containerId: WorldObjectId, partId: PartId): WorldObjectId[] {
  return Object.entries(placement.containedIn)
    .filter(([, ref]) => ref.containerId === containerId && ref.partId === partId)
    .map(([id]) => id);
}

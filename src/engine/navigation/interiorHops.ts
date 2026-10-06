import type { GameState, LocationId } from "../types";

/**
 * Entering/exiting a building, or moving between two locations inside the
 * SAME building, is always this many minutes and always free — see
 * docs/systems/navigation.md's "Interiors" section. Not configurable per
 * connection; this is a flat game-wide rule, not content data.
 */
export const INTERIOR_HOP_MINUTES = 1;

/**
 * Whether a hop from `fromId` to `toId` should get the flat interior
 * rate. Derived ENTIRELY from the two Locations' `kind`/`exteriorId` —
 * NOT from a Connection's `compassLabel`. This matters: a building on a
 * multi-building street (see docs/systems/navigation.md) keeps an
 * ordinary directional compassLabel like "south" rather than "in" (since
 * "in" would be ambiguous with other doors on the same street), but
 * entering it is still exactly as free/fast as a single-door "in" case —
 * the rule doesn't care which word, if any, labels the connection.
 *
 * Covers three cases:
 *  1. Entering: exterior -> the interior it owns.
 *  2. Exiting: interior -> the exterior that owns it.
 *  3. Moving within: interior -> another interior with the same owner
 *     (a hallway, a staircase between floors, ...).
 */
export function isInteriorHop(state: GameState, fromId: LocationId, toId: LocationId): boolean {
  const from = state.locations[fromId];
  const to = state.locations[toId];
  if (!from || !to) return false;

  if (from.kind === "exterior" && to.kind === "interior") return to.exteriorId === from.id;
  if (from.kind === "interior" && to.kind === "exterior") return from.exteriorId === to.id;
  if (from.kind === "interior" && to.kind === "interior") return from.exteriorId === to.exteriorId;
  return false;
}

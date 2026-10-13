import type { GameState, LocationId } from "../types";

/**
 * The shortest route (fewest hops) from one location to another, as the
 * ordered list of location ids to walk through — `[fromId, ..., toId]` —
 * or `null` if `toId` can't be reached. Plain breadth-first search over
 * `Location.connections`, which are directional: a one-way connection is
 * followed only the way it points. Travel on the website has no distance,
 * speed, fare or time, so hop count is the only thing that matters. Pure
 * (takes a `GameState`, mutates nothing), so it's directly unit-testable
 * without `GameEngine`. See docs/systems/navigation.md.
 */
export function findPath(state: GameState, fromId: LocationId, toId: LocationId): LocationId[] | null {
  if (fromId === toId) return [fromId];
  const previous = new Map<LocationId, LocationId>();
  const queue: LocationId[] = [fromId];
  const seen = new Set<LocationId>([fromId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const connection of state.locations[current]?.connections ?? []) {
      if (seen.has(connection.toId) || !state.locations[connection.toId]) continue;
      seen.add(connection.toId);
      previous.set(connection.toId, current);
      if (connection.toId === toId) {
        const path: LocationId[] = [toId];
        for (let step = toId; step !== fromId; ) {
          step = previous.get(step)!;
          path.unshift(step);
        }
        return path;
      }
      queue.push(connection.toId);
    }
  }
  return null;
}

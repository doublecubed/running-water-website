import type { Connection, GameState, LocationId, TransportMode } from "../types";
import { INTERIOR_HOP_MINUTES, isInteriorHop } from "./interiorHops";

/**
 * Canonical speed (km/h) for each transport mode, defined once so content
 * never duplicates a mode's speed on every connection that uses it — a
 * Connection only says WHICH modes are usable on it (see types.ts), never
 * how fast they are. `taxi` is a car (same speed) hired per trip; `bus`
 * is slower than a car due to stops.
 */
export const TRANSPORT_MODE_SPEED_KMH: Record<TransportMode, number> = {
  foot: 5,
  car: 40,
  ship: 25,
  taxi: 40,
  bus: 18,
};

/**
 * A metered taxi fare is flagFee + perKm × distance — a real formula, not
 * a number content should hand-type per connection (unlike a flat bus/
 * train fare, which genuinely doesn't scale with distance). Defined once,
 * centrally, same reasoning as TRANSPORT_MODE_SPEED_KMH. `flagFeeMinor`
 * is deliberately set at (not below) a typical transit fare — see
 * content/world.ts's bus-1 line ($3.00) — so a taxi is never cheaper than
 * public transit even for a very short ride; only the per-km rate can
 * push it further above that.
 */
export const TAXI_FARE = {
  flagFeeMinor: 300, // $3.00 to get in — at least a typical transit fare, never below it.
  perKmMinor: 50, // $0.50/km on the meter.
};

/** Minutes to cover a distance at a given mode's canonical speed. */
export function travelMinutes(distanceKm: number, mode: TransportMode): number {
  const hours = distanceKm / TRANSPORT_MODE_SPEED_KMH[mode];
  return Math.round(hours * 60);
}

/**
 * True if the player currently holds an unexpired Pass covering
 * `transitLineId` — see ActivePass/Pass in types.ts. `expiresAtMinutesElapsed`
 * is an absolute clock reading computed once at purchase (`GameEngine.buyPass`),
 * so this is a cheap lazy comparison, never a decrement — see
 * engine/time/calendar.ts's module doc comment.
 */
function hasValidPassFor(state: GameState, transitLineId: string): boolean {
  return state.player.activePasses.some((active) => {
    if (active.expiresAtMinutesElapsed <= state.clock.minutesElapsed) return false;
    return state.passes[active.passId]?.lineIds.includes(transitLineId) ?? false;
  });
}

/**
 * Minor-unit fare for a FRESH (first-time) use of `mode` on `connection`
 * — i.e. before accounting for whether the player is already mid-ride on
 * the same transit line (see Connection.transitLineId / Player.boardedLineId
 * in types.ts). That "already paid, free transfer" adjustment is a
 * property of a resolved, ordered route, not of one connection in
 * isolation, so it's applied afterward by pathfinding.ts's findRoute —
 * see its doc comment — rather than here.
 *
 * Resolution order: taxi is always the metered formula (TAXI_FARE),
 * regardless of any costsMinor entry; a connection with `transitLineId`
 * set is FREE if the player holds a valid Pass covering it (see
 * `hasValidPassFor`), else looks up that line's flat fare in
 * `state.transitLines` (0 if the id doesn't resolve — a
 * malformed/dangling reference, handled defensively rather than
 * crashing, consistent with how pathfinding treats other malformed
 * content); otherwise it falls back to the connection's own `costsMinor`
 * (0 if absent).
 */
export function costOfMode(state: GameState, connection: Connection, mode: TransportMode): number {
  if (mode === "taxi") {
    return TAXI_FARE.flagFeeMinor + Math.round(TAXI_FARE.perKmMinor * connection.distanceKm);
  }
  if (connection.transitLineId) {
    if (hasValidPassFor(state, connection.transitLineId)) return 0;
    return state.transitLines[connection.transitLineId]?.fareMinor ?? 0;
  }
  return connection.costsMinor?.[mode] ?? 0;
}

/**
 * The single place minutes+cost for one hop are decided, for EVERY caller
 * that computes a hop's time/cost (findRoute's Dijkstra relaxation,
 * GameEngine.executeHop, and the choice-builders behind `inquire`/the
 * direct-connections menu) — so the interior flat-rate rule (see
 * interiorHops.ts) can never be applied in some places and forgotten in
 * others. `mode` is still resolved normally (via `pickMode`/`fastestMode`/
 * `cheapestMode` by the caller) even for an interior hop — it's still
 * recorded/displayed (e.g. "on foot"), just doesn't affect the numbers.
 */
export function hopMinutesAndCost(
  state: GameState,
  fromId: LocationId,
  connection: Connection,
  mode: TransportMode,
): { minutes: number; cost: number } {
  if (isInteriorHop(state, fromId, connection.toId)) {
    return { minutes: INTERIOR_HOP_MINUTES, cost: 0 };
  }
  return { minutes: travelMinutes(connection.distanceKm, mode), cost: costOfMode(state, connection, mode) };
}

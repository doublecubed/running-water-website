import type { Connection, GameState, LocationId, TransportMode, TravelCategory, TravelStrategy } from "../types";
import { costOfMode, hopMinutesAndCost, travelMinutes } from "./transportModes";

export interface RouteHop {
  fromId: LocationId;
  toId: LocationId;
  mode: TransportMode;
  minutes: number;
  distanceKm: number;
  /** Which transit line this hop belongs to, if any — see Connection.transitLineId. */
  transitLineId?: string;
  /**
   * Fare for THIS hop, in minor units, WITHIN THE CONTEXT OF THIS ROUTE —
   * 0 if free. Two hops on the same connection could have different
   * costMinor in different routes: a transit-line hop is free if the
   * immediately preceding hop in this same route was on the same line
   * (a continued ride), and full fare otherwise (a fresh boarding). See
   * findRoute's doc comment for where this adjustment is applied.
   */
  costMinor: number;
}

export interface Route {
  /** Location ids visited in order, including the start and destination. */
  path: LocationId[];
  hops: RouteHop[];
  totalMinutes: number;
  /**
   * Sum of every (route-contextual, free-transfer-adjusted) hop cost —
   * see RouteHop.costMinor. Reported regardless of which TravelStrategy
   * chose this route — a "fastest" route still reports what it costs,
   * and vice versa. See docs/systems/economy.md.
   */
  totalCostMinor: number;
}

/** Picks the fastest transport mode available on a connection, or undefined if it lists none (an unusable/malformed edge). */
export function fastestMode(connection: Connection): TransportMode | undefined {
  return connection.modes.reduce<TransportMode | undefined>((fastest, mode) => {
    if (!fastest) return mode;
    return travelMinutes(connection.distanceKm, mode) < travelMinutes(connection.distanceKm, fastest) ? mode : fastest;
  }, undefined);
}

/**
 * Picks the cheapest transport mode available on a connection (ties
 * broken by speed, same tiebreak spirit as fastestMode), or undefined if
 * it lists none. NOTE: this evaluates each mode's cost in isolation
 * (costOfMode's "fresh boarding" cost) — it does NOT know whether the
 * player might already be mid-ride on a transit line this connection
 * belongs to, which could make it free. That "is this a continuation"
 * question only has an answer once a route is resolved (see findRoute's
 * doc comment on applyFreeTransfers); per-connection mode selection can't
 * see that far ahead without augmenting Dijkstra's state space, which
 * isn't built — see docs/systems/economy.md.
 */
export function cheapestMode(state: GameState, connection: Connection): TransportMode | undefined {
  return connection.modes.reduce<TransportMode | undefined>((cheapest, mode) => {
    if (!cheapest) return mode;
    const modeCost = costOfMode(state, connection, mode);
    const cheapestCost = costOfMode(state, connection, cheapest);
    if (modeCost !== cheapestCost) return modeCost < cheapestCost ? mode : cheapest;
    return travelMinutes(connection.distanceKm, mode) < travelMinutes(connection.distanceKm, cheapest) ? mode : cheapest;
  }, undefined);
}

/** Picks a connection's mode according to a TravelStrategy — the single place GameEngine and findRoute both go to avoid duplicating the fastest-vs-cheapest branch. */
export function pickMode(state: GameState, connection: Connection, strategy: TravelStrategy): TransportMode | undefined {
  return strategy === "cheapest" ? cheapestMode(state, connection) : fastestMode(connection);
}

/** Which TransportMode each natural TravelCategory prefers — see TravelCategory's doc comment in types.ts. */
export const CATEGORY_PREFERRED_MODE: Record<TravelCategory, TransportMode> = {
  foot: "foot",
  transit: "bus",
  taxi: "taxi",
};

/** Every natural travel category, in display order — used to compute one route per category for a named-destination inquiry. See docs/systems/economy.md. */
export const TRAVEL_CATEGORIES: TravelCategory[] = ["foot", "transit", "taxi"];

/**
 * What each category is actually optimizing for when it has a real
 * choice to make — most categories care about TIME (a transit rider or a
 * taxi rider wants to get there quickly on their chosen mode); "foot" is
 * the one exception, since foot itself is always free and the real
 * reason someone picks it is to spend as little as possible — see
 * docs/systems/economy.md. Drives both `findCategoryRoute`'s Dijkstra
 * weight and `resolveCategoryEdges`'/`pickModeForCategory`'s forced-
 * fallback tie-break (which mode wins when neither the category's own
 * mode nor foot is offered on a hop at all).
 */
export const CATEGORY_OPTIMIZES_FOR: Record<TravelCategory, "time" | "cost"> = {
  foot: "cost",
  transit: "time",
  taxi: "time",
};

/** Which of a connection's usable modes wins as a forced fallback (no category/foot alternative on this connection) — cheapest for a cost-optimizing category, fastest otherwise. See CATEGORY_OPTIMIZES_FOR. */
function fallbackModeFor(state: GameState, connection: Connection, category: TravelCategory): TransportMode | undefined {
  return CATEGORY_OPTIMIZES_FOR[category] === "cost" ? cheapestMode(state, connection) : fastestMode(connection);
}

/** True if `b` is a better forced fallback than `a` for this category — primary metric per CATEGORY_OPTIMIZES_FOR, the other as tie-break, mirroring runDijkstra's own tie-break style. */
function isBetterFallback(state: GameState, category: TravelCategory, a: ResolvedEdge, b: ResolvedEdge): boolean {
  const aCost = costOfMode(state, a.connection, a.mode);
  const bCost = costOfMode(state, b.connection, b.mode);
  const aMinutes = travelMinutes(a.connection.distanceKm, a.mode);
  const bMinutes = travelMinutes(b.connection.distanceKm, b.mode);
  if (CATEGORY_OPTIMIZES_FOR[category] === "cost") {
    return bCost !== aCost ? bCost < aCost : bMinutes < aMinutes;
  }
  return bMinutes !== aMinutes ? bMinutes < aMinutes : bCost < aCost;
}

/**
 * Resolves ONE connection's mode for a category: the category's own mode
 * if THIS connection offers it, else "foot" if offered, else whichever
 * mode wins as a forced fallback (a hop with no category/foot alternative
 * — e.g. the ship-only crossing to the pier; see `fallbackModeFor`). Used
 * by the compass fast path, where the connection is already fixed (the
 * player's explicit directional choice) and there's nothing to group. A
 * multi-hop search needs the grouped version below instead — see
 * `resolveCategoryEdges`'s doc comment for why a plain per-connection
 * check like this one isn't enough there.
 */
export function pickModeForCategory(state: GameState, connection: Connection, category: TravelCategory): TransportMode | undefined {
  const preferred = CATEGORY_PREFERRED_MODE[category];
  if (connection.modes.includes(preferred)) return preferred;
  if (connection.modes.includes("foot")) return "foot";
  return fallbackModeFor(state, connection, category);
}

interface ResolvedEdge {
  connection: Connection;
  mode: TransportMode;
}

/**
 * Resolves each DESTINATION a location connects to down to exactly one
 * (connection, mode) pair for a given category, even when several
 * parallel Connection objects lead to the same neighbor (e.g. alley's
 * separate foot/taxi and bus-only connections to street — see
 * content/world.ts). Grouping by destination first, rather than
 * resolving each connection object in isolation, is what stops a
 * category from opportunistically switching onto a faster PARALLEL edge
 * that doesn't even offer its own mode — a plain per-connection check
 * (`pickModeForCategory`) can't see the sibling edge to know it should
 * lose to the category's real match. Preference order per neighbor: the
 * category's own mode if ANY parallel connection offers it; else foot if
 * any does; else whichever mode wins as a forced fallback across the
 * group (see `isBetterFallback`/`CATEGORY_OPTIMIZES_FOR`) — guarantees
 * every category can still reach a neighbor only reachable by some other
 * mode entirely, like the ship-only pier crossing, rather than reporting
 * it unreachable.
 */
function resolveCategoryEdges(state: GameState, connections: Connection[], category: TravelCategory): ResolvedEdge[] {
  const preferred = CATEGORY_PREFERRED_MODE[category];
  const byDestination = new Map<LocationId, Connection[]>();
  for (const connection of connections) {
    const group = byDestination.get(connection.toId) ?? [];
    group.push(connection);
    byDestination.set(connection.toId, group);
  }

  const resolved: ResolvedEdge[] = [];
  for (const group of byDestination.values()) {
    const preferredEdge = group.find((c) => c.modes.includes(preferred));
    if (preferredEdge) {
      resolved.push({ connection: preferredEdge, mode: preferred });
      continue;
    }
    const footEdge = group.find((c) => c.modes.includes("foot"));
    if (footEdge) {
      resolved.push({ connection: footEdge, mode: "foot" });
      continue;
    }
    let fallback: ResolvedEdge | undefined;
    for (const connection of group) {
      const mode = fallbackModeFor(state, connection, category);
      if (!mode) continue;
      const candidate: ResolvedEdge = { connection, mode };
      if (!fallback || isBetterFallback(state, category, fallback, candidate)) {
        fallback = candidate;
      }
    }
    if (fallback) resolved.push(fallback);
  }
  return resolved;
}

/**
 * Shortest MIXED-MODE route between two locations under the given
 * TravelStrategy — `strategy` decides which mode `pickMode` picks per
 * connection AND which of that mode's minutes/cost becomes Dijkstra's
 * edge weight, so the search can freely switch mode hop-to-hop to hit
 * "fastest" (minimize time) or "cheapest" (minimize cost). Both
 * totalMinutes and totalCostMinor are always computed and reported
 * regardless of strategy; only the WINNING route differs. Returns null if
 * no route exists (disconnected graph). See `runDijkstra`'s doc comment
 * below for the shared search mechanics (tie-breaking, free-transfer
 * bookkeeping, the flat interior-hop rate).
 *
 * NOT the default route resolution as of the TravelCategory redesign
 * (see `findCategoryRoute` below, and TravelStrategy's doc comment in
 * types.ts) — ordinary `inquire`/`travel` no longer call this. It's kept,
 * fully implemented and tested, for a future "navigator device" item that
 * shows the player the true mixed-mode fastest/cheapest routes; reachable
 * today only via `GameEngine.travelTo`'s `TravelOverride.strategy`.
 *
 * A single-hop compass move (see GameEngine.travelTo) does NOT go through
 * this function either way — it resolves the named connection directly.
 */
export function findRoute(
  state: GameState,
  fromId: LocationId,
  toId: LocationId,
  strategy: TravelStrategy,
): Route | null {
  return runDijkstra(
    state,
    fromId,
    toId,
    (connections) =>
      connections
        .map((connection) => ({ connection, mode: pickMode(state, connection, strategy) }))
        .filter((edge): edge is ResolvedEdge => edge.mode !== undefined),
    (minutes, cost) => (strategy === "cheapest" ? cost : minutes),
    (minutes, cost) => (strategy === "cheapest" ? minutes : cost),
  );
}

/**
 * Route between two locations that consistently rides `category`'s own
 * mode wherever it's offered (falling back to foot, then whatever wins
 * as a forced fallback — see `resolveCategoryEdges`), rather than
 * opportunistically switching modes hop-to-hop the way `findRoute`'s
 * mixed-mode search does. This is what backs the natural foot/transit/
 * taxi options a named-destination inquiry offers — see
 * docs/systems/economy.md. Minimizes TIME for most categories (a transit
 * or taxi rider wants to get there quickly on their mode) but minimizes
 * COST for `"foot"` (foot itself is always free; the real question is
 * which forced fallback costs least — see `CATEGORY_OPTIMIZES_FOR`); the
 * other metric is always the Dijkstra SECONDARY tie-break either way
 * (same reasoning as `findRoute`'s tie-break: two equally-good routes
 * under one category shouldn't resolve to an arbitrary one).
 */
export function findCategoryRoute(
  state: GameState,
  fromId: LocationId,
  toId: LocationId,
  category: TravelCategory,
): Route | null {
  const optimizesForCost = CATEGORY_OPTIMIZES_FOR[category] === "cost";
  return runDijkstra(
    state,
    fromId,
    toId,
    (connections) => resolveCategoryEdges(state, connections, category),
    (minutes, cost) => (optimizesForCost ? cost : minutes),
    (minutes, cost) => (optimizesForCost ? minutes : cost),
  );
}

/**
 * The Dijkstra core shared by `findRoute` and `findCategoryRoute` — city-
 * scale node counts (tens, not thousands) make plain Dijkstra sufficient,
 * no A-star or other heuristics needed. `edgesFrom` resolves a location's
 * raw `connections` down to the (connection, mode) pairs actually usable
 * for this search — `findRoute` resolves one edge per connection via
 * `pickMode`; `findCategoryRoute` resolves one edge per NEIGHBOR via
 * `resolveCategoryEdges`, since a category has to consider parallel
 * connections together (see that function's doc comment). `primaryOf`/
 * `secondaryOf` derive Dijkstra's weight and tie-break metric from a
 * hop's minutes/cost — see `findRoute`'s doc comment for why a secondary
 * metric matters at all (tied primary weights shouldn't resolve to an
 * arbitrary route).
 *
 * Cost bookkeeping: each hop's "fresh" fare (costOfMode, via
 * hopMinutesAndCost) is computed during relaxation, but doesn't yet
 * account for free transfers (see `cheapestMode`'s doc comment). AFTER
 * the winning path is reconstructed, a separate linear pass
 * (`applyFreeTransfers`) zeroes out any hop on the same `transitLineId`
 * as the hop immediately before it in THIS route, modeling "already paid
 * for this line, this is a continuation."
 *
 * Entering/exiting a building, or moving between rooms of the same
 * building, always costs the flat `INTERIOR_HOP_MINUTES`/free rate
 * regardless of mode or distance — see navigation/interiorHops.ts and
 * `hopMinutesAndCost`, which this loop calls for every candidate edge
 * rather than computing minutes/cost directly.
 */
function runDijkstra(
  state: GameState,
  fromId: LocationId,
  toId: LocationId,
  edgesFrom: (connections: Connection[]) => ResolvedEdge[],
  primaryOf: (minutes: number, cost: number) => number,
  secondaryOf: (minutes: number, cost: number) => number,
): Route | null {
  const bestWeight = new Map<LocationId, number>([[fromId, 0]]);
  const bestSecondary = new Map<LocationId, number>([[fromId, 0]]);
  const cameFrom = new Map<LocationId, RouteHop>();
  const visited = new Set<LocationId>();
  const unvisited = new Set<LocationId>(Object.keys(state.locations));

  while (unvisited.size > 0) {
    // Node selection ALSO needs the secondary-metric tie-break, not just
    // edge relaxation below — otherwise, with tied weights, Dijkstra can
    // pop (and lock in, via the early-exit right after) the destination
    // through a worse-secondary-metric path before a same-weight,
    // better-secondary path through another node has been explored.
    let currentId: LocationId | undefined;
    let currentWeight = Infinity;
    let currentSecondary = Infinity;
    for (const id of unvisited) {
      const weight = bestWeight.get(id);
      if (weight === undefined) continue;
      const secondary = bestSecondary.get(id) ?? Infinity;
      const better = weight < currentWeight || (weight === currentWeight && secondary < currentSecondary);
      if (better) {
        currentWeight = weight;
        currentSecondary = secondary;
        currentId = id;
      }
    }
    if (currentId === undefined) break; // Remaining unvisited nodes are unreachable.

    unvisited.delete(currentId);
    visited.add(currentId);
    if (currentId === toId) break;

    const location = state.locations[currentId];
    if (!location) continue;

    for (const { connection, mode } of edgesFrom(location.connections)) {
      if (visited.has(connection.toId)) continue;

      const { minutes, cost } = hopMinutesAndCost(state, currentId, connection, mode);
      const weight = primaryOf(minutes, cost);
      const secondary = secondaryOf(minutes, cost);
      const candidateWeight = currentWeight + weight;
      const candidateSecondary = currentSecondary + secondary;
      const existingWeight = bestWeight.get(connection.toId) ?? Infinity;
      const existingSecondary = bestSecondary.get(connection.toId) ?? Infinity;
      const better =
        candidateWeight < existingWeight || (candidateWeight === existingWeight && candidateSecondary < existingSecondary);
      if (better) {
        bestWeight.set(connection.toId, candidateWeight);
        bestSecondary.set(connection.toId, candidateSecondary);
        cameFrom.set(connection.toId, {
          fromId: currentId,
          toId: connection.toId,
          mode,
          minutes,
          distanceKm: connection.distanceKm,
          transitLineId: connection.transitLineId,
          costMinor: cost,
        });
      }
    }
  }

  if (!bestWeight.has(toId)) return null;

  const hops: RouteHop[] = [];
  let cursor = toId;
  while (cursor !== fromId) {
    const hop = cameFrom.get(cursor);
    if (!hop) return null; // Should be unreachable given the bestWeight.has(toId) check above.
    hops.unshift(hop);
    cursor = hop.fromId;
  }

  applyFreeTransfers(hops);

  return {
    path: [fromId, ...hops.map((h) => h.toId)],
    hops,
    totalMinutes: hops.reduce((sum, h) => sum + h.minutes, 0),
    totalCostMinor: hops.reduce((sum, h) => sum + h.costMinor, 0),
  };
}

/**
 * Zeroes out a hop's cost when it continues the same transit line as the
 * hop immediately before it — see runDijkstra's doc comment. Mutates
 * `hops` in place; safe because `hops` is a freshly-built array local to
 * one runDijkstra call.
 */
function applyFreeTransfers(hops: RouteHop[]): void {
  for (let i = 1; i < hops.length; i++) {
    const hop = hops[i]!;
    const previous = hops[i - 1]!;
    if (hop.transitLineId && hop.transitLineId === previous.transitLineId) {
      hop.costMinor = 0;
    }
  }
}

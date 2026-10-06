import { describe, expect, it } from "vitest";
import type { Connection, GameState } from "../types";
import { findCategoryRoute, findRoute } from "./pathfinding";

function stateWithLocations(
  locations: GameState["locations"],
  transitLines: GameState["transitLines"] = {},
): GameState {
  return {
    locations,
    worldObjects: {},
    npcs: {},
    transitLines,
    passes: {},
    notebookProducts: {},
    facts: {},
    placement: { worldObjectLocationId: {}, npcLocationId: {}, containedIn: {} },
    partStates: {},
    focusedWorldObjectId: null,
    examinedTarget: null,
    notebooks: { notebooks: [], activeNotebookId: null },
    flags: {},
    labels: {},
    npcStates: {},
    reputation: { global: 0, byLabel: {} },
    playerFacts: {},
    board: { nodes: [], connections: [] },
    player: { locationId: "a", inventory: [], money: 0, boardedLineId: null, travelPreference: "foot", visitedLocationIds: [], activePasses: [], stealthMode: false },
    clock: { minutesElapsed: 0, epoch: { year: 1946, month: 9, day: 18 } },
  };
}

describe("findRoute", () => {
  it("returns a zero-hop route when start equals destination", () => {
    const state = stateWithLocations({
      a: { id: "a", nameKey: "a", descriptionKey: "a", kind: "exterior", aliases: [], connections: [] },
    });
    const route = findRoute(state, "a", "a", "fastest");
    expect(route).toEqual({ path: ["a"], hops: [], totalMinutes: 0, totalCostMinor: 0 });
  });

  it("returns null when no path exists", () => {
    const state = stateWithLocations({
      a: { id: "a", nameKey: "a", descriptionKey: "a", kind: "exterior", aliases: [], connections: [] },
      b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
    });
    expect(findRoute(state, "a", "b", "fastest")).toBeNull();
  });

  it("prefers a longer-hop-count route that is faster overall", () => {
    // a --(10km, foot only)--> b            [slow direct: 120 min]
    // a --(1km, foot)--> c --(1km, car)--> b [fast indirect: ~13.5 min]
    const state = stateWithLocations({
      a: {
        id: "a",
        nameKey: "a",
        descriptionKey: "a", kind: "exterior",
        aliases: [],
        connections: [
          { toId: "b", distanceKm: 10, modes: ["foot"] },
          { toId: "c", distanceKm: 1, modes: ["foot"] },
        ],
      },
      b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
      c: {
        id: "c",
        nameKey: "c",
        descriptionKey: "c", kind: "exterior",
        aliases: [],
        connections: [{ toId: "b", distanceKm: 1, modes: ["car"] }],
      },
    });

    const route = findRoute(state, "a", "b", "fastest");
    expect(route?.path).toEqual(["a", "c", "b"]);
    expect(route?.totalMinutes).toBeLessThan(20);
  });

  it("sums each hop's fare into totalCostMinor, treating an unlisted mode as free", () => {
    // a --(1km, bus, $0.15/100 = 15 minor)--> b --(1km, foot, free)--> c
    const state = stateWithLocations({
      a: {
        id: "a",
        nameKey: "a",
        descriptionKey: "a", kind: "exterior",
        aliases: [],
        connections: [{ toId: "b", distanceKm: 1, modes: ["bus"], costsMinor: { bus: 15 } }],
      },
      b: {
        id: "b",
        nameKey: "b",
        descriptionKey: "b", kind: "exterior",
        aliases: [],
        connections: [{ toId: "c", distanceKm: 1, modes: ["foot"] }],
      },
      c: { id: "c", nameKey: "c", descriptionKey: "c", kind: "exterior", aliases: [], connections: [] },
    });

    const route = findRoute(state, "a", "c", "fastest");
    expect(route?.hops.map((h) => h.costMinor)).toEqual([15, 0]);
    expect(route?.totalCostMinor).toBe(15);
  });

  it("charges a transit line's fare once, then treats consecutive hops on the same line as free transfers", () => {
    // a --(bus, line-7)--> b --(bus, line-7)--> c --(bus, line-7)--> d
    const line7Connections = (toId: string): Connection => ({ toId, distanceKm: 1, modes: ["bus"], transitLineId: "line-7" });
    const state = stateWithLocations(
      {
        a: { id: "a", nameKey: "a", descriptionKey: "a", kind: "exterior", aliases: [], connections: [line7Connections("b")] },
        b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [line7Connections("c")] },
        c: { id: "c", nameKey: "c", descriptionKey: "c", kind: "exterior", aliases: [], connections: [line7Connections("d")] },
        d: { id: "d", nameKey: "d", descriptionKey: "d", kind: "exterior", aliases: [], connections: [] },
      },
      { "line-7": { id: "line-7", nameKey: "line.7", fareMinor: 25 } },
    );

    const route = findRoute(state, "a", "d", "fastest");
    expect(route?.hops.map((h) => h.costMinor)).toEqual([25, 0, 0]);
    expect(route?.totalCostMinor).toBe(25);
  });

  it("charges again when a route changes to a different transit line", () => {
    // a --(bus, line-7)--> b --(bus, line-9)--> c
    const state = stateWithLocations(
      {
        a: {
          id: "a",
          nameKey: "a",
          descriptionKey: "a", kind: "exterior",
          aliases: [],
          connections: [{ toId: "b", distanceKm: 1, modes: ["bus"], transitLineId: "line-7" }],
        },
        b: {
          id: "b",
          nameKey: "b",
          descriptionKey: "b", kind: "exterior",
          aliases: [],
          connections: [{ toId: "c", distanceKm: 1, modes: ["bus"], transitLineId: "line-9" }],
        },
        c: { id: "c", nameKey: "c", descriptionKey: "c", kind: "exterior", aliases: [], connections: [] },
      },
      {
        "line-7": { id: "line-7", nameKey: "line.7", fareMinor: 25 },
        "line-9": { id: "line-9", nameKey: "line.9", fareMinor: 30 },
      },
    );

    const route = findRoute(state, "a", "c", "fastest");
    expect(route?.hops.map((h) => h.costMinor)).toEqual([25, 30]);
    expect(route?.totalCostMinor).toBe(55);
  });

  it("computes a metered taxi fare as flag fee plus per-km rate, ignoring costsMinor", () => {
    const state = stateWithLocations({
      a: {
        id: "a",
        nameKey: "a",
        descriptionKey: "a", kind: "exterior",
        aliases: [],
        connections: [{ toId: "b", distanceKm: 4, modes: ["taxi"], costsMinor: { taxi: 1 } }],
      },
      b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
    });

    // TAXI_FARE: 300 flag + 50/km * 4km = 500.
    const route = findRoute(state, "a", "b", "fastest");
    expect(route?.totalCostMinor).toBe(500);
  });

  it("picks a slower but cheaper mode under the cheapest strategy, and the faster paid one under fastest", () => {
    // a -> b: foot (free, slow) or taxi (fast, metered — always costs money).
    const state = stateWithLocations({
      a: {
        id: "a",
        nameKey: "a",
        descriptionKey: "a", kind: "exterior",
        aliases: [],
        connections: [{ toId: "b", distanceKm: 4, modes: ["foot", "taxi"] }],
      },
      b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
    });

    const fastest = findRoute(state, "a", "b", "fastest");
    expect(fastest?.hops[0]?.mode).toBe("taxi");
    expect(fastest?.totalCostMinor).toBeGreaterThan(0);

    const cheapest = findRoute(state, "a", "b", "cheapest");
    expect(cheapest?.hops[0]?.mode).toBe("foot");
    expect(cheapest?.totalCostMinor).toBe(0);
  });

  it("prefers the faster of two equally-cheap (free) routes under the cheapest strategy", () => {
    // a -> b: direct foot, free, slow (10km).
    // a -> c -> b: foot then foot, free, fast overall (2km total).
    // Both routes cost $0 — "cheapest" should still pick the faster one, not an arbitrary one.
    const state = stateWithLocations({
      a: {
        id: "a",
        nameKey: "a",
        descriptionKey: "a", kind: "exterior",
        aliases: [],
        connections: [
          { toId: "b", distanceKm: 10, modes: ["foot"] },
          { toId: "c", distanceKm: 1, modes: ["foot"] },
        ],
      },
      b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
      c: {
        id: "c",
        nameKey: "c",
        descriptionKey: "c", kind: "exterior",
        aliases: [],
        connections: [{ toId: "b", distanceKm: 1, modes: ["foot"] }],
      },
    });

    const cheapest = findRoute(state, "a", "b", "cheapest");
    expect(cheapest?.totalCostMinor).toBe(0);
    expect(cheapest?.path).toEqual(["a", "c", "b"]);
  });

  it("skips a connection with no usable transport mode rather than crashing", () => {
    const state = stateWithLocations({
      a: {
        id: "a",
        nameKey: "a",
        descriptionKey: "a", kind: "exterior",
        aliases: [],
        connections: [{ toId: "b", distanceKm: 1, modes: [] }],
      },
      b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
    });
    expect(findRoute(state, "a", "b", "fastest")).toBeNull();
  });
});

describe("findCategoryRoute", () => {
  it("sticks to a category's own mode across a PARALLEL faster edge that doesn't offer it, rather than opportunistically switching", () => {
    // Two separate connections a->b: one offers foot+taxi, a second
    // (faster, since bus > foot in speed here) offers only bus. A "taxi"
    // category should still ride the first connection by taxi, not get
    // pulled onto the bus-only edge just because it's quicker overall —
    // see resolveCategoryEdges's doc comment on why grouping by
    // destination (not resolving each connection object in isolation)
    // matters here.
    const state = stateWithLocations({
      a: {
        id: "a",
        nameKey: "a",
        descriptionKey: "a", kind: "exterior",
        aliases: [],
        connections: [
          { toId: "b", distanceKm: 1, modes: ["foot", "taxi"] },
          { toId: "b", distanceKm: 1, modes: ["bus"] },
        ],
      },
      b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
    });

    const route = findCategoryRoute(state, "a", "b", "taxi");
    expect(route?.hops[0]?.mode).toBe("taxi");
  });

  it("falls back to foot when the category's own mode isn't offered on any parallel connection", () => {
    const state = stateWithLocations({
      a: {
        id: "a",
        nameKey: "a",
        descriptionKey: "a", kind: "exterior",
        aliases: [],
        connections: [{ toId: "b", distanceKm: 1, modes: ["foot"] }],
      },
      b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
    });

    const route = findCategoryRoute(state, "a", "b", "taxi");
    expect(route?.hops[0]?.mode).toBe("foot");
  });

  it("falls back to whatever mode is forced when neither the category nor foot is offered at all", () => {
    // A ship-only crossing, like the docks<->pier connection in content/world.ts.
    const state = stateWithLocations({
      a: {
        id: "a",
        nameKey: "a",
        descriptionKey: "a", kind: "exterior",
        aliases: [],
        connections: [{ toId: "b", distanceKm: 1, modes: ["ship"] }],
      },
      b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
    });

    const route = findCategoryRoute(state, "a", "b", "foot");
    expect(route?.hops[0]?.mode).toBe("ship");
  });

  it("returns null when no route exists at all, same as findRoute", () => {
    const state = stateWithLocations({
      a: { id: "a", nameKey: "a", descriptionKey: "a", kind: "exterior", aliases: [], connections: [] },
      b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
    });
    expect(findCategoryRoute(state, "a", "b", "foot")).toBeNull();
  });

  it("picks the CHEAPEST forced-fallback mode for the 'foot' category, not the fastest", () => {
    // Neither "foot" (the category's own preference) nor either candidate
    // mode's category is at play here — bus (flat $3.00 via a transit
    // line) and taxi (metered — $8.00 over this 10km) are both forced-
    // fallback candidates on a connection with no foot option at all.
    // "foot" optimizes for cost (see CATEGORY_OPTIMIZES_FOR), so it
    // should pick the cheaper bus, even though taxi (40km/h vs bus's
    // 18km/h) would get there faster.
    const state = stateWithLocations(
      {
        a: {
          id: "a",
          nameKey: "a",
          descriptionKey: "a", kind: "exterior",
          aliases: [],
          connections: [{ toId: "b", distanceKm: 10, modes: ["bus", "taxi"], transitLineId: "line-1" }],
        },
        b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
      },
      { "line-1": { id: "line-1", nameKey: "line.1", fareMinor: 300 } },
    );

    const route = findCategoryRoute(state, "a", "b", "foot");
    expect(route?.hops[0]?.mode).toBe("bus");
  });

  it("picks the FASTEST forced-fallback mode for the 'transit'/'taxi' categories, not the cheapest", () => {
    // Neither foot nor bus is offered — car (free, fast) and ship (free,
    // slower) are both forced-fallback candidates for "transit", which
    // optimizes for time (see CATEGORY_OPTIMIZES_FOR). Both are free, so
    // this isolates the SPEED half of the tie-break from any cost effect.
    const state = stateWithLocations({
      a: {
        id: "a",
        nameKey: "a",
        descriptionKey: "a", kind: "exterior",
        aliases: [],
        connections: [{ toId: "b", distanceKm: 10, modes: ["car", "ship"] }],
      },
      b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
    });

    const route = findCategoryRoute(state, "a", "b", "transit");
    expect(route?.hops[0]?.mode).toBe("car");
  });

  it("minimizes total COST for the 'foot' category, unlike the other categories which minimize time", () => {
    // a -> b: direct, free, slow foot path (10km).
    // a -> c -> b: forced onto a paid bus-only connection, but much
    // faster overall. "foot" should still prefer the free direct path
    // (cost is what it optimizes for); a category that minimizes time
    // would prefer the indirect one instead.
    const state = stateWithLocations({
      a: {
        id: "a",
        nameKey: "a",
        descriptionKey: "a", kind: "exterior",
        aliases: [],
        connections: [
          { toId: "b", distanceKm: 10, modes: ["foot"] },
          { toId: "c", distanceKm: 1, modes: ["bus"], costsMinor: { bus: 500 } },
        ],
      },
      b: { id: "b", nameKey: "b", descriptionKey: "b", kind: "exterior", aliases: [], connections: [] },
      c: {
        id: "c",
        nameKey: "c",
        descriptionKey: "c", kind: "exterior",
        aliases: [],
        connections: [{ toId: "b", distanceKm: 1, modes: ["foot"] }],
      },
    });

    const foot = findCategoryRoute(state, "a", "b", "foot");
    expect(foot?.path).toEqual(["a", "b"]);
    expect(foot?.totalCostMinor).toBe(0);
  });
});

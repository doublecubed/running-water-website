import { describe, expect, it } from "vitest";
import type { Connection, GameState, Location } from "../types";
import { costOfMode, hopMinutesAndCost, TAXI_FARE, travelMinutes, TRANSPORT_MODE_SPEED_KMH } from "./transportModes";
import { INTERIOR_HOP_MINUTES } from "./interiorHops";

function stateWithTransitLines(transitLines: GameState["transitLines"] = {}, passes: GameState["passes"] = {}): GameState {
  return {
    locations: {},
    worldObjects: {},
    npcs: {},
    transitLines,
    passes,
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

function stateWithLocations(locations: Record<string, Location>): GameState {
  return { ...stateWithTransitLines(), locations };
}

describe("costOfMode", () => {
  it("returns the declared flat fare for a mode with one", () => {
    const state = stateWithTransitLines();
    const connection: Connection = { toId: "b", distanceKm: 2, modes: ["foot", "bus"], costsMinor: { bus: 15 } };
    expect(costOfMode(state, connection, "bus")).toBe(15);
  });

  it("treats a mode with no entry in costsMinor as free", () => {
    const state = stateWithTransitLines();
    const connection: Connection = { toId: "b", distanceKm: 2, modes: ["foot", "bus"], costsMinor: { bus: 15 } };
    expect(costOfMode(state, connection, "foot")).toBe(0);
  });

  it("treats a connection with no costsMinor at all as entirely free", () => {
    const state = stateWithTransitLines();
    const freeConnection: Connection = { toId: "b", distanceKm: 1, modes: ["car"] };
    expect(costOfMode(state, freeConnection, "car")).toBe(0);
  });

  it("computes taxi as flag fee plus per-km rate, ignoring any costsMinor entry", () => {
    const state = stateWithTransitLines();
    const connection: Connection = { toId: "b", distanceKm: 3, modes: ["taxi"], costsMinor: { taxi: 1 } };
    expect(costOfMode(state, connection, "taxi")).toBe(TAXI_FARE.flagFeeMinor + TAXI_FARE.perKmMinor * 3);
  });

  it("looks up a transit line's flat fare via transitLineId, ignoring costsMinor", () => {
    const state = stateWithTransitLines({ "line-7": { id: "line-7", nameKey: "line.7", fareMinor: 25 } });
    const connection: Connection = {
      toId: "b",
      distanceKm: 10,
      modes: ["bus"],
      transitLineId: "line-7",
      costsMinor: { bus: 1 },
    };
    expect(costOfMode(state, connection, "bus")).toBe(25);
  });

  it("treats a dangling transitLineId (no matching line in state) as free rather than crashing", () => {
    const state = stateWithTransitLines();
    const connection: Connection = { toId: "b", distanceKm: 1, modes: ["bus"], transitLineId: "ghost-line" };
    expect(costOfMode(state, connection, "bus")).toBe(0);
  });

  it("is free when the player holds a Pass covering the line, and unexpired (expiresAt strictly greater than now)", () => {
    const state = stateWithTransitLines(
      { "line-7": { id: "line-7", nameKey: "line.7", fareMinor: 25 } },
      { "pass-7": { id: "pass-7", nameKey: "pass.7", aliases: [], priceMinor: 100, durationDays: 1, lineIds: ["line-7"] } },
    );
    state.player.activePasses = [{ passId: "pass-7", expiresAtMinutesElapsed: 100 }];
    state.clock.minutesElapsed = 50; // before expiry
    const connection: Connection = { toId: "b", distanceKm: 10, modes: ["bus"], transitLineId: "line-7" };
    expect(costOfMode(state, connection, "bus")).toBe(0);
  });

  it("charges the normal fare once the held Pass has expired", () => {
    const state = stateWithTransitLines(
      { "line-7": { id: "line-7", nameKey: "line.7", fareMinor: 25 } },
      { "pass-7": { id: "pass-7", nameKey: "pass.7", aliases: [], priceMinor: 100, durationDays: 1, lineIds: ["line-7"] } },
    );
    state.player.activePasses = [{ passId: "pass-7", expiresAtMinutesElapsed: 100 }];
    state.clock.minutesElapsed = 100; // exactly at expiry — no longer valid
    const connection: Connection = { toId: "b", distanceKm: 10, modes: ["bus"], transitLineId: "line-7" };
    expect(costOfMode(state, connection, "bus")).toBe(25);
  });

  it("charges the normal fare when a held Pass doesn't cover this line", () => {
    const state = stateWithTransitLines(
      { "line-7": { id: "line-7", nameKey: "line.7", fareMinor: 25 } },
      { "pass-9": { id: "pass-9", nameKey: "pass.9", aliases: [], priceMinor: 100, durationDays: 1, lineIds: ["line-9"] } },
    );
    state.player.activePasses = [{ passId: "pass-9", expiresAtMinutesElapsed: 1000 }];
    const connection: Connection = { toId: "b", distanceKm: 10, modes: ["bus"], transitLineId: "line-7" };
    expect(costOfMode(state, connection, "bus")).toBe(25);
  });
});

describe("travelMinutes", () => {
  it("computes taxi at the same speed as a car", () => {
    expect(travelMinutes(4, "taxi")).toBe(travelMinutes(4, "car"));
  });

  it("computes bus as slower than a car", () => {
    expect(TRANSPORT_MODE_SPEED_KMH.bus).toBeLessThan(TRANSPORT_MODE_SPEED_KMH.car);
  });
});

describe("hopMinutesAndCost", () => {
  const street: Location = {
    id: "street",
    kind: "exterior",
    nameKey: "street",
    descriptionKey: "street",
    aliases: [],
    connections: [],
  };
  const diner: Location = {
    id: "diner",
    kind: "interior",
    exteriorId: "street",
    nameKey: "diner",
    descriptionKey: "diner",
    aliases: [],
    connections: [],
  };

  it("overrides an entering hop to the flat interior rate, ignoring distance/mode entirely", () => {
    const state = stateWithLocations({ street, diner });
    // A taxi over 400km would normally be extremely expensive and slow — irrelevant here.
    const connection: Connection = { toId: "diner", distanceKm: 400, modes: ["taxi"] };
    expect(hopMinutesAndCost(state, "street", connection, "taxi")).toEqual({ minutes: INTERIOR_HOP_MINUTES, cost: 0 });
  });

  it("computes normally between two exteriors", () => {
    const highway: Location = { ...street, id: "highway", nameKey: "highway", descriptionKey: "highway" };
    const state = stateWithLocations({ street, highway });
    const connection: Connection = { toId: "highway", distanceKm: 4, modes: ["taxi"] };
    const result = hopMinutesAndCost(state, "street", connection, "taxi");
    expect(result).toEqual({ minutes: travelMinutes(4, "taxi"), cost: costOfMode(state, connection, "taxi") });
    expect(result.cost).toBeGreaterThan(0);
  });
});

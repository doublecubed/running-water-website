import { describe, expect, it } from "vitest";
import type { GameState, InteriorLocation, Location } from "../types";
import { isInteriorHop } from "./interiorHops";

function stateWithLocations(locations: Record<string, Location>): GameState {
  return {
    locations,
    worldObjects: {},
    npcs: {},
    transitLines: {},
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
    player: { locationId: "street", inventory: [], money: 0, boardedLineId: null, travelPreference: "foot", visitedLocationIds: [], activePasses: [], stealthMode: false },
    clock: { minutesElapsed: 0, epoch: { year: 1946, month: 9, day: 18 } },
  };
}

const street: Location = {
  id: "street",
  kind: "exterior",
  nameKey: "street",
  descriptionKey: "street",
  aliases: [],
  connections: [],
};

const highway: Location = { ...street, id: "highway", nameKey: "highway", descriptionKey: "highway" };

function diner(exteriorId: string): InteriorLocation {
  return {
    id: "diner",
    kind: "interior",
    exteriorId,
    nameKey: "diner",
    descriptionKey: "diner",
    aliases: [],
    connections: [],
  };
}

function hotelFloor2(exteriorId: string): InteriorLocation {
  return { ...diner(exteriorId), id: "hotel-floor-2", nameKey: "hotel-floor-2", descriptionKey: "hotel-floor-2" };
}

describe("isInteriorHop", () => {
  it("is true when entering the interior a location owns", () => {
    const state = stateWithLocations({ street, diner: diner("street") });
    expect(isInteriorHop(state, "street", "diner")).toBe(true);
  });

  it("is true when exiting to the interior's owning exterior", () => {
    const state = stateWithLocations({ street, diner: diner("street") });
    expect(isInteriorHop(state, "diner", "street")).toBe(true);
  });

  it("is false when moving to an exterior that does NOT own this interior", () => {
    const state = stateWithLocations({ street, highway, diner: diner("street") });
    expect(isInteriorHop(state, "diner", "highway")).toBe(false);
  });

  it("is true when moving between two interiors of the same building", () => {
    const state = stateWithLocations({ street, diner: diner("street"), "hotel-floor-2": hotelFloor2("street") });
    expect(isInteriorHop(state, "diner", "hotel-floor-2")).toBe(true); // same exteriorId, even though they're not literally the same building in this synthetic fixture — the rule only checks exteriorId equality.
  });

  it("is false when moving between two interiors of DIFFERENT buildings", () => {
    const state = stateWithLocations({ street, highway, diner: diner("street"), "hotel-floor-2": hotelFloor2("highway") });
    expect(isInteriorHop(state, "diner", "hotel-floor-2")).toBe(false);
  });

  it("is false between two exteriors", () => {
    const state = stateWithLocations({ street, highway });
    expect(isInteriorHop(state, "street", "highway")).toBe(false);
  });

  it("is false for an unknown location id (defensive, doesn't throw)", () => {
    const state = stateWithLocations({ street });
    expect(isInteriorHop(state, "street", "ghost")).toBe(false);
  });
});

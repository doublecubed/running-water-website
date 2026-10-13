import { describe, expect, it } from "vitest";
import { createInitialState } from "../content/world";
import { GameEngine } from "./GameEngine";

/** Moving between rooms: free, instant, by compass word or by (possibly distant) room name. */
function newEngine(): GameEngine {
  return new GameEngine(createInitialState());
}

describe("travelTo", () => {
  it("starts at the landing, and arriving describes the room in full on the first visit only", () => {
    const engine = newEngine();
    expect(engine.getCurrentLocation().id).toBe("studio-landing");

    const first = engine.travelTo("corridor");
    expect(first.ok).toBe(true);
    expect(first.events[0]).toMatchObject({ type: "player_traveled", textKey: "event.playerTraveled" });
    expect(first.events.some((e) => e.type === "location_described")).toBe(true);

    engine.travelTo("landing");
    const revisit = engine.travelTo("corridor");
    expect(revisit.events.some((e) => e.type === "location_described")).toBe(false);
  });

  it("reports only the destination: no minutes, hops, or cost", () => {
    const result = newEngine().travelTo("archive");
    const arrival = result.events.find((e) => e.type === "player_traveled")!;
    expect(arrival.params).toEqual({ locationKey: "location.studio-archive.name" });
    expect(result.events.some((e) => e.type === "time_checked" || e.type === "money_spent")).toBe(false);
  });

  it("walks a multi-hop route in one step: the archive is four rooms from the landing", () => {
    const engine = newEngine();
    expect(engine.travelTo("archive").ok).toBe(true);
    expect(engine.getCurrentLocation().id).toBe("studio-archive");
  });

  it("neither spends money nor moves the clock", () => {
    const engine = newEngine();
    const money = engine.getMoney();
    const minutes = engine.getState().clock.minutesElapsed;
    engine.travelTo("archive");
    expect(engine.getMoney()).toBe(money);
    expect(engine.getState().clock.minutesElapsed).toBe(minutes);
  });

  it("records the arrival as visited, without duplicates", () => {
    const engine = newEngine();
    engine.travelTo("corridor");
    engine.travelTo("landing");
    engine.travelTo("corridor");
    expect(engine.getVisitedLocationIds()).toEqual(["studio-landing", "studio-corridor"]);
  });

  it("reports already-there instead of moving", () => {
    const result = newEngine().travelTo("landing");
    expect(result.ok).toBe(true);
    expect(result.events[0]?.type).toBe("already_there");
  });

  it("fails to resolve an unknown place, and for an empty query", () => {
    const engine = newEngine();
    expect(engine.travelTo("atlantis")).toMatchObject({ ok: false, events: [{ type: "location_not_found" }] });
    expect(engine.travelTo("   ").ok).toBe(false);
    expect(engine.getCurrentLocation().id).toBe("studio-landing");
  });

  it("fails when no path leads there (the waiting room has no way in yet)", () => {
    const engine = newEngine();
    const result = engine.travelTo("waiting room");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("route_not_found");
    expect(engine.getCurrentLocation().id).toBe("studio-landing");
  });

  it("follows one-way connections only the way they point", () => {
    const state = createInitialState();
    state.locations["studio-archive"]!.connections = []; // no way back up
    const engine = new GameEngine(state);
    expect(engine.travelTo("archive").ok).toBe(true);
    expect(engine.travelTo("landing").events[0]?.type).toBe("route_not_found");
  });
});

describe("travelTo with compass words", () => {
  function withCompass(): GameEngine {
    const state = createInitialState();
    state.locations["studio-landing"]!.connections[0]!.compassLabel = "east";
    return new GameEngine(state);
  }

  it("moves along the connection carrying that label", () => {
    const engine = withCompass();
    const result = engine.travelTo("east");
    expect(result.ok).toBe(true);
    expect(result.events[0]).toMatchObject({ type: "player_moved", params: { direction: "east" } });
    expect(engine.getCurrentLocation().id).toBe("studio-corridor");
  });

  it("is blocked when nothing here carries the label", () => {
    const engine = withCompass();
    const result = engine.travelTo("north");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("move_blocked");
    expect(engine.getCurrentLocation().id).toBe("studio-landing");
  });
});

describe("talking and taking", () => {
  it("lets the player talk to an NPC in the current room, and records that they did", () => {
    const engine = newEngine();
    expect(engine.talkTo("herald").ok).toBe(true);
    expect(engine.getState().flags["talkedTo.herald"]).toBe(true);
  });

  it("can't talk to someone who isn't here", () => {
    const engine = newEngine();
    engine.travelTo("corridor");
    expect(engine.talkTo("herald").ok).toBe(false);
  });

  it("refuses to take a setpiece", () => {
    const engine = newEngine();
    engine.travelTo("main room");
    expect(engine.takeItem("whiteboard").ok).toBe(false);
  });

  it("picks up a portable item into the inventory", () => {
    const state = createInitialState();
    state.worldObjects["reception-desk"]!.portable = true;
    const engine = new GameEngine(state);
    expect(engine.takeItem("reception desk").ok).toBe(true);
    expect(engine.getState().player.inventory).toContain("reception-desk");
  });

  it("picks a dialogue rule whose flags are all set, ahead of the fallback line", () => {
    const state = createInitialState();
    state.npcs["herald"]!.dialogueRules = [{ requires: ["secret"], textKey: "test.secret" }];
    const engine = new GameEngine(state);
    expect(engine.talkTo("herald").events[0]?.textKey).toBe(state.npcs["herald"]!.dialogueKey);
    state.flags["secret"] = true;
    expect(engine.talkTo("herald").events[0]?.textKey).toBe("test.secret");
  });
});

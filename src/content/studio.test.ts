import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { createInitialState } from "./world";

/** Walks the website's first-slice flow headlessly: landing -> herald -> main room -> examine -> back. */
describe("studio first slice", () => {
  it("starts at the landing, where the herald greets the visitor", () => {
    const engine = new GameEngine(createInitialState(), Math.random, { externalClock: true });
    expect(engine.getState().player.locationId).toBe("studio-landing");
    expect(engine.talkTo("herald").ok).toBe(true);
  });

  it("walks to the main room by name and examines an object", () => {
    const engine = new GameEngine(createInitialState(), Math.random, { externalClock: true });
    expect(engine.travelTo("main room").ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("studio-mainroom");
    expect(engine.examine("whiteboard").ok).toBe(true);
    expect(engine.getSceneImage()?.src).toBe("studio-whiteboard.jpg");
  });

  it("pathfinds across rooms: archive is reachable from the main room via the break room", () => {
    const engine = new GameEngine(createInitialState(), Math.random, { externalClock: true });
    expect(engine.travelTo("archive").ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("studio-archive");
  });
});

describe("studio room structure", () => {
  it("routes the main room's exits through the corridor", () => {
    const engine = new GameEngine(createInitialState(), Math.random, { externalClock: true });
    engine.travelTo("main room");
    // Press room is not directly connected to the main room: the path goes via the corridor.
    expect(engine.travelTo("press room").ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("studio-pressroom");
    expect(engine.travelTo("corridor").ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("studio-corridor");
    expect(engine.travelTo("meeting room").ok).toBe(true);
  });

  it("has no way into the waiting room or bathroom yet", () => {
    const state = createInitialState();
    const inbound = (id: string) =>
      Object.values(state.locations).some((l) => l.connections.some((c) => c.toId === id));
    expect(inbound("studio-waitingroom")).toBe(false);
    expect(inbound("studio-bathroom")).toBe(false);
  });
});

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

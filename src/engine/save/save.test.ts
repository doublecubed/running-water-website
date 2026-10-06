import { describe, expect, it } from "vitest";
import { createInitialState, loadCityContent } from "../../content/world";
import { GameEngine } from "../GameEngine";
import { buildStateFromSave, SAVE_SCHEMA_VERSION, SaveVersionMismatchError, serializeState } from "./save";

describe("serializeState / buildStateFromSave", () => {
  it("round-trips player/clock/placement exactly, rebuilt against fresh content", () => {
    const engine = new GameEngine(createInitialState());
    engine.takeItem("case file"); // office -> inventory, before leaving
    engine.travelTo("out"); // office -> alley

    const saved = serializeState(engine.getState());
    const rebuilt = buildStateFromSave(loadCityContent(), saved);

    expect(rebuilt.player).toEqual(engine.getState().player);
    expect(rebuilt.clock).toEqual(engine.getState().clock);
    expect(rebuilt.placement).toEqual(engine.getState().placement);
    // Static content is present too, freshly loaded rather than copied from the live engine.
    expect(rebuilt.locations.office).toBeDefined();
  });

  it("captures an item's removal from its starting location, and restores that on load — not just the inventory addition", () => {
    const engine = new GameEngine(createInitialState());
    engine.takeItem("case file"); // starts in the office, the player's starting location

    const saved = serializeState(engine.getState());
    const rebuilt = buildStateFromSave(loadCityContent(), saved);

    expect(rebuilt.player.inventory).toContain("case-file");
    expect(rebuilt.placement.worldObjectLocationId["case-file"]).toBeUndefined();
  });

  it("clones rather than aliasing — mutating the live engine after saving doesn't change the SaveData", () => {
    const engine = new GameEngine(createInitialState());
    const saved = serializeState(engine.getState());
    engine.travelTo("out");
    expect(saved.player.locationId).toBe("office");
  });

  it("round-trips partStates, but always resets focusedWorldObjectId to null regardless of what it was before saving", () => {
    const engine = new GameEngine(createInitialState());
    engine.interact("close", "right drawer"); // important + starts open, so reachable without focus, and focuses the desk afterward
    expect(engine.getFocusedWorldObject()?.id).toBe("desk");

    const saved = serializeState(engine.getState());
    expect(saved).not.toHaveProperty("focusedWorldObjectId");
    expect(saved.partStates.desk?.["right-drawer"]).toBe("closed");

    const rebuilt = buildStateFromSave(loadCityContent(), saved);
    expect(rebuilt.partStates).toEqual(engine.getState().partStates);
    expect(rebuilt.focusedWorldObjectId).toBeNull();
    expect(engine.getState().examinedTarget).not.toBeNull(); // examining set it...
    expect(saved).not.toHaveProperty("examinedTarget");
    expect(rebuilt.examinedTarget).toBeNull(); // ...but it never survives a load
  });

  it("stamps the current SAVE_SCHEMA_VERSION", () => {
    const saved = serializeState(createInitialState());
    expect(saved.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });

  it("refuses to build state from a mismatched schema version", () => {
    const saved = serializeState(createInitialState());
    const mismatched = { ...saved, schemaVersion: SAVE_SCHEMA_VERSION + 1 };
    expect(() => buildStateFromSave(loadCityContent(), mismatched)).toThrow(SaveVersionMismatchError);
  });

  it("migrates a schema-7 save (no player.stats) forward instead of throwing, and defaults still apply", () => {
    const saved = serializeState(createInitialState());
    const { stats, ...playerWithoutStats } = saved.player;
    const legacySave = { ...saved, schemaVersion: 7, player: playerWithoutStats as typeof saved.player };

    const rebuilt = buildStateFromSave(loadCityContent(), legacySave);
    expect(rebuilt.player.stats).toBeUndefined();

    const engine = new GameEngine(rebuilt);
    expect(engine.getPlayerStat("stealth")).toBe(30);
  });

  it("migrates a schema-8 save (no player.stealthMode) forward, defaulting stealthMode to false", () => {
    const saved = serializeState(createInitialState());
    const { stealthMode, concealment, ...playerWithoutStealth } = saved.player;
    const legacySave = { ...saved, schemaVersion: 8, player: playerWithoutStealth as typeof saved.player };

    const rebuilt = buildStateFromSave(loadCityContent(), legacySave);
    expect(rebuilt.player.stealthMode).toBe(false);
    expect(rebuilt.player.concealment).toBeUndefined();
  });

  it("migrates a schema-9 save (no flags) forward, defaulting flags to an empty object", () => {
    const saved = serializeState(createInitialState());
    const { flags, ...saveWithoutFlags } = saved;
    const legacySave = { ...saveWithoutFlags, schemaVersion: 9 } as typeof saved;

    const rebuilt = buildStateFromSave(loadCityContent(), legacySave);
    expect(rebuilt.flags).toEqual({});
  });

  it("preserves an explicitly-set player.stats value across a current-schema round-trip", () => {
    const state = createInitialState();
    state.player.stats = { handguns: 60 };
    const saved = serializeState(state);

    const rebuilt = buildStateFromSave(loadCityContent(), saved);
    expect(rebuilt.player.stats).toEqual({ handguns: 60 });
  });

  it("migrates a schema-12 save (no board) forward, defaulting board to empty nodes/connections", () => {
    const saved = serializeState(createInitialState());
    const { board, ...saveWithoutBoard } = saved;
    const legacySave = { ...saveWithoutBoard, schemaVersion: 12 } as typeof saved;

    const rebuilt = buildStateFromSave(loadCityContent(), legacySave);
    expect(rebuilt.board).toEqual({ nodes: [], connections: [] });
  });

  it("preserves board state across a current-schema round-trip", () => {
    const state = createInitialState();
    state.board = { nodes: [{ id: "n1", refKind: "note", refId: null, text: "hunch", x: 5, y: 5 }], connections: [] };
    const saved = serializeState(state);

    const rebuilt = buildStateFromSave(loadCityContent(), saved);
    expect(rebuilt.board).toEqual(state.board);
  });
});

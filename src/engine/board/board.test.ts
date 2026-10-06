import { describe, expect, it } from "vitest";
import { createInitialState } from "../../content/world";
import type { BoardState, GameState } from "../types";
import {
  BOARD_STRING_COLORS,
  addConnection,
  addNode,
  defaultNodePosition,
  editNoteText,
  listAddableEntities,
  moveNode,
  recolorConnection,
  removeConnection,
  removeNode,
} from "./board";

function emptyBoard(): BoardState {
  return { nodes: [], connections: [] };
}

describe("board — node mutations", () => {
  it("adds a node and generates an id", () => {
    const { board, id } = addNode(emptyBoard(), { refKind: "note", refId: null, text: "hunch", x: 10, y: 20 });
    expect(board.nodes).toHaveLength(1);
    expect(board.nodes[0]).toEqual({ id, refKind: "note", refId: null, text: "hunch", x: 10, y: 20 });
  });

  it("moves a node to a new position", () => {
    const { board, id } = addNode(emptyBoard(), { refKind: "note", refId: null, text: "hunch", x: 0, y: 0 });
    const moved = moveNode(board, id, 50, 60);
    expect(moved.nodes[0]).toMatchObject({ x: 50, y: 60 });
  });

  it("removes a node", () => {
    const { board, id } = addNode(emptyBoard(), { refKind: "note", refId: null, text: "hunch", x: 0, y: 0 });
    expect(removeNode(board, id).nodes).toHaveLength(0);
  });

  it("removing a node cascades to any connection touching it", () => {
    let board = emptyBoard();
    ({ board } = addNode(board, { refKind: "note", refId: null, text: "a", x: 0, y: 0 }));
    const aId = board.nodes[0]!.id;
    ({ board } = addNode(board, { refKind: "note", refId: null, text: "b", x: 0, y: 0 }));
    const bId = board.nodes[1]!.id;
    const result = addConnection(board, aId, bId, "red");
    expect(result).not.toBeNull();
    board = result!.board;
    expect(board.connections).toHaveLength(1);

    board = removeNode(board, aId);
    expect(board.connections).toHaveLength(0);
  });

  it("edits a note node's text", () => {
    const { board, id } = addNode(emptyBoard(), { refKind: "note", refId: null, text: "old", x: 0, y: 0 });
    const edited = editNoteText(board, id, "new");
    expect(edited.nodes[0]!.text).toBe("new");
  });

  it("no-ops editing text on a non-note node", () => {
    const { board, id } = addNode(emptyBoard(), { refKind: "fact", refId: "fact-1", text: null, x: 0, y: 0 });
    const edited = editNoteText(board, id, "should not apply");
    expect(edited.nodes[0]!.text).toBeNull();
  });
});

describe("board — connections", () => {
  function twoNodeBoard(): { board: BoardState; aId: string; bId: string } {
    let board = emptyBoard();
    ({ board } = addNode(board, { refKind: "note", refId: null, text: "a", x: 0, y: 0 }));
    const aId = board.nodes[0]!.id;
    ({ board } = addNode(board, { refKind: "note", refId: null, text: "b", x: 0, y: 0 }));
    const bId = board.nodes[1]!.id;
    return { board, aId, bId };
  }

  it("adds a connection with a color", () => {
    const { board, aId, bId } = twoNodeBoard();
    const result = addConnection(board, aId, bId, "blue");
    expect(result).not.toBeNull();
    expect(result!.board.connections[0]).toMatchObject({ fromNodeId: aId, toNodeId: bId, color: "blue" });
  });

  it("rejects a self-connection", () => {
    const { board, aId } = twoNodeBoard();
    expect(addConnection(board, aId, aId, "red")).toBeNull();
  });

  it("rejects a connection to a missing node", () => {
    const { board, aId } = twoNodeBoard();
    expect(addConnection(board, aId, "no-such-node", "red")).toBeNull();
  });

  it("rejects a duplicate connection regardless of endpoint order", () => {
    const { board, aId, bId } = twoNodeBoard();
    const first = addConnection(board, aId, bId, "red");
    expect(first).not.toBeNull();
    expect(addConnection(first!.board, bId, aId, "green")).toBeNull();
  });

  it("removes a connection", () => {
    const { board, aId, bId } = twoNodeBoard();
    const { board: withConnection, id } = addConnection(board, aId, bId, "red")!;
    expect(removeConnection(withConnection, id).connections).toHaveLength(0);
  });

  it("recolors a connection", () => {
    const { board, aId, bId } = twoNodeBoard();
    const { board: withConnection, id } = addConnection(board, aId, bId, "red")!;
    const recolored = recolorConnection(withConnection, id, "yellow");
    expect(recolored.connections[0]!.color).toBe("yellow");
  });

  it("recoloring a missing connection is a no-op", () => {
    const { board } = twoNodeBoard();
    expect(recolorConnection(board, "no-such-connection", "yellow")).toEqual(board);
  });

  it("exposes the fixed v1 palette", () => {
    expect(BOARD_STRING_COLORS).toEqual(["red", "blue", "yellow", "green"]);
  });
});

describe("board — defaultNodePosition", () => {
  it("staggers across a 5-column grid", () => {
    expect(defaultNodePosition(0)).toEqual({ x: 100, y: 100 });
    expect(defaultNodePosition(1)).toEqual({ x: 280, y: 100 });
    expect(defaultNodePosition(4)).toEqual({ x: 820, y: 100 });
    expect(defaultNodePosition(5)).toEqual({ x: 100, y: 240 });
  });
});

describe("board — listAddableEntities", () => {
  function fixture(): GameState {
    const state = createInitialState();
    state.facts = { ...state.facts, "fact-x": { id: "fact-x", textKey: "fact.x.text" } };
    state.npcs = {
      ...state.npcs,
      "npc-x": { id: "npc-x", nameKey: "npc.x.name", descriptionKey: "npc.x.description", aliases: ["npc-x"], dialogueRules: [], dialogueKey: "npc.x.dialogue", labels: [] },
    };
    const someLocationId = Object.keys(state.locations)[0]!;
    const someItemId = Object.keys(state.worldObjects)[0]!;
    state.player.visitedLocationIds = [someLocationId];
    state.player.inventory = [someItemId];
    return state;
  }

  it("lists a known fact", () => {
    const state = fixture();
    state.playerFacts = { "fact-x": { atMinutes: 0 } };
    const entities = listAddableEntities(state);
    expect(entities).toContainEqual({ refKind: "fact", refId: "fact-x", labelKey: "fact.x.text" });
  });

  it("lists an NPC met via the talkedTo flag convention", () => {
    const state = fixture();
    state.flags = { "talkedTo.npc-x": true };
    const entities = listAddableEntities(state);
    expect(entities).toContainEqual({ refKind: "npc", refId: "npc-x", labelKey: "npc.x.name" });
  });

  it("does not list an NPC whose talkedTo flag is false", () => {
    const state = fixture();
    state.flags = { "talkedTo.npc-x": false };
    expect(listAddableEntities(state).some((e) => e.refKind === "npc")).toBe(false);
  });

  it("lists a visited location", () => {
    const state = fixture();
    const locationId = state.player.visitedLocationIds[0]!;
    const entities = listAddableEntities(state);
    expect(entities).toContainEqual({ refKind: "location", refId: locationId, labelKey: state.locations[locationId]!.nameKey });
  });

  it("lists an inventory item", () => {
    const state = fixture();
    const itemId = state.player.inventory[0]!;
    const entities = listAddableEntities(state);
    expect(entities).toContainEqual({ refKind: "item", refId: itemId, labelKey: state.worldObjects[itemId]!.nameKey });
  });

  it("excludes an entity that already has a board node", () => {
    const state = fixture();
    state.playerFacts = { "fact-x": { atMinutes: 0 } };
    const { board } = addNode(state.board, { refKind: "fact", refId: "fact-x", text: null, x: 0, y: 0 });
    state.board = board;
    expect(listAddableEntities(state).some((e) => e.refKind === "fact" && e.refId === "fact-x")).toBe(false);
  });
});

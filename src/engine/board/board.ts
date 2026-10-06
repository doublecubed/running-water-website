import { generateNotebookId } from "../notebooks";
import type { BoardNode, BoardNodeId, BoardState, BoardStringColor, GameState } from "../types";

/**
 * Pure helpers for the case board — see docs/systems/case-board.md. Nothing
 * here touches `GameState` directly except `listAddableEntities` (a
 * read-only query); `GameEngine` calls these and wires the results into its
 * own mutation methods (`addBoardNode`, `moveBoardNode`, ...), same split as
 * `notebooks.ts`/`npc/schedule.ts`.
 *
 * Three deliberate v1 scope limits, not oversights:
 *  - Item nodes are sourced from `Player.inventory` only — there is no
 *    "examined but not taken" tracking anywhere in the engine yet, so an
 *    item only seen (never picked up) can't be offered as a node.
 *  - "NPCs met" is detected by scanning `state.flags` for the existing
 *    `talkedTo.<npcId>` convention (set by `GameEngine.talkTo`) — this does
 *    NOT get a new dedicated `Player` field; it reuses the flag exactly the
 *    way dialogue conditions already do.
 *  - No auto-inferred connections, no contradiction/corroboration
 *    detection, no connection labels — every node and every string is
 *    placed and colored by the player, and nothing here ever concludes
 *    anything on their behalf.
 */

/** Fixed v1 palette a player picks from when drawing or recoloring a string, in picker-display order. */
export const BOARD_STRING_COLORS: BoardStringColor[] = ["red", "blue", "yellow", "green"];

const TALKED_TO_PREFIX = "talkedTo.";

function nodeExists(board: BoardState, nodeId: BoardNodeId): boolean {
  return board.nodes.some((node) => node.id === nodeId);
}

function hasNode(board: BoardState, refKind: BoardNode["refKind"], refId: string | null): boolean {
  return board.nodes.some((node) => node.refKind === refKind && node.refId === refId);
}

/** Adds a new node, generating its id. Does not reject a duplicate reference — the caller (`listAddableEntities`) is what keeps the picker from offering an already-added entity twice; re-adding the same entity is still technically possible and harmless. */
export function addNode(board: BoardState, node: Omit<BoardNode, "id">): { board: BoardState; id: BoardNodeId } {
  const id = generateNotebookId("board-node");
  return { board: { ...board, nodes: [...board.nodes, { ...node, id }] }, id };
}

export function moveNode(board: BoardState, nodeId: BoardNodeId, x: number, y: number): BoardState {
  return { ...board, nodes: board.nodes.map((node) => (node.id === nodeId ? { ...node, x, y } : node)) };
}

/** Removes a node and cascades to any connection touching it, so no connection is ever left dangling on a missing endpoint. */
export function removeNode(board: BoardState, nodeId: BoardNodeId): BoardState {
  return {
    nodes: board.nodes.filter((node) => node.id !== nodeId),
    connections: board.connections.filter((connection) => connection.fromNodeId !== nodeId && connection.toNodeId !== nodeId),
  };
}

/** No-ops (returns `board` unchanged) if `nodeId` doesn't exist or isn't a `"note"` node — editing text only ever makes sense for a player-authored node. */
export function editNoteText(board: BoardState, nodeId: BoardNodeId, text: string): BoardState {
  return {
    ...board,
    nodes: board.nodes.map((node) => (node.id === nodeId && node.refKind === "note" ? { ...node, text } : node)),
  };
}

/** Rejects (returns `null`, mutating nothing) a self-connection, a connection to a missing node, or a duplicate of an existing unordered pair. */
export function addConnection(
  board: BoardState,
  fromNodeId: BoardNodeId,
  toNodeId: BoardNodeId,
  color: BoardStringColor,
): { board: BoardState; id: string } | null {
  if (fromNodeId === toNodeId) return null;
  if (!nodeExists(board, fromNodeId) || !nodeExists(board, toNodeId)) return null;
  const isDuplicate = board.connections.some(
    (connection) =>
      (connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId) ||
      (connection.fromNodeId === toNodeId && connection.toNodeId === fromNodeId),
  );
  if (isDuplicate) return null;

  const id = generateNotebookId("board-connection");
  return { board: { ...board, connections: [...board.connections, { id, fromNodeId, toNodeId, color }] }, id };
}

export function removeConnection(board: BoardState, connectionId: string): BoardState {
  return { ...board, connections: board.connections.filter((connection) => connection.id !== connectionId) };
}

/** No-ops if `connectionId` doesn't exist. */
export function recolorConnection(board: BoardState, connectionId: string, color: BoardStringColor): BoardState {
  return {
    ...board,
    connections: board.connections.map((connection) => (connection.id === connectionId ? { ...connection, color } : connection)),
  };
}

/** One entity the "add node" picker can offer — a reference category only (never `"note"`, which is authored as free text directly, not picked from a list). `labelKey` is a locale key the view resolves via `t()`; this module never produces display strings itself. */
export interface AddableEntity {
  refKind: "fact" | "npc" | "location" | "item";
  refId: string;
  labelKey: string;
}

/**
 * Everything the player could currently add to the board, grouped by kind,
 * excluding anything that already has a node. Sourced entirely from
 * existing "what has the player encountered" state — see this file's
 * header comment for why items/NPCs specifically are scoped the way they
 * are.
 */
/** Default staggered placement for the Nth node added via the picker (Stage 3) — a simple grid, not load-bearing (any two positions are fine; this just keeps freshly-added cards from all landing exactly on top of each other). See docs/systems/case-board.md. */
export function defaultNodePosition(existingNodeCount: number): { x: number; y: number } {
  const columns = 5;
  return { x: 100 + (existingNodeCount % columns) * 180, y: 100 + Math.floor(existingNodeCount / columns) * 140 };
}

export function listAddableEntities(state: GameState): AddableEntity[] {
  const board = state.board;
  const entities: AddableEntity[] = [];

  for (const factId of Object.keys(state.playerFacts)) {
    if (hasNode(board, "fact", factId)) continue;
    const fact = state.facts[factId];
    if (fact) entities.push({ refKind: "fact", refId: factId, labelKey: fact.textKey });
  }

  for (const flagKey of Object.keys(state.flags)) {
    if (!state.flags[flagKey] || !flagKey.startsWith(TALKED_TO_PREFIX)) continue;
    const npcId = flagKey.slice(TALKED_TO_PREFIX.length);
    if (hasNode(board, "npc", npcId)) continue;
    const npc = state.npcs[npcId];
    if (npc) entities.push({ refKind: "npc", refId: npcId, labelKey: npc.nameKey });
  }

  for (const locationId of state.player.visitedLocationIds) {
    if (hasNode(board, "location", locationId)) continue;
    const location = state.locations[locationId];
    if (location) entities.push({ refKind: "location", refId: locationId, labelKey: location.nameKey });
  }

  for (const itemId of state.player.inventory) {
    if (hasNode(board, "item", itemId)) continue;
    const item = state.worldObjects[itemId];
    if (item) entities.push({ refKind: "item", refId: itemId, labelKey: item.nameKey });
  }

  return entities;
}

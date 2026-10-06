import type { AddableEntity } from "../engine/board/board";
import { BOARD_STRING_COLORS } from "../engine/board/board";
import type { BoardNode, BoardState, BoardStringColor } from "../engine/types";
import { isClick, movedDistance } from "../mapview/dragGesture";

/**
 * Renders the case board overlay's canvas — see docs/systems/case-board.md.
 * A stateless render function, following the same "full wholesale redraw
 * on any change" posture as `TerminalView`'s notebook-page-view overlay:
 * `TerminalView` owns every piece of transient UI-only state (which
 * color-swatch popover is open, which note is being edited) and calls this
 * again after every change.
 *
 * Deliberately NO pan/zoom (unlike `src/mapview/MapView.ts`) — nodes are
 * plain absolutely-positioned `<div>` cards inside a large, scrollable
 * canvas (CSS `overflow: auto`), not an SVG viewBox. This is a smaller
 * surface than a real corkboard needs at scale, but pan/zoom wasn't part
 * of what was asked for, and the plain-scroll canvas is far simpler than
 * reusing MapView's viewBox math for a card-based, not circle-based,
 * layout — see `dragGesture.ts`'s header comment for why only the
 * click-vs-drag threshold is actually shared with MapView.
 *
 * Each card has a thin header strip with a pin ("O") — the string anchor
 * point AND the drag handle for starting a connection (see `attachPinDrag`
 * below). This is deliberately a SEPARATE pointer listener from the card
 * body's own move-handle (`attachDrag`) so that grabbing the pin never
 * repositions the node, and grabbing the body never starts a connection.
 */

const BOARD_CANVAS_SIZE = 3000;

/** Must match `.board-node`'s CSS width — used to compute the pin's canvas-local anchor point without a DOM measurement (jsdom can't lay out real geometry, so this stays a constant, same posture as `CLICK_MOVEMENT_THRESHOLD_PX`). */
const BOARD_NODE_WIDTH = 160;
/** Distance from a node's `y` (its card's top edge) down to the pin's vertical center — must match `.board-node__header`'s height in CSS. */
const BOARD_NODE_PIN_Y = 10;

function pinAnchor(node: BoardNode): { x: number; y: number } {
  return { x: node.x + BOARD_NODE_WIDTH / 2, y: node.y + BOARD_NODE_PIN_Y };
}

/**
 * `document.elementFromPoint` always returns `null` under jsdom (no real
 * layout engine), so the pin-drag drop-target lookup is routed through this
 * overridable hook. Tests assign a stub here before dispatching the
 * `pointerup` that completes a drag, and reset it to `null` afterward — the
 * same spirit as `TerminalView.test.ts`'s `pointer()` MouseEvent
 * substitution for `PointerEvent`, a documented jsdom workaround rather
 * than a production code smell.
 */
let elementFromPointForTest: ((x: number, y: number) => Element | null) | null = null;

/** Test-only hook — see `elementFromPointForTest`'s doc comment above. Pass `null` to restore the real `document.elementFromPoint`. */
export function setElementFromPointForTest(lookup: ((x: number, y: number) => Element | null) | null): void {
  elementFromPointForTest = lookup;
}

function findDropTargetNodeId(clientX: number, clientY: number): string | null {
  const lookup = elementFromPointForTest ?? document.elementFromPoint.bind(document);
  const el = lookup(clientX, clientY);
  return el?.closest<HTMLElement>(".board-node")?.dataset.nodeId ?? null;
}

export interface BoardViewState {
  /** A second node was dropped onto while a pin-drag was in progress from a different node — the color swatch popover shows near the target node, and `onPickColor` finishes the connection using `fromNodeId`. */
  pendingConnection: { fromNodeId: string; toNodeId: string } | null;
  /** A connection's string was clicked — the color swatch popover (plus a remove control) shows near its midpoint. */
  recoloring: { connectionId: string } | null;
}

export interface BoardViewCallbacks {
  /** A node's drag gesture ended past the click threshold — the final position to persist via `GameEngine.moveBoardNode`. */
  onNodeDragEnd(nodeId: string, x: number, y: number): void;
  /** A pin-drag was released over a DIFFERENT node's pin — opens the color-swatch popover to finish the connection. Never fires for a same-node or off-node drop (silent no-op). */
  onConnectionDragEnd(fromNodeId: string, toNodeId: string): void;
  /** A `"note"` node's pencil icon was clicked — enters edit mode for that node. */
  onEditNote(nodeId: string): void;
  /** A `"note"` node's textarea was blurred — commits via `GameEngine.editBoardNoteText`. */
  onNoteTextCommit(nodeId: string, text: string): void;
  onRemoveNode(nodeId: string): void;
  /** An existing connection's string was clicked — opens the recolor/remove popover. */
  onConnectionClick(connectionId: string): void;
  /** A color swatch was picked while `pendingConnection` or `recoloring` was set. */
  onPickColor(color: BoardStringColor): void;
  onRemoveConnection(connectionId: string): void;
}

export function renderBoard(
  mount: HTMLElement,
  board: BoardState,
  resolveLabel: (node: BoardNode) => string,
  editingNoteId: string | null,
  uiState: BoardViewState,
  callbacks: BoardViewCallbacks,
): void {
  const canvas = document.createElement("div");
  canvas.className = "board-canvas";
  canvas.style.width = `${BOARD_CANVAS_SIZE}px`;
  canvas.style.height = `${BOARD_CANVAS_SIZE}px`;

  const strings = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  strings.setAttribute("class", "board-strings");
  strings.setAttribute("width", String(BOARD_CANVAS_SIZE));
  strings.setAttribute("height", String(BOARD_CANVAS_SIZE));
  const nodesById = new Map(board.nodes.map((n) => [n.id, n]));
  for (const connection of board.connections) {
    const from = nodesById.get(connection.fromNodeId);
    const to = nodesById.get(connection.toNodeId);
    if (!from || !to) continue;
    const fromAnchor = pinAnchor(from);
    const toAnchor = pinAnchor(to);
    // A wide, invisible hit-stroke sits under the thin visible line —
    // mirrors MapView's edge click-hitbox technique — since a 2px line is
    // too small a target to click reliably.
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "line");
    hit.setAttribute("class", "board-strings__hit");
    hit.setAttribute("x1", String(fromAnchor.x));
    hit.setAttribute("y1", String(fromAnchor.y));
    hit.setAttribute("x2", String(toAnchor.x));
    hit.setAttribute("y2", String(toAnchor.y));
    hit.addEventListener("click", () => callbacks.onConnectionClick(connection.id));

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", `board-strings__line board-strings__line--${connection.color}`);
    line.setAttribute("x1", String(fromAnchor.x));
    line.setAttribute("y1", String(fromAnchor.y));
    line.setAttribute("x2", String(toAnchor.x));
    line.setAttribute("y2", String(toAnchor.y));
    strings.append(hit, line);
  }
  canvas.append(strings);

  for (const node of board.nodes) {
    canvas.append(renderNode(node, resolveLabel, editingNoteId === node.id, strings, callbacks));
  }

  if (uiState.recoloring) {
    const connection = board.connections.find((c) => c.id === uiState.recoloring!.connectionId);
    const from = connection && nodesById.get(connection.fromNodeId);
    const to = connection && nodesById.get(connection.toNodeId);
    if (from && to) {
      const fromAnchor = pinAnchor(from);
      const toAnchor = pinAnchor(to);
      canvas.append(
        renderColorPopover((fromAnchor.x + toAnchor.x) / 2, (fromAnchor.y + toAnchor.y) / 2, callbacks, () =>
          callbacks.onRemoveConnection(uiState.recoloring!.connectionId),
        ),
      );
    }
  } else if (uiState.pendingConnection) {
    const target = nodesById.get(uiState.pendingConnection.toNodeId);
    if (target) {
      const anchor = pinAnchor(target);
      canvas.append(renderColorPopover(anchor.x, anchor.y - 40, callbacks));
    }
  }

  mount.replaceChildren(canvas);
}

function renderColorPopover(x: number, y: number, callbacks: BoardViewCallbacks, onRemove?: () => void): HTMLElement {
  const popover = document.createElement("div");
  popover.className = "board-color-picker";
  popover.style.left = `${x}px`;
  popover.style.top = `${y}px`;
  for (const color of BOARD_STRING_COLORS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = `board-color-picker__swatch board-color-picker__swatch--${color}`;
    swatch.addEventListener("click", () => callbacks.onPickColor(color));
    popover.append(swatch);
  }
  if (onRemove) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "board-color-picker__remove";
    remove.textContent = "×";
    remove.addEventListener("click", onRemove);
    popover.append(remove);
  }
  return popover;
}

function renderNode(
  node: BoardNode,
  resolveLabel: (node: BoardNode) => string,
  isEditing: boolean,
  stringsLayer: SVGSVGElement,
  callbacks: BoardViewCallbacks,
): HTMLElement {
  const card = document.createElement("div");
  card.className = `board-node board-node--${node.refKind}`;
  card.dataset.nodeId = node.id;
  card.style.left = `${node.x}px`;
  card.style.top = `${node.y}px`;

  const header = document.createElement("div");
  header.className = "board-node__header";

  const pin = document.createElement("span");
  pin.className = "board-node__pin";
  header.append(pin);

  if (node.refKind === "note") {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "board-node__edit";
    edit.textContent = "✎";
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      callbacks.onEditNote(node.id);
    });
    header.append(edit);
  }

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "board-node__remove";
  removeButton.textContent = "×";
  removeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    callbacks.onRemoveNode(node.id);
  });
  header.append(removeButton);

  card.append(header);

  if (node.refKind === "note" && isEditing) {
    const textarea = document.createElement("textarea");
    textarea.className = "board-node__text board-node__text--editable";
    textarea.value = node.text ?? "";
    textarea.addEventListener("pointerdown", (event) => event.stopPropagation());
    textarea.addEventListener("blur", () => callbacks.onNoteTextCommit(node.id, textarea.value));
    card.append(textarea);
    queueMicrotask(() => textarea.focus());
  } else {
    const text = document.createElement("div");
    text.className = "board-node__text";
    text.textContent = resolveLabel(node);
    card.append(text);
  }

  attachDrag(card, node, callbacks);
  attachPinDrag(pin, card, node, stringsLayer, callbacks);
  return card;
}

/** Pointer-down/move/up wiring for one node card — click-vs-drag resolved via `dragGesture.ts`'s shared threshold, same posture as `MapView`'s node dragging, but tracking plain client-pixel deltas directly against the card's own `x`/`y` (no viewBox conversion — see this file's header comment). A brief click that doesn't clear the threshold is simply a no-op now (connections no longer start from a card-body click — see `attachPinDrag`). */
function attachDrag(card: HTMLElement, node: BoardNode, callbacks: BoardViewCallbacks): void {
  card.addEventListener("pointerdown", (event) => {
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startX = node.x;
    const startY = node.y;
    try {
      card.setPointerCapture(event.pointerId);
    } catch {
      /* unsupported in this environment — non-fatal, matches MapView's own guard */
    }

    let lastX = startX;
    let lastY = startY;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startClientX;
      const dy = moveEvent.clientY - startClientY;
      lastX = startX + dx;
      lastY = startY + dy;
      card.style.left = `${lastX}px`;
      card.style.top = `${lastY}px`;
    };
    const onUp = (upEvent: PointerEvent) => {
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerup", onUp);
      const moved = movedDistance(upEvent.clientX - startClientX, upEvent.clientY - startClientY);
      if (!isClick(moved)) {
        callbacks.onNodeDragEnd(node.id, lastX, lastY);
      }
    };
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerup", onUp);
  });
}

/** Pointer-down/move/up wiring for a node's pin — pressing and dragging it draws a live thread (a temporary SVG line, mutated directly, no re-render mid-gesture) from the pin to the cursor; releasing over a DIFFERENT node's pin resolves the connection via `onConnectionDragEnd`. Releasing over empty space or the same node discards the temp line with no callback — a silent no-op, same posture as an accidental click used to be. */
function attachPinDrag(pin: HTMLElement, card: HTMLElement, node: BoardNode, stringsLayer: SVGSVGElement, callbacks: BoardViewCallbacks): void {
  pin.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    try {
      pin.setPointerCapture(event.pointerId);
    } catch {
      /* unsupported in this environment — non-fatal, matches MapView's own guard */
    }

    const canvas = card.parentElement as HTMLElement | null;
    const canvasRect = canvas?.getBoundingClientRect();
    const anchor = pinAnchor(node);

    const tempLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tempLine.setAttribute("class", "board-strings__line board-strings__line--pending");
    tempLine.setAttribute("x1", String(anchor.x));
    tempLine.setAttribute("y1", String(anchor.y));
    tempLine.setAttribute("x2", String(anchor.x));
    tempLine.setAttribute("y2", String(anchor.y));
    stringsLayer.append(tempLine);

    const onMove = (moveEvent: PointerEvent) => {
      const x = canvasRect ? moveEvent.clientX - canvasRect.left : moveEvent.clientX;
      const y = canvasRect ? moveEvent.clientY - canvasRect.top : moveEvent.clientY;
      tempLine.setAttribute("x2", String(x));
      tempLine.setAttribute("y2", String(y));
    };
    const onUp = (upEvent: PointerEvent) => {
      pin.removeEventListener("pointermove", onMove);
      pin.removeEventListener("pointerup", onUp);
      tempLine.remove();
      const targetNodeId = findDropTargetNodeId(upEvent.clientX, upEvent.clientY);
      if (targetNodeId && targetNodeId !== node.id) {
        callbacks.onConnectionDragEnd(node.id, targetNodeId);
      }
    };
    pin.addEventListener("pointermove", onMove);
    pin.addEventListener("pointerup", onUp);
  });
}

// --- The "+ Add node" picker (Stage 3) — a plain DOM dropdown hosted in
// the overlay's toolbar, NOT a `MenuFlow` screen: `MenuFlow` renders into
// the terminal scrollback, which sits entirely BEHIND this full-screen
// overlay, so it has no way to be shown while the board is open. This is
// a deliberate deviation from the original plan sketch (which speculated
// reusing `MenuFlow`) made after inspecting how the existing notebook
// overlay's own "+ New note" affordance works — it's plain DOM too, for
// the same reason. See docs/systems/case-board.md.

export type AddNodeCategory = "fact" | "npc" | "location" | "item" | "note";

const CATEGORY_LABEL_KEYS: Record<AddNodeCategory, string> = {
  fact: "ui.boardCategoryFacts",
  npc: "ui.boardCategoryPeople",
  location: "ui.boardCategoryPlaces",
  item: "ui.boardCategoryItems",
  note: "ui.boardCategoryNote",
};

export interface AddNodeMenuState {
  open: boolean;
  /** `null` shows the top-level category list. */
  category: AddNodeCategory | null;
}

export interface AddNodeMenuCallbacks {
  onToggle(): void;
  onSelectCategory(category: AddNodeCategory): void;
  onSelectEntity(entity: AddableEntity): void;
  onSubmitNote(text: string): void;
  onBack(): void;
}

export function renderAddNodeMenu(
  mount: HTMLElement,
  entities: AddableEntity[],
  t: (key: string) => string,
  state: AddNodeMenuState,
  callbacks: AddNodeMenuCallbacks,
): void {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "board-overlay__add-node-toggle";
  toggle.textContent = t("ui.boardAddNode");
  toggle.addEventListener("click", callbacks.onToggle);

  if (!state.open) {
    mount.replaceChildren(toggle);
    return;
  }

  const panel = document.createElement("div");
  panel.className = "board-add-node-menu";

  if (state.category === null) {
    for (const category of Object.keys(CATEGORY_LABEL_KEYS) as AddNodeCategory[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t(CATEGORY_LABEL_KEYS[category]);
      button.addEventListener("click", () => callbacks.onSelectCategory(category));
      panel.append(button);
    }
  } else if (state.category === "note") {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = t("ui.boardNoteTextPrompt");
    const submit = document.createElement("button");
    submit.type = "button";
    submit.textContent = "+";
    submit.addEventListener("click", () => {
      const value = input.value.trim();
      if (value.length > 0) callbacks.onSubmitNote(value);
    });
    panel.append(input, submit, backButton(t, callbacks));
  } else {
    const matching = entities.filter((entity) => entity.refKind === state.category);
    if (matching.length === 0) {
      const empty = document.createElement("p");
      empty.className = "board-add-node-menu__empty";
      empty.textContent = t("ui.boardNoAddableEntities");
      panel.append(empty);
    } else {
      for (const entity of matching) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = t(entity.labelKey);
        button.addEventListener("click", () => callbacks.onSelectEntity(entity));
        panel.append(button);
      }
    }
    panel.append(backButton(t, callbacks));
  }

  mount.replaceChildren(toggle, panel);
}

function backButton(t: (key: string) => string, callbacks: AddNodeMenuCallbacks): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "board-add-node-menu__back";
  button.textContent = t("ui.boardBack");
  button.addEventListener("click", callbacks.onBack);
  return button;
}

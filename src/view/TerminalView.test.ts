import { afterEach, describe, expect, it } from "vitest";
import { createInitialState } from "../content/world";
import { GameEngine } from "../engine/GameEngine";
import { EnglishCommandParser } from "../engine/parsing/EnglishCommandParser";
import { setElementFromPointForTest } from "./boardView";
import { buildDissolveFilter } from "./imagePane";
import { TerminalView } from "./TerminalView";

/**
 * Exercises the click-to-jot picking mode (docs/systems/notebooks.md's
 * `jotDown` section) end to end through the DOM, the one part of this
 * feature that's genuinely a view/mouse-interaction concern rather than
 * something GameEngine.test.ts can cover headlessly (CLAUDE.md's
 * engine/view boundary).
 */
/** A fresh engine whose starting room has no scene image, so image tests start from a hidden pane. */
function newEngine(): GameEngine {
  const state = createInitialState();
  delete state.locations[state.player.locationId]!.image;
  return new GameEngine(state);
}

/** Moves to the main room and makes its workspace portable, then picks it up: a carried item for the inventory/board tests. */
function takeWorkspace(engine: GameEngine): void {
  engine.travelTo("main room");
  engine.getState().worldObjects["workspace"]!.portable = true;
  engine.takeItem("workspace");
}

function setUp() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const engine = newEngine();
  const parser = new EnglishCommandParser(false);
  const view = new TerminalView(root, engine, parser, 0); // fade off — most tests assert DOM state synchronously; see "scene image fade" describe block for fade behavior itself
  const input = root.querySelector<HTMLInputElement>('[data-role="input"]')!;
  const log = root.querySelector<HTMLElement>('[data-role="log"]')!;

  const submit = async (raw: string) => {
    input.value = raw;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await new Promise((r) => setTimeout(r, 0));
  };

  const jottableLine = () =>
    Array.from(log.querySelectorAll<HTMLElement>(".terminal__line")).find(
      (el) => !el.classList.contains("terminal__line--input") && el.dataset.role !== "jot-prompt",
    )!;

  const click = async (el: HTMLElement) => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  };

  return { root, engine, view, input, log, submit, jottableLine, click };
}

describe("TerminalView — click-to-jot picking mode", () => {
  it("enters picking mode on a bare 'jot down' and jots the clicked line into the active notebook", async () => {
    const { engine, view, log, submit, jottableLine, click } = setUp();
    engine.buyNotebook("notebook");
    engine.setActiveNotebook(engine.getNotebooks()[0]!.id);
    await view.start(); // prints the starting location description, so there's a line to jot

    await submit("jot down");
    expect(log.classList.contains("terminal__log--jot-picking")).toBe(true);

    const line = jottableLine();
    const jottedText = line.textContent!;
    await click(line);

    expect(log.classList.contains("terminal__log--jot-picking")).toBe(false);
    const notebook = engine.getNotebooks()[0]!;
    const jottedBlock = notebook.pages[0]!.blocks.find((b) => b.spans.some((s) => s.text === jottedText));
    expect(jottedBlock).toBeTruthy();
    expect(jottedBlock!.sourceRef).toBe("scrollback:click");
  });

  it("rejects a click on the player's own echoed input while picking, with feedback, and stays in pick mode", async () => {
    const { engine, log, submit, click } = setUp();
    engine.buyNotebook("notebook");
    engine.setActiveNotebook(engine.getNotebooks()[0]!.id);

    await submit("look"); // prints an input echo line, plus output lines
    await submit("jot down");

    const inputEcho = Array.from(log.querySelectorAll<HTMLElement>(".terminal__line--input")).at(-1)!;
    await click(inputEcho);

    // Still picking — the click on the input echo was rejected, not accepted.
    expect(log.classList.contains("terminal__log--jot-picking")).toBe(true);
    expect(engine.getNotebooks()[0]!.pages[0]!.blocks).toHaveLength(0);
    expect(log.lastElementChild?.textContent).toBe("You can't jot that down — click a line of what's happened, not your own input or a menu.");
  });

  it("opens the notebook picker when a line is clicked with 2+ notebooks owned and none active", async () => {
    const { engine, view, log, submit, jottableLine, click } = setUp();
    engine.buyNotebook("notebook");
    engine.buyNotebook("notebook");
    // Two owned, neither active.
    await view.start(); // prints the starting location description, so there's a line to jot

    await submit("jot down");
    await click(jottableLine());

    expect(log.querySelector(".terminal__menu")).toBeTruthy();
    expect(engine.getNotebooks().every((n) => n.pages[0]!.blocks.length === 0)).toBe(true);
  });

  it("jots straight into the sole notebook, without asking, when exactly one is owned and none is active", async () => {
    const { engine, view, log, submit, jottableLine, click } = setUp();
    engine.buyNotebook("notebook");
    // One owned, not active.
    await view.start();

    await submit("jot down");
    const line = jottableLine();
    const jottedText = line.textContent!;
    await click(line);

    expect(log.querySelector(".terminal__menu")).toBeNull(); // never asked "which one?"
    const notebook = engine.getNotebooks()[0]!;
    expect(notebook.pages[0]!.blocks.some((b) => b.spans.some((s) => s.text === jottedText))).toBe(true);
  });

  it("refuses a bare 'jot down' before entering pick mode when no notebooks are owned at all", async () => {
    const { log, submit } = setUp();

    await submit("jot down");

    expect(log.classList.contains("terminal__log--jot-picking")).toBe(false);
    expect(log.lastElementChild?.textContent).toBe("You don't have a notebook. You can buy one with \"buy notebook\".");
  });

  it("cancels picking mode when the player types 'cancel' instead of clicking", async () => {
    const { engine, log, submit } = setUp();
    engine.buyNotebook("notebook");
    engine.setActiveNotebook(engine.getNotebooks()[0]!.id);

    await submit("jot down");
    expect(log.classList.contains("terminal__log--jot-picking")).toBe(true);
    await submit("cancel");
    expect(log.classList.contains("terminal__log--jot-picking")).toBe(false);
    expect(engine.getNotebooks()[0]!.pages[0]!.blocks).toHaveLength(0);
  });
});

describe("TerminalView — NPC topic menu", () => {
  it("'talk herald' opens a topic menu, selecting a topic answers and reopens it, and 'leave' returns to normal dispatch", async () => {
    const { engine, log, submit } = setUp();

    await submit("talk herald");
    const menu = log.querySelector(".terminal__menu");
    expect(menu).toBeTruthy();
    const optionTexts = Array.from(menu!.querySelectorAll("p")).map((p) => p.textContent);
    expect(optionTexts).toContain("1) the studio");
    expect(optionTexts.some((text) => text?.includes("Leave"))).toBe(true);

    // Selecting a topic prints the answer and reopens the menu, rather than closing it.
    await submit("1");
    expect(log.querySelectorAll(".terminal__menu")).toHaveLength(2);
    expect(log.lastElementChild?.querySelector(".terminal__line")?.textContent).toContain("Underwater Games is a small studio");

    await submit("leave");
    // The flow is closed (menu.clear()) — what matters is the NEXT input is no longer routed to the menu.
    expect(log.lastElementChild?.classList.contains("terminal__menu")).toBe(false);

    await submit("go to corridor");
    expect(engine.getState().player.locationId).toBe("studio-corridor");
  });

  it("opening the topic menu still runs the NPC's own greeting/first-talk dialogue rule, not just a bare header", async () => {
    // Regression test: the topic-menu branch used to build the header from the
    // NPC's plain dialogue line, skipping a matching first-talk dialogueRule.
    const { log, submit } = setUp();
    await submit("talk herald");
    const header = log.querySelector(".terminal__menu .terminal__line")?.textContent ?? "";
    expect(header).toContain("Hail, traveller");
  });

  it("plain 'talk' still applies when the NPC has no topics offered", async () => {
    const { engine, log, submit } = setUp();
    engine.getState().npcs["herald"]!.topics = [];

    await submit("talk herald");
    expect(log.querySelector(".terminal__menu")).toBeNull();
    expect(log.lastElementChild?.textContent).toContain("Hail");
  });
});

describe("TerminalView — side panels", () => {
  it("defaults to locations on the left and inventory on the right", () => {
    const { root } = setUp();
    const left = root.querySelector<HTMLElement>('[data-role="panel-left"]')!;
    const right = root.querySelector<HTMLElement>('[data-role="panel-right"]')!;

    expect(left.hidden).toBe(false);
    expect(left.querySelector(".side-panel__title")?.textContent).toBe("Known locations");
    expect(right.hidden).toBe(false);
    expect(right.querySelector(".side-panel__title")?.textContent).toBe("Inventory");
  });

  it("switches a slot's content via 'panel <slot> <content>', live off current engine state", async () => {
    const { root, engine, submit } = setUp();
    const left = root.querySelector<HTMLElement>('[data-role="panel-left"]')!;

    await submit("panel left inventory");
    expect(left.hidden).toBe(false);
    expect(left.querySelector(".side-panel__title")?.textContent).toBe("Inventory");
    expect(left.querySelectorAll("li")).toHaveLength(0);

    takeWorkspace(engine);
    await submit("look"); // any turn re-renders both panels — see TerminalView.updateStatusBar

    expect(Array.from(left.querySelectorAll("li")).map((li) => li.textContent)).toContain("the workspace");
  });

  it("shows learned facts, oldest-first, via 'panel <slot> facts'", async () => {
    const { root, engine, submit } = setUp();
    const left = root.querySelector<HTMLElement>('[data-role="panel-left"]')!;

    await submit("panel left facts");
    expect(left.querySelector(".side-panel__title")?.textContent).toBe("Facts");
    expect(left.querySelectorAll("li")).toHaveLength(0);

    // A synthetic fact whose text reuses an existing locale entry ("carried").
    engine.getState().facts["test-fact"] = { id: "test-fact", textKey: "ui.inventoryLabel" };
    engine.getState().playerFacts["test-fact"] = { atMinutes: engine.getState().clock.minutesElapsed };
    await submit("look"); // any turn re-renders both panels — see TerminalView.updateStatusBar

    const items = Array.from(left.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toHaveLength(1);
    expect(items[0]).toBe("carried");
  });

  it("opens a menu for bare 'panel <slot>' and applies the selected content to that slot", async () => {
    const { root, submit, log } = setUp();
    const right = root.querySelector<HTMLElement>('[data-role="panel-right"]')!;

    await submit("panel right");
    const menu = log.querySelector(".terminal__menu");
    expect(menu).toBeTruthy();
    const optionTexts = Array.from(menu!.querySelectorAll("p")).map((p) => p.textContent);
    expect(optionTexts).toContain("1) Known locations");
    expect(optionTexts).toContain("2) Known verbs");
    expect(optionTexts).toContain("3) Inventory");
    expect(optionTexts).toContain("4) Facts");
    expect(optionTexts).toContain("5) None");

    await submit("3"); // Inventory
    expect(right.querySelector(".side-panel__title")?.textContent).toBe("Inventory");
  });

  it("closes the slot (shows placeholder art) when 'None' is picked from the bare 'panel <slot>' menu", async () => {
    const { root, submit, log } = setUp();
    const left = root.querySelector<HTMLElement>('[data-role="panel-left"]')!;

    await submit("panel left");
    expect(log.querySelector(".terminal__menu")).toBeTruthy();
    await submit("none"); // matches the option's alias, not just its number

    expect(left.querySelector(".side-panel__title")).toBeNull();
    expect(left.querySelector(".side-panel__art")).toBeTruthy();
  });

  it("shows placeholder art (not an empty/hidden slot) when re-requesting the content it's already showing", async () => {
    const { root, submit } = setUp();
    const right = root.querySelector<HTMLElement>('[data-role="panel-right"]')!;
    expect(right.hidden).toBe(false);
    expect(right.querySelector(".side-panel__art")).toBeNull();

    await submit("verbs"); // switches the right slot from its default (inventory) to verbs
    expect(right.querySelector(".side-panel__title")?.textContent).toBe("Known verbs");

    await submit("verbs"); // right slot already shows verbs — re-requesting it closes it
    expect(right.hidden).toBe(false); // still occupies its layout slot
    expect(right.querySelector(".side-panel__title")).toBeNull(); // but no longer showing verbs
    expect(right.querySelector(".side-panel__art")).toBeTruthy();

    await submit("verbs"); // requesting it again reopens it
    expect(right.querySelector(".side-panel__title")?.textContent).toBe("Known verbs");
  });
});

/** jsdom doesn't implement the PointerEvent constructor — a plain MouseEvent with the same clientX/clientY carries everything boardView.ts's handlers actually read, same rationale as MapView.test.ts's own `pointer` helper. */
function pointer(type: string, opts: { clientX: number; clientY: number }): Event {
  return new MouseEvent(type, { clientX: opts.clientX, clientY: opts.clientY, bubbles: true });
}

describe("TerminalView — case board overlay", () => {
  afterEach(() => setElementFromPointForTest(null));


  it("opens on 'board' and closes on a second 'board'", async () => {
    const { root, submit } = setUp();
    const overlay = root.querySelector<HTMLElement>('[data-role="board-overlay"]')!;
    expect(overlay.hidden).toBe(true);

    await submit("board");
    expect(overlay.hidden).toBe(false);

    await submit("board");
    expect(overlay.hidden).toBe(true);
  });

  it("shows the empty-state hint with no nodes", async () => {
    const { root, submit } = setUp();
    await submit("board");
    const mount = root.querySelector<HTMLElement>('[data-role="board-canvas-mount"]')!;
    expect(mount.querySelector(".board-overlay__empty-hint")).toBeTruthy();
  });

  it("renders a node card with its resolved label", async () => {
    const { root, engine, submit } = setUp();
    takeWorkspace(engine);
    const itemId = engine.getState().player.inventory[0]!;
    engine.addBoardNode("item", itemId, null, 100, 100);

    await submit("board");
    const mount = root.querySelector<HTMLElement>('[data-role="board-canvas-mount"]')!;
    const card = mount.querySelector<HTMLElement>(".board-node")!;
    expect(card).toBeTruthy();
    expect(card.querySelector(".board-node__text")?.textContent).toBe("the workspace");
  });

  it("a note node shows plain text at rest, and the pencil icon enters edit mode", async () => {
    const { root, engine, submit } = setUp();
    engine.addBoardNode("note", null, "old text", 50, 50);

    await submit("board");
    const mount = root.querySelector<HTMLElement>('[data-role="board-canvas-mount"]')!;
    const card = mount.querySelector<HTMLElement>(".board-node")!;
    expect(card.querySelector(".board-node__text")?.textContent).toBe("old text");
    expect(card.querySelector(".board-node__text--editable")).toBeFalsy();

    card.querySelector<HTMLButtonElement>(".board-node__edit")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const textarea = mount.querySelector<HTMLTextAreaElement>(".board-node__text--editable")!;
    expect(textarea).toBeTruthy();
    textarea.value = "new text";
    textarea.dispatchEvent(new FocusEvent("blur"));
    await new Promise((r) => setTimeout(r, 0));

    expect(engine.getBoard().nodes[0]!.text).toBe("new text");
    const rerendered = mount.querySelector<HTMLElement>(".board-node")!;
    expect(rerendered.querySelector(".board-node__text--editable")).toBeFalsy();
    expect(rerendered.querySelector(".board-node__text")?.textContent).toBe("new text");
  });

  it("a reference node (non-note) has no pencil icon", async () => {
    const { root, engine, submit } = setUp();
    takeWorkspace(engine);
    const itemId = engine.getState().player.inventory[0]!;
    engine.addBoardNode("item", itemId, null, 100, 100);

    await submit("board");
    const mount = root.querySelector<HTMLElement>('[data-role="board-canvas-mount"]')!;
    expect(mount.querySelector(".board-node__edit")).toBeFalsy();
  });

  it("draws a connection: press-and-hold the pin, drag, and release over another node's pin, then pick a color swatch", async () => {
    const { root, engine, submit } = setUp();
    engine.addBoardNode("note", null, "a", 0, 0);
    engine.addBoardNode("note", null, "b", 200, 0);
    const [a, b] = engine.getBoard().nodes;

    await submit("board");
    const mount = root.querySelector<HTMLElement>('[data-role="board-canvas-mount"]')!;
    const cards = () => Array.from(mount.querySelectorAll<HTMLElement>(".board-node"));
    const pins = () => Array.from(mount.querySelectorAll<HTMLElement>(".board-node__pin"));

    setElementFromPointForTest(() => cards()[1]!);
    pins()[0]!.dispatchEvent(pointer("pointerdown", { clientX: 80, clientY: 10 }));
    pins()[0]!.dispatchEvent(pointer("pointermove", { clientX: 280, clientY: 10 }));
    pins()[0]!.dispatchEvent(pointer("pointerup", { clientX: 280, clientY: 10 }));
    await new Promise((r) => setTimeout(r, 0));

    const swatch = mount.querySelector<HTMLElement>(".board-color-picker__swatch--blue")!;
    expect(swatch).toBeTruthy();
    swatch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(engine.getBoard().connections).toHaveLength(1);
    expect(engine.getBoard().connections[0]).toMatchObject({ fromNodeId: a!.id, toNodeId: b!.id, color: "blue" });
  });

  it("releasing a pin-drag over the same node or empty space is a silent no-op", async () => {
    const { root, engine, submit } = setUp();
    engine.addBoardNode("note", null, "a", 0, 0);

    await submit("board");
    const mount = root.querySelector<HTMLElement>('[data-role="board-canvas-mount"]')!;
    const pin = mount.querySelector<HTMLElement>(".board-node__pin")!;
    const card = mount.querySelector<HTMLElement>(".board-node")!;

    setElementFromPointForTest(() => card);
    pin.dispatchEvent(pointer("pointerdown", { clientX: 80, clientY: 10 }));
    pin.dispatchEvent(pointer("pointerup", { clientX: 80, clientY: 10 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mount.querySelector(".board-color-picker")).toBeFalsy();

    setElementFromPointForTest(() => null);
    pin.dispatchEvent(pointer("pointerdown", { clientX: 80, clientY: 10 }));
    pin.dispatchEvent(pointer("pointerup", { clientX: 500, clientY: 500 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mount.querySelector(".board-color-picker")).toBeFalsy();
    expect(engine.getBoard().connections).toHaveLength(0);
  });

  it("dragging a node's pin does not move the node itself", async () => {
    const { root, engine, submit } = setUp();
    engine.addBoardNode("note", null, "a", 0, 0);
    engine.addBoardNode("note", null, "b", 200, 0);
    const id = engine.getBoard().nodes[0]!.id;

    await submit("board");
    const mount = root.querySelector<HTMLElement>('[data-role="board-canvas-mount"]')!;
    const pin = mount.querySelector<HTMLElement>(".board-node__pin")!;
    const cards = () => Array.from(mount.querySelectorAll<HTMLElement>(".board-node"));

    setElementFromPointForTest(() => cards()[1]!);
    pin.dispatchEvent(pointer("pointerdown", { clientX: 80, clientY: 10 }));
    pin.dispatchEvent(pointer("pointermove", { clientX: 280, clientY: 10 }));
    pin.dispatchEvent(pointer("pointerup", { clientX: 280, clientY: 10 }));
    await new Promise((r) => setTimeout(r, 0));

    expect(engine.getBoard().nodes.find((n) => n.id === id)).toMatchObject({ x: 0, y: 0 });
  });

  it("removing a node also removes its connection and re-renders", async () => {
    const { root, engine, submit } = setUp();
    engine.addBoardNode("note", null, "a", 0, 0);
    engine.addBoardNode("note", null, "b", 200, 0);
    const [a, b] = engine.getBoard().nodes;
    engine.addBoardConnection(a!.id, b!.id, "red");

    await submit("board");
    const mount = root.querySelector<HTMLElement>('[data-role="board-canvas-mount"]')!;
    mount.querySelectorAll<HTMLElement>(".board-node__remove")[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(engine.getBoard().nodes).toHaveLength(1);
    expect(engine.getBoard().connections).toHaveLength(0);
    expect(mount.querySelectorAll(".board-node")).toHaveLength(1);
  });

  it("dragging a node past the click threshold moves it exactly once, on release", async () => {
    const { root, engine, submit } = setUp();
    engine.addBoardNode("note", null, "a", 0, 0);
    const id = engine.getBoard().nodes[0]!.id;

    await submit("board");
    const mount = root.querySelector<HTMLElement>('[data-role="board-canvas-mount"]')!;
    const card = mount.querySelector<HTMLElement>(".board-node")!;

    card.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
    card.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 0 }));
    card.dispatchEvent(pointer("pointerup", { clientX: 40, clientY: 0 }));
    await new Promise((r) => setTimeout(r, 0));

    expect(engine.getBoard().nodes.find((n) => n.id === id)).toMatchObject({ x: 40, y: 0 });
  });

  it("the '+ Add node' dropdown adds a free-text note", async () => {
    const { root, engine, submit } = setUp();
    await submit("board");
    const toolbarMount = root.querySelector<HTMLElement>('[data-role="board-add-node-mount"]')!;

    toolbarMount.querySelector<HTMLButtonElement>(".board-overlay__add-node-toggle")!.click();
    await new Promise((r) => setTimeout(r, 0));
    const buttons = () => Array.from(toolbarMount.querySelectorAll<HTMLButtonElement>(".board-add-node-menu button"));
    buttons().find((b) => b.textContent === "Note")!.click();
    await new Promise((r) => setTimeout(r, 0));

    const input = toolbarMount.querySelector<HTMLInputElement>(".board-add-node-menu input")!;
    input.value = "a hunch";
    Array.from(toolbarMount.querySelectorAll<HTMLButtonElement>(".board-add-node-menu button")).find((b) => b.textContent === "+")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(engine.getBoard().nodes).toHaveLength(1);
    expect(engine.getBoard().nodes[0]).toMatchObject({ refKind: "note", text: "a hunch" });
    // The dropdown closes and the canvas re-renders with the new card.
    const mount = root.querySelector<HTMLElement>('[data-role="board-canvas-mount"]')!;
    expect(mount.querySelector(".board-node")).toBeTruthy();
  });

  it("lists an inventory item under the Item category, and adding it removes it from the list", async () => {
    const { root, engine, submit } = setUp();
    takeWorkspace(engine);
    await submit("board");
    const toolbarMount = root.querySelector<HTMLElement>('[data-role="board-add-node-mount"]')!;

    toolbarMount.querySelector<HTMLButtonElement>(".board-overlay__add-node-toggle")!.click();
    await new Promise((r) => setTimeout(r, 0));
    Array.from(toolbarMount.querySelectorAll<HTMLButtonElement>(".board-add-node-menu button")).find((b) => b.textContent === "Item")!.click();
    await new Promise((r) => setTimeout(r, 0));

    const entityButtons = () => Array.from(toolbarMount.querySelectorAll<HTMLButtonElement>(".board-add-node-menu button")).filter((b) => b.textContent === "the workspace");
    expect(entityButtons()).toHaveLength(1);
    entityButtons()[0]!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(engine.getBoard().nodes).toHaveLength(1);
    expect(engine.getBoard().nodes[0]).toMatchObject({ refKind: "item" });
  });

  it("shows the empty-category message when nothing is eligible yet", async () => {
    const { root, submit } = setUp();
    await submit("board");
    const toolbarMount = root.querySelector<HTMLElement>('[data-role="board-add-node-mount"]')!;

    toolbarMount.querySelector<HTMLButtonElement>(".board-overlay__add-node-toggle")!.click();
    await new Promise((r) => setTimeout(r, 0));
    Array.from(toolbarMount.querySelectorAll<HTMLButtonElement>(".board-add-node-menu button")).find((b) => b.textContent === "Fact")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(toolbarMount.querySelector(".board-add-node-menu__empty")?.textContent).toBe("Nothing to add here yet.");
  });

  it("a click (below the drag threshold) does not move the node", async () => {
    const { root, engine, submit } = setUp();
    engine.addBoardNode("note", null, "a", 0, 0);

    await submit("board");
    const mount = root.querySelector<HTMLElement>('[data-role="board-canvas-mount"]')!;
    const card = mount.querySelector<HTMLElement>(".board-node")!;

    card.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
    card.dispatchEvent(pointer("pointerup", { clientX: 0, clientY: 0 }));
    await new Promise((r) => setTimeout(r, 0));

    expect(engine.getBoard().nodes[0]).toMatchObject({ x: 0, y: 0 });
  });
});

describe("TerminalView — scene image pane", () => {
  const IMAGE = {
    src: "test.svg",
    altKey: "test.alt",
    hotspots: [{ labelKey: "test.label", command: "look", x: 10, y: 20, w: 30, h: 40 }],
  };

  it("is hidden for a location without an image, and shows the image with percent-positioned hotspot buttons when it has one", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const state = createInitialState();
    const engine = new GameEngine(state);
    const here = engine.getCurrentLocation();
    delete state.locations[here.id]!.image;
    const view = new TerminalView(root, engine, new EnglishCommandParser(false), 0);
    const pane = root.querySelector<HTMLElement>('[data-role="image"]')!;
    expect(pane.hidden).toBe(true);

    state.locations[here.id]!.image = IMAGE;
    void view.start();
    (view as unknown as { updateStatusBar(): void }).updateStatusBar();
    expect(pane.hidden).toBe(false);
    expect(pane.querySelector("img")!.getAttribute("src")).toContain("images/test.svg");
    const button = pane.querySelector<HTMLButtonElement>(".scene-image__hotspot")!;
    expect(button.style.left).toBe("10%");
    expect(button.style.top).toBe("20%");
    expect(button.style.width).toBe("30%");
    expect(button.style.height).toBe("40%");
  });

  it("clicking a hotspot echoes and runs its command, leaving half-typed input alone", async () => {
    const { root, engine, input, log, view } = setUp();
    engine.getState().locations[engine.getCurrentLocation().id]!.image = IMAGE;
    (view as unknown as { updateStatusBar(): void }).updateStatusBar();
    input.value = "half typed";
    root.querySelector<HTMLButtonElement>(".scene-image__hotspot")!.click();
    await new Promise((r) => setTimeout(r, 0));
    const echoed = Array.from(log.querySelectorAll(".terminal__line--input")).map((el) => el.textContent);
    expect(echoed.some((text) => text?.includes("look"))).toBe(true);
    expect(input.value).toBe("half typed");
  });

  it("does not rebuild the DOM when the image is unchanged between turns", () => {
    const { root, engine, view } = setUp();
    engine.getState().locations[engine.getCurrentLocation().id]!.image = IMAGE;
    const update = () => (view as unknown as { updateStatusBar(): void }).updateStatusBar();
    update();
    const before = root.querySelector(".scene-image__hotspot");
    update();
    expect(root.querySelector(".scene-image__hotspot")).toBe(before);
  });

  it("cycles the log toggle through auto / expanded / collapsed, defaulting to collapsed, only while an image shows", async () => {
    const { root, engine, log, view } = setUp();
    const toggle = root.querySelector<HTMLButtonElement>('[data-role="log-toggle"]')!;
    const update = () => (view as unknown as { updateStatusBar(): void }).updateStatusBar();
    expect(toggle.hidden).toBe(true);
    log.dispatchEvent(new Event("mouseenter"));
    expect(log.classList.contains("terminal__log--expanded")).toBe(false);

    engine.getState().locations[engine.getCurrentLocation().id]!.image = IMAGE;
    update();
    expect(toggle.hidden).toBe(false);
    // default: collapsed, hover does nothing
    expect(toggle.textContent).toBe("Collapsed");
    expect(toggle.classList.contains("terminal__log-toggle--active")).toBe(true);
    expect(log.classList.contains("terminal__log--expanded")).toBe(false);
    log.dispatchEvent(new Event("mouseleave"));

    // auto: hover expands, leaving collapses after a delay
    toggle.click();
    expect(toggle.textContent).toBe("Auto");
    expect(toggle.classList.contains("terminal__log-toggle--active")).toBe(false);
    log.dispatchEvent(new Event("mouseenter"));
    expect(log.classList.contains("terminal__log--expanded")).toBe(true);
    log.dispatchEvent(new Event("mouseleave"));
    expect(log.classList.contains("terminal__log--expanded")).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(log.classList.contains("terminal__log--expanded")).toBe(false);

    // expanded: always over the image, no hover needed
    toggle.click();
    expect(toggle.textContent).toBe("Expanded");
    expect(log.classList.contains("terminal__log--expanded")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.classList.contains("terminal__log-toggle--active")).toBe(true);

    // back to collapsed
    toggle.click();
    expect(toggle.textContent).toBe("Collapsed");
    expect(log.classList.contains("terminal__log--expanded")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    log.dispatchEvent(new Event("mouseenter"));
    expect(log.classList.contains("terminal__log--expanded")).toBe(false);
  });
});

describe("TerminalView — scene image fade transition", () => {
  const IMAGE_A = { src: "a.svg", altKey: "a.alt", hotspots: [] };
  const IMAGE_B = { src: "b.svg", altKey: "b.alt", hotspots: [] };

  function setUpWithFade(fadeDurationMs: number) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const engine = newEngine();
    const view = new TerminalView(root, engine, new EnglishCommandParser(false), fadeDurationMs);
    const pane = root.querySelector<HTMLElement>('[data-role="image"]')!;
    const update = () => (view as unknown as { updateStatusBar(): void }).updateStatusBar();
    return { engine, pane, update };
  }

  it("fades the old image out, then swaps and fades the new one in, when fadeDurationMs is nonzero", async () => {
    const { engine, pane, update } = setUpWithFade(20);
    engine.getState().locations[engine.getCurrentLocation().id]!.image = IMAGE_A;
    update();
    // very first render has nothing to fade from, so it appears immediately
    expect(pane.querySelector("figure")!.classList.contains("scene-image--fade-hidden")).toBe(false);

    engine.getState().locations[engine.getCurrentLocation().id]!.image = IMAGE_B;
    update();
    // the swap is deferred — right after the call, the OLD image is still showing, now fading out
    expect(pane.querySelector("img")!.getAttribute("src")).toContain("a.svg");
    expect(pane.querySelector("figure")!.classList.contains("scene-image--fade-hidden")).toBe(true);

    await new Promise((r) => setTimeout(r, 40));
    expect(pane.querySelector("img")!.getAttribute("src")).toContain("b.svg");
    expect(pane.querySelector("figure")!.classList.contains("scene-image--fade-hidden")).toBe(false);
  });

  it("fades out to hidden, and fades a new image back in from hidden with no exit phase", async () => {
    const { engine, pane, update } = setUpWithFade(20);
    engine.getState().locations[engine.getCurrentLocation().id]!.image = IMAGE_A;
    update();

    delete engine.getState().locations[engine.getCurrentLocation().id]!.image;
    update();
    expect(pane.hidden).toBe(false); // still visible while fading out
    await new Promise((r) => setTimeout(r, 40));
    expect(pane.hidden).toBe(true);

    engine.getState().locations[engine.getCurrentLocation().id]!.image = IMAGE_B;
    update();
    expect(pane.hidden).toBe(false);
    expect(pane.querySelector("img")!.getAttribute("src")).toContain("b.svg");
    expect(pane.querySelector("figure")!.classList.contains("scene-image--fade-hidden")).toBe(false); // nothing was on screen to fade out first
  });

  it("swaps instantly, with no fade class ever applied, when fadeDurationMs is 0", () => {
    const { engine, pane, update } = setUpWithFade(0);
    engine.getState().locations[engine.getCurrentLocation().id]!.image = IMAGE_A;
    update();
    engine.getState().locations[engine.getCurrentLocation().id]!.image = IMAGE_B;
    update();
    expect(pane.querySelector("img")!.getAttribute("src")).toContain("b.svg");
    expect(pane.querySelector("figure")!.classList.contains("scene-image--fade-hidden")).toBe(false);
  });
});

describe("TerminalView — scene image dither dissolve", () => {
  const IMAGE_A = { src: "a.svg", altKey: "a.alt", hotspots: [] };
  const IMAGE_B = { src: "b.svg", altKey: "b.alt", hotspots: [] };

  function setUpWithDither(ditherEnabled: boolean) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const engine = newEngine();
    const view = new TerminalView(root, engine, new EnglishCommandParser(false), 40, ditherEnabled, 4);
    const pane = root.querySelector<HTMLElement>('[data-role="image"]')!;
    const update = () => (view as unknown as { updateStatusBar(): void }).updateStatusBar();
    const setImage = (image: typeof IMAGE_A) => {
      engine.getState().locations[engine.getCurrentLocation().id]!.image = image;
      update();
    };
    return { pane, setImage };
  }

  it("dissolves the outgoing image with a filter instead of an opacity fade, and leaves the new image clean at rest", async () => {
    const { pane, setImage } = setUpWithDither(true);
    setImage(IMAGE_A); // the view's startup render had no image, so this one dissolves IN
    expect(pane.querySelector<HTMLElement>("img")!.style.filter).toContain("url("); // starts fully dissolved
    await new Promise((r) => setTimeout(r, 60));
    expect(pane.querySelector<HTMLElement>("img")!.style.filter).toBe(""); // clean at rest

    setImage(IMAGE_B);
    const outgoing = pane.querySelector<HTMLElement>("img")!;
    expect(outgoing.getAttribute("src")).toContain("a.svg");
    expect(pane.querySelector("figure")!.classList.contains("scene-image--fade-hidden")).toBe(false); // no opacity fade
    await new Promise((r) => setTimeout(r, 25)); // mid-dissolve: some pixels already gone
    expect(outgoing.style.filter).toContain("url(");

    await new Promise((r) => setTimeout(r, 60)); // swapped, and the new image's dissolve-in has finished
    const incoming = pane.querySelector<HTMLElement>("img")!;
    expect(incoming.getAttribute("src")).toContain("b.svg");
    expect(incoming.style.filter).toBe("");
  });

  it("uses the plain opacity fade when dither is disabled", () => {
    const { pane, setImage } = setUpWithDither(false);
    setImage(IMAGE_A);
    setImage(IMAGE_B);
    expect(pane.querySelector("figure")!.classList.contains("scene-image--fade-hidden")).toBe(true);
    expect(pane.querySelector<HTMLElement>("img")!.style.filter).toBe("");
  });

  it("builds a filter only for progress above zero, keeping nothing at full progress", () => {
    expect(buildDissolveFilter(0)).toBe("");
    const half = decodeURIComponent(buildDissolveFilter(0.5));
    expect(half).toContain("feTurbulence");
    expect(half).toContain('intercept="-127.5"'); // threshold 0.2 + 0.6 * 0.5 = 0.5
    expect(decodeURIComponent(buildDissolveFilter(1))).toContain('intercept="-257.55"'); // threshold 1.01: nothing survives
  });
});

describe("TerminalView — examine-driven scene image", () => {
  const paneSrc = (root: HTMLElement) => root.querySelector<HTMLImageElement>('[data-role="image"] img')?.getAttribute("src") ?? null;

  it("swaps the pane to an examined object's image and restores the room's image on back", async () => {
    const { root, engine, submit } = setUp();
    const pane = root.querySelector<HTMLElement>('[data-role="image"]')!;
    expect(pane.hidden).toBe(true);

    await submit("go to main room");
    expect(paneSrc(root)).toContain("studio-general.jpg");

    await submit("examine whiteboard");
    expect(paneSrc(root)).toContain("studio-whiteboard.jpg");
    expect(engine.getSceneImage()?.src).toBe("studio-whiteboard.jpg");

    await submit("back");
    expect(paneSrc(root)).toContain("studio-general.jpg");
  });

  it("runs a hotspot on the object image like typed input and re-renders the room's image", async () => {
    const { root, submit } = setUp();
    await submit("go to main room");
    await submit("examine whiteboard");
    root.querySelector<HTMLButtonElement>(".scene-image__hotspot[aria-label='Step back']")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(paneSrc(root)).toContain("studio-general.jpg");
  });
});

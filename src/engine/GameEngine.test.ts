import { describe, expect, it } from "vitest";
import { createInitialState } from "../content/world";
import { GameEngine } from "./GameEngine";

/**
 * Exercises the engine with zero DOM/view involved — a direct demonstration
 * of the "engine is headless and synchronous" boundary from CLAUDE.md: the
 * simulation is fully testable by calling actions and asserting state/events.
 */
describe("GameEngine", () => {

  it("omits the items-present line entirely (no 'nothing here' filler) when a location has none", () => {
    const engine = new GameEngine(createInitialState());
    engine.travelTo("out"); // alley has the informant and the streetlamp object; its only item is the ledger
    engine.takeItem("ledger");
    const result = engine.look();
    expect(result.events.some((e) => e.type === "items_present")).toBe(false);
    expect(result.events.some((e) => e.type === "npcs_present")).toBe(true);
  });

  it("re-shows the full description on an explicit look even after the location was already visited", () => {
    const engine = new GameEngine(createInitialState());
    engine.travelTo("out");
    engine.travelTo("office");
    engine.travelTo("out"); // revisiting alley — arrival itself omits the description
    const result = engine.look();
    expect(result.events[0]?.type).toBe("location_described");
  });

  it("fails to resolve an unknown place name", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.travelTo("mars");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("location_not_found");
  });

  it("fails to take an item that isn't in the location", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.takeItem("nonexistent");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("item_not_found");
  });

  it("reports the current simulated time as absolute calendar params — no relative 'Day N' format exists anymore", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.checkTime();
    expect(result.ok).toBe(true);
    expect(result.events[0]?.params).toEqual({
      day: "18",
      monthKey: "calendar.month.9.long",
      year: "1946",
      weekdayKey: expect.stringMatching(/^calendar\.weekday\.\d\.long$/),
      hour: "08",
      minute: "00",
    });
  });

  it("exposes the absolute calendar date derived from the clock's epoch", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getCalendarDate()).toMatchObject({ year: 1946, month: 9, day: 18, hour: 8, minute: 0 });
  });

  it("getVisibility defaults to the player's current location, at full daylight (08:00, an unauthored 'normal' tier)", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getVisibility()).toEqual({ tier: "normal", value: 65 });
  });

  it("getVisibility throws for an unknown locationId", () => {
    const engine = new GameEngine(createInitialState());
    expect(() => engine.getVisibility("nonexistent")).toThrow(/no location "nonexistent"/);
  });

  it("getPlayerStat returns the registry default on a fresh player with no stored value", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getPlayerStat("stealth")).toBe(30);
  });

  it("getPlayerStat returns a stored value when the player has one set", () => {
    const state = createInitialState();
    state.player.stats = { stealth: 77 };
    const engine = new GameEngine(state);
    expect(engine.getPlayerStat("stealth")).toBe(77);
  });

  it("getNpcStat throws for an unknown NPC id", () => {
    const engine = new GameEngine(createInitialState());
    expect(() => engine.getNpcStat("nonexistent", "stealth")).toThrow(/no NPC "nonexistent"/);
  });

  it("getStealthConcealment resolves stealth vs. the current location's visibility, using the injected rng", () => {
    const neutralRng = () => 0; // both d10s roll 1 -> sum 2 -> modifier -20, deterministic
    const state = createInitialState();
    state.player.stats = { stealth: 60 };
    const engine = new GameEngine(state, neutralRng);
    const { value: visibility } = engine.getVisibility();
    const result = engine.getStealthConcealment();
    expect(result.rolls).toEqual([-20]);
    expect(result.margin).toBe(60 - 20 - visibility);
  });

  it("getStealthConcealment defaults to real Math.random when no rng is injected", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.getStealthConcealment();
    expect(result.rolls).toHaveLength(1);
    expect(typeof result.margin).toBe("number");
  });

  it("toggleStealth() on sets stealthMode, rolls immediately for the current location, and emits both events in order", () => {
    const neutralRng = () => 0; // both d10s roll 1 -> sum 2 -> modifier -20, deterministic
    const state = createInitialState();
    state.player.stats = { stealth: 60 };
    const engine = new GameEngine(state, neutralRng);

    const result = engine.toggleStealth();

    expect(engine.getState().player.stealthMode).toBe(true);
    expect(engine.getState().player.concealment).toBeDefined();
    expect(result.events.map((e) => e.type)).toEqual(["stealth_mode_on", "concealment_updated"]);
  });

  it("toggleStealth() off clears stealthMode and concealment, and does not roll", () => {
    const engine = new GameEngine(createInitialState(), () => 0);
    engine.toggleStealth(); // on
    const result = engine.toggleStealth(); // off

    expect(engine.getState().player.stealthMode).toBe(false);
    expect(engine.getState().player.concealment).toBeUndefined();
    expect(result.events.map((e) => e.type)).toEqual(["stealth_mode_off"]);
  });

  it("a failed concealment roll on toggle-on does not turn stealthMode back off", () => {
    const state = createInitialState();
    state.player.stats = { stealth: 0 }; // minimum skill, guarantees a failing margin
    const engine = new GameEngine(state, () => 0); // worst-case modifier too
    engine.toggleStealth();

    expect(engine.getState().player.stealthMode).toBe(true);
    const concealment = engine.getState().player.concealment;
    expect(concealment).toMatch(/^failed/);
  });

  it("travelTo does not roll or touch concealment while stealthMode is false", () => {
    const engine = new GameEngine(createInitialState(), () => 0);
    const result = engine.travelTo("out"); // office -> alley

    expect(result.events.some((e) => e.type === "concealment_updated")).toBe(false);
    expect(engine.getState().player.concealment).toBeUndefined();
  });

  it("starts with the content-defined balance and reflects it via getMoney", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getMoney()).toBe(15000);
  });

  it("credits money and reports it in the event", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.addMoney(150);
    expect(result.ok).toBe(true);
    expect(engine.getMoney()).toBe(15150);
    expect(result.events[0]?.params).toEqual({ amountSign: "", amountMajor: "1", amountMinor: "50" });
  });

  it("debits money when there's enough", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.spendMoney(200);
    expect(result.ok).toBe(true);
    expect(engine.getMoney()).toBe(14800);
  });

  it("refuses to debit past zero and leaves the balance untouched", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.spendMoney(20_000);
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("insufficient_funds");
    expect(engine.getMoney()).toBe(15000);
  });

  it("does not print a spend event for a free hop", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.travelTo("out"); // office -> alley: interior/exterior boundary hop, always free
    expect(result.events.some((e) => e.type === "money_spent")).toBe(false);
  });
});

/**
 * The desk (office) has two parts — `left-drawer` (closed by default, not
 * important) and `right-drawer` (OPEN by default, `important: true`) — and
 * `street` has a `lighter` item with a purely descriptive `symbol` part (no
 * `enterAliases`). See content/city/world.yaml.
 */
describe("notebooks and case board", () => {
  describe("notebooks", () => {
    it("buyNotebook charges the price and creates a blank, unnamed notebook", () => {
      const engine = new GameEngine(createInitialState());
      const startingMoney = engine.getMoney();
      const result = engine.buyNotebook("notebook");
      expect(result.ok).toBe(true);
      expect(engine.getMoney()).toBeLessThan(startingMoney);
      expect(engine.getNotebooks()).toHaveLength(1);
      expect(engine.getNotebooks()[0]?.name).toBe("");
      expect(engine.getNotebooks()[0]?.pages.length).toBeGreaterThan(0);
    });

    it("buyNotebook fails cleanly on an unknown product, without charging", () => {
      const engine = new GameEngine(createInitialState());
      const startingMoney = engine.getMoney();
      const result = engine.buyNotebook("nonexistent thing");
      expect(result.ok).toBe(false);
      expect(engine.getMoney()).toBe(startingMoney);
    });

    it("setActiveNotebook/clearActiveNotebook toggle GameEngine.getActiveNotebookId", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      expect(engine.getActiveNotebookId()).toBeNull();

      expect(engine.setActiveNotebook(id).ok).toBe(true);
      expect(engine.getActiveNotebookId()).toBe(id);

      expect(engine.clearActiveNotebook().ok).toBe(true);
      expect(engine.getActiveNotebookId()).toBeNull();
    });

    it("renameNotebook sets free player-authored text", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      engine.renameNotebook(id, "My Casebook");
      expect(engine.getNotebooks()[0]?.name).toBe("My Casebook");
    });

    it("jotNote writes a new, stamped block into the notebook's first page", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      const result = engine.jotNote(id, "The desk drawer was locked.");
      expect(result.ok).toBe(true);
      const block = engine.getNotebooks()[0]!.pages[0]!.blocks[0]!;
      expect(block.spans).toEqual([{ id: expect.any(String), text: "The desk drawer was locked.", struck: false }]);
      expect(block.locationId).toBe(engine.getState().player.locationId);
    });

    it("jotNote fails with nothing written when no page has room", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      const notebook = engine.getNotebooks()[0]!;
      // Shrink to one page with no room at all, to exercise "notebook full" without writing a huge fixture string.
      notebook.pages.length = 1;
      notebook.pages[0]!.charCapacity = 0;

      const result = engine.jotNote(id, "anything");
      expect(result.ok).toBe(false);
      expect(notebook.pages[0]!.blocks).toHaveLength(0);
    });

    it("jotNote refuses a note longer than an entire page's capacity, even on a totally empty notebook", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      const page = engine.getNotebooks()[0]!.pages[0]!;
      const tooLong = "x".repeat(page.charCapacity + 1);

      const result = engine.jotNote(id, tooLong);
      expect(result.ok).toBe(false);
      expect(result.events[0]?.type).toBe("note_too_long");
      expect(engine.getNotebooks()[0]!.pages.every((p) => p.blocks.length === 0)).toBe(true);
    });

    it("jotNote lets a single entry span well beyond what any per-entry line cap used to allow, as long as the page has room", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      const page = engine.getNotebooks()[0]!.pages[0]!;
      const longButFits = "x".repeat(page.charCapacity - 10);

      const result = engine.jotNote(id, longButFits);
      expect(result.ok).toBe(true);
      expect(page.blocks[0]!.spans[0]?.text).toBe(longButFits);
    });

    it("amendNote refuses an edit that would exceed the page's total capacity, leaving the block unchanged", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      engine.jotNote(id, "short note");
      const page = engine.getNotebooks()[0]!.pages[0]!;
      const blockId = page.blocks[0]!.id;
      const tooLong = "x".repeat(page.charCapacity + 1);

      const result = engine.amendNote(id, blockId, tooLong);
      expect(result.ok).toBe(false);
      expect(result.events[0]?.type).toBe("note_too_long");
      expect(page.blocks[0]!.spans).toEqual([{ id: expect.any(String), text: "short note", struck: false }]);
    });

    it("amendNote diffs the new text against the block's committed spans, striking removed text", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      engine.jotNote(id, "hello cruel world");
      const blockId = engine.getNotebooks()[0]!.pages[0]!.blocks[0]!.id;

      const result = engine.amendNote(id, blockId, "hello world");
      expect(result.ok).toBe(true);
      const block = engine.getNotebooks()[0]!.pages[0]!.blocks[0]!;
      expect(block.spans.some((s) => s.struck && s.text === "cruel ")).toBe(true);
    });

    it("disposeNotebook removes the notebook and clears activeNotebookId if it was active", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      engine.setActiveNotebook(id);

      const result = engine.disposeNotebook(id);
      expect(result.ok).toBe(true);
      expect(engine.getNotebooks()).toHaveLength(0);
      expect(engine.getActiveNotebookId()).toBeNull();
    });
  });

  describe("case board", () => {
    it("addBoardNode adds a node and getBoard reflects it", () => {
      const engine = new GameEngine(createInitialState());
      const result = engine.addBoardNode("note", null, "a hunch", 10, 20);
      expect(result.ok).toBe(true);
      expect(engine.getBoard().nodes).toEqual([{ id: expect.any(String), refKind: "note", refId: null, text: "a hunch", x: 10, y: 20 }]);
    });

    it("moveBoardNode repositions a node and produces no printable event", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "a hunch", 0, 0);
      const id = engine.getBoard().nodes[0]!.id;

      const result = engine.moveBoardNode(id, 50, 60);
      expect(result.ok).toBe(true);
      expect(result.events).toEqual([]);
      expect(engine.getBoard().nodes[0]).toMatchObject({ x: 50, y: 60 });
    });

    it("removeBoardNode removes the node and cascades to its connections", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "a", 0, 0);
      engine.addBoardNode("note", null, "b", 0, 0);
      const [a, b] = engine.getBoard().nodes;
      engine.addBoardConnection(a!.id, b!.id, "red");

      const result = engine.removeBoardNode(a!.id);
      expect(result.ok).toBe(true);
      expect(engine.getBoard().nodes).toHaveLength(1);
      expect(engine.getBoard().connections).toHaveLength(0);
    });

    it("editBoardNoteText updates a note node's text", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "old", 0, 0);
      const id = engine.getBoard().nodes[0]!.id;

      const result = engine.editBoardNoteText(id, "new");
      expect(result.ok).toBe(true);
      expect(engine.getBoard().nodes[0]!.text).toBe("new");
    });

    it("addBoardConnection succeeds between two existing nodes with a color", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "a", 0, 0);
      engine.addBoardNode("note", null, "b", 0, 0);
      const [a, b] = engine.getBoard().nodes;

      const result = engine.addBoardConnection(a!.id, b!.id, "blue");
      expect(result.ok).toBe(true);
      expect(engine.getBoard().connections[0]).toMatchObject({ fromNodeId: a!.id, toNodeId: b!.id, color: "blue" });
    });

    it("addBoardConnection fails on a self-connection, without mutating the board", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "a", 0, 0);
      const id = engine.getBoard().nodes[0]!.id;

      const result = engine.addBoardConnection(id, id, "red");
      expect(result.ok).toBe(false);
      expect(engine.getBoard().connections).toHaveLength(0);
    });

    it("removeBoardConnection removes the string", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "a", 0, 0);
      engine.addBoardNode("note", null, "b", 0, 0);
      const [a, b] = engine.getBoard().nodes;
      engine.addBoardConnection(a!.id, b!.id, "red");
      const connectionId = engine.getBoard().connections[0]!.id;

      const result = engine.removeBoardConnection(connectionId);
      expect(result.ok).toBe(true);
      expect(engine.getBoard().connections).toHaveLength(0);
    });

    it("recolorBoardConnection changes an existing string's color", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "a", 0, 0);
      engine.addBoardNode("note", null, "b", 0, 0);
      const [a, b] = engine.getBoard().nodes;
      engine.addBoardConnection(a!.id, b!.id, "red");
      const connectionId = engine.getBoard().connections[0]!.id;

      const result = engine.recolorBoardConnection(connectionId, "green");
      expect(result.ok).toBe(true);
      expect(engine.getBoard().connections[0]!.color).toBe("green");
    });
  });
});

describe("GameEngine clock", () => {
  it("syncClock sets minutesElapsed outright", () => {
    const engine = new GameEngine(createInitialState());
    engine.syncClock(1000);
    expect(engine.getState().clock.minutesElapsed).toBe(1000);
  });
});

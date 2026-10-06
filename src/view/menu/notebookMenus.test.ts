import { describe, expect, it } from "vitest";
import { createInitialState } from "../../content/world";
import { GameEngine } from "../../engine/GameEngine";
import type { ChoiceMenuScreen, PromptMenuScreen } from "./MenuFlow";
import { buildJotDownPickerScreen, openNotebookCommand } from "./notebookMenus";

describe("openNotebookCommand", () => {
  it("fails cleanly (no screen) when the player owns no notebooks", () => {
    const engine = new GameEngine(createInitialState());
    const { result, screen } = openNotebookCommand(engine);
    expect(screen).toBeUndefined();
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("no_notebooks_owned");
  });

  it("skips straight to the actions screen when exactly one notebook is owned", () => {
    const engine = new GameEngine(createInitialState());
    engine.buyNotebook("notebook");
    const { screen } = openNotebookCommand(engine);
    expect((screen as ChoiceMenuScreen).menuKind).toBe("notebook");
    expect((screen as ChoiceMenuScreen).options.map((o) => o.textKey)).toEqual([
      "ui.openNotebookOption",
      "ui.renameNotebookOption",
      "ui.setActiveNotebookOption",
      "ui.disposeNotebookOption",
    ]);
  });

  it("prompts which notebook when 2+ are owned", () => {
    const engine = new GameEngine(createInitialState());
    engine.buyNotebook("notebook");
    engine.buyNotebook("notebook");
    const { screen } = openNotebookCommand(engine);
    const picker = screen as ChoiceMenuScreen;
    expect(picker.options).toHaveLength(2);

    const drillIn = picker.options[0]!.select();
    expect(drillIn.type).toBe("goto");
    if (drillIn.type !== "goto") throw new Error("expected goto");
    expect((drillIn.screen as ChoiceMenuScreen).menuKind).toBe("notebook");
  });
});

describe("notebook actions screen", () => {
  it("'Open it' exits with a notebook_opened marker event carrying the notebook id", () => {
    const engine = new GameEngine(createInitialState());
    engine.buyNotebook("notebook");
    const id = engine.getNotebooks()[0]!.id;
    const { screen } = openNotebookCommand(engine);
    const outcome = (screen as ChoiceMenuScreen).options[0]!.select();
    expect(outcome).toEqual({ type: "exit", events: [expect.objectContaining({ type: "notebook_opened", params: expect.objectContaining({ notebookId: id }) })] });
  });

  it("toggles between 'make active' and 'stop using as active' depending on current state", () => {
    const engine = new GameEngine(createInitialState());
    engine.buyNotebook("notebook");
    const id = engine.getNotebooks()[0]!.id;

    let screen = openNotebookCommand(engine).screen as ChoiceMenuScreen;
    expect(screen.options[2]?.textKey).toBe("ui.setActiveNotebookOption");
    screen.options[2]!.select();
    expect(engine.getActiveNotebookId()).toBe(id);

    screen = openNotebookCommand(engine).screen as ChoiceMenuScreen;
    expect(screen.options[2]?.textKey).toBe("ui.clearActiveNotebookOption");
    screen.options[2]!.select();
    expect(engine.getActiveNotebookId()).toBeNull();
  });

  it("rename goes to a prompt screen that renames on submit", () => {
    const engine = new GameEngine(createInitialState());
    engine.buyNotebook("notebook");
    const screen = openNotebookCommand(engine).screen as ChoiceMenuScreen;
    const renameOutcome = screen.options[1]!.select();
    expect(renameOutcome.type).toBe("goto");
    if (renameOutcome.type !== "goto") throw new Error("expected goto");
    const prompt = renameOutcome.screen as PromptMenuScreen;

    const submitOutcome = prompt.submit("My Casebook");
    expect(submitOutcome.type).toBe("exit");
    expect(engine.getNotebooks()[0]?.name).toBe("My Casebook");
  });

  it("dispose goes through a confirm screen before actually removing the notebook", () => {
    const engine = new GameEngine(createInitialState());
    engine.buyNotebook("notebook");
    const id = engine.getNotebooks()[0]!.id;
    const screen = openNotebookCommand(engine).screen as ChoiceMenuScreen;
    const confirmOutcome = screen.options[3]!.select();
    expect(confirmOutcome.type).toBe("goto");
    if (confirmOutcome.type !== "goto") throw new Error("expected goto");
    const confirmScreen = confirmOutcome.screen as ChoiceMenuScreen;
    expect(confirmScreen.options.map((o) => o.textKey)).toEqual(["ui.confirmDispose", "ui.cancelDispose"]);

    // Cancel leaves the notebook intact.
    confirmScreen.options[1]!.select();
    expect(engine.getNotebooks()).toHaveLength(1);

    // Confirm actually disposes it.
    confirmScreen.options[0]!.select();
    expect(engine.getNotebooks().find((n) => n.id === id)).toBeUndefined();
  });
});

describe("buildJotDownPickerScreen", () => {
  it("jots into whichever notebook is selected, and exits", () => {
    const engine = new GameEngine(createInitialState());
    engine.buyNotebook("notebook");
    engine.buyNotebook("notebook");
    const [first, second] = engine.getNotebooks();

    const screen = buildJotDownPickerScreen(engine, "the desk drawer was locked") as ChoiceMenuScreen;
    expect(screen.options).toHaveLength(2);

    const outcome = screen.options[1]!.select();
    expect(outcome.type).toBe("exit");
    expect(second!.pages[0]!.blocks).toHaveLength(1);
    expect(first!.pages[0]!.blocks).toHaveLength(0);
  });
});

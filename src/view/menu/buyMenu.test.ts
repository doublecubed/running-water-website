import { describe, expect, it } from "vitest";
import { createInitialState } from "../../content/world";
import { GameEngine } from "../../engine/GameEngine";
import { buildBuyMenuScreen, buyByQuery } from "./buyMenu";
import type { ChoiceMenuScreen } from "./MenuFlow";

describe("buyByQuery", () => {
  it("resolves against passes first", () => {
    const engine = new GameEngine(createInitialState());
    const result = buyByQuery(engine, "weekly pass");
    expect(result.ok).toBe(true);
    expect(result.events.some((e) => e.type === "pass_purchased")).toBe(true);
  });

  it("falls through to notebook products when no pass matches", () => {
    const engine = new GameEngine(createInitialState());
    const result = buyByQuery(engine, "notebook");
    expect(result.ok).toBe(true);
    expect(engine.getNotebooks()).toHaveLength(1);
  });

  it("does not mask a real failure (e.g. insufficient funds) by falling through", () => {
    const engine = new GameEngine(createInitialState());
    engine.addMoney(-engine.getMoney()); // drain to $0
    const result = buyByQuery(engine, "weekly pass");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("insufficient_funds");
    expect(engine.getNotebooks()).toHaveLength(0);
  });

  it("reports not-found when neither catalog has it", () => {
    const engine = new GameEngine(createInitialState());
    const result = buyByQuery(engine, "a spaceship");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("notebook_product_not_found");
  });
});

describe("buildBuyMenuScreen", () => {
  it("lists one option per notebook product and per pass", () => {
    const engine = new GameEngine(createInitialState());
    const screen = buildBuyMenuScreen(engine) as ChoiceMenuScreen;
    expect(screen.kind).toBe("choices");
    expect(screen.menuKind).toBe("buy");
    expect(screen.options).toHaveLength(Object.keys(engine.getState().notebookProducts).length + Object.keys(engine.getState().passes).length);
  });

  it("selecting a notebook option buys it by id and exits", () => {
    const engine = new GameEngine(createInitialState());
    const screen = buildBuyMenuScreen(engine) as ChoiceMenuScreen;
    const notebookOption = screen.options.find((o) => o.textKey === "ui.buyNotebookOption")!;

    const outcome = notebookOption.select();
    expect(outcome.type).toBe("exit");
    expect(engine.getNotebooks()).toHaveLength(1);
  });

  it("selecting a pass option buys it by id and exits", () => {
    const engine = new GameEngine(createInitialState());
    const screen = buildBuyMenuScreen(engine) as ChoiceMenuScreen;
    const passOption = screen.options.find((o) => o.textKey === "ui.buyPassOption")!;

    const outcome = passOption.select();
    expect(outcome.type).toBe("exit");
    expect(engine.getState().player.activePasses).toHaveLength(1);
  });
});

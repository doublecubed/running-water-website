import { describe, expect, it } from "vitest";
import { createInitialState } from "../../content/world";
import { GameEngine } from "../../engine/GameEngine";
import { buildBuyMenuScreen, buyByQuery } from "./buyMenu";
import type { ChoiceMenuScreen } from "./MenuFlow";

describe("buyByQuery", () => {
  it("buys a notebook product by alias", () => {
    const engine = new GameEngine(createInitialState());
    const result = buyByQuery(engine, "notebook");
    expect(result.ok).toBe(true);
    expect(engine.getNotebooks()).toHaveLength(1);
  });

  it("does not mask a real failure (insufficient funds) as not-found", () => {
    const engine = new GameEngine(createInitialState());
    engine.addMoney(-engine.getMoney()); // drain to $0
    const result = buyByQuery(engine, "notebook");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("insufficient_funds");
    expect(engine.getNotebooks()).toHaveLength(0);
  });

  it("reports not-found when nothing for sale matches", () => {
    const engine = new GameEngine(createInitialState());
    const result = buyByQuery(engine, "a spaceship");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("notebook_product_not_found");
  });
});

describe("buildBuyMenuScreen", () => {
  it("lists one option per notebook product", () => {
    const engine = new GameEngine(createInitialState());
    const screen = buildBuyMenuScreen(engine) as ChoiceMenuScreen;
    expect(screen.kind).toBe("choices");
    expect(screen.menuKind).toBe("buy");
    expect(screen.options).toHaveLength(Object.keys(engine.getState().notebookProducts).length);
  });

  it("selecting a notebook option buys it by id and exits", () => {
    const engine = new GameEngine(createInitialState());
    const screen = buildBuyMenuScreen(engine) as ChoiceMenuScreen;
    const notebookOption = screen.options.find((o) => o.textKey === "ui.buyNotebookOption")!;

    const outcome = notebookOption.select();
    expect(outcome.type).toBe("exit");
    expect(engine.getNotebooks()).toHaveLength(1);
  });
});

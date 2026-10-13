import type { GameEngine } from "../../engine/GameEngine";
import { formatMoneyParts } from "../../engine/economy/money";
import type { ActionResult } from "../../engine/types";
import type { MenuOption, MenuOutcome, MenuScreen } from "./MenuFlow";

const MENU_KIND = "buy";

function priceParams(priceMinor: number): Record<string, string> {
  const { sign, major, minor } = formatMoneyParts(priceMinor);
  return { priceSign: sign, priceMajor: major, priceMinor: minor };
}

/** Resolves a direct "buy <query>" — notebook products are the only purchasable good. */
export function buyByQuery(engine: GameEngine, query: string): ActionResult {
  return engine.buyNotebook(query);
}

/**
 * The screen behind bare `buy`: one option per `NotebookProduct` — selecting
 * one purchases it immediately (by id, not by re-running alias matching — see
 * `GameEngine.buyNotebook`'s `{ id }` overload) and closes the flow.
 */
export function buildBuyMenuScreen(engine: GameEngine): MenuScreen {
  const notebookOptions: MenuOption[] = Object.values(engine.getState().notebookProducts).map((product) => ({
    textKey: "ui.buyNotebookOption",
    params: { productKey: product.nameKey, ...priceParams(product.priceMinor) },
    aliases: product.aliases,
    select: (): MenuOutcome => ({ type: "exit", events: engine.buyNotebook({ id: product.id }).events }),
  }));

  return {
    kind: "choices",
    menuKind: MENU_KIND,
    header: [{ type: "buy_menu_header", textKey: "event.buyMenuHeader" }],
    options: notebookOptions,
  };
}

import type { GameEngine } from "../../engine/GameEngine";
import { formatMoneyParts } from "../../engine/economy/money";
import type { ActionResult } from "../../engine/types";
import type { MenuOption, MenuOutcome, MenuScreen } from "./MenuFlow";

const MENU_KIND = "buy";

function priceParams(priceMinor: number): Record<string, string> {
  const { sign, major, minor } = formatMoneyParts(priceMinor);
  return { priceSign: sign, priceMajor: major, priceMinor: minor };
}

/**
 * Resolves a direct "buy <query>" against BOTH catalogs now that the
 * verb is generalized (see docs/systems/notebooks.md's "Economy
 * integration" decision) — passes AND notebook products. Tries a pass
 * first; falls through to notebook products only when that lookup comes
 * back as a genuine "not found" (a real failure, like insufficient
 * funds, is returned as-is — never masked by a second attempt).
 */
export function buyByQuery(engine: GameEngine, query: string): ActionResult {
  const passResult = engine.buyPass(query);
  if (passResult.ok || passResult.events[0]?.type !== "pass_not_found") return passResult;
  return engine.buyNotebook(query);
}

/**
 * The screen behind bare `buy`: one option per `NotebookProduct`, then
 * one per `Pass` — selecting either purchases it immediately (by id, not
 * by re-running alias matching — see `GameEngine.buyNotebook`/`buyPass`'s
 * `{ id }` overload) and closes the flow.
 */
export function buildBuyMenuScreen(engine: GameEngine): MenuScreen {
  const notebookOptions: MenuOption[] = Object.values(engine.getState().notebookProducts).map((product) => ({
    textKey: "ui.buyNotebookOption",
    params: { productKey: product.nameKey, ...priceParams(product.priceMinor) },
    aliases: product.aliases,
    select: (): MenuOutcome => ({ type: "exit", events: engine.buyNotebook({ id: product.id }).events }),
  }));
  const passOptions: MenuOption[] = Object.values(engine.getState().passes).map((pass) => ({
    textKey: "ui.buyPassOption",
    params: { passKey: pass.nameKey, ...priceParams(pass.priceMinor) },
    aliases: pass.aliases,
    select: (): MenuOutcome => ({ type: "exit", events: engine.buyPass({ id: pass.id }).events }),
  }));

  return {
    kind: "choices",
    menuKind: MENU_KIND,
    header: [{ type: "buy_menu_header", textKey: "event.buyMenuHeader" }],
    options: [...notebookOptions, ...passOptions],
  };
}

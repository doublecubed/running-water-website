import type { ActionResult, GameEvent, ResolutionChoice, WorldObjectId } from "../../engine/types";
import type { MenuOption, MenuOutcome, MenuScreen } from "./MenuFlow";

const MENU_KIND = "disambiguation";

/**
 * Turns an ambiguous verb result's `ResolutionChoice`s into a one-shot
 * `MenuScreen` — picking an option calls `resolve` with the chosen
 * `WorldObjectId`, re-issuing the exact verb that produced the ambiguity
 * via its id-based overload (e.g. `engine.examine({ id })`), never by
 * re-running alias matching on the option's own label. See
 * docs/systems/parts.md's "Ambiguous targets" and `GameEngine`'s
 * `resolveWorldObjectQuery`. Domain-agnostic across every verb that can
 * hit this ambiguity (`examine`, `takeItem`, ...) — the caller supplies
 * `resolve`, this file has no opinion on which verb it is.
 */
export function buildDisambiguationScreen(
  header: GameEvent[],
  choices: ResolutionChoice[],
  resolve: (id: WorldObjectId) => ActionResult,
): MenuScreen {
  const options: MenuOption[] = choices.map((choice) => ({
    textKey: choice.textKey,
    params: choice.params,
    select: (): MenuOutcome => ({ type: "exit", events: resolve(choice.id).events }),
  }));

  return { kind: "choices", menuKind: MENU_KIND, header, options };
}

import type { GameEngine } from "../../engine/GameEngine";
import type { ActionResult, LocationId, TransportMode, TravelCategory, TravelChoice } from "../../engine/types";
import type { MenuOption, MenuOutcome, MenuScreen } from "./MenuFlow";

const MENU_KIND = "travel";

/** Turns one TravelChoice into a MenuOption that executes it via `travelTo`, using `query` (the original destination text) to re-resolve — see docs/systems/economy.md on why this re-derives rather than replaying a stored Route. Ends the flow either way (a completed trip, or an insufficient-funds refusal, both just print their events and close). Carries the choice's `aliases` through so the player can select it by mode/category name, or "fastest"/"cheapest" when earned, not just a number — see MenuOption.aliases. */
function travelChoiceOption(engine: GameEngine, query: string, choice: TravelChoice): MenuOption {
  return {
    textKey: choice.textKey,
    params: choice.params,
    aliases: choice.aliases,
    select: (): MenuOutcome => {
      const override = choice.kind === "mode" ? { mode: choice.id as TransportMode } : { category: choice.id as TravelCategory };
      const result = engine.travelTo(query, override);
      return { type: "exit", events: result.events };
    },
  };
}

/**
 * The screen behind bare `travel`: a fixed FIRST option to name a
 * destination directly, followed by every direct connection from the
 * current location as an immediate-travel shortcut (selecting one calls
 * `travelToConnection` right away — no further mode breakdown, per the
 * design discussion in docs/systems/economy.md). The custom-destination
 * option is deliberately pinned to position 1 rather than appended last
 * — a location's direct-connection count varies, so "last" is a
 * different number every time and defeats the muscle memory of typing
 * the same digit; position 1 is always the same regardless of how many
 * connections follow it.
 */
export function buildDirectConnectionsScreen(engine: GameEngine): MenuScreen {
  const result = engine.listDirectConnections();
  const options: MenuOption[] = [
    {
      textKey: "ui.pickCustomDestination",
      select: (): MenuOutcome => ({ type: "goto", screen: buildAskDestinationPrompt(engine) }),
    },
    // listDirectConnections() only ever populates TravelChoice — safe cast.
    ...((result.choices ?? []) as TravelChoice[]).map((choice) => ({
      textKey: choice.textKey,
      params: choice.params,
      select: (): MenuOutcome => {
        const travelResult = engine.travelToConnection(choice.id as LocationId);
        return { type: "exit" as const, events: travelResult.events };
      },
    })),
  ];

  return { kind: "choices", menuKind: MENU_KIND, header: result.events, options };
}

/** The free-text sub-prompt reached via "Pick a custom destination" — submitting a name runs the full foot/transit/taxi inquiry, same as the old standalone `inquire` command did. */
function buildAskDestinationPrompt(engine: GameEngine): MenuScreen {
  return {
    kind: "prompt",
    menuKind: MENU_KIND,
    header: [{ type: "ask_destination_prompt", textKey: "event.askDestinationPrompt" }],
    submit: (input: string): MenuOutcome => {
      const result = engine.inquireTravel(input);
      if (!result.choices || result.choices.length === 0) {
        // Already there, not found, blocked, etc. — nothing to choose from; just report it and close.
        return { type: "exit", events: result.events };
      }
      return { type: "goto", screen: buildInquiryScreen(engine, input, result) };
    },
  };
}

/** The detailed foot/transit/taxi (or per-mode, for a compass query) breakdown for one destination, plus a way back to the root direct-connections screen. */
function buildInquiryScreen(engine: GameEngine, query: string, result: ActionResult): MenuScreen {
  // inquireTravel() only ever populates TravelChoice — safe cast.
  const options: MenuOption[] = ((result.choices ?? []) as TravelChoice[]).map((choice) => travelChoiceOption(engine, query, choice));
  options.push({
    textKey: "ui.goBackToDirectConnections",
    select: (): MenuOutcome => ({ type: "restart", screen: buildDirectConnectionsScreen(engine) }),
  });

  return { kind: "choices", menuKind: MENU_KIND, header: result.events, options };
}

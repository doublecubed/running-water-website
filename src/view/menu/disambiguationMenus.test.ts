import { describe, expect, it } from "vitest";
import { createInitialState } from "../../content/world";
import { GameEngine } from "../../engine/GameEngine";
import type { ResolutionChoice } from "../../engine/types";
import { buildDisambiguationScreen } from "./disambiguationMenus";
import type { ChoiceMenuScreen } from "./MenuFlow";

function makeAmbiguousExamineResult(engine: GameEngine) {
  engine.getState().worldObjects["torn-photograph"]!.aliases.push("case file");
  return engine.examine("case file");
}

describe("buildDisambiguationScreen", () => {
  it("carries the ambiguous result's own event as the screen header, one option per candidate", () => {
    const engine = new GameEngine(createInitialState());
    const result = makeAmbiguousExamineResult(engine);
    const screen = buildDisambiguationScreen(result.events, result.choices as ResolutionChoice[], (id) => engine.examine({ id })) as ChoiceMenuScreen;

    expect(screen.kind).toBe("choices");
    expect(screen.menuKind).toBe("disambiguation");
    expect(screen.header).toBe(result.events);
    expect(screen.options).toHaveLength(2);
    expect(screen.options.map((o) => o.textKey)).toEqual(["ui.disambiguationOption", "ui.disambiguationOption"]);
  });

  it("selecting an option resolves by id (not by re-matching the alias) and exits the flow", () => {
    const engine = new GameEngine(createInitialState());
    const result = makeAmbiguousExamineResult(engine);
    const choices = result.choices as ResolutionChoice[];
    const screen = buildDisambiguationScreen(result.events, choices, (id) => engine.takeItem({ id })) as ChoiceMenuScreen;

    const photographIndex = choices.findIndex((c) => c.id === "torn-photograph");
    const outcome = screen.options[photographIndex]!.select();

    expect(outcome).toEqual({ type: "exit", events: expect.arrayContaining([expect.objectContaining({ type: "item_taken" })]) });
    expect(engine.getState().player.inventory).toEqual(["torn-photograph"]);
    // The still-ambiguous "case-file" alias was never touched — proves
    // resolution went by id, not by re-running alias matching.
    expect(engine.getState().placement.worldObjectLocationId["case-file"]).toBe("office");
  });
});

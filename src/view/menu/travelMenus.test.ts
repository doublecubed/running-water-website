import { describe, expect, it } from "vitest";
import { createInitialState } from "../../content/world";
import { GameEngine } from "../../engine/GameEngine";
import type { ChoiceMenuScreen, PromptMenuScreen } from "./MenuFlow";
import { buildDirectConnectionsScreen } from "./travelMenus";

describe("buildDirectConnectionsScreen", () => {
  it("puts the custom-destination option FIRST, followed by every direct connection, tagged as the travel menu kind", () => {
    const engine = new GameEngine(createInitialState());
    const screen = buildDirectConnectionsScreen(engine) as ChoiceMenuScreen;

    expect(screen.kind).toBe("choices");
    expect(screen.menuKind).toBe("travel");
    expect(screen.options[0]?.textKey).toBe("ui.pickCustomDestination");
    // Office has one connection (south to the alley), right after it.
    expect(screen.options).toHaveLength(2);
  });

  it("selecting a direct-connection option (position 1, not 0) travels immediately and exits the flow", () => {
    const engine = new GameEngine(createInitialState());
    const screen = buildDirectConnectionsScreen(engine) as ChoiceMenuScreen;

    const outcome = screen.options[1]!.select();
    expect(outcome.type).toBe("exit");
    expect(engine.getState().player.locationId).toBe("alley");
  });

  it("selecting 'pick a custom destination' (always position 0) opens a free-text prompt screen", () => {
    const engine = new GameEngine(createInitialState());
    const screen = buildDirectConnectionsScreen(engine) as ChoiceMenuScreen;

    const outcome = screen.options[0]!.select();
    expect(outcome.type).toBe("goto");
    if (outcome.type !== "goto") throw new Error("expected goto");
    expect(outcome.screen.kind).toBe("prompt");
  });

  it("submitting a valid destination to the prompt opens its detailed options, including a way back", () => {
    const engine = new GameEngine(createInitialState());
    const root = buildDirectConnectionsScreen(engine) as ChoiceMenuScreen;
    const askOutcome = root.options[0]!.select();
    if (askOutcome.type !== "goto") throw new Error("expected goto");
    const promptScreen = askOutcome.screen as PromptMenuScreen;

    const outcome = promptScreen.submit("the docks");
    expect(outcome.type).toBe("goto");
    if (outcome.type !== "goto") throw new Error("expected goto");
    const detailScreen = outcome.screen as ChoiceMenuScreen;
    expect(detailScreen.kind).toBe("choices");
    // At least one strategy option, plus the "go back" option appended last.
    expect(detailScreen.options.length).toBeGreaterThanOrEqual(2);
    expect(detailScreen.options[detailScreen.options.length - 1]?.textKey).toBe("ui.goBackToDirectConnections");
  });

  it("submitting an unreachable/unknown destination to the prompt just exits with the failure event", () => {
    const engine = new GameEngine(createInitialState());
    const root = buildDirectConnectionsScreen(engine) as ChoiceMenuScreen;
    const askOutcome = root.options[0]!.select();
    if (askOutcome.type !== "goto") throw new Error("expected goto");
    const promptScreen = askOutcome.screen as PromptMenuScreen;

    const outcome = promptScreen.submit("mars");
    expect(outcome).toEqual({ type: "exit", events: expect.arrayContaining([expect.objectContaining({ type: "location_not_found" })]) });
  });

  it("selecting a detailed option travels via the chosen strategy and exits the flow", () => {
    const engine = new GameEngine(createInitialState());
    const root = buildDirectConnectionsScreen(engine) as ChoiceMenuScreen;
    const askOutcome = root.options[0]!.select();
    if (askOutcome.type !== "goto") throw new Error("expected goto");
    const promptScreen = askOutcome.screen as PromptMenuScreen;
    const detailOutcome = promptScreen.submit("the docks");
    if (detailOutcome.type !== "goto") throw new Error("expected goto");
    const detailScreen = detailOutcome.screen as ChoiceMenuScreen;

    const outcome = detailScreen.options[0]!.select();
    expect(outcome.type).toBe("exit");
    expect(engine.getState().player.locationId).toBe("docks");
  });

  it("'go back to direct connections' restarts at a fresh root screen", () => {
    const engine = new GameEngine(createInitialState());
    const root = buildDirectConnectionsScreen(engine) as ChoiceMenuScreen;
    const askOutcome = root.options[0]!.select();
    if (askOutcome.type !== "goto") throw new Error("expected goto");
    const promptScreen = askOutcome.screen as PromptMenuScreen;
    const detailOutcome = promptScreen.submit("the docks");
    if (detailOutcome.type !== "goto") throw new Error("expected goto");
    const detailScreen = detailOutcome.screen as ChoiceMenuScreen;

    const goBack = detailScreen.options[detailScreen.options.length - 1]!.select();
    expect(goBack.type).toBe("restart");
    if (goBack.type !== "restart") throw new Error("expected restart");
    expect(goBack.screen.kind).toBe("choices");
    expect((goBack.screen as ChoiceMenuScreen).menuKind).toBe("travel");
  });
});

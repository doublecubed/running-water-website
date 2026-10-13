import { describe, expect, it } from "vitest";
import { createInitialState } from "../content/world";
import { GameEngine } from "../engine/GameEngine";
import { EnglishCommandParser } from "../engine/parsing/EnglishCommandParser";
import { TerminalView } from "./TerminalView";

/** The locations panel lists visited places as buttons; clicking one runs "go to <name>" like typed input. */
describe("locations panel links", () => {
  it("clicking a visited location runs a go-to command and moves the player", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const engine = new GameEngine(createInitialState(), Math.random, { externalClock: true });
    const view = new TerminalView(root, engine, new EnglishCommandParser(false), 0);
    void view;

    // Visit the main room, then use the panel (left slot shows locations by default) to head back.
    engine.travelTo("main room");
    root.querySelector<HTMLInputElement>('[data-role="input"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await new Promise((r) => setTimeout(r, 0));

    const links = Array.from(root.querySelectorAll<HTMLElement>(".side-panel__link"));
    const landing = links.find((el) => el.dataset.command === "go to the landing");
    expect(landing, `no landing link among: ${links.map((l) => l.dataset.command).join(", ")}`).toBeDefined();
    landing!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.getState().player.locationId).toBe("studio-landing");
  });
});

/** The verbs panel is fixed chrome under the locations panel, outside the switchable slot registry. */
describe("verbs panel", () => {
  it("lists the five starter verbs and survives a re-render", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const engine = new GameEngine(createInitialState(), Math.random, { externalClock: true });
    new TerminalView(root, engine, new EnglishCommandParser(false), 0);
    const items = () => Array.from(root.querySelectorAll('[data-role="panel-verbs"] li')).map((li) => li.textContent);
    const expected = ["go to <place>", "examine <thing>", "talk to <someone>", "open <thing>", "close <thing>"];
    expect(items()).toEqual(expected);

    const input = root.querySelector<HTMLInputElement>('[data-role="input"]')!;
    input.value = "look";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(items()).toEqual(expected);
  });
});

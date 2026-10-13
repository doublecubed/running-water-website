import { describe, expect, it } from "vitest";
import { createInitialState } from "../content/world";
import { GameEngine } from "../engine/GameEngine";
import { EnglishCommandParser } from "../engine/parsing/EnglishCommandParser";
import { TerminalView } from "./TerminalView";

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const engine = new GameEngine(createInitialState(), Math.random, { externalClock: true });
  const view = new TerminalView(root, engine, new EnglishCommandParser(false), 0);
  const type = async (text: string) => {
    const input = root.querySelector<HTMLInputElement>('[data-role="input"]')!;
    input.value = text;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await tick();
    await tick();
  };
  const options = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".terminal__menu-option"));
  return { root, engine, view, type, options };
}

/** Menu options (dialogue topics here) are buttons that act like typing their number. */
describe("clickable menu options", () => {
  it("clicking a topic answers it and shows a fresh menu; the old one goes inert", async () => {
    const { root, type, options } = setup();
    await type("talk herald");
    const first = options();
    expect(first.length).toBeGreaterThan(1);
    expect(first.every((b) => !b.disabled)).toBe(true);

    first[0]!.click();
    await tick();
    await tick();

    expect(first.every((b) => b.disabled)).toBe(true);
    const now = options().filter((b) => !b.disabled);
    expect(now.length).toBeGreaterThan(1);

    // Clicking a spent option does nothing (no extra echoed line).
    const lines = root.querySelectorAll(".terminal__line--input").length;
    first[0]!.click();
    await tick();
    expect(root.querySelectorAll(".terminal__line--input").length).toBe(lines);
  });

  it("clicking the leave option ends the conversation and disables every option", async () => {
    const { type, options } = setup();
    await type("talk herald");
    const live = options();
    live[live.length - 1]!.click();
    await tick();
    await tick();
    expect(options().every((b) => b.disabled)).toBe(true);
  });

  it("typing the number still works", async () => {
    const { type, options } = setup();
    await type("talk herald");
    const first = options();
    await type("1");
    expect(first.every((b) => b.disabled)).toBe(true);
    expect(options().some((b) => !b.disabled)).toBe(true);
  });
});

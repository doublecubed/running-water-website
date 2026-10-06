import type { GameEvent } from "../../engine/types";

/**
 * A domain-agnostic multi-screen menu system for the terminal view — built
 * for the bare `travel` command (see docs/systems/economy.md) but
 * intentionally knows nothing about travel. A future non-travel use
 * (interrogation, an accusation, ...) is expected to build its own
 * `MenuScreen`s and reuse this same controller, rather than needing a
 * second mechanism. This file has zero DOM/GameEngine dependency — it's
 * pure state, testable headlessly like everything under src/engine/, even
 * though it lives in src/view/ (it owns interaction-mode state, which is
 * a view concern per CLAUDE.md's engine/view boundary — GameState never
 * has a "current menu").
 */

/** One selectable item in a ChoiceMenuScreen. */
export interface MenuOption {
  textKey: string;
  params?: Record<string, string>;
  /** Extra lowercase words (besides the numbered position) that select this option directly — e.g. a mode/category name, or "fastest"/"cheapest" when this option earned that label. Purely a domain-supplied selection convenience; MenuFlow itself never inspects these — matching them is TerminalView's job. */
  aliases?: string[];
  select: () => MenuOutcome;
}

export interface ChoiceMenuScreen {
  kind: "choices";
  /** Which domain this screen belongs to — purely cosmetic (drives the tint via data-menu-kind in TerminalView), never inspected by MenuFlow itself. */
  menuKind: string;
  /** Printed once when the screen is shown, before the numbered options. */
  header: GameEvent[];
  options: MenuOption[];
}

export interface PromptMenuScreen {
  kind: "prompt";
  menuKind: string;
  header: GameEvent[];
  submit: (input: string) => MenuOutcome;
}

export type MenuScreen = ChoiceMenuScreen | PromptMenuScreen;

/**
 * What happens after a MenuOption is selected or a PromptMenuScreen is
 * submitted:
 *  - "goto": push a new screen on top (e.g. drilling into a destination's
 *    detailed options). "back" returns here.
 *  - "restart": clear the whole stack and start fresh at a screen — for a
 *    menu item that means "return to the root," not just "undo one step"
 *    (e.g. "Go back to direct connections" from three screens deep).
 *  - "back": pop one screen (the universal `back` keyword uses this too).
 *  - "exit": close the flow entirely, optionally printing final events
 *    (a completed action's events, or a plain "you decided not to go
 *    anywhere" cancellation).
 */
export type MenuOutcome =
  | { type: "goto"; screen: MenuScreen }
  | { type: "restart"; screen: MenuScreen }
  | { type: "back" }
  | { type: "exit"; events?: GameEvent[] };

/**
 * Holds the screen stack for one active menu flow. Only one flow is ever
 * active at a time in TerminalView (opening a new one implicitly means
 * the old one is gone) — this class doesn't enforce that, it's just a
 * stack; TerminalView owns having exactly zero or one MenuFlow instance
 * live.
 */
export class MenuFlow {
  private stack: MenuScreen[] = [];

  get isActive(): boolean {
    return this.stack.length > 0;
  }

  get current(): MenuScreen | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** Clears any existing stack and starts fresh at `screen`. */
  start(screen: MenuScreen): void {
    this.stack = [screen];
  }

  /** Pushes a new screen on top of the current one. */
  push(screen: MenuScreen): void {
    this.stack.push(screen);
  }

  /** Pops the current screen, returning the new top (undefined if the flow is now empty — the caller should treat that as a cancellation). */
  back(): MenuScreen | undefined {
    this.stack.pop();
    return this.current;
  }

  /** Ends the flow entirely. */
  clear(): void {
    this.stack = [];
  }
}

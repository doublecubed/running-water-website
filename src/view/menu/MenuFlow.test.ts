import { describe, expect, it } from "vitest";
import { MenuFlow } from "./MenuFlow";
import type { ChoiceMenuScreen } from "./MenuFlow";

function screen(id: string): ChoiceMenuScreen {
  return { kind: "choices", menuKind: "test", header: [], options: [{ textKey: id, select: () => ({ type: "back" }) }] };
}

describe("MenuFlow", () => {
  it("starts inactive", () => {
    const flow = new MenuFlow();
    expect(flow.isActive).toBe(false);
    expect(flow.current).toBeUndefined();
  });

  it("becomes active and exposes the started screen", () => {
    const flow = new MenuFlow();
    const root = screen("root");
    flow.start(root);
    expect(flow.isActive).toBe(true);
    expect(flow.current).toBe(root);
  });

  it("push/back navigate the stack", () => {
    const flow = new MenuFlow();
    const root = screen("root");
    const child = screen("child");
    flow.start(root);
    flow.push(child);
    expect(flow.current).toBe(child);

    flow.back();
    expect(flow.current).toBe(root);
    expect(flow.isActive).toBe(true);
  });

  it("back() past the root returns undefined and leaves the flow inactive", () => {
    const flow = new MenuFlow();
    flow.start(screen("root"));
    flow.back();
    expect(flow.current).toBeUndefined();
    expect(flow.isActive).toBe(false);
  });

  it("start() clears any existing stack rather than pushing", () => {
    const flow = new MenuFlow();
    flow.start(screen("root"));
    flow.push(screen("child"));
    const fresh = screen("fresh-root");
    flow.start(fresh);
    expect(flow.current).toBe(fresh);
    flow.back();
    expect(flow.isActive).toBe(false); // Only one screen deep — start() really did reset, not just push.
  });

  it("clear() ends the flow regardless of depth", () => {
    const flow = new MenuFlow();
    flow.start(screen("root"));
    flow.push(screen("child"));
    flow.clear();
    expect(flow.isActive).toBe(false);
    expect(flow.current).toBeUndefined();
  });
});

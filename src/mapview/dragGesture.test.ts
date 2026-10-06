import { describe, expect, it } from "vitest";
import { CLICK_MOVEMENT_THRESHOLD_PX, isClick, movedDistance } from "./dragGesture";

describe("dragGesture", () => {
  it("movedDistance is the straight-line distance between the deltas", () => {
    expect(movedDistance(3, 4)).toBe(5);
    expect(movedDistance(0, 0)).toBe(0);
  });

  it("isClick is true below the threshold", () => {
    expect(isClick(0)).toBe(true);
    expect(isClick(CLICK_MOVEMENT_THRESHOLD_PX - 1)).toBe(true);
  });

  it("isClick is false at or above the threshold", () => {
    expect(isClick(CLICK_MOVEMENT_THRESHOLD_PX)).toBe(false);
    expect(isClick(CLICK_MOVEMENT_THRESHOLD_PX + 5)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { localEpoch, minutesSinceEpoch } from "./wallClock";

describe("wallClock", () => {
  it("derives the epoch from the local calendar date", () => {
    expect(localEpoch(new Date(2026, 9, 6, 23, 59))).toEqual({ year: 2026, month: 10, day: 6 });
  });

  it("counts local minutes since the epoch's midnight, across day boundaries", () => {
    const epoch = { year: 2026, month: 10, day: 6 };
    expect(minutesSinceEpoch(epoch, new Date(2026, 9, 6, 14, 30))).toBe(14 * 60 + 30);
    expect(minutesSinceEpoch(epoch, new Date(2026, 9, 7, 0, 5))).toBe(24 * 60 + 5);
  });
});

import { describe, expect, it } from "vitest";
import { getStatValue, STAT_DEFINITIONS } from "./stats";

describe("getStatValue", () => {
  it("returns the registry default when block is undefined", () => {
    expect(getStatValue(undefined, "stealth")).toBe(STAT_DEFINITIONS.stealth.default);
    expect(getStatValue(undefined, "handguns")).toBe(STAT_DEFINITIONS.handguns.default);
  });

  it("returns the registry default when block is {} or missing that key", () => {
    expect(getStatValue({}, "intimidation")).toBe(STAT_DEFINITIONS.intimidation.default);
    expect(getStatValue({ stealth: 80 }, "intimidation")).toBe(STAT_DEFINITIONS.intimidation.default);
  });

  it("returns the stored value when present and in range", () => {
    expect(getStatValue({ stealth: 72 }, "stealth")).toBe(72);
  });

  it("clamps an out-of-range stored value to [min, max]", () => {
    expect(getStatValue({ stealth: 500 }, "stealth")).toBe(STAT_DEFINITIONS.stealth.max);
    expect(getStatValue({ stealth: -50 }, "stealth")).toBe(STAT_DEFINITIONS.stealth.min);
  });

  it("uses per-stat defaults, not one global default", () => {
    expect(STAT_DEFINITIONS.stealth.default).not.toBe(STAT_DEFINITIONS.handguns.default);
    expect(getStatValue(undefined, "stealth")).toBe(30);
    expect(getStatValue(undefined, "handguns")).toBe(10);
  });
});

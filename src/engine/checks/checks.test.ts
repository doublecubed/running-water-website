import { describe, expect, it } from "vitest";
import { resolveContestedCheck, resolveDifficultyCheck, rollModifier } from "./checks";

/** Stubs `rng()` to return a fixed sequence of [0, 1) values, one per call, in order. */
function queue(values: number[]): () => number {
  let i = 0;
  return () => values[i++]!;
}

/** rng() value that makes rollD10 produce the given 1-10 die face. */
function forDie(face: number): number {
  return (face - 1) / 10;
}

describe("rollModifier", () => {
  it("gives 0 for a sum of 11 (e.g. 10 + 1)", () => {
    expect(rollModifier(queue([forDie(10), forDie(1)]))).toBe(0);
  });

  it("gives +20 for the max sum of 20 (10 + 10)", () => {
    expect(rollModifier(queue([forDie(10), forDie(10)]))).toBe(20);
  });

  it("gives -20 for the min sum of 2 (1 + 1)", () => {
    expect(rollModifier(queue([forDie(1), forDie(1)]))).toBe(-20);
  });

  it("gives +5 for a sum of 15 (distance 4 from 11)", () => {
    expect(rollModifier(queue([forDie(10), forDie(5)]))).toBe(5);
  });

  it("gives -7 for a sum of 6 (distance 5 from 11)", () => {
    expect(rollModifier(queue([forDie(3), forDie(3)]))).toBe(-7);
  });
});

describe("resolveDifficultyCheck", () => {
  const neutralRng = () => queue([forDie(10), forDie(1)]); // sum 11 -> modifier 0

  it("computes margin as skill + modifier - difficulty", () => {
    const result = resolveDifficultyCheck(60, 40, neutralRng());
    expect(result.margin).toBe(20);
    expect(result.rolls).toEqual([0]);
  });

  it("lands exactly on succeeded at margin 0", () => {
    const result = resolveDifficultyCheck(40, 40, neutralRng());
    expect(result.outcome).toBe("succeeded");
    expect(result.success).toBe(true);
  });

  it("lands exactly on succeededWell at margin 15", () => {
    const result = resolveDifficultyCheck(55, 40, neutralRng());
    expect(result.outcome).toBe("succeededWell");
    expect(result.success).toBe(true);
  });

  it("lands exactly on succeededSpectacularly at margin 40", () => {
    const result = resolveDifficultyCheck(80, 40, neutralRng());
    expect(result.outcome).toBe("succeededSpectacularly");
    expect(result.success).toBe(true);
  });

  it("lands exactly on failed at margin -1", () => {
    const result = resolveDifficultyCheck(39, 40, neutralRng());
    expect(result.outcome).toBe("failed");
    expect(result.success).toBe(false);
  });

  it("lands exactly on failedBadly at margin -40 (the tier's own floor)", () => {
    const result = resolveDifficultyCheck(0, 40, neutralRng());
    expect(result.outcome).toBe("failedBadly");
    expect(result.success).toBe(false);
  });

  it("lands exactly on failedSpectacularly just below -40", () => {
    const result = resolveDifficultyCheck(0, 41, neutralRng());
    expect(result.outcome).toBe("failedSpectacularly");
    expect(result.success).toBe(false);
  });

  it("leaves skill + modifier unclamped beyond [0, 100]", () => {
    const luckyRng = queue([forDie(10), forDie(10)]); // sum 20 -> modifier +20
    const result = resolveDifficultyCheck(95, 0, luckyRng);
    expect(result.margin).toBe(115);
    expect(result.outcome).toBe("succeededSpectacularly");
  });
});

describe("resolveContestedCheck", () => {
  it("rolls independently for each side and compares skillA + rollA vs skillB + rollB", () => {
    const rng = queue([
      forDie(10), forDie(10), // side A: sum 20 -> +20
      forDie(1), forDie(1), // side B: sum 2 -> -20
    ]);
    const result = resolveContestedCheck(50, 50, rng);
    expect(result.rolls).toEqual([20, -20]);
    expect(result.margin).toBe(70 - 30);
    expect(result.outcome).toBe("succeededSpectacularly");
  });

  it("returns two rolls even when both sides land on the neutral sum of 11", () => {
    const rng = queue([forDie(10), forDie(1), forDie(10), forDie(1)]);
    const result = resolveContestedCheck(50, 50, rng);
    expect(result.rolls).toEqual([0, 0]);
    expect(result.margin).toBe(0);
    expect(result.outcome).toBe("succeeded");
  });
});

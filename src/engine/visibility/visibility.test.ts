import { describe, expect, it } from "vitest";
import type { ExteriorLocation, InteriorLocation } from "../types";
import { computeVisibility, daylightFactor, VISIBILITY_TIER_VALUES, visibilityTierForValue } from "./visibility";

function exterior(overrides: Partial<ExteriorLocation> = {}): ExteriorLocation {
  return {
    id: "street",
    nameKey: "location.street.name",
    descriptionKey: "location.street.description",
    aliases: [],
    connections: [],
    kind: "exterior",
    ...overrides,
  };
}

function interior(overrides: Partial<InteriorLocation> = {}): InteriorLocation {
  return {
    id: "diner",
    nameKey: "location.diner.name",
    descriptionKey: "location.diner.description",
    aliases: [],
    connections: [],
    kind: "interior",
    exteriorId: "street",
    ...overrides,
  };
}

describe("daylightFactor", () => {
  it("is full daylight at midday", () => {
    expect(daylightFactor(12)).toBe(1);
  });

  it("is zero at midnight", () => {
    expect(daylightFactor(0)).toBe(0);
  });

  it("is zero right at the dawn/dusk boundaries", () => {
    expect(daylightFactor(5)).toBe(0);
    expect(daylightFactor(21)).toBe(0);
  });

  it("ramps up linearly through dawn", () => {
    expect(daylightFactor(6)).toBeCloseTo(0.5);
  });

  it("ramps down linearly through dusk", () => {
    expect(daylightFactor(20)).toBeCloseTo(0.5);
  });
});

describe("computeVisibility", () => {
  it("exterior at midday equals its base tier's value exactly", () => {
    expect(computeVisibility(exterior({ baseVisibility: "bright" }), 12)).toBe(VISIBILITY_TIER_VALUES.bright);
  });

  it("exterior at midnight drops to zero regardless of authored tier", () => {
    expect(computeVisibility(exterior({ baseVisibility: "bright" }), 0)).toBe(0);
  });

  it("defaults an unauthored exterior to the normal tier", () => {
    expect(computeVisibility(exterior(), 12)).toBe(VISIBILITY_TIER_VALUES.normal);
  });

  it("interior with affectedByDaylight true dampens the night-time drop instead of zeroing it", () => {
    const value = computeVisibility(interior({ baseVisibility: "bright", affectedByDaylight: true }), 0);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(VISIBILITY_TIER_VALUES.bright);
  });

  it("interior with affectedByDaylight true still reaches full base value at midday", () => {
    expect(computeVisibility(interior({ baseVisibility: "bright", affectedByDaylight: true }), 12)).toBe(VISIBILITY_TIER_VALUES.bright);
  });

  it("interior with affectedByDaylight false ignores the hour entirely", () => {
    const atNoon = computeVisibility(interior({ baseVisibility: "dim", affectedByDaylight: false }), 12);
    const atMidnight = computeVisibility(interior({ baseVisibility: "dim", affectedByDaylight: false }), 0);
    expect(atNoon).toBe(VISIBILITY_TIER_VALUES.dim);
    expect(atMidnight).toBe(VISIBILITY_TIER_VALUES.dim);
  });

  it("interior with no affectedByDaylight authored defaults to true (affected)", () => {
    const value = computeVisibility(interior({ baseVisibility: "bright" }), 0);
    expect(value).toBeLessThan(VISIBILITY_TIER_VALUES.bright);
    expect(value).toBeGreaterThan(0);
  });
});

describe("visibilityTierForValue", () => {
  it("buckets an exact tier value back to itself", () => {
    for (const tier of Object.keys(VISIBILITY_TIER_VALUES) as (keyof typeof VISIBILITY_TIER_VALUES)[]) {
      expect(visibilityTierForValue(VISIBILITY_TIER_VALUES[tier])).toBe(tier);
    }
  });

  it("buckets a value between two tiers to the nearest one", () => {
    // Halfway between dark (10) and dim (35) — closer to dim, no tie.
    expect(visibilityTierForValue(30)).toBe("dim");
  });
});

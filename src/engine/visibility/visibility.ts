import type { Location, VisibilityTier } from "../types";

/**
 * Pure visibility math — how well-lit/observable a location is, as ONE
 * computed number (0-100), before any future consumer decides what to do
 * with it. Two consumers are anticipated but NOT built yet (no NPCs/stats
 * to drive them): how much `examine` reveals, and whether an NPC notices
 * the player. Both would read the same number differently rather than
 * each getting its own lighting/clutter subsystem — see
 * docs/systems/visibility.md.
 *
 * Like `engine/time/calendar.ts`'s pass-expiry pattern, this is computed
 * lazily from static content (`Location.baseVisibility`/
 * `InteriorLocation.affectedByDaylight`) plus the current clock reading —
 * nothing here is stored on `GameState`, so there's no save-schema impact.
 */

/**
 * Canonical numeric value for each named tier, defined once so content
 * authors pick a small, intuitable tier rather than hand-typing an
 * arbitrary 0-100 number. These
 * are the values before time-of-day is applied.
 */
export const VISIBILITY_TIER_VALUES: Record<VisibilityTier, number> = {
  dark: 10,
  dim: 35,
  normal: 65,
  bright: 100,
};

const DEFAULT_VISIBILITY_TIER: VisibilityTier = "normal";

/** Hour-of-day boundaries for the dawn/dusk ramp — a simple piecewise-linear approximation, not real sun-position math. Tunable constants, not meant to be astronomically accurate. */
const DAWN_START_HOUR = 5;
const DAWN_END_HOUR = 7;
const DUSK_START_HOUR = 19;
const DUSK_END_HOUR = 21;

/**
 * Interiors swing far less with time of day than the outdoors does — most
 * of an interior's light is artificial/ambient, not direct sun. `false`
 * (see `InteriorLocation.affectedByDaylight`) drops this contribution to
 * zero entirely; `true` (the default) applies this fraction of the full
 * exterior swing.
 */
const INTERIOR_DAYLIGHT_WEIGHT = 0.3;

/**
 * Fraction of full daylight present at this hour (0..1) — 1 at midday,
 * ramping down through dusk to 0 at night, ramping back up through dawn.
 * `hour` is expected in 0-23 (see `CalendarDate.hour`); fractional hours
 * (e.g. from `hour + minute / 60`) work too since this is pure arithmetic.
 */
export function daylightFactor(hour: number): number {
  if (hour <= DAWN_START_HOUR || hour >= DUSK_END_HOUR) return 0;
  if (hour >= DAWN_END_HOUR && hour <= DUSK_START_HOUR) return 1;
  if (hour < DAWN_END_HOUR) return (hour - DAWN_START_HOUR) / (DAWN_END_HOUR - DAWN_START_HOUR);
  return 1 - (hour - DUSK_START_HOUR) / (DUSK_END_HOUR - DUSK_START_HOUR);
}

/**
 * Current visibility value (0-100) for `location` at `hour`. Exterior: the
 * authored tier is scaled DIRECTLY by `daylightFactor` — night pulls even
 * a "bright" exterior down toward darkness, since no authored tier should
 * be able to defeat nightfall outright. Interior: `affectedByDaylight`
 * (default `true`) dampens that same swing by `INTERIOR_DAYLIGHT_WEIGHT`
 * instead of applying it directly; `false` ignores `hour` entirely and
 * returns the authored tier's value unchanged (a windowless basement/
 * warehouse).
 */
export function computeVisibility(location: Location, hour: number): number {
  const base = VISIBILITY_TIER_VALUES[location.baseVisibility ?? DEFAULT_VISIBILITY_TIER];
  const daylight = daylightFactor(hour);

  if (location.kind === "exterior") return base * daylight;

  if (location.affectedByDaylight === false) return base;
  const swing = 1 - INTERIOR_DAYLIGHT_WEIGHT + daylight * INTERIOR_DAYLIGHT_WEIGHT;
  return base * swing;
}

/**
 * Buckets a computed value back to the nearest named tier's own value —
 * for a future consumer that wants tier semantics (e.g. a display label)
 * rather than the raw number.
 */
export function visibilityTierForValue(value: number): VisibilityTier {
  let closest: VisibilityTier = DEFAULT_VISIBILITY_TIER;
  let smallestDiff = Infinity;
  for (const tier of Object.keys(VISIBILITY_TIER_VALUES) as VisibilityTier[]) {
    const diff = Math.abs(VISIBILITY_TIER_VALUES[tier] - value);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closest = tier;
    }
  }
  return closest;
}

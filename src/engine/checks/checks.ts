import type { CheckOutcomeTier, CheckResult } from "../types";

/**
 * Generic opposed-check resolution — a skill (0-100, see
 * docs/systems/stats.md) rolled against either a static difficulty
 * number (visibility, or any future authored difficulty rating) or
 * another actor's skill. See docs/systems/checks.md for the full design
 * rationale: why 2d10, why the modifier table is hand-tuned rather than
 * a formula, why difficulty and contested checks are two functions
 * instead of one with a boolean flag, and why the six-tier outcome
 * stores `success` explicitly.
 *
 * `rng` is always an injected `() => number` source in [0, 1) — nothing
 * here reads `Math.random()` directly, so every function in this module
 * is pure given its inputs. `GameEngine` is the one place a real
 * `Math.random` default lives.
 */

/**
 * Roll magnitude for each 2d10 sum, indexed by |sum - 11| (0..9). A 2d10
 * roll is triangular around 11 — sum 11 has a 10% chance, each step away
 * a 1% smaller chance, down to 1% at the extremes (2 or 20). Magnitudes
 * are hand-tuned, not derived from a formula: they accelerate as the
 * roll's probability drops, so a 1%-chance nat 20 swings a check hard
 * while the common near-11 rolls barely nudge it.
 */
const MODIFIER_MAGNITUDE_BY_DISTANCE: readonly number[] = [0, 1, 2, 3, 5, 7, 10, 13, 16, 20];

/** One die of the 2d10 roll: an integer 1-10 from a [0, 1) `rng()` source. */
function rollD10(rng: () => number): number {
  return 1 + Math.floor(rng() * 10);
}

/**
 * Rolls 2d10 and returns the signed modifier for the result — the ONE
 * place randomness happens; everything downstream (effective skill,
 * margin, tier lookup) is pure given this number. Sums above 11 give a
 * positive modifier, below 11 negative, exactly 11 gives 0.
 */
export function rollModifier(rng: () => number): number {
  const sum = rollD10(rng) + rollD10(rng);
  const magnitude = MODIFIER_MAGNITUDE_BY_DISTANCE[Math.abs(sum - 11)] ?? 0;
  return sum >= 11 ? magnitude : -magnitude;
}

/**
 * Outcome tiers ordered high-to-low; the first tier whose `minMargin`
 * the margin clears wins. Thresholds are tunable placeholders, not
 * derived from anything else — retune here only, nothing else in the
 * codebase encodes these numbers.
 */
const CHECK_OUTCOME_TIERS: readonly { tier: CheckOutcomeTier; minMargin: number; success: boolean }[] = [
  { tier: "succeededSpectacularly", minMargin: 40, success: true },
  { tier: "succeededWell", minMargin: 15, success: true },
  { tier: "succeeded", minMargin: 0, success: true },
  { tier: "failed", minMargin: -15, success: false },
  { tier: "failedBadly", minMargin: -40, success: false },
  { tier: "failedSpectacularly", minMargin: -Infinity, success: false },
];

function tierForMargin(margin: number): { outcome: CheckOutcomeTier; success: boolean } {
  const entry = CHECK_OUTCOME_TIERS.find((t) => margin >= t.minMargin)!;
  return { outcome: entry.tier, success: entry.success };
}

/**
 * Actor's skill (unclamped, plus a 2d10 modifier) vs. a static,
 * non-rolling difficulty number — e.g. player stealth vs. location
 * visibility. The difficulty side never rolls: it isn't an actor, so
 * there's nothing on that side to roll for. `skill + modifier` is left
 * unclamped to [0, 100] — it's a transient check value, not a stored
 * stat, and clamping would blunt the rare-roll swing at exactly the
 * extremes where it's meant to matter.
 */
export function resolveDifficultyCheck(skill: number, difficulty: number, rng: () => number): CheckResult {
  const roll = rollModifier(rng);
  const margin = skill + roll - difficulty;
  return { ...tierForMargin(margin), margin, rolls: [roll] };
}

/**
 * Two actors' skills, each independently rolled (two separate 2d10
 * draws, not one roll read both ways) — deliberately swingier than a
 * difficulty check, since dice contribute to the margin from both
 * sides at once. That extra swinginess is intentional, not normalized
 * away: a contested check is meant to feel less predictable than a
 * skill-vs-environment check.
 */
export function resolveContestedCheck(skillA: number, skillB: number, rng: () => number): CheckResult {
  const rollA = rollModifier(rng);
  const rollB = rollModifier(rng);
  const margin = skillA + rollA - (skillB + rollB);
  return { ...tierForMargin(margin), margin, rolls: [rollA, rollB] };
}

import type { StatBlock, StatKey } from "../types";

/**
 * Universal 0-100 stat lookup shared by Player, NPC, and (later) Location —
 * one central registry plus one fallback function, instead of separate
 * defaulting logic per entity type. Mirrors `engine/visibility/visibility.ts`'s
 * "named-constant table + pure functions" shape, and deliberately has no
 * consumer yet (no stealth mechanic, no notice-check, no mutation verb) —
 * see docs/systems/stats.md and docs/future_work.md's "Stats"/"Stealth"
 * entries.
 */

/**
 * One stat's definition: its default (used whenever an entity has no
 * authored/stored value for this key — an NPC written before this stat
 * existed, or simply never given one), and its valid authored range.
 * min/max are enforced by cityLoader.ts (NPC content) and by
 * getStatValue's clamp (defensive, for any value already in a save or
 * content that predates a range tightening).
 *
 * displayNameKey is reserved for a future UI (a character sheet, a skill
 * check message) — not consumed anywhere yet, same posture as
 * VisibilityTier having tier semantics before any view read them.
 */
export interface StatDefinition {
  key: StatKey;
  min: number;
  max: number;
  default: number;
  displayNameKey: string;
}

/**
 * Central stat registry — the ONE place a new stat is added. Every stat in
 * this project uses the same 0-100 scale as VISIBILITY_TIER_VALUES
 * (engine/visibility/visibility.ts), so a future consumer can combine a
 * stat and a visibility value arithmetically without a unit conversion.
 * Starting set drawn from docs/future_work.md's "Stats" entry — deliberately
 * small; more stats are a one-entry addition here later, not a redesign.
 */
export const STAT_DEFINITIONS: Record<StatKey, StatDefinition> = {
  stealth: { key: "stealth", min: 0, max: 100, default: 30, displayNameKey: "stat.stealth.name" },
  intimidation: { key: "intimidation", min: 0, max: 100, default: 30, displayNameKey: "stat.intimidation.name" },
  handguns: { key: "handguns", min: 0, max: 100, default: 10, displayNameKey: "stat.handguns.name" },
};

/**
 * THE single shared lookup every entity type goes through — Player, NPC,
 * and (later) Location alike. Pure, no defaulting logic duplicated per
 * entity type: `block` may be undefined (an entity with no stats field at
 * all authored yet) or missing this specific key (authored before this key
 * existed, or never set) — both fall back to this stat's own registry
 * default, not one single global default, since e.g. "handguns" and
 * "stealth" have different sensible baselines.
 *
 * Clamps to [min, max] even on an already-stored/authored value, so a
 * value that predates a later-tightened range doesn't silently misbehave.
 */
export function getStatValue(block: StatBlock | undefined, key: StatKey): number {
  const def = STAT_DEFINITIONS[key];
  const raw = block?.[key] ?? def.default;
  return Math.min(def.max, Math.max(def.min, raw));
}

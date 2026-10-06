/**
 * Money is stored as an integer count of minor units (like cents) —
 * NEVER a float — so repeated add/spend can't drift from floating-point
 * rounding error. `Player.money` (see engine/types.ts) is this integer.
 *
 * This module only splits that integer into display-ready numeric parts
 * (sign/major/minor digits) — it does NOT choose a currency symbol or
 * decimal separator, since those are player-facing and potentially
 * language-dependent. That's src/i18n/ territory (mirrors the
 * clock/calendar split: engine does numeric formatting, i18n does
 * language-dependent text) — see docs/systems/economy.md.
 */
export const MINOR_UNITS_PER_MAJOR = 100;

export interface MoneyParts {
  sign: string;
  major: string;
  /** Always 2 digits, zero-padded. */
  minor: string;
}

export function formatMoneyParts(amountMinor: number): MoneyParts {
  const sign = amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(amountMinor);
  return {
    sign,
    major: String(Math.floor(absolute / MINOR_UNITS_PER_MAJOR)),
    minor: String(absolute % MINOR_UNITS_PER_MAJOR).padStart(2, "0"),
  };
}

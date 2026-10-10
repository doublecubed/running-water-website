import type { CalendarEpoch } from "../engine/time/calendar";

/**
 * Bridges the visitor's real clock to the engine's `minutesElapsed` — the
 * engine itself never reads `Date` (CLAUDE.md: headless, no timing
 * awareness), so the view layer does the conversion.
 *
 * Everything uses the visitor's LOCAL calendar fields, treated as UTC-style
 * numbers (`Date.UTC(local y/m/d/h/m)`), which is the same convention
 * `calendar.ts`'s `toCalendarDate` uses in reverse; DST shifts therefore show
 * up as the local clock jumping, exactly what the visitor's own clock does.
 */

/** Today's date in the visitor's local timezone, as a clock epoch. */
export function localEpoch(now: Date = new Date()): CalendarEpoch {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** Whole minutes of local wall-clock time elapsed since `epoch` 00:00 — the value to pass to `GameEngine.syncClock`. */
export function minutesSinceEpoch(epoch: CalendarEpoch, now: Date = new Date()): number {
  const epochMs = Date.UTC(epoch.year, epoch.month - 1, epoch.day, 0, 0, 0);
  const localMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0);
  return Math.floor((localMs - epochMs) / 60_000);
}

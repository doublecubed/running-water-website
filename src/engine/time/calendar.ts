/**
 * Absolute calendar math, layered on top of GameClock.minutesElapsed —
 * the ONLY time format the game shows the player (a relative "Day N"
 * view existed early on and was deliberately dropped once it became
 * clear it couldn't carry real dates: NPC statements about past events,
 * newspaper dates, and — the case that actually forced the removal — a
 * pass system whose expiry needs to read as a real date, not "Day 8").
 *
 * Deliberately delegates real calendar arithmetic (month lengths, leap
 * years, month/year rollover) to the JS Date engine rather than
 * reimplementing it — Date.UTC is well-tested for exactly this and using
 * UTC throughout avoids any local-timezone/DST bugs. This module only
 * produces plain numbers; it does NOT format them into display text
 * (month/weekday names are player-facing and therefore language-dependent
 * — see src/i18n/calendarFormat.ts, which is the ONLY place that turns a
 * CalendarDate into a string via a token PATTERN, per CLAUDE.md's "no
 * inline player-facing string" rule — `calendarDisplayParams` below is a
 * separate, PARAM-based route to the same information, for callers that
 * go through `t()`'s named-placeholder templates instead of a pattern
 * string; see its own doc comment for why both exist).
 *
 * Also home to `minutesUntilDayAlignedExpiry` — the general pattern this
 * project uses for ANY time-sensitive/countdown state (passes today;
 * case deadlines, NPC schedules, evidence windows later): store an
 * ABSOLUTE expiry minute, computed once, and compare it against the
 * current clock on demand. Nothing needs a "time passed" tick/event to
 * update a stored countdown, because nothing stores a countdown — see
 * that function's doc comment and docs/systems/time.md.
 */

/** The real-world calendar date GameClock.minutesElapsed = 0 (Day 1, 00:00) corresponds to. Set once, per game, in content (see content/world.ts). */
export interface CalendarEpoch {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
}

export interface CalendarDate {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
  /** 0 = Sunday .. 6 = Saturday, matching JS Date's getUTCDay(). */
  weekday: number;
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
}

/** Converts elapsed simulated minutes, plus the game's epoch, into an absolute calendar date/time. */
export function toCalendarDate(epoch: CalendarEpoch, minutesElapsed: number): CalendarDate {
  const epochMs = Date.UTC(epoch.year, epoch.month - 1, epoch.day, 0, 0, 0);
  const date = new Date(epochMs + minutesElapsed * 60_000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

export const MINUTES_PER_DAY = 24 * 60;

/**
 * Minutes from `nowMinutesElapsed` until exactly `days` calendar days
 * from now have elapsed, always landing on a DAY BOUNDARY (midnight
 * starting the day after the `days`th one) — deliberately NOT
 * `days * MINUTES_PER_DAY`, which would drift to whatever time-of-day
 * purchase happened to occur at instead of a clean expiry. A partial
 * "today" counts as the first of the `days` — e.g. a 7-day pass bought
 * at 08:00 covers the rest of today plus 6 more full days, expiring at
 * 00:00 on day 8, not exactly 168 hours later. See
 * docs/systems/economy.md's pass system and this module's doc comment on
 * why passes (and any future countdown/deadline) store an ABSOLUTE
 * expiry minute rather than a "remaining duration" that would need
 * decrementing as time passes.
 */
export function minutesUntilDayAlignedExpiry(nowMinutesElapsed: number, days: number): number {
  const minutesElapsedToday = nowMinutesElapsed % MINUTES_PER_DAY;
  return days * MINUTES_PER_DAY - minutesElapsedToday;
}

/**
 * The `{day, monthKey, year, weekdayKey, hour, minute}` params any
 * calendar-date display needs — shared by `GameEngine.describeTime`
 * (event params) and `TerminalView`'s status bar, so the two can never
 * show inconsistent formats. `monthKey`/`weekdayKey` are dynamically
 * built i18n key REFERENCES (e.g. `"calendar.month.9.long"`), not
 * player-facing text themselves — the same pattern GameEngine already
 * uses for `modeKey`/`categoryKey`/`preferenceKey` elsewhere, so this
 * doesn't cross the "engine never produces display strings" line (see
 * CLAUDE.md): no language-dependent word is chosen here, only a key
 * path built from a number the engine already knows. `hour`/`minute` are
 * zero-padded here (numeric formatting, not language-dependent — same
 * precedent as `formatMoneyParts` padding minor units engine-side).
 */
export function calendarDisplayParams(date: CalendarDate): Record<string, string> {
  return {
    day: String(date.day),
    monthKey: `calendar.month.${date.month}.long`,
    year: String(date.year),
    weekdayKey: `calendar.weekday.${date.weekday}.long`,
    hour: String(date.hour).padStart(2, "0"),
    minute: String(date.minute).padStart(2, "0"),
  };
}

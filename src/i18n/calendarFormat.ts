import type { CalendarDate } from "../engine/time/calendar";
import { t } from "./resolver";

/**
 * Turns a numeric CalendarDate (see engine/time/calendar.ts) into display
 * text using a token pattern, e.g. "D MMMM YYYY" -> "18 September 1946",
 * "YYYY-MM-DD" -> "1946-09-18", "MM/DD/YYYY" -> "09/18/1946". This is
 * intentionally in src/i18n/, not src/engine/ — month and weekday names
 * are player-facing, language-dependent text (resolved via t() against
 * "calendar.month.<n>.long/.short" and "calendar.weekday.<n>.long/.short"
 * keys), and the engine never produces display strings. See CLAUDE.md.
 *
 * Longer tokens are matched before their prefixes (MMMM before MMM before
 * MM before M) so e.g. "MMMM" isn't partially consumed as "MM" + "MM".
 */
const TOKEN_PATTERN = /YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|m/g;

export function formatCalendarDate(date: CalendarDate, pattern: string): string {
  return pattern.replace(TOKEN_PATTERN, (token) => resolveToken(token, date));
}

function resolveToken(token: string, date: CalendarDate): string {
  switch (token) {
    case "YYYY":
      return String(date.year).padStart(4, "0");
    case "YY":
      return String(date.year % 100).padStart(2, "0");
    case "MMMM":
      return t(`calendar.month.${date.month}.long`);
    case "MMM":
      return t(`calendar.month.${date.month}.short`);
    case "MM":
      return String(date.month).padStart(2, "0");
    case "M":
      return String(date.month);
    case "DD":
      return String(date.day).padStart(2, "0");
    case "D":
      return String(date.day);
    case "dddd":
      return t(`calendar.weekday.${date.weekday}.long`);
    case "ddd":
      return t(`calendar.weekday.${date.weekday}.short`);
    case "HH":
      return String(date.hour).padStart(2, "0");
    case "H":
      return String(date.hour);
    case "mm":
      return String(date.minute).padStart(2, "0");
    case "m":
      return String(date.minute);
    default:
      return token;
  }
}

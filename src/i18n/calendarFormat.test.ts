import { describe, expect, it } from "vitest";
import { toCalendarDate } from "../engine/time/calendar";
import { formatCalendarDate } from "./calendarFormat";
import { en } from "./en";

describe("formatCalendarDate", () => {
  const date = toCalendarDate({ year: 1946, month: 9, day: 18 }, 0);

  it("formats a long-form date", () => {
    expect(formatCalendarDate(date, "D MMMM YYYY")).toBe(`18 ${en["calendar.month.9.long"]} 1946`);
  });

  it("formats ISO-style", () => {
    expect(formatCalendarDate(date, "YYYY-MM-DD")).toBe("1946-09-18");
  });

  it("formats US-style", () => {
    expect(formatCalendarDate(date, "MM/DD/YYYY")).toBe("09/18/1946");
  });

  it("formats European-style", () => {
    expect(formatCalendarDate(date, "DD/MM/YYYY")).toBe("18/09/1946");
  });

  it("resolves weekday tokens against the active translation table", () => {
    expect(formatCalendarDate(date, "dddd")).toBe(en[`calendar.weekday.${date.weekday}.long`]);
    expect(formatCalendarDate(date, "ddd")).toBe(en[`calendar.weekday.${date.weekday}.short`]);
  });

  it("formats time tokens", () => {
    const withTime = toCalendarDate({ year: 1946, month: 9, day: 18 }, 9 * 60 + 5);
    expect(formatCalendarDate(withTime, "HH:mm")).toBe("09:05");
  });
});

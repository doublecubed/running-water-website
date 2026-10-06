import { describe, expect, it } from "vitest";
import { calendarDisplayParams, minutesUntilDayAlignedExpiry, toCalendarDate } from "./calendar";

describe("toCalendarDate", () => {
  const epoch = { year: 1946, month: 9, day: 18 };

  it("returns the epoch date itself at minute 0", () => {
    expect(toCalendarDate(epoch, 0)).toMatchObject({ year: 1946, month: 9, day: 18, hour: 0, minute: 0 });
  });

  it("carries hours/minutes within the same day", () => {
    expect(toCalendarDate(epoch, 90)).toMatchObject({ year: 1946, month: 9, day: 18, hour: 1, minute: 30 });
  });

  it("rolls over into the next month", () => {
    const sepEpoch = { year: 1946, month: 9, day: 29 };
    expect(toCalendarDate(sepEpoch, 2 * 24 * 60)).toMatchObject({ year: 1946, month: 10, day: 1 });
  });

  it("rolls over Feb 28 -> Mar 1 in a non-leap year", () => {
    const feb28_2023 = { year: 2023, month: 2, day: 28 };
    expect(toCalendarDate(feb28_2023, 24 * 60)).toMatchObject({ year: 2023, month: 3, day: 1 });
  });

  it("rolls over Feb 28 -> Feb 29 -> Mar 1 in a leap year", () => {
    const feb28_2024 = { year: 2024, month: 2, day: 28 };
    expect(toCalendarDate(feb28_2024, 24 * 60)).toMatchObject({ year: 2024, month: 2, day: 29 });
    expect(toCalendarDate(feb28_2024, 2 * 24 * 60)).toMatchObject({ year: 2024, month: 3, day: 1 });
  });

  it("rolls over into the next year", () => {
    const dec31 = { year: 1999, month: 12, day: 31 };
    expect(toCalendarDate(dec31, 24 * 60)).toMatchObject({ year: 2000, month: 1, day: 1 });
  });

  it("computes a weekday consistent with the JS Date engine", () => {
    const result = toCalendarDate(epoch, 0);
    const expectedWeekday = new Date(Date.UTC(1946, 8, 18)).getUTCDay();
    expect(result.weekday).toBe(expectedWeekday);
  });
});

describe("minutesUntilDayAlignedExpiry", () => {
  it("lands exactly on a day boundary for a mid-day purchase, not a fixed days*1440 offset", () => {
    // Day 1, 08:00 (480 minutes in) + a 7-day pass should expire at the
    // START of day 8 (00:00) — i.e. exactly a multiple of 1440 minutes
    // after minute 0 — covering the rest of today plus 6 more full days,
    // not literally 7*24*60 minutes after purchase (which would land at
    // day 7, 16:00 — not a day boundary at all).
    const now = 480;
    const duration = minutesUntilDayAlignedExpiry(now, 7);
    const expiry = now + duration;
    expect(expiry % (24 * 60)).toBe(0);
    expect(expiry).toBe(7 * 24 * 60);
  });

  it("returns exactly days*1440 when purchased at midnight (no partial day to account for)", () => {
    expect(minutesUntilDayAlignedExpiry(0, 7)).toBe(7 * 24 * 60);
    expect(minutesUntilDayAlignedExpiry(3 * 24 * 60, 1)).toBe(24 * 60);
  });

  it("returns just the rest of today when purchased late in the day", () => {
    const lateInDay = 23 * 60 + 30; // Day 1, 23:30 — 30 minutes left in the day.
    expect(minutesUntilDayAlignedExpiry(lateInDay, 1)).toBe(30);
  });
});

describe("calendarDisplayParams", () => {
  it("builds zero-padded time and dynamic month/weekday key references, not display text", () => {
    const date = toCalendarDate({ year: 1946, month: 9, day: 18 }, 8 * 60 + 5);
    expect(calendarDisplayParams(date)).toEqual({
      day: "18",
      monthKey: "calendar.month.9.long",
      year: "1946",
      weekdayKey: expect.stringMatching(/^calendar\.weekday\.\d\.long$/),
      hour: "08",
      minute: "05",
    });
  });
});

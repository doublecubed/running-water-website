import { describe, expect, it } from "vitest";
import { blockActiveText, charsRemaining, charsUsed, commitBlockEdit, toNoteTimestamp } from "./notebooks";
import type { NoteBlock, Page, Span } from "./types";

function span(id: string, text: string, struck = false): Span {
  return { id, text, struck };
}

function block(id: string, spans: Span[]): NoteBlock {
  return { id, timestamp: { day: "1946-09-18", time: "08:00" }, locationId: "office", spans };
}

describe("toNoteTimestamp", () => {
  it("zero-pads into a locale-neutral {day, time} shape", () => {
    expect(toNoteTimestamp({ year: 1946, month: 9, day: 18, weekday: 3, hour: 8, minute: 5 })).toEqual({
      day: "1946-09-18",
      time: "08:05",
    });
  });
});

describe("charsUsed / charsRemaining", () => {
  it("sums characters across every block on a page, counting only active span text", () => {
    const page: Page = {
      charCapacity: 40,
      blocks: [
        block("b1", [span("s1", "12345")]), // 5 chars
        block("b2", [span("s2", "12345678901", false), span("s3", "struck out entirely", true)]), // 11 chars active, struck text ignored
      ],
    };
    expect(charsUsed(page)).toBe(16);
    expect(charsRemaining(page)).toBe(24);
  });
});

describe("commitBlockEdit", () => {
  it("returns the same spans (a clone) when the text is unchanged", () => {
    const spans = [span("s1", "hello")];
    const result = commitBlockEdit(spans, "hello", { timestamp: { day: "d", time: "t" }, locationId: "office" });
    expect(result).toEqual(spans);
  });

  it("appends new text as a new active span", () => {
    const spans = [span("s1", "hello")];
    const result = commitBlockEdit(spans, "hello world", { timestamp: { day: "d", time: "t" }, locationId: "office" });
    expect(blockActiveText(block("x", result))).toBe("hello world");
    expect(result.every((s) => !s.struck)).toBe(true);
  });

  it("strikes a removed middle chunk and stamps it", () => {
    const spans = [span("s1", "hello cruel world")];
    const stamp = { timestamp: { day: "1946-09-18", time: "09:00" }, locationId: "docks" };
    const result = commitBlockEdit(spans, "hello world", stamp);

    expect(blockActiveText(block("x", result))).toBe("hello world");
    const struckSpan = result.find((s) => s.struck);
    expect(struckSpan?.text).toBe("cruel ");
    expect(struckSpan?.struckAt).toEqual(stamp);
  });

  it("marks fully-removed text as struck, leaving no active span, when the whole block is cleared", () => {
    const spans = [span("s1", "delete all of this")];
    const stamp = { timestamp: { day: "d", time: "t" }, locationId: "office" };
    const result = commitBlockEdit(spans, "", stamp);

    expect(blockActiveText(block("x", result))).toBe("");
    expect(result.every((s) => s.struck)).toBe(true);
  });

  it("leaves a previously-struck span untouched and in place", () => {
    const spans = [span("s1", "old note", true), span("s2", "current text")];
    const stamp = { timestamp: { day: "d", time: "t" }, locationId: "office" };
    const result = commitBlockEdit(spans, "current text, amended", stamp);

    expect(result[0]).toEqual(spans[0]);
    expect(blockActiveText(block("x", result))).toBe("current text, amended");
  });

  it("inserts text in the middle without disturbing unchanged prefix/suffix spans' ids", () => {
    const spans = [span("s1", "start end")];
    const stamp = { timestamp: { day: "d", time: "t" }, locationId: "office" };
    const result = commitBlockEdit(spans, "start middle end", stamp);
    expect(blockActiveText(block("x", result))).toBe("start middle end");
    // No text was removed, so nothing should be struck.
    expect(result.every((s) => !s.struck)).toBe(true);
  });
});

import type { CalendarDate } from "./time/calendar";
import type { NoteBlock, NoteTimestamp, Page, Span } from "./types";

/**
 * Pure helpers for the notebook system — see docs/systems/notebooks.md.
 * Nothing here touches `GameState` directly; `GameEngine` calls these and
 * wires the results into its own mutation methods (`buyNotebook`,
 * `jotNote`, `amendNote`, ...), same split as `navigation/pathfinding.ts`.
 */

/** Turns an absolute calendar date into the locale-neutral `{day, time}` shape a `NoteBlock` stamps itself with — zero-padded numeric formatting (not a translation key), matching `calendarDisplayParams`'s precedent of doing this kind of formatting engine-side. See docs/systems/notebooks.md. */
export function toNoteTimestamp(date: CalendarDate): NoteTimestamp {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return {
    day: `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`,
    time: `${pad(date.hour, 2)}:${pad(date.minute, 2)}`,
  };
}

/** A short, sufficiently-unique id for a notebook/block/span — not cryptographically strong, just distinct enough for this project's scale (compare content ids, which are author-chosen instead). */
export function generateNotebookId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Only non-struck span text counts as "ink the player spent" — a struck span's characters are already spent, not double-charged. See docs/systems/notebooks.md. */
export function blockActiveTextLength(block: NoteBlock): number {
  return block.spans.filter((span) => !span.struck).reduce((sum, span) => sum + span.text.length, 0);
}

/** The block's current EDITABLE plain text — the concatenation of its active (non-struck) spans, in order. This is what a view seeds its edit buffer with when the player opens this block; struck spans are history, not part of the text being edited. See docs/systems/notebooks.md's editing model. */
export function blockActiveText(block: NoteBlock): string {
  return block.spans
    .filter((span) => !span.struck)
    .map((span) => span.text)
    .join("");
}

/**
 * Derived, never stored — see `Page`'s doc comment in `types.ts` for why.
 * Only non-struck span text counts as ink spent; the auto-inserted header
 * does NOT count against this budget (see docs/systems/notebooks.md) —
 * only span text does.
 */
export function charsUsed(page: Page): number {
  return page.blocks.reduce((sum, block) => sum + blockActiveTextLength(block), 0);
}

/** Characters of ink still free on this page — see `charsUsed`. */
export function charsRemaining(page: Page): number {
  return page.charCapacity - charsUsed(page);
}

function commonPrefixSuffixLength(oldText: string, newText: string): { prefixLen: number; suffixLen: number } {
  const maxPrefix = Math.min(oldText.length, newText.length);
  let prefixLen = 0;
  while (prefixLen < maxPrefix && oldText[prefixLen] === newText[prefixLen]) prefixLen++;

  const maxSuffix = Math.min(oldText.length, newText.length) - prefixLen;
  let suffixLen = 0;
  while (suffixLen < maxSuffix && oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]) suffixLen++;

  return { prefixLen, suffixLen };
}

/**
 * Diffs a block's current active text against `newText` (the final plain
 * text a view hands back on exiting the notebook UI — see
 * docs/systems/notebooks.md's editing model) and returns the block's next
 * `spans` list: unchanged runs stay active, the removed run (if any) is
 * struck and stamped with `stamp`, and the inserted run (if any) becomes a
 * new active span. Already-struck spans in `spans` are left untouched, at
 * their original position.
 *
 * Uses a common-prefix/common-suffix diff rather than a full LCS — this
 * treats an edit as ONE contiguous changed region, which is exactly what a
 * real single editing session produces (type here, delete a chunk there,
 * insert a chunk elsewhere collapses to "everything between the first and
 * last change"); it will not split a session's edit into multiple disjoint
 * hunks the way a full diff algorithm would. Acceptable for v1, in the same
 * spirit as the block-commit-time-not-per-keystroke tradeoff already
 * accepted in docs/systems/notebooks.md.
 */
export function commitBlockEdit(spans: readonly Span[], newText: string, stamp: { timestamp: NoteTimestamp; locationId: string }): Span[] {
  const runs: { spanIndex: number; start: number; end: number }[] = [];
  let activeText = "";
  spans.forEach((span, spanIndex) => {
    if (span.struck) return;
    const start = activeText.length;
    activeText += span.text;
    runs.push({ spanIndex, start, end: activeText.length });
  });

  if (activeText === newText) return spans.slice();

  const { prefixLen, suffixLen } = commonPrefixSuffixLength(activeText, newText);
  const oldMiddleStart = prefixLen;
  const oldMiddleEnd = activeText.length - suffixLen;
  const newMiddle = newText.slice(prefixLen, newText.length - suffixLen);

  const result: Span[] = [];
  let insertedMiddle = false;
  let cursor = 0;

  for (const run of runs) {
    while (cursor < run.spanIndex) {
      result.push(spans[cursor]!);
      cursor++;
    }
    const span = spans[run.spanIndex]!;
    const text = span.text;
    const prefixEnd = clamp(oldMiddleStart - run.start, 0, text.length);
    const middleEnd = clamp(oldMiddleEnd - run.start, prefixEnd, text.length);

    let usedOriginalId = false;
    if (prefixEnd > 0) {
      result.push({ id: span.id, text: text.slice(0, prefixEnd), struck: false });
      usedOriginalId = true;
    }
    if (middleEnd > prefixEnd) {
      result.push({ id: generateNotebookId("span"), text: text.slice(prefixEnd, middleEnd), struck: true, struckAt: stamp });
    }
    if (!insertedMiddle && run.start <= oldMiddleEnd && oldMiddleEnd <= run.end) {
      if (newMiddle.length > 0) result.push({ id: generateNotebookId("span"), text: newMiddle, struck: false });
      insertedMiddle = true;
    }
    if (text.length > middleEnd) {
      result.push({ id: usedOriginalId ? generateNotebookId("span") : span.id, text: text.slice(middleEnd), struck: false });
    }
    cursor = run.spanIndex + 1;
  }
  while (cursor < spans.length) {
    result.push(spans[cursor]!);
    cursor++;
  }
  if (!insertedMiddle && newMiddle.length > 0) {
    result.push({ id: generateNotebookId("span"), text: newMiddle, struck: false });
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

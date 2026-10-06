import type { Command } from "./Command";

/**
 * One entry in a parser's verb catalog: a human-readable usage line for a
 * verb this parser recognizes. This is NOT filtered by what's usable in
 * the player's current context (room exits, items present, etc.) — it is
 * the parser's full, static vocabulary. Context-sensitive filtering (if
 * ever built) belongs elsewhere; see docs/systems/parsing.md.
 */
export interface VerbHelp {
  /** i18n key resolving to the full usage line, e.g. "go <direction> (n/s/e/w) — move to a connected location". */
  usageKey: string;
}

/**
 * Contract for turning raw player text into a Command. Different languages
 * can require entirely different syntax rules (word order, particles,
 * agglutination) — this interface is the seam that lets a language get its
 * own parser implementation instead of forcing one grammar onto everything.
 *
 * Implementations must be pure text-processing: no world/engine state, no
 * DOM. See EnglishCommandParser for the reference implementation and
 * docs/systems/parsing.md for how to add another one.
 */
export interface ICommandParser {
  parse(raw: string): Command;

  /**
   * Returns this parser's full verb catalog, for debug/help display. Must
   * be derived from the same data `parse()` matches against — never a
   * hand-maintained second list — so it can never drift out of sync with
   * what actually works.
   */
  listVerbs(): VerbHelp[];
}

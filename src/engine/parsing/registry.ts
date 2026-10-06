import { EnglishCommandParser } from "./EnglishCommandParser";
import type { ICommandParser } from "./ICommandParser";

/**
 * Maps a language code to a factory for its ICommandParser implementation.
 * Mirrors src/i18n/resolver.ts's TABLES map — parsing and translation are
 * separate concerns (a language's grammar for player commands need not
 * match its display text formatting), but both are keyed the same way so
 * adding a language touches one entry in each. A factory rather than a
 * pre-built instance because `devMode` (see EnglishCommandParser's doc
 * comment) is a per-call construction argument, decided by the caller —
 * not something baked into a shared singleton.
 */
const PARSER_FACTORIES: Record<string, (devMode: boolean) => ICommandParser> = {
  en: (devMode) => new EnglishCommandParser(devMode),
};

/** Returns a command parser for a language code, defaulting to English if none is registered. `devMode` gates that parser's dev-only verbs (see EnglishCommandParser) — pass `import.meta.env.DEV` from the composition root, never decided here. */
export function getCommandParser(language: string, devMode = false): ICommandParser {
  const factory = PARSER_FACTORIES[language] ?? PARSER_FACTORIES.en!;
  return factory(devMode);
}

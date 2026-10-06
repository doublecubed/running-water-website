import { en } from "./en";

/**
 * All available translation tables, keyed by language code. Each table
 * merges the language's hand-written chrome/event strings (`en.ts`) with
 * whatever content text has been registered for it via
 * `registerContentLocale` — see that function's doc comment and
 * `docs/localization.md`. Starts out chrome-only for `en`; content text
 * is pushed in later (by `content/world.ts`, at its own module load) once
 * `cityLoader.ts` has actually parsed it — this module deliberately
 * doesn't know or care where a language's content text comes from.
 */
const TABLES: Record<string, Record<string, string>> = { en: { ...en } };

/**
 * Merges `table` into the resolver's table for `language`, creating the
 * entry if it doesn't exist yet — the ONE way content text (derived from
 * inline `text:` blocks in `content/city/**\/*.yaml`, see
 * `cityLoader.ts`'s `CityContent.derivedLocale`) gets into `t()`/
 * `rawLookup()`. A content -> i18n PUSH, kept one-directional so this
 * module stays generic and reusable rather than reaching into content
 * itself. Safe to call more than once for the same language (later
 * calls merge in, they don't replace) — `content/world.ts` calls this
 * once per language present in its parsed content at module load.
 */
export function registerContentLocale(language: string, table: Record<string, string>): void {
  TABLES[language] = { ...(TABLES[language] ?? {}), ...table };
}

let activeLanguage = "en";

export function setLanguage(language: string): void {
  if (!TABLES[language]) {
    throw new Error(`No translation table registered for language "${language}"`);
  }
  activeLanguage = language;
}

/**
 * Looks up a key's raw text without `t()`'s "fall back to the key itself"
 * behavior — for callers that need to tell "translated" apart from
 * "missing" (e.g. world.test.ts's content-authoring check), where `t()`'s
 * player-facing fallback would make a missing key indistinguishable from
 * a real one.
 */
export function rawLookup(key: string, language: string = activeLanguage): string | undefined {
  return TABLES[language]?.[key];
}

/**
 * Resolves a translation key to display text, substituting {placeholder}
 * params. Param values that are themselves translation keys (a common case:
 * an event carries e.g. `itemKey: "item.caseFile.name"`) are resolved
 * recursively so callers never need to pre-resolve nested keys by hand.
 */
export function t(key: string, params: Record<string, string> = {}): string {
  const table = TABLES[activeLanguage];
  const template = table?.[key];
  if (!table || template === undefined) {
    return key; // Visible fallback so a missing translation is obvious, not silently blank.
  }

  return template.replace(/\{(\w+)\}/g, (_match, paramName: string) => {
    const value = params[paramName];
    if (value === undefined) return `{${paramName}}`;
    // A param may be a single translation key, or a ", "-joined list of them
    // (e.g. GameEngine joins room item names before putting them in params).
    return value
      .split(", ")
      .map((part) => (table[part] !== undefined ? t(part, params) : part))
      .join(", ");
  });
}

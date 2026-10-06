import { describe, expect, it } from "vitest";
import { loadCityContent } from "../content/world";

/**
 * The development-time "did I forget to translate something" check —
 * see docs/localization.md. Deliberately NOT baked into `cityLoader.ts`
 * (which runs on every app/test startup): `en` (the baseline language) is
 * the only one required at content-load time, so a language nobody has
 * started translating yet is simply invisible here — nothing to diff
 * against. The moment ANY object/location authors even one `text` block
 * for another language, that language is "in scope" and every key it's
 * missing becomes a loud, listed failure — matching cityLoader.ts's own
 * "report everything, not just the first" style, rather than a silent
 * runtime fallback to the raw key.
 */
describe("translation coverage", () => {
  it("has nothing to report when only the baseline language (en) exists", () => {
    const { derivedLocale } = loadCityContent();
    expect(Object.keys(derivedLocale)).toEqual(["en"]);
  });

  it("reports every content key missing from a non-baseline language, not just the first", () => {
    const derivedLocale = {
      en: { "item.a.name": "A", "item.a.description": "Desc A", "item.b.name": "B" },
      es: { "item.a.name": "La A" }, // missing item.a.description AND item.b.name
    };
    const missing = missingKeys(derivedLocale, "es");
    expect(missing).toEqual(["item.a.description", "item.b.name"]);
  });

  it("reports nothing for a language that fully mirrors the baseline's key set", () => {
    const derivedLocale = {
      en: { "item.a.name": "A", "item.a.description": "Desc A" },
      es: { "item.a.name": "La A", "item.a.description": "Desc A (es)" },
    };
    expect(missingKeys(derivedLocale, "es")).toEqual([]);
  });

  it("checks every registered non-baseline language found in the real, currently-authored content", () => {
    const { derivedLocale } = loadCityContent();
    const baselineKeys = Object.keys(derivedLocale.en ?? {});
    const problems: string[] = [];
    for (const [language, table] of Object.entries(derivedLocale)) {
      if (language === "en") continue;
      const missing = baselineKeys.filter((key) => table[key] === undefined);
      if (missing.length > 0) problems.push(`${language} is missing: ${missing.join(", ")}`);
    }
    expect(problems).toEqual([]);
  });
});

/** Every baseline (`en`) key absent from `derivedLocale[language]`, in baseline key order. */
function missingKeys(derivedLocale: Record<string, Record<string, string>>, language: string): string[] {
  const baselineKeys = Object.keys(derivedLocale.en ?? {});
  const target = derivedLocale[language] ?? {};
  return baselineKeys.filter((key) => target[key] === undefined);
}

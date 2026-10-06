import { describe, expect, it } from "vitest";
import { rawLookup, registerContentLocale, t } from "./resolver";

describe("registerContentLocale", () => {
  it("merges a language's content table into the resolver without clobbering existing (chrome) keys", () => {
    expect(rawLookup("ui.prompt")).toBeDefined(); // a chrome key, present before any registration
    registerContentLocale("en", { "location.testFixtureA.name": "Fixture A" });
    expect(rawLookup("ui.prompt")).toBeDefined(); // still there
    expect(rawLookup("location.testFixtureA.name")).toBe("Fixture A");
  });

  it("merges rather than replaces on a second call for the same language", () => {
    registerContentLocale("en", { "location.testFixtureB.name": "Fixture B" });
    registerContentLocale("en", { "location.testFixtureC.name": "Fixture C" });
    expect(rawLookup("location.testFixtureB.name")).toBe("Fixture B");
    expect(rawLookup("location.testFixtureC.name")).toBe("Fixture C");
  });

  it("creates a new language's table on first registration", () => {
    registerContentLocale("xx", { "location.testFixtureD.name": "Fixture D" });
    expect(rawLookup("location.testFixtureD.name", "xx")).toBe("Fixture D");
  });

  it("t() resolves a registered content key like any other", () => {
    registerContentLocale("en", { "location.testFixtureE.name": "Fixture E" });
    expect(t("location.testFixtureE.name")).toBe("Fixture E");
  });
});

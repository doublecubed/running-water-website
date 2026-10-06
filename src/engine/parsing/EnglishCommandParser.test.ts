import { describe, expect, it } from "vitest";
import { EnglishCommandParser } from "./EnglishCommandParser";

describe("EnglishCommandParser", () => {
  const parser = new EnglishCommandParser();

  it("parses recognized verbs into their Command shape", () => {
    expect(parser.parse("look")).toEqual({ kind: "look" });
    expect(parser.parse("go north")).toEqual({ kind: "travel", query: "north" });
    expect(parser.parse("n")).toEqual({ kind: "travel", query: "north" });
    expect(parser.parse("go to the docks")).toEqual({ kind: "travel", query: "the docks" });
    expect(parser.parse("travel to the docks")).toEqual({ kind: "travel", query: "the docks" });
    expect(parser.parse("take case file")).toEqual({ kind: "take", query: "case file" });
    expect(parser.parse("talk to informant")).toEqual({ kind: "talk", query: "informant" });
    expect(parser.parse("verbs")).toEqual({ kind: "setPanel", slot: "right", content: "verbs" });
    expect(parser.parse("map")).toEqual({ kind: "setPanel", slot: "left", content: "locations" });
    expect(parser.parse("worldmap")).toEqual({ kind: "toggleWorldMap" });
    expect(parser.parse("board")).toEqual({ kind: "board" });
    expect(parser.parse("corkboard")).toEqual({ kind: "board" });
    expect(parser.parse("panel left inventory")).toEqual({ kind: "setPanel", slot: "left", content: "inventory" });
    expect(parser.parse("panel right map")).toEqual({ kind: "setPanel", slot: "right", content: "locations" });
    expect(parser.parse("panel left close")).toEqual({ kind: "setPanel", slot: "left", content: "closed" });
    expect(parser.parse("time")).toEqual({ kind: "time" });
    expect(parser.parse("prefer")).toEqual({ kind: "travelPreference" });
    expect(parser.parse("prefer taxi")).toEqual({ kind: "travelPreference", preference: "taxi" });
    expect(parser.parse("prefer cab")).toEqual({ kind: "travelPreference", preference: "taxi" });
    expect(parser.parse("preference walk")).toEqual({ kind: "travelPreference", preference: "foot" });
    expect(parser.parse("prefer bus")).toEqual({ kind: "travelPreference", preference: "transit" });
    expect(parser.parse("sneak")).toEqual({ kind: "toggleStealth" });
    expect(parser.parse("travel")).toEqual({ kind: "travelMenu" });
    expect(parser.parse("save")).toEqual({ kind: "save" });
    expect(parser.parse("load")).toEqual({ kind: "load" });
  });

  it("returns unknown for prefer with an unrecognized preference word", () => {
    expect(parser.parse("prefer purple")).toEqual({ kind: "unknown", raw: "prefer purple" });
  });

  it("returns unknown for 'panel' with an unrecognized slot, unrecognized content, or a missing slot entirely", () => {
    expect(parser.parse("panel top verbs")).toEqual({ kind: "unknown", raw: "panel top verbs" });
    expect(parser.parse("panel left weather")).toEqual({ kind: "unknown", raw: "panel left weather" });
    expect(parser.parse("panel")).toEqual({ kind: "unknown", raw: "panel" });
  });

  it("opens a panel-content menu for 'panel <slot>' with no content word", () => {
    expect(parser.parse("panel left")).toEqual({ kind: "panelMenu", slot: "left" });
    expect(parser.parse("panel right")).toEqual({ kind: "panelMenu", slot: "right" });
  });

  it("returns unknown for bare 'go' (no menu equivalent) and unrecognized input", () => {
    expect(parser.parse("go")).toEqual({ kind: "unknown", raw: "go" });
    expect(parser.parse("dance")).toEqual({ kind: "unknown", raw: "dance" });
    expect(parser.parse("")).toEqual({ kind: "unknown", raw: "" });
  });

  it("retired 'inquire' as a standalone verb — it's now unknown, freed for future investigation use", () => {
    expect(parser.parse("inquire about the docks")).toEqual({ kind: "unknown", raw: "inquire about the docks" });
  });

  it("lists every verb it actually parses, and only those", () => {
    const verbs = parser.listVerbs();
    // One entry per VERB_RULES row (directions share the "travel" rule's key).
    expect(verbs.map((v) => v.usageKey)).toEqual([
      "verb.look.usage",
      "verb.inventory.usage",
      "verb.help.usage",
      "verb.verbs.usage",
      "verb.locations.usage",
      "verb.worldmap.usage",
      "verb.panel.usage",
      "verb.travel.usage",
      "verb.take.usage",
      "verb.buy.usage",
      "verb.talk.usage",
      "verb.examine.usage",
      "verb.interact.usage",
      "verb.unfocus.usage",
      "verb.time.usage",
      "verb.sneak.usage",
      "verb.prefer.usage",
      "verb.notebook.usage",
      "verb.board.usage",
      "verb.jotDown.usage",
      "verb.save.usage",
      "verb.load.usage",
    ]);
  });

  describe("dev-only verbs (devmoney, devlocations)", () => {
    it("treats them as unknown, and omits them from listVerbs, when devMode is off (the default)", () => {
      expect(parser.parse("devmoney 50")).toEqual({ kind: "unknown", raw: "devmoney 50" });
      expect(parser.parse("devlocations")).toEqual({ kind: "unknown", raw: "devlocations" });
      expect(parser.listVerbs().map((v) => v.usageKey)).not.toContain("verb.devMoney.usage");
      expect(parser.listVerbs().map((v) => v.usageKey)).not.toContain("verb.devLocations.usage");
    });

    it("parses them, and lists them, when constructed with devMode: true", () => {
      const devParser = new EnglishCommandParser(true);
      expect(devParser.parse("devmoney 50")).toEqual({ kind: "devAddMoney", amountMinor: 5000 });
      expect(devParser.parse("devmoney -12.34")).toEqual({ kind: "devAddMoney", amountMinor: -1234 });
      expect(devParser.parse("devlocations")).toEqual({ kind: "devToggleAllLocations" });
      expect(devParser.listVerbs().map((v) => v.usageKey)).toEqual(
        expect.arrayContaining(["verb.devMoney.usage", "verb.devLocations.usage"]),
      );
    });

    it("returns unknown for devmoney with a non-numeric, zero, or missing amount, even in dev mode", () => {
      const devParser = new EnglishCommandParser(true);
      expect(devParser.parse("devmoney")).toEqual({ kind: "unknown", raw: "devmoney" });
      expect(devParser.parse("devmoney zero")).toEqual({ kind: "unknown", raw: "devmoney zero" });
      expect(devParser.parse("devmoney 0")).toEqual({ kind: "unknown", raw: "devmoney 0" });
    });
  });
});

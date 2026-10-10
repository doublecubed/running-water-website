import { describe, expect, it } from "vitest";
import { rawLookup } from "../i18n/resolver";
import { EnglishCommandParser } from "../engine/parsing/EnglishCommandParser";
import type { SceneImage } from "../engine/types";
import { createInitialState } from "./world";

/**
 * Content-authoring regression test: every location must accept its own
 * displayed name as a "go to"/"inquire about" query. This exact bug
 * happened for real — the pier's aliases had "the pier" and "far pier"
 * separately but not "the far pier", the phrase its displayed name
 * ("The Far Pier") actually lowercases to, so typing what the game had
 * just shown the player failed. See docs/content-schema.md.
 */
describe("world content", () => {
  it("includes each location's own display name (lowercased) in its aliases", () => {
    const state = createInitialState();
    for (const location of Object.values(state.locations)) {
      const displayName = rawLookup(location.nameKey);
      expect(displayName, `location "${location.id}" has no translation entry for ${location.nameKey}`).toBeDefined();
      expect(
        location.aliases,
        `location "${location.id}" (displayed as "${displayName}") is missing "${displayName?.toLowerCase()}" from its aliases`,
      ).toContain(displayName?.toLowerCase());
    }
  });

  it("has every interior location's exteriorId point to a real location that is actually kind: exterior", () => {
    const state = createInitialState();
    for (const location of Object.values(state.locations)) {
      if (location.kind !== "interior") continue;
      const owner = state.locations[location.exteriorId];
      expect(owner, `interior "${location.id}" has exteriorId "${location.exteriorId}", which doesn't exist`).toBeDefined();
      expect(
        owner?.kind,
        `interior "${location.id}"'s exteriorId "${location.exteriorId}" points to a location that isn't kind: "exterior"`,
      ).toBe("exterior");
    }
  });

  it("has every connection's transitLineId (if any) point to a real entry in transitLines", () => {
    const state = createInitialState();
    for (const location of Object.values(state.locations)) {
      for (const connection of location.connections) {
        if (!connection.transitLineId) continue;
        expect(
          state.transitLines[connection.transitLineId],
          `location "${location.id}" has a connection to "${connection.toId}" with transitLineId "${connection.transitLineId}", which has no entry in transitLines`,
        ).toBeDefined();
      }
    }
  });

  it("has every pass's lineIds point to real entries in transitLines", () => {
    const state = createInitialState();
    for (const pass of Object.values(state.passes)) {
      for (const lineId of pass.lineIds) {
        expect(
          state.transitLines[lineId],
          `pass "${pass.id}" lists lineIds "${lineId}", which has no entry in transitLines`,
        ).toBeDefined();
      }
    }
  });

  it("resolves the studio's inline text and starts the player there", () => {
    const state = createInitialState();
    expect(state.player.locationId).toBe("studio-landing");
    expect(rawLookup(state.locations["studio-landing"]!.nameKey)).toBe("The Landing");
  });

  it("has every pass with at least one alias, and every alias lowercase", () => {
    const state = createInitialState();
    for (const pass of Object.values(state.passes)) {
      expect(pass.aliases.length, `pass "${pass.id}" has no aliases — nothing could ever "buy" it`).toBeGreaterThan(0);
      for (const alias of pass.aliases) {
        expect(alias, `pass "${pass.id}" has a non-lowercase alias "${alias}"`).toBe(alias.toLowerCase());
      }
    }
  });
});

/**
 * Hotspot commands are authored raw text run through the parser at click
 * time, so a typo would only surface as an "unknown command" in play —
 * catch it here instead, for every image an entity can carry (location,
 * object, part state, NPC). See docs/systems/image-pane.md.
 */
describe("scene image hotspots", () => {
  it("every hotspot command parses to a known command", () => {
    const parser = new EnglishCommandParser(false);
    const state = createInitialState();
    const images: Array<[string, SceneImage | undefined]> = [
      ...Object.values(state.locations).map((l): [string, SceneImage | undefined] => [`location "${l.id}"`, l.image]),
      ...Object.values(state.npcs).map((n): [string, SceneImage | undefined] => [`npc "${n.id}"`, n.image]),
      ...Object.values(state.worldObjects).flatMap((o): Array<[string, SceneImage | undefined]> => [
        [`object "${o.id}"`, o.image],
        ...(o.parts ?? []).flatMap((p) => p.states.map((st): [string, SceneImage | undefined] => [`object "${o.id}" part "${p.id}" state "${st.id}"`, st.image])),
      ]),
    ];
    for (const [owner, image] of images) {
      for (const hotspot of image?.hotspots ?? []) {
        expect(parser.parse(hotspot.command).kind, `${owner} hotspot "${hotspot.command}" does not parse`).not.toBe("unknown");
      }
    }
  });
});

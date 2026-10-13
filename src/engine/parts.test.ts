import { describe, expect, it } from "vitest";
import { createInitialState } from "../content/world";
import { GameEngine } from "./GameEngine";
import type { GameState, SceneImage } from "./types";

/**
 * Parts, focus, containment, ambiguity and scene images — the engine's object
 * model. The studio content has only plain setpieces, so these tests install a
 * small synthetic "test desk" (two drawers, one holding a photograph) into the
 * main room. Locale keys here are never rendered, so they only need to be
 * stable strings.
 */
const img = (src: string): SceneImage => ({ src, altKey: `test.${src}`, hotspots: [] });

function fixture(): { state: GameState; engine: GameEngine } {
  const state = createInitialState();
  state.player.locationId = "studio-mainroom";
  state.player.visitedLocationIds.push("studio-mainroom");

  state.worldObjects["t-desk"] = {
    id: "t-desk",
    nameKey: "t.desk.name",
    descriptionKey: "t.desk.description",
    aliases: ["test desk"],
    kind: "setpiece",
    portable: false,
    parts: [
      {
        id: "left-drawer",
        nameKey: "t.left.name",
        descriptionKey: "t.left.description",
        aliases: ["left drawer"],
        defaultStateId: "closed",
        states: [
          { id: "closed", nameKey: "t.left.closed.name", descriptionKey: "t.left.closed.description", enterAliases: ["close"] },
          { id: "open", nameKey: "t.left.open.name", descriptionKey: "t.left.open.description", enterAliases: ["open"] },
        ],
      },
      {
        id: "right-drawer",
        nameKey: "t.right.name",
        descriptionKey: "t.right.description",
        aliases: ["right drawer"],
        defaultStateId: "open",
        states: [
          { id: "closed", nameKey: "t.right.closed.name", descriptionKey: "t.right.closed.description", enterAliases: ["close"] },
          {
            id: "open",
            nameKey: "t.right.open.name",
            descriptionKey: "t.right.open.description",
            summaryKey: "t.right.open.summary",
            important: true,
            exposesContents: true,
            enterAliases: ["open"],
            image: img("drawer-open.svg"),
          },
        ],
      },
    ],
  };
  state.worldObjects["t-photo"] = {
    id: "t-photo",
    nameKey: "t.photo.name",
    descriptionKey: "t.photo.description",
    aliases: ["photo", "torn photograph"],
    kind: "item",
    portable: true,
  };
  state.placement.worldObjectLocationId["t-desk"] = "studio-mainroom";
  state.placement.containedIn["t-photo"] = { containerId: "t-desk", partId: "right-drawer" };

  return { state, engine: new GameEngine(state) };
}

describe("parts, focus, and interact", () => {
  it("examining an object with parts focuses it, and bubbles up any part currently in an important state", () => {
    const { engine } = fixture();
    const result = engine.examine("test desk");
    expect(engine.getFocusedWorldObject()?.id).toBe("t-desk");
    const bubbled = result.events.filter((e) => e.type === "part_state_noted");
    expect(bubbled).toHaveLength(1); // only the right drawer (open, important)
    expect(bubbled[0]?.textKey).toBe("t.right.open.summary"); // the SHORT summary
  });

  it("clears focus when examining a plain object", () => {
    const { engine } = fixture();
    engine.examine("test desk");
    expect(engine.getFocusedWorldObject()).toBeDefined();
    engine.examine("workspace"); // a setpiece with no parts
    expect(engine.getFocusedWorldObject()).toBeUndefined();
  });

  it("clears focus when examining an NPC", () => {
    const { state, engine } = fixture();
    state.player.locationId = "studio-landing";
    state.focusedWorldObjectId = "t-desk";
    engine.examine("herald");
    expect(engine.getFocusedWorldObject()).toBeUndefined();
  });

  it("examines a non-important part directly while focused", () => {
    const { engine } = fixture();
    engine.examine("test desk");
    const result = engine.examine("left drawer");
    expect(result.ok).toBe(true);
    expect(result.events.map((e) => e.type)).toEqual(["part_examined", "part_state_noted"]);
    expect(result.events[1]?.textKey).toBe("t.left.closed.description");
  });

  it("resolves an important part directly, without focus first, and sets focus afterward", () => {
    const { engine } = fixture();
    const result = engine.examine("right drawer");
    expect(result.ok).toBe(true);
    expect(engine.getFocusedWorldObject()?.id).toBe("t-desk");
  });

  it("refuses a non-important, non-focused part with a 'look closer first' message", () => {
    const { engine } = fixture();
    const result = engine.examine("left drawer");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.textKey).toBe("event.partNotFocused");
  });

  it("interact: changes a part's state and keeps focus on the parent", () => {
    const { engine } = fixture();
    engine.examine("test desk");
    const result = engine.interact("open", "left drawer");
    expect(result.ok).toBe(true);
    expect(result.events[0]?.textKey).toBe("t.left.open.description");
    expect(engine.getFocusedWorldObject()?.id).toBe("t-desk");
  });

  it("interact: reports 'already in state' without changing anything", () => {
    const { engine } = fixture();
    engine.examine("test desk");
    const result = engine.interact("close", "left drawer"); // already closed
    expect(result.ok).toBe(true);
    expect(result.events[0]?.textKey).toBe("event.partAlreadyInState");
    expect(result.events[0]?.params?.stateKey).toBe("t.left.closed.name");
  });

  it("interact: reports verb-not-applicable when no state accepts that verb", () => {
    const { engine } = fixture();
    engine.examine("test desk");
    const result = engine.interact("smash", "left drawer");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("part_verb_not_applicable");
  });

  it("interact: fails as 'not focused yet' for a non-important part reached without focus", () => {
    const { engine } = fixture();
    const result = engine.interact("open", "left drawer");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.textKey).toBe("event.partNotFocused");
  });

  it("interact: fails as not-found when the alias matches no part anywhere in scope", () => {
    const { engine } = fixture();
    const result = engine.interact("open", "nonexistent thing");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.textKey).toBe("event.itemNotFound");
  });

  it("interact: an important part works without focus, and sets focus afterward", () => {
    const { engine } = fixture();
    const result = engine.interact("close", "right drawer");
    expect(result.ok).toBe(true);
    expect(engine.getFocusedWorldObject()?.id).toBe("t-desk");
  });

  it("clears focus on a successful travel, but not on a blocked one", () => {
    const { engine } = fixture();
    engine.examine("test desk");
    engine.travelTo("nowhere in particular"); // unknown place
    expect(engine.getFocusedWorldObject()?.id).toBe("t-desk");
    expect(engine.travelTo("corridor").ok).toBe(true);
    expect(engine.getFocusedWorldObject()).toBeUndefined();
  });

  it("clears focus when talkTo succeeds, but not when it fails to find the NPC", () => {
    const { state, engine } = fixture();
    engine.examine("test desk");
    engine.talkTo("nobody");
    expect(engine.getFocusedWorldObject()?.id).toBe("t-desk");
    state.player.locationId = "studio-landing";
    expect(engine.talkTo("herald").ok).toBe(true);
    expect(engine.getFocusedWorldObject()).toBeUndefined();
  });

  it("unfocus clears focus and reports what was focused; with nothing focused it says so", () => {
    const { engine } = fixture();
    const nothing = engine.unfocus();
    expect(nothing.ok).toBe(true);
    expect(nothing.events[0]?.textKey).toBe("event.nothingFocused");

    engine.examine("test desk");
    const result = engine.unfocus();
    expect(result.ok).toBe(true);
    expect(engine.getFocusedWorldObject()).toBeUndefined();
  });

  it("clearFocus is an event-less, unconditional focus break", () => {
    const { engine } = fixture();
    engine.examine("test desk");
    engine.clearFocus();
    expect(engine.getFocusedWorldObject()).toBeUndefined();
  });
});

describe("containment", () => {
  it("makes a contained object reachable (examine/take) while its container part exposes it", () => {
    const { engine } = fixture();
    expect(engine.examine("photo").ok).toBe(true);
    expect(engine.takeItem("photo").ok).toBe(true);
    expect(engine.getState().player.inventory).toContain("t-photo");
  });

  it("clears its containedIn entry once taken", () => {
    const { engine } = fixture();
    expect(engine.getState().placement.containedIn["t-photo"]).toEqual({ containerId: "t-desk", partId: "right-drawer" });
    engine.takeItem("photo");
    expect(engine.getState().placement.containedIn["t-photo"]).toBeUndefined();
  });

  it("becomes unreachable again once the container is closed", () => {
    const { engine } = fixture();
    expect(engine.interact("close", "right drawer").ok).toBe(true);
    const result = engine.examine("photo");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.textKey).toBe("event.examineNotFound");
  });

  it("does not join the ambient items-present line while exposed, since revealInAmbientListing isn't set", () => {
    const { engine } = fixture();
    const itemsLine = engine.look().events.find((e) => e.type === "items_present");
    expect(itemsLine?.params?.items ?? "").not.toMatch(/photo/);
  });
});

/** Two in-scope objects sharing an alias — see docs/systems/parts.md's "Ambiguous targets." */
describe("ambiguous targets", () => {
  function ambiguous(): GameEngine {
    const { state, engine } = fixture();
    state.worldObjects["t-photo"]!.aliases.push("workspace"); // collides with the studio's workspace setpiece
    return engine;
  }

  it("reports every in-scope match instead of silently picking one", () => {
    const result = ambiguous().examine("workspace");
    expect(result.ok).toBe(true);
    expect(result.events[0]?.textKey).toBe("event.targetAmbiguous");
    expect((result.choices ?? []).map((c) => c.id).sort()).toEqual(["t-photo", "workspace"]);
    for (const choice of result.choices ?? []) {
      expect(choice.kind).toBe("resolution");
      expect(choice.textKey).toBe("ui.disambiguationOption");
    }
  });

  it("labels each candidate by its immediate parent: the location for a bare placement, the container for a contained one", () => {
    const result = ambiguous().examine("workspace");
    const byId = Object.fromEntries((result.choices ?? []).map((c) => [c.id, c]));
    expect(byId["workspace"]?.params?.locationKey).toBe("location.studio-mainroom.name");
    expect(byId["t-photo"]?.params?.locationKey).toBe("t.desk.name");
  });

  it("labels a carried candidate with the inventory placeholder", () => {
    const engine = ambiguous();
    engine.getState().player.inventory.push("t-photo");
    delete engine.getState().placement.containedIn["t-photo"];
    const result = engine.examine("workspace");
    const byId = Object.fromEntries((result.choices ?? []).map((c) => [c.id, c]));
    expect(byId["t-photo"]?.params?.locationKey).toBe("ui.inventoryLabel");
  });

  it("the id-based overload resolves a specific candidate directly, bypassing alias matching", () => {
    const engine = ambiguous();
    const examined = engine.examine({ id: "t-photo" });
    expect(examined.ok).toBe(true);
    expect(examined.choices).toBeUndefined();
    expect(engine.takeItem({ id: "t-photo" }).ok).toBe(true);
    expect(engine.getState().player.inventory).toContain("t-photo");
  });

  it("takeItem also reports ambiguity rather than taking the wrong one", () => {
    const engine = ambiguous();
    const result = engine.takeItem("workspace");
    expect(result.ok).toBe(true);
    expect(result.choices).toHaveLength(2);
    expect(engine.getState().player.inventory).toEqual([]);
  });
});

/** `getSceneImage`: the examined thing's image (object, part state, NPC) while examining, else the location's. */
describe("scene image", () => {
  it("shows the location image until something with its own image is examined", () => {
    const { state, engine } = fixture();
    state.worldObjects["t-desk"]!.image = img("desk.svg");
    expect(engine.getSceneImage()?.src).toBe("studio-general.jpg");
    engine.examine("test desk");
    // The open right drawer's state image overrides the object's own.
    expect(engine.getSceneImage()?.src).toBe("drawer-open.svg");
  });

  it("reverts to the location image on back, and on travel", () => {
    const { engine } = fixture();
    engine.examine("test desk");
    engine.unfocus();
    expect(engine.getSceneImage()?.src).toBe("studio-general.jpg");
    engine.examine("test desk");
    engine.travelTo("corridor");
    expect(engine.getSceneImage()?.src).toBe("studio-corridor.jpg");
  });

  it("falls through to the location image when the examined thing has none", () => {
    const { engine } = fixture();
    engine.examine("photo");
    expect(engine.getSceneImage()?.src).toBe("studio-general.jpg");
  });

  it("shows an NPC's image while examining them", () => {
    const { state, engine } = fixture();
    state.player.locationId = "studio-landing";
    state.npcs["herald"]!.image = img("herald.svg");
    engine.examine("herald");
    expect(engine.getSceneImage()?.src).toBe("herald.svg");
  });

  it("swaps to a part state's image when interact changes state, overriding the object's own", () => {
    const { state, engine } = fixture();
    state.worldObjects["t-desk"]!.image = img("desk.svg");
    engine.examine("test desk");
    expect(engine.getSceneImage()?.src).toBe("drawer-open.svg");
    engine.interact("close", "right drawer");
    expect(engine.getSceneImage()?.src).toBe("desk.svg"); // closed state has no image of its own
  });
});

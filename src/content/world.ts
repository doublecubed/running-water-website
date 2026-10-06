import { registerContentLocale } from "../i18n/resolver";
import type { GameState, InteriorLocation, Location } from "../engine/types";
import worldYamlText from "./city/world.yaml?raw";
import type { CityContent } from "./cityLoader";
import { parseCity } from "./cityLoader";

/**
 * City content (locations, items, NPCs, transit lines, passes) lives
 * across many files under `content/city/` — see `cityLoader.ts`'s doc
 * comment for the file layout and `docs/content-schema.md` for the
 * format. This file is left owning only game SETUP: which location the
 * player starts in, their starting money/preference, and the clock's
 * epoch — things that describe how a NEW GAME begins, not the shape of
 * the city itself.
 *
 * `import.meta.glob` (Vite) discovers every `objects/`/`locations/` file
 * at build time and inlines each one's text — no separate network fetch
 * at runtime, no manifest to hand-maintain, and no YAML-specific bundler
 * plugin needed; `cityLoader.ts` does the actual parsing (via `js-yaml`)
 * and validation itself, fully testable in isolation from Vite. Parsed,
 * validated, and registered once, at module load — a malformed YAML file
 * fails loudly (a thrown Error listing every problem found, tagged by
 * source file) the moment the app starts, not partway through play.
 */
const objectFiles = import.meta.glob("./city/objects/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const locationFiles = import.meta.glob("./city/locations/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const city = parseCity({ world: worldYamlText, objectFiles, locationFiles });

// Registers every language's derived content text into i18n/resolver.ts's
// table — see cityLoader.ts's `CityContent.derivedLocale` doc comment.
// Happens once here (not per `loadCityContent()` call); `content/world.ts`
// is imported by everything that ever calls `createInitialState()` (the
// game itself, and every engine test), so this "just runs" on import —
// the same self-initializing behavior `resolver.ts` used to provide by
// itself before content text moved inline.
for (const [language, table] of Object.entries(city.derivedLocale)) {
  registerContentLocale(language, table);
}

const STARTING_LOCATION_ID = "office";
if (!city.locations[STARTING_LOCATION_ID]) {
  throw new Error(`content/city/locations/ has no location "${STARTING_LOCATION_ID}" — createInitialState needs it as the starting location.`);
}

/**
 * Returns a fresh, independent clone of the STATIC/catalog content
 * (`locations`/`worldObjects`/`npcs`/`transitLines`/`passes`) plus this
 * city's `initialPlacement`/`initialPartStates` — everything a new game
 * or a save-file load needs to rebuild the non-mutable half of
 * `GameState` from. Parsing itself only happens once, at module load
 * (above); this just clones that result, so repeated calls (a fresh
 * game, then later a save load) never alias the same objects. See
 * docs/systems/save.md for how this pairs with the saved mutable slice
 * (`player`/`clock`/`placement`) to reconstruct a full `GameState`.
 */
export function loadCityContent(): CityContent {
  return structuredClone(city);
}

export function createInitialState(): GameState {
  const content = loadCityContent();
  return {
    locations: content.locations,
    worldObjects: content.worldObjects,
    npcs: content.npcs,
    labels: content.labels,
    transitLines: content.transitLines,
    passes: content.passes,
    notebookProducts: content.notebookProducts,
    facts: content.facts,
    placement: content.initialPlacement,
    partStates: content.initialPartStates,
    focusedWorldObjectId: null,
    examinedTarget: null,
    // A new game starts with no notebooks — see docs/systems/notebooks.md.
    notebooks: { notebooks: [], activeNotebookId: null },
    // A new game starts with no flags set — see docs/systems/dialogue.md.
    flags: {},
    // Seeded from each NPC's authored initial trust/memories/knowledge — see docs/systems/npcs.md.
    npcStates: content.initialNpcStates,
    reputation: { global: 0, byLabel: {} },
    // A new game starts having learned nothing — see docs/systems/case-system.md.
    playerFacts: {},
    // A new game starts with an empty case board — see docs/systems/case-board.md.
    board: { nodes: [], connections: [] },
    // 15000 minor units = $150.00 starting cash — enough to comfortably
    // afford everyday taxi/bus fares and still feel the $10.00 ship fare to
    // the pier as a real cost, not enough to make affordability moot. See
    // docs/systems/economy.md.
    player: {
      locationId: STARTING_LOCATION_ID,
      inventory: [],
      money: 15000,
      boardedLineId: null,
      travelPreference: "foot",
      // The starting location counts as already visited — see
      // Player.visitedLocationIds and docs/systems/navigation.md.
      visitedLocationIds: [STARTING_LOCATION_ID],
      activePasses: [],
      stats: {},
      stealthMode: false,
    },
    // Day 1, 08:00 = 18 September 1946, 08:00. The epoch is the ONLY
    // date/time format the game shows — see docs/systems/time.md for why
    // an earlier relative "Day N" display was dropped entirely.
    clock: { minutesElapsed: 8 * 60, epoch: { year: 1946, month: 9, day: 18 } },
  };
}

/** Re-exported so content-validation tests (world.test.ts) can narrow Location -> InteriorLocation without duplicating the type guard. */
export function isInteriorLocation(location: Location): location is InteriorLocation {
  return location.kind === "interior";
}

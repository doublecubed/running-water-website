import { load as parseYaml } from "js-yaml";
import type {
  ComparisonOp,
  Condition,
  Connection,
  DialogueEffect,
  DialogueRule,
  DialogueTopic,
  Direction,
  Fact,
  KnowledgeDisposition,
  Hotspot,
  Location,
  SceneImage,
  Memory,
  MemoryPattern,
  Npc,
  NpcLabel,
  NpcState,
  ScheduleSlot,
  NotebookProduct,
  Part,
  PartState,
  Pass,
  Placement,
  StatBlock,
  StatKey,
  TransitLine,
  TransportMode,
  VisibilityTier,
  WorldObject,
} from "../engine/types";
import { STAT_DEFINITIONS } from "../engine/stats/stats";
import { MEMORY_VERBS } from "../engine/types";
import { parseMemoryShorthand, parseRef } from "../engine/npc/memory";

/**
 * Turns hand-authored YAML into the same content shape `content/world.ts`
 * used to hand-write as TS object literals — see `docs/content-schema.md`
 * for the field-by-field reference and file-layout convention.
 *
 * Content is split across MANY files, not one: every location lives under
 * `content/city/locations/*.yaml`, every world object under
 * `content/city/objects/*.yaml` (each file a bare YAML array — one or
 * several entries, author's choice of grouping — no wrapping key, since
 * the folder already establishes the category), discovered automatically
 * via Vite's `import.meta.glob` in `content/world.ts` — no manifest to
 * hand-maintain. `content/city/world.yaml` itself now holds only `npcs`/
 * `transitLines`/`passes` (small counts, not worth splitting yet).
 *
 * Every `nameKey`/`descriptionKey`/`dialogueKey` an author used to have to
 * ALSO type into a separate `i18n/content/<lang>.yaml` file is now an
 * inline `text: { en: {...}, ... }` block on the entity itself — `en`
 * (the baseline language) is required, any other language is fully
 * optional per entity (see `validateText`). This module DERIVES the
 * lookup key from the entity's own `id` (and its parent chain, for parts/
 * states) and emits the resulting `{ language: { key: text } }` table as
 * `CityContent.derivedLocale`, which `content/world.ts` registers into
 * `i18n/resolver.ts` — so the runtime `Location`/`WorldObject`/etc. shapes
 * (`nameKey: string`, resolved via `t()`) are completely unchanged; only
 * WHERE that key string comes from (synthesized here, not hand-typed) and
 * WHERE its text lives (inline, not a separate file) changed.
 *
 * Why this exists at all: a hardcoded TS array gets its shape checked for
 * free by the compiler (a typo'd field, a `Connection.toId` pointing
 * nowhere, would simply fail to compile). Content authored as external
 * YAML data loses that entirely — `parseYaml` hands back `unknown`. This
 * module puts the safety back: it validates structure (required fields,
 * correct types, enum values like `kind`/`modes`/`compassLabel`) AND
 * referential integrity (does this `toId`/`exteriorId`/`transitLineId`/
 * `locationId`/`itemIds`/`npcIds`/`lineIds`/`containerId`/
 * `containerPartId` actually point to something that exists, and is it
 * free of containment cycles).
 *
 * On any problem, throws ONE `Error` listing EVERY problem found (not
 * just the first, and tagged with the SOURCE FILE it came from) — a
 * content author fixing a YAML file wants the whole list in one pass, not
 * one compile-fix-recompile cycle per mistake.
 *
 * Also used directly by the map editor (`src/editor/main.ts`) to
 * validate every edit before writing it back — see
 * `docs/architecture.md`'s "The map editor" section.
 */

/** The required language every entity's `text` block must have — see `validateText`. Every other language is optional per entity; see `i18n/translationCoverage.test.ts` for the separate, non-blocking completeness check. */
const BASELINE_LANGUAGE = "en";

export interface CitySourceFiles {
  /** `content/city/world.yaml`'s text — `npcs`/`transitLines`/`passes` only. */
  world: string;
  /** path -> YAML text, each document a bare array of `WorldObject` entries — see this file's doc comment. */
  objectFiles: Record<string, string>;
  /** path -> YAML text, each document a bare array of `Location` entries. */
  locationFiles: Record<string, string>;
}

export interface CityContent {
  locations: Record<string, Location>;
  worldObjects: Record<string, WorldObject>;
  npcs: Record<string, Npc>;
  /** Every NPC label definition — see `NpcLabel` and docs/systems/npcs.md. */
  labels: Record<string, NpcLabel>;
  /**
   * Each NPC's authored STARTING trust/suspicion/memories/knowledge —
   * setup data, like `initialPlacement`: a new game copies it into
   * `GameState.npcStates`, after which the state lives (and is saved) only
   * there. Every NPC has an entry.
   */
  initialNpcStates: Record<string, NpcState>;
  transitLines: Record<string, TransitLine>;
  passes: Record<string, Pass>;
  /** Every purchasable notebook product — see `NotebookProduct` and docs/systems/notebooks.md. */
  notebookProducts: Record<string, NotebookProduct>;
  /** Every fact the player could learn — see `Fact` and docs/systems/case-system.md. */
  facts: Record<string, Fact>;
  /**
   * Where every world object/NPC starts out — built from each location's
   * authored `itemIds`/`npcIds`, each NPC's authored `locationId`, and
   * each contained world object's own `containerId`/`containerPartId`,
   * which describe CASE SETUP, not the location/NPC/object records
   * themselves — see `Placement`'s doc comment in `engine/types.ts`. A new
   * game copies this as its starting `GameState.placement`; it plays no
   * further role once play begins (placement from then on lives only in
   * `GameState`).
   */
  initialPlacement: Placement;
  /**
   * Every part's starting state, per world object — `partId ->
   * defaultStateId` for each object that has `parts`. Mirrors
   * `initialPlacement`: describes SETUP (what a new game/case starts
   * with), not the `WorldObject` record itself — see
   * `GameState.partStates` and docs/systems/parts.md.
   */
  initialPartStates: Record<string, Record<string, string>>;
  /**
   * `{ language: { derivedKey: text } }` — every `text:` block found
   * across every parsed file, keyed by the SAME derived keys this module
   * assigned to `nameKey`/`descriptionKey`/etc. `content/world.ts`
   * registers this into `i18n/resolver.ts` (`registerContentLocale`) so
   * `t()` can resolve them — see this file's doc comment.
   */
  derivedLocale: Record<string, Record<string, string>>;
}

/** `validateLocation`'s actual return shape — `itemIds`/`npcIds` are parsed and validated here (same as every other field) but pulled off into `initialPlacement` before `parseCity` returns, never exposed on `Location` itself. */
type ParsedLocation = Location & { itemIds: string[]; npcIds: string[] };

/** `validateNpc`'s actual return shape — `locationId` is parsed and validated here but pulled off into `initialPlacement` before `parseCity` returns, never exposed on `Npc` itself. */
type ParsedNpc = Npc & { locationId: string; initialState: NpcState };

/** `validateWorldObject`'s actual return shape — `containerId`/`containerPartId` (see docs/systems/parts.md's "Containment") are parsed and validated here but pulled off into `initialPlacement.containedIn` before `parseCity` returns, never exposed on `WorldObject` itself. */
type ParsedWorldObject = WorldObject & { containerId?: string; containerPartId?: string };

const VALID_KINDS = new Set(["exterior", "interior"]);
const VALID_WORLD_OBJECT_KINDS = new Set(["item", "setpiece"]);
/** Bounds the containment-chain walk in `checkContainmentCycles` — no authored case should ever nest a container this deep; hitting the limit means a cycle, not a legitimately deep chain. */
const MAX_CONTAINMENT_DEPTH = 10;
const VALID_MODES: ReadonlySet<TransportMode> = new Set(["foot", "car", "ship", "taxi", "bus"]);
const VALID_VISIBILITY_TIERS: ReadonlySet<VisibilityTier> = new Set(["dark", "dim", "normal", "bright"]);
const VALID_STAT_KEYS: ReadonlySet<StatKey> = new Set(Object.keys(STAT_DEFINITIONS) as StatKey[]);
const VALID_DIRECTIONS: ReadonlySet<Direction> = new Set(["north", "south", "east", "west", "up", "down", "in", "out"]);

/** Parses and fully validates a city's content across every source file. Throws a single, multi-line Error listing every problem found (each tagged with its source file) if anything is malformed. */
export function parseCity(files: CitySourceFiles): CityContent {
  const errors: string[] = [];
  const locale: Record<string, Record<string, string>> = {};

  let worldRoot: unknown = {};
  if (files.world.trim() !== "") {
    try {
      worldRoot = parseYaml(files.world) ?? {};
    } catch (err) {
      throw new Error(`Invalid content/city/world.yaml: invalid YAML — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!isRecord(worldRoot)) {
    throw new Error(`Invalid content/city/world.yaml: must be a YAML mapping (or empty).`);
  }

  const rawNpcs = expectArray(worldRoot.npcs, "world.yaml npcs", errors, {});
  const rawLabels = expectArray(worldRoot.labels, "world.yaml labels", errors, {});
  const rawTransitLines = expectArray(worldRoot.transitLines, "world.yaml transitLines", errors, {});
  const rawPasses = expectArray(worldRoot.passes, "world.yaml passes", errors, {});
  const rawNotebookProducts = expectArray(worldRoot.notebookProducts, "world.yaml notebookProducts", errors, {});
  const rawFacts = expectArray(worldRoot.facts, "world.yaml facts", errors, {});

  const locationEntries = collectFileEntries(files.locationFiles, "locations", errors);
  const objectEntries = collectFileEntries(files.objectFiles, "items", errors);

  const parsedLocations = buildById(locationEntries, "locations", errors, (raw, where, errs) => validateLocation(raw, where, errs, locale));
  const parsedWorldObjects = buildById(objectEntries, "items", errors, (raw, where, errs) => validateWorldObject(raw, where, errs, locale));
  const parsedNpcs = buildById(
    tagEntries(rawNpcs, "world.yaml npcs"),
    "npcs",
    errors,
    (raw, where, errs) => validateNpc(raw, where, errs, locale),
  );
  const labels = buildById(tagEntries(rawLabels, "world.yaml labels"), "labels", errors, (raw, where, errs) =>
    validateLabel(raw, where, errs, locale),
  );
  const transitLines = buildById(
    tagEntries(rawTransitLines, "world.yaml transitLines"),
    "transitLines",
    errors,
    (raw, where, errs) => validateTransitLine(raw, where, errs, locale),
  );
  const passes = buildById(
    tagEntries(rawPasses, "world.yaml passes"),
    "passes",
    errors,
    (raw, where, errs) => validatePass(raw, where, errs, locale),
  );
  const notebookProducts = buildById(
    tagEntries(rawNotebookProducts, "world.yaml notebookProducts"),
    "notebookProducts",
    errors,
    (raw, where, errs) => validateNotebookProduct(raw, where, errs, locale),
  );
  const facts = buildById(tagEntries(rawFacts, "world.yaml facts"), "facts", errors, (raw, where, errs) =>
    validateFact(raw, where, errs, locale),
  );

  // Referential integrity — checks a hardcoded TS file never needed
  // because a dangling id reference just wouldn't have type-checked.
  for (const location of Object.values(parsedLocations)) {
    for (const connection of location.connections) {
      if (!parsedLocations[connection.toId]) {
        errors.push(`location "${location.id}" has a connection to "${connection.toId}", which doesn't exist.`);
      }
      if (connection.transitLineId && !transitLines[connection.transitLineId]) {
        errors.push(
          `location "${location.id}" has a connection to "${connection.toId}" with transitLineId "${connection.transitLineId}", which has no entry in transitLines.`,
        );
      }
    }
    if (location.kind === "interior") {
      const owner = parsedLocations[location.exteriorId];
      if (!owner) {
        errors.push(`interior location "${location.id}" has exteriorId "${location.exteriorId}", which doesn't exist.`);
      } else if (owner.kind !== "exterior") {
        errors.push(`interior location "${location.id}"'s exteriorId "${location.exteriorId}" points to a location that isn't kind: "exterior".`);
      }
    }
    for (const itemId of location.itemIds) {
      const worldObject = parsedWorldObjects[itemId];
      if (!worldObject) {
        errors.push(`location "${location.id}" lists itemIds "${itemId}", which has no entry in items.`);
      } else if (worldObject.containerId !== undefined) {
        errors.push(
          `location "${location.id}" lists itemIds "${itemId}", but that object also has containerId "${worldObject.containerId}" — an object must be placed at a location OR inside a container, not both.`,
        );
      }
    }
    for (const npcId of location.npcIds) {
      if (!parsedNpcs[npcId]) errors.push(`location "${location.id}" lists npcIds "${npcId}", which has no entry in npcs.`);
    }
  }
  for (const npc of Object.values(parsedNpcs)) {
    if (!parsedLocations[npc.locationId]) {
      errors.push(`npc "${npc.id}" has locationId "${npc.locationId}", which doesn't exist.`);
    }
    for (const labelId of npc.labels) {
      if (!labels[labelId]) errors.push(`npc "${npc.id}" has label "${labelId}", which has no entry in labels.`);
    }
    for (const slot of npc.schedule ?? []) {
      if (!parsedLocations[slot.locationId]) {
        errors.push(`npc "${npc.id}" has a schedule slot at locationId "${slot.locationId}", which doesn't exist.`);
      }
    }
    const conditions = npc.dialogueRules.flatMap((rule) => (rule.when ? [rule.when] : []));
    for (const condition of conditions) checkConditionReferences(condition, `npc "${npc.id}" dialogue rule`, labels, facts, errors);
    for (const rule of npc.dialogueRules) {
      for (const effect of rule.effects ?? []) {
        if ("reputation" in effect && effect.reputation.scope !== "global" && !labels[effect.reputation.scope]) {
          errors.push(`npc "${npc.id}" dialogue effect references reputation scope "${effect.reputation.scope}", which is neither "global" nor a label.`);
        }
        if ("memory" in effect && effect.memory.locationId !== undefined && !parsedLocations[effect.memory.locationId]) {
          errors.push(`npc "${npc.id}" dialogue effect has a memory at locationId "${effect.memory.locationId}", which doesn't exist.`);
        }
        if ("learnFact" in effect && !facts[effect.learnFact]) {
          errors.push(`npc "${npc.id}" dialogue effect references fact "${effect.learnFact}", which has no entry in facts.`);
        }
      }
    }
    for (const topic of npc.topics ?? []) {
      if (topic.when) checkConditionReferences(topic.when, `npc "${npc.id}" topic "${topic.id}"`, labels, facts, errors);
      for (const rule of topic.responses) {
        if (rule.when) checkConditionReferences(rule.when, `npc "${npc.id}" topic "${topic.id}" response`, labels, facts, errors);
        for (const effect of rule.effects ?? []) {
          if ("reputation" in effect && effect.reputation.scope !== "global" && !labels[effect.reputation.scope]) {
            errors.push(
              `npc "${npc.id}" topic "${topic.id}" response effect references reputation scope "${effect.reputation.scope}", which is neither "global" nor a label.`,
            );
          }
          if ("memory" in effect && effect.memory.locationId !== undefined && !parsedLocations[effect.memory.locationId]) {
            errors.push(`npc "${npc.id}" topic "${topic.id}" response effect has a memory at locationId "${effect.memory.locationId}", which doesn't exist.`);
          }
          if ("learnFact" in effect && !facts[effect.learnFact]) {
            errors.push(`npc "${npc.id}" topic "${topic.id}" response effect references fact "${effect.learnFact}", which has no entry in facts.`);
          }
        }
      }
    }
    for (const memory of npc.initialState.memories) {
      if (memory.locationId !== undefined && !parsedLocations[memory.locationId]) {
        errors.push(`npc "${npc.id}" has a memory at locationId "${memory.locationId}", which doesn't exist.`);
      }
    }
  }
  for (const label of Object.values(labels)) {
    for (const otherId of Object.keys(label.labelOpinions)) {
      if (!labels[otherId]) errors.push(`label "${label.id}" has labelOpinions for "${otherId}", which has no entry in labels.`);
    }
  }
  for (const pass of Object.values(passes)) {
    for (const lineId of pass.lineIds) {
      if (!transitLines[lineId]) errors.push(`pass "${pass.id}" lists lineIds "${lineId}", which has no entry in transitLines.`);
    }
  }
  for (const worldObject of Object.values(parsedWorldObjects)) {
    if (worldObject.containerId === undefined) continue;
    const container = parsedWorldObjects[worldObject.containerId];
    if (!container) {
      errors.push(`item "${worldObject.id}" has containerId "${worldObject.containerId}", which has no entry in items.`);
    } else if (!container.parts?.some((p) => p.id === worldObject.containerPartId)) {
      errors.push(
        `item "${worldObject.id}" has containerPartId "${worldObject.containerPartId}", which isn't a part of container "${worldObject.containerId}".`,
      );
    }
  }
  checkContainmentCycles(parsedWorldObjects, errors);

  if (errors.length > 0) {
    throw new Error([`Invalid city content — ${errors.length} problem(s) found:`, ...errors.map((e) => `  - ${e}`)].join("\n"));
  }

  // Split each ParsedLocation/ParsedNpc/ParsedWorldObject into its static
  // record plus its contribution to initialPlacement — see
  // CityContent.initialPlacement's doc comment for why placement never
  // ends up on Location/Npc/WorldObject itself.
  const locations: Record<string, Location> = {};
  const worldObjectLocationId: Record<string, string> = {};
  const npcLocationId: Record<string, string> = {};
  for (const { itemIds, npcIds, ...location } of Object.values(parsedLocations)) {
    locations[location.id] = location as Location;
    for (const itemId of itemIds) worldObjectLocationId[itemId] = location.id;
    for (const npcId of npcIds) npcLocationId[npcId] = location.id;
  }
  const npcs: Record<string, Npc> = {};
  const initialNpcStates: Record<string, NpcState> = {};
  for (const { locationId, initialState, ...npc } of Object.values(parsedNpcs)) {
    npcs[npc.id] = npc;
    npcLocationId[npc.id] = locationId;
    initialNpcStates[npc.id] = initialState;
  }
  const worldObjects: Record<string, WorldObject> = {};
  const containedIn: Placement["containedIn"] = {};
  for (const { containerId, containerPartId, ...worldObject } of Object.values(parsedWorldObjects)) {
    worldObjects[worldObject.id] = worldObject;
    if (containerId !== undefined && containerPartId !== undefined) {
      containedIn[worldObject.id] = { containerId, partId: containerPartId };
    }
  }

  const initialPartStates: Record<string, Record<string, string>> = {};
  for (const worldObject of Object.values(worldObjects)) {
    if (!worldObject.parts?.length) continue;
    initialPartStates[worldObject.id] = Object.fromEntries(worldObject.parts.map((part) => [part.id, part.defaultStateId]));
  }

  return {
    locations,
    worldObjects,
    npcs,
    labels,
    initialNpcStates,
    transitLines,
    passes,
    notebookProducts,
    facts,
    initialPlacement: { worldObjectLocationId, npcLocationId, containedIn },
    initialPartStates,
    derivedLocale: locale,
  };
}

/** Detects a containment cycle (an object ending up containing itself through a chain of containerIds) via a bounded walk from each object — see `MAX_CONTAINMENT_DEPTH`. Reports each cycle member once, not once per step of the loop. */
function checkContainmentCycles(worldObjects: Record<string, ParsedWorldObject>, errors: string[]): void {
  const reported = new Set<string>();
  for (const start of Object.values(worldObjects)) {
    if (start.containerId === undefined || reported.has(start.id)) continue;
    const seen = new Set<string>([start.id]);
    let current: ParsedWorldObject | undefined = start;
    for (let depth = 0; depth < MAX_CONTAINMENT_DEPTH; depth++) {
      const nextId: string | undefined = current?.containerId;
      if (nextId === undefined) break;
      if (seen.has(nextId)) {
        for (const id of seen) reported.add(id);
        errors.push(`item "${start.id}" has a circular containment chain (it eventually contains itself via "${nextId}").`);
        break;
      }
      seen.add(nextId);
      current = worldObjects[nextId];
    }
  }
}

// --- Per-entry validation -----------------------------------------------
// Each function returns the validated, typed entry, or `undefined` (after
// pushing one or more messages to `errors`) if it's too malformed to use.
// Validation continues past a bad entry rather than aborting immediately,
// so one pass surfaces every problem across every file, not just the first.

function validateLocation(raw: unknown, where: string, errors: string[], locale: Record<string, Record<string, string>>): ParsedLocation | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const id = expectString(raw.id, `${where}.id`, errors);
  if (id === undefined) return undefined;

  const kind = expectString(raw.kind, `${where}.kind`, errors);
  const aliases = expectStringArrayOr(raw.aliases, `${where}.aliases`, errors, []);
  const itemIds = expectStringArrayOr(raw.itemIds, `${where}.itemIds`, errors, []);
  const npcIds = expectStringArrayOr(raw.npcIds, `${where}.npcIds`, errors, []);
  const connections = expectArray(raw.connections, `${where}.connections`, errors, {}).flatMap((c, i) => {
    const connection = validateConnection(c, `${where}.connections[${i}]`, errors);
    return connection ? [connection] : [];
  });
  const fields = validateText(raw.text, where, errors, locale, `location.${id}`, ["name", "description"]);

  if (fields === undefined) return undefined;
  if (kind !== "exterior" && kind !== "interior") {
    errors.push(`${where}.kind is "${String(kind)}" — must be one of: ${[...VALID_KINDS].join(", ")}.`);
    return undefined;
  }

  const x = raw.x === undefined ? undefined : expectNumber(raw.x, `${where}.x`, errors);
  const y = raw.y === undefined ? undefined : expectNumber(raw.y, `${where}.y`, errors);
  const coords = { ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) };

  let baseVisibility: VisibilityTier | undefined;
  if (raw.baseVisibility !== undefined) {
    const value = expectString(raw.baseVisibility, `${where}.baseVisibility`, errors);
    if (value !== undefined) {
      if (!VALID_VISIBILITY_TIERS.has(value as VisibilityTier)) {
        errors.push(`${where}.baseVisibility is "${value}" — must be one of: ${[...VALID_VISIBILITY_TIERS].join(", ")}.`);
      } else {
        baseVisibility = value as VisibilityTier;
      }
    }
  }

  const image = raw.image === undefined ? undefined : validateImage(raw.image, `${where}.image`, errors, locale, `location.${id}.image`);

  const base = {
    id,
    nameKey: `location.${id}.name`,
    descriptionKey: `location.${id}.description`,
    aliases,
    itemIds,
    npcIds,
    connections,
    ...coords,
    ...(baseVisibility !== undefined ? { baseVisibility } : {}),
    ...(image !== undefined ? { image } : {}),
  };
  if (kind === "exterior") {
    if (raw.affectedByDaylight !== undefined) {
      errors.push(`${where}.affectedByDaylight is only valid on an interior location — exterior locations are always time-of-day-affected.`);
    }
    return { ...base, kind };
  }

  const exteriorId = expectString(raw.exteriorId, `${where}.exteriorId`, errors);
  if (exteriorId === undefined) return undefined;
  const floorNumber = raw.floorNumber === undefined ? undefined : expectNumber(raw.floorNumber, `${where}.floorNumber`, errors);
  const affectedByDaylight = raw.affectedByDaylight === undefined ? undefined : expectBoolean(raw.affectedByDaylight, `${where}.affectedByDaylight`, errors);
  return {
    ...base,
    kind,
    exteriorId,
    ...(floorNumber !== undefined ? { floorNumber } : {}),
    ...(affectedByDaylight !== undefined ? { affectedByDaylight } : {}),
  };
}

/**
 * Validates an optional `image:` block (see SceneImage) on a location,
 * world object, part state or NPC. Alt text and each hotspot label are
 * derived into the locale table as `<keyPrefix>.alt` /
 * `<keyPrefix>.hotspot<n>.label` (e.g. `location.alley.image.alt`) via the
 * shared `validateText`, like every other authored string.
 */
function validateImage(
  raw: unknown,
  where: string,
  errors: string[],
  locale: Record<string, Record<string, string>>,
  keyPrefix: string,
): SceneImage | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const src = expectString(raw.src, `${where}.src`, errors);
  const altFields = validateText(raw.text, where, errors, locale, keyPrefix, ["alt"]);
  const hotspots = expectArray(raw.hotspots, `${where}.hotspots`, errors, {}).flatMap((h, i) => {
    const hotspot = validateHotspot(h, `${where}.hotspots[${i}]`, errors, locale, `${keyPrefix}.hotspot${i}`);
    return hotspot ? [hotspot] : [];
  });
  if (src === undefined || altFields === undefined) return undefined;
  return { src, altKey: `${keyPrefix}.alt`, hotspots };
}

function validateHotspot(
  raw: unknown,
  where: string,
  errors: string[],
  locale: Record<string, Record<string, string>>,
  keyPrefix: string,
): Hotspot | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const command = expectString(raw.command, `${where}.command`, errors);
  const labelFields = validateText(raw.text, where, errors, locale, keyPrefix, ["label"]);
  const rect = expectArray(raw.rect, `${where}.rect`, errors, { required: true });
  if (command === undefined || labelFields === undefined) return undefined;
  if (command.trim().length === 0) {
    errors.push(`${where}.command must not be empty.`);
    return undefined;
  }
  if (rect.length !== 4) {
    if (raw.rect !== undefined) errors.push(`${where}.rect must be [x, y, w, h] — four numbers (percent of the image).`);
    return undefined;
  }
  const nums = rect.map((v, i) => expectNumber(v, `${where}.rect[${i}]`, errors));
  if (nums.some((n) => n === undefined)) return undefined;
  const [x, y, w, h] = nums as [number, number, number, number];
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 100 || y + h > 100) {
    errors.push(`${where}.rect [${nums.join(", ")}] must stay within 0-100 percent of the image (x,y >= 0, w,h > 0, x+w and y+h <= 100).`);
    return undefined;
  }
  return { labelKey: `${keyPrefix}.label`, command, x, y, w, h };
}

function validateConnection(raw: unknown, where: string, errors: string[]): Connection | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const toId = expectString(raw.toId, `${where}.toId`, errors);
  const distanceKm = expectNumber(raw.distanceKm, `${where}.distanceKm`, errors);
  const modes = expectStringArray(raw.modes, `${where}.modes`, errors)?.filter((mode) => {
    if (VALID_MODES.has(mode as TransportMode)) return true;
    errors.push(`${where}.modes has "${mode}" — must be one of: ${[...VALID_MODES].join(", ")}.`);
    return false;
  }) as TransportMode[] | undefined;

  if (toId === undefined || distanceKm === undefined || modes === undefined) return undefined;

  const connection: Connection = { toId, distanceKm, modes };
  if (raw.compassLabel !== undefined) {
    const compassLabel = expectString(raw.compassLabel, `${where}.compassLabel`, errors);
    if (compassLabel !== undefined) {
      if (!VALID_DIRECTIONS.has(compassLabel as Direction)) {
        errors.push(`${where}.compassLabel is "${compassLabel}" — must be one of: ${[...VALID_DIRECTIONS].join(", ")}.`);
      } else {
        connection.compassLabel = compassLabel as Direction;
      }
    }
  }
  if (raw.transitLineId !== undefined) {
    const transitLineId = expectString(raw.transitLineId, `${where}.transitLineId`, errors);
    if (transitLineId !== undefined) connection.transitLineId = transitLineId;
  }
  if (raw.costsMinor !== undefined) {
    if (!isRecord(raw.costsMinor)) {
      errors.push(`${where}.costsMinor is not a mapping.`);
    } else {
      const costsMinor: Partial<Record<TransportMode, number>> = {};
      for (const [mode, value] of Object.entries(raw.costsMinor)) {
        const amount = expectNumber(value, `${where}.costsMinor.${mode}`, errors);
        if (amount !== undefined) costsMinor[mode as TransportMode] = amount;
      }
      connection.costsMinor = costsMinor;
    }
  }
  if (raw.curve !== undefined) {
    if (!isRecord(raw.curve)) {
      errors.push(`${where}.curve is not a mapping.`);
    } else {
      const cx = expectNumber(raw.curve.cx, `${where}.curve.cx`, errors);
      const cy = expectNumber(raw.curve.cy, `${where}.curve.cy`, errors);
      if (cx !== undefined && cy !== undefined) connection.curve = { cx, cy };
    }
  }
  return connection;
}

function validateWorldObject(
  raw: unknown,
  where: string,
  errors: string[],
  locale: Record<string, Record<string, string>>,
): ParsedWorldObject | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const id = expectString(raw.id, `${where}.id`, errors);
  if (id === undefined) return undefined;

  const aliases = expectStringArrayOr(raw.aliases, `${where}.aliases`, errors, []);
  const kind = expectString(raw.kind, `${where}.kind`, errors);
  const portable = expectBoolean(raw.portable, `${where}.portable`, errors);
  if (kind === undefined || portable === undefined) return undefined;
  if (kind !== "item" && kind !== "setpiece") {
    errors.push(`${where}.kind is "${kind}" — must be one of: ${[...VALID_WORLD_OBJECT_KINDS].join(", ")}.`);
    return undefined;
  }

  const fields = validateText(raw.text, where, errors, locale, `${kind}.${id}`, ["name", "description"]);
  if (fields === undefined) return undefined;

  const announceOnRevisit = raw.announceOnRevisit === undefined ? undefined : expectBoolean(raw.announceOnRevisit, `${where}.announceOnRevisit`, errors);
  const parts =
    raw.parts === undefined
      ? undefined
      : expectArray(raw.parts, `${where}.parts`, errors, {}).flatMap((p, i) => {
          const part = validatePart(p, `${where}.parts[${i}]`, errors, locale, kind, id);
          return part ? [part] : [];
        });

  const image = raw.image === undefined ? undefined : validateImage(raw.image, `${where}.image`, errors, locale, `${kind}.${id}.image`);

  // containerId/containerPartId must appear together — see docs/systems/parts.md's "Containment".
  const hasContainerId = raw.containerId !== undefined;
  const hasContainerPartId = raw.containerPartId !== undefined;
  let containerId: string | undefined;
  let containerPartId: string | undefined;
  if (hasContainerId !== hasContainerPartId) {
    errors.push(`${where} has ${hasContainerId ? "containerId" : "containerPartId"} without the other — both are required together, or neither.`);
  } else if (hasContainerId && hasContainerPartId) {
    containerId = expectString(raw.containerId, `${where}.containerId`, errors);
    containerPartId = expectString(raw.containerPartId, `${where}.containerPartId`, errors);
  }

  return {
    id,
    nameKey: `${kind}.${id}.name`,
    descriptionKey: `${kind}.${id}.description`,
    aliases,
    kind,
    portable,
    ...(announceOnRevisit !== undefined ? { announceOnRevisit } : {}),
    ...(parts !== undefined ? { parts } : {}),
    ...(image !== undefined ? { image } : {}),
    ...(containerId !== undefined ? { containerId } : {}),
    ...(containerPartId !== undefined ? { containerPartId } : {}),
  };
}

function validatePart(
  raw: unknown,
  where: string,
  errors: string[],
  locale: Record<string, Record<string, string>>,
  objectKind: string,
  objectId: string,
): Part | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const id = expectString(raw.id, `${where}.id`, errors);
  if (id === undefined) return undefined;

  const aliases = expectStringArrayOr(raw.aliases, `${where}.aliases`, errors, []);
  const keyPrefix = `${objectKind}.${objectId}.${id}`;
  const fields = validateText(raw.text, where, errors, locale, keyPrefix, ["name", "description"]);
  const states = expectArray(raw.states, `${where}.states`, errors, { required: true }).flatMap((s, i) => {
    const state = validatePartState(s, `${where}.states[${i}]`, errors, locale, objectKind, objectId, id);
    return state ? [state] : [];
  });
  const defaultStateId = expectString(raw.defaultStateId, `${where}.defaultStateId`, errors);
  if (fields === undefined || defaultStateId === undefined) return undefined;
  if (states.length === 0) {
    errors.push(`${where}.states must have at least one entry.`);
    return undefined;
  }
  if (!states.some((s) => s.id === defaultStateId)) {
    errors.push(`${where}.defaultStateId is "${defaultStateId}", which doesn't match any of this part's states.`);
    return undefined;
  }
  return { id, nameKey: `${keyPrefix}.name`, descriptionKey: `${keyPrefix}.description`, aliases, states, defaultStateId };
}

function validatePartState(
  raw: unknown,
  where: string,
  errors: string[],
  locale: Record<string, Record<string, string>>,
  objectKind: string,
  objectId: string,
  partId: string,
): PartState | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const id = expectString(raw.id, `${where}.id`, errors);
  if (id === undefined) return undefined;

  const keyPrefix = `${objectKind}.${objectId}.${partId}.${id}`;
  const fields = validateText(raw.text, where, errors, locale, keyPrefix, ["name", "description"]);
  if (fields === undefined) return undefined;

  const important = raw.important === undefined ? undefined : expectBoolean(raw.important, `${where}.important`, errors);
  const enterAliases = raw.enterAliases === undefined ? undefined : expectStringArray(raw.enterAliases, `${where}.enterAliases`, errors);
  const exposesContents = raw.exposesContents === undefined ? undefined : expectBoolean(raw.exposesContents, `${where}.exposesContents`, errors);
  const revealInAmbientListing =
    raw.revealInAmbientListing === undefined ? undefined : expectBoolean(raw.revealInAmbientListing, `${where}.revealInAmbientListing`, errors);
  const image = raw.image === undefined ? undefined : validateImage(raw.image, `${where}.image`, errors, locale, `${keyPrefix}.image`);
  return {
    id,
    nameKey: `${keyPrefix}.name`,
    descriptionKey: `${keyPrefix}.description`,
    ...(image !== undefined ? { image } : {}),
    ...(fields.has("summary") ? { summaryKey: `${keyPrefix}.summary` } : {}),
    ...(important !== undefined ? { important } : {}),
    ...(enterAliases !== undefined ? { enterAliases } : {}),
    ...(exposesContents !== undefined ? { exposesContents } : {}),
    ...(revealInAmbientListing !== undefined ? { revealInAmbientListing } : {}),
  };
}

function validateNpc(raw: unknown, where: string, errors: string[], locale: Record<string, Record<string, string>>): ParsedNpc | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const id = expectString(raw.id, `${where}.id`, errors);
  if (id === undefined) return undefined;

  const aliases = expectStringArrayOr(raw.aliases, `${where}.aliases`, errors, []);
  const locationId = expectString(raw.locationId, `${where}.locationId`, errors);
  const fields = validateText(raw.text, where, errors, locale, `npc.${id}`, ["name", "description", "dialogue"]);
  if (fields === undefined || locationId === undefined) return undefined;

  let stats: StatBlock | undefined;
  if (raw.stats !== undefined) {
    if (!isRecord(raw.stats)) {
      errors.push(`${where}.stats is not a mapping.`);
    } else {
      stats = {};
      for (const [key, value] of Object.entries(raw.stats)) {
        if (!VALID_STAT_KEYS.has(key as StatKey)) {
          errors.push(`${where}.stats has unknown key "${key}" — must be one of: ${[...VALID_STAT_KEYS].join(", ")}.`);
          continue;
        }
        const num = expectNumber(value, `${where}.stats.${key}`, errors);
        if (num === undefined) continue;
        const def = STAT_DEFINITIONS[key as StatKey];
        if (num < def.min || num > def.max) {
          errors.push(`${where}.stats.${key} is ${num} — must be between ${def.min} and ${def.max}.`);
          continue;
        }
        stats[key as StatKey] = num;
      }
    }
  }

  const image = raw.image === undefined ? undefined : validateImage(raw.image, `${where}.image`, errors, locale, `npc.${id}.image`);
  const dialogueRules = parseRuleList(raw.dialogueRules, `${where}.dialogueRules`, `npc.${id}.dialogue`, errors, locale);
  const topics = raw.topics === undefined ? undefined : parseTopics(raw.topics, id, `${where}.topics`, errors, locale);

  const labels = expectStringArrayOr(raw.labels, `${where}.labels`, errors, []);
  const schedule = raw.schedule === undefined ? undefined : parseSchedule(raw.schedule, `${where}.schedule`, errors);

  const trust = raw.trust === undefined ? 0 : expectNumber(raw.trust, `${where}.trust`, errors) ?? 0;
  const suspicion = raw.suspicion === undefined ? 0 : expectNumber(raw.suspicion, `${where}.suspicion`, errors) ?? 0;

  const knowledge: Record<string, KnowledgeDisposition> = {};
  if (raw.knowledge !== undefined) {
    if (!isRecord(raw.knowledge)) {
      errors.push(`${where}.knowledge is not a mapping.`);
    } else {
      for (const [factId, disposition] of Object.entries(raw.knowledge)) {
        if (typeof disposition !== "string" || !VALID_KNOWLEDGE.has(disposition)) {
          errors.push(`${where}.knowledge.${factId} must be one of: ${[...VALID_KNOWLEDGE].join(", ")}.`);
          continue;
        }
        knowledge[factId] = disposition as KnowledgeDisposition;
      }
    }
  }

  // Authored memories are pre-game history: atMinutes 0, neutral valence.
  const memories: Memory[] = [];
  expectArray(raw.memories, `${where}.memories`, errors, {}).forEach((rawMemory, i) => {
    if (typeof rawMemory !== "string") {
      errors.push(`${where}.memories[${i}] must be a string like "npc:barkeep saw player @docks".`);
      return;
    }
    const parsed = parseMemoryShorthand(rawMemory);
    if ("error" in parsed) {
      errors.push(`${where}.memories[${i}]: ${parsed.error}`);
      return;
    }
    memories.push({ ...parsed, atMinutes: 0, source: "inferred", valence: 0 });
  });

  return {
    id,
    nameKey: `npc.${id}.name`,
    descriptionKey: `npc.${id}.description`,
    dialogueKey: `npc.${id}.dialogue`,
    dialogueRules,
    aliases,
    labels,
    locationId,
    initialState: { trust, suspicion, memories, opinions: {}, knowledge },
    ...(schedule !== undefined ? { schedule } : {}),
    ...(stats !== undefined ? { stats } : {}),
    ...(topics !== undefined ? { topics } : {}),
    ...(image !== undefined ? { image } : {}),
  };
}

/**
 * Parses an ordered list of `DialogueRule`s — shared by `Npc.dialogueRules`
 * and each `DialogueTopic.responses` (see docs/systems/dialogue.md's
 * "Topic menus" section). `keyPrefix` is where each rule's `text` gets
 * registered, index-suffixed (`npc.<id>.dialogue.<n>` or
 * `npc.<id>.topic.<topicId>.response.<n>`).
 */
function parseRuleList(
  raw: unknown,
  where: string,
  keyPrefix: string,
  errors: string[],
  locale: Record<string, Record<string, string>>,
): DialogueRule[] {
  const rules: DialogueRule[] = [];
  const rawRules = expectArray(raw, where, errors, { required: false });
  rawRules.forEach((rawRule, i) => {
    if (!isRecord(rawRule)) {
      errors.push(`${where}[${i}] is not a mapping.`);
      return;
    }
    const requires = expectStringArrayOr(rawRule.requires, `${where}[${i}].requires`, errors, []);
    const when = rawRule.when === undefined ? undefined : parseCondition(rawRule.when, `${where}[${i}].when`, errors);
    if (requires.length === 0 && rawRule.when === undefined) {
      errors.push(`${where}[${i}].requires must be a non-empty list (or the rule needs a "when" condition).`);
    }
    if (!isRecord(rawRule.text)) {
      errors.push(`${where}[${i}].text is not a mapping.`);
      return;
    }
    const textKey = `${keyPrefix}.${i}`;
    for (const [lang, value] of Object.entries(rawRule.text)) {
      if (typeof value !== "string" || value.length === 0) {
        errors.push(`${where}[${i}].text.${lang} must be a non-empty string.`);
        continue;
      }
      (locale[lang] ??= {})[textKey] = value;
    }
    const effects = rawRule.effects === undefined ? undefined : parseDialogueEffects(rawRule.effects, `${where}[${i}].effects`, errors);
    rules.push({ requires, ...(when !== undefined ? { when } : {}), textKey, ...(effects !== undefined ? { effects } : {}) });
  });
  return rules;
}

/**
 * Parses an NPC's `topics:` list — see `DialogueTopic` and
 * docs/systems/dialogue.md's "Topic menus" section. Each topic's `requires`/
 * `when` gates whether it's OFFERED at all; its `responses` (a nested
 * `DialogueRule` list, via `parseRuleList`) picks the answer once asked.
 */
function parseTopics(
  raw: unknown,
  npcId: string,
  where: string,
  errors: string[],
  locale: Record<string, Record<string, string>>,
): DialogueTopic[] | undefined {
  if (!Array.isArray(raw)) {
    errors.push(`${where} must be a list.`);
    return undefined;
  }
  const topics: DialogueTopic[] = [];
  raw.forEach((rawTopic, i) => {
    const at = `${where}[${i}]`;
    if (!isRecord(rawTopic)) {
      errors.push(`${at} is not a mapping.`);
      return;
    }
    const id = expectString(rawTopic.id, `${at}.id`, errors);
    if (id === undefined) return;

    // Unlike a dialogueRules entry (where an always-true override is just
    // redundant with dialogueKey), an always-OFFERED topic is legitimate
    // content — e.g. "ask about herself" with no gating at all — so, unlike
    // parseRuleList, empty requires + no when is not an error here.
    const requires = expectStringArrayOr(rawTopic.requires, `${at}.requires`, errors, []);
    const when = rawTopic.when === undefined ? undefined : parseCondition(rawTopic.when, `${at}.when`, errors);

    const keyPrefix = `npc.${npcId}.topic.${id}`;
    const fields = validateText(rawTopic.text, at, errors, locale, keyPrefix, ["label", "dialogue"]);
    if (fields === undefined) return;

    const responses = parseRuleList(rawTopic.responses, `${at}.responses`, `${keyPrefix}.response`, errors, locale);
    topics.push({
      id,
      labelKey: `${keyPrefix}.label`,
      textKey: `${keyPrefix}.dialogue`,
      requires,
      ...(when !== undefined ? { when } : {}),
      responses,
    });
  });
  return topics;
}

const VALID_KNOWLEDGE: ReadonlySet<string> = new Set(["knows", "conceals", "lies", "unaware"]);
const VALID_OPS: ReadonlySet<string> = new Set(["<", "<=", ">", ">=", "==", "!="]);

function validateLabel(raw: unknown, where: string, errors: string[], locale: Record<string, Record<string, string>>): NpcLabel | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const id = expectString(raw.id, `${where}.id`, errors);
  if (id === undefined) return undefined;
  const fields = validateText(raw.text, where, errors, locale, `label.${id}`, ["name"]);
  const trustOffset = raw.trustOffset === undefined ? 0 : expectNumber(raw.trustOffset, `${where}.trustOffset`, errors) ?? 0;
  const labelOpinions: Record<string, number> = {};
  if (raw.labelOpinions !== undefined) {
    if (!isRecord(raw.labelOpinions)) {
      errors.push(`${where}.labelOpinions is not a mapping.`);
    } else {
      for (const [otherId, value] of Object.entries(raw.labelOpinions)) {
        const num = expectNumber(value, `${where}.labelOpinions.${otherId}`, errors);
        if (num !== undefined) labelOpinions[otherId] = num;
      }
    }
  }
  if (fields === undefined) return undefined;
  return { id, nameKey: `label.${id}.name`, trustOffset, labelOpinions };
}

/**
 * Parses one `facts:` entry: `{ id, text: { en: "...", ... } }`. Unlike most
 * entities' `text` block (a mapping of NAMED fields per language —
 * `{ en: { name: "...", description: "..." } }`), a fact's `text` block is
 * a single string per language directly, since a fact has exactly one
 * player-facing field — see docs/content-schema.md. `textKey` is the bare
 * `fact.<id>` (no field suffix) as a result.
 */
function validateFact(raw: unknown, where: string, errors: string[], locale: Record<string, Record<string, string>>): Fact | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const id = expectString(raw.id, `${where}.id`, errors);
  if (id === undefined) return undefined;

  if (!isRecord(raw.text)) {
    errors.push(`"${where}.text" is required and must be a mapping.`);
    return undefined;
  }
  const baseline = raw.text[BASELINE_LANGUAGE];
  if (typeof baseline !== "string" || baseline.length === 0) {
    errors.push(`"${where}.text.${BASELINE_LANGUAGE}" is required and must be a non-empty string.`);
    return undefined;
  }
  const textKey = `fact.${id}`;
  for (const [lang, value] of Object.entries(raw.text)) {
    if (typeof value !== "string" || value.length === 0) {
      errors.push(`"${where}.text.${lang}" must be a non-empty string.`);
      continue;
    }
    (locale[lang] ??= {})[textKey] = value;
  }
  return { id, textKey };
}

/** Parses an NPC's `schedule:` list — each entry `{ fromHour, toHour, locationId, weekdays? }`. */
function parseSchedule(raw: unknown, where: string, errors: string[]): ScheduleSlot[] | undefined {
  if (!Array.isArray(raw)) {
    errors.push(`${where} must be a list.`);
    return undefined;
  }
  const slots: ScheduleSlot[] = [];
  raw.forEach((rawSlot, i) => {
    const at = `${where}[${i}]`;
    if (!isRecord(rawSlot)) {
      errors.push(`${at} is not a mapping.`);
      return;
    }
    const fromHour = expectNumber(rawSlot.fromHour, `${at}.fromHour`, errors);
    const toHour = expectNumber(rawSlot.toHour, `${at}.toHour`, errors);
    const locationId = expectString(rawSlot.locationId, `${at}.locationId`, errors);
    if (fromHour !== undefined && (!Number.isInteger(fromHour) || fromHour < 0 || fromHour > 23)) {
      errors.push(`${at}.fromHour must be an integer 0-23.`);
    }
    if (toHour !== undefined && (!Number.isInteger(toHour) || toHour < 0 || toHour > 24)) {
      errors.push(`${at}.toHour must be an integer 0-24.`);
    }
    let weekdays: number[] | undefined;
    if (rawSlot.weekdays !== undefined) {
      if (!Array.isArray(rawSlot.weekdays) || !rawSlot.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
        errors.push(`${at}.weekdays must be a list of integers 0 (Sunday) to 6 (Saturday).`);
      } else {
        weekdays = rawSlot.weekdays as number[];
      }
    }
    if (fromHour === undefined || toHour === undefined || locationId === undefined) return;
    slots.push({ fromHour, toHour, locationId, ...(weekdays ? { weekdays } : {}) });
  });
  return slots;
}

/**
 * Parses a structured `Condition` from YAML — see `Condition` in
 * engine/types.ts and docs/systems/npcs.md for the shapes. Exactly one
 * discriminating key per mapping (`flag`, `not`, `all`, `any`, `npcStat`,
 * `knows`, `memory`, `hasLabel`, `reputation`, `playerKnows`). Returns
 * undefined after pushing errors, so validation can keep going.
 */
function parseCondition(raw: unknown, where: string, errors: string[]): Condition | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const readOp = (): ComparisonOp | undefined => {
    if (typeof raw.op !== "string" || !VALID_OPS.has(raw.op)) {
      errors.push(`${where}.op must be one of: ${[...VALID_OPS].join(" ")}.`);
      return undefined;
    }
    return raw.op as ComparisonOp;
  };
  if (raw.flag !== undefined) {
    const flag = expectString(raw.flag, `${where}.flag`, errors);
    return flag === undefined ? undefined : { flag };
  }
  if (raw.not !== undefined) {
    const inner = parseCondition(raw.not, `${where}.not`, errors);
    return inner === undefined ? undefined : { not: inner };
  }
  for (const key of ["all", "any"] as const) {
    if (raw[key] === undefined) continue;
    if (!Array.isArray(raw[key])) {
      errors.push(`${where}.${key} must be a list of conditions.`);
      return undefined;
    }
    const inner = (raw[key] as unknown[]).map((c, i) => parseCondition(c, `${where}.${key}[${i}]`, errors));
    if (inner.some((c) => c === undefined)) return undefined;
    return key === "all" ? { all: inner as Condition[] } : { any: inner as Condition[] };
  }
  if (raw.npcStat !== undefined) {
    if (raw.npcStat !== "trust" && raw.npcStat !== "suspicion" && raw.npcStat !== "opinionOfPlayer") {
      errors.push(`${where}.npcStat must be one of: trust, suspicion, opinionOfPlayer.`);
      return undefined;
    }
    const op = readOp();
    const value = expectNumber(raw.value, `${where}.value`, errors);
    return op === undefined || value === undefined ? undefined : { npcStat: raw.npcStat, op, value };
  }
  if (raw.knows !== undefined) {
    const fact = expectString(raw.knows, `${where}.knows`, errors);
    return fact === undefined ? undefined : { knows: fact };
  }
  if (raw.memory !== undefined) {
    const pattern = parseMemoryPattern(raw.memory, `${where}.memory`, errors);
    return pattern === undefined ? undefined : { memory: pattern };
  }
  if (raw.hasLabel !== undefined) {
    const label = expectString(raw.hasLabel, `${where}.hasLabel`, errors);
    return label === undefined ? undefined : { hasLabel: label };
  }
  if (raw.reputation !== undefined) {
    const scope = expectString(raw.reputation, `${where}.reputation`, errors);
    const op = readOp();
    const value = expectNumber(raw.value, `${where}.value`, errors);
    return scope === undefined || op === undefined || value === undefined ? undefined : { reputation: { scope, op, value } };
  }
  if (raw.playerKnows !== undefined) {
    const fact = expectString(raw.playerKnows, `${where}.playerKnows`, errors);
    return fact === undefined ? undefined : { playerKnows: fact };
  }
  errors.push(`${where} must have one of: flag, not, all, any, npcStat, knows, memory, hasLabel, reputation, playerKnows.`);
  return undefined;
}

/**
 * Parses a dialogue rule's `effects:` list — each entry a mapping with
 * exactly one of `trust`, `suspicion`, `opinion`, `reputation`, `setFlag`,
 * `knowledge`, `memory`, `learnFact` (see `DialogueEffect`). Returns
 * undefined after pushing errors if any entry is bad.
 */
function parseDialogueEffects(raw: unknown, where: string, errors: string[]): DialogueEffect[] | undefined {
  if (!Array.isArray(raw)) {
    errors.push(`${where} must be a list.`);
    return undefined;
  }
  const effects: DialogueEffect[] = [];
  let ok = true;
  raw.forEach((entry, i) => {
    const at = `${where}[${i}]`;
    if (!isRecord(entry)) {
      errors.push(`${at} is not a mapping.`);
      ok = false;
      return;
    }
    const keys = Object.keys(entry);
    if (keys.length !== 1) {
      errors.push(`${at} must have exactly one of: trust, suspicion, opinion, reputation, setFlag, knowledge, memory, learnFact.`);
      ok = false;
      return;
    }
    const key = keys[0]!;
    const value = entry[key];
    let effect: DialogueEffect | undefined;
    if (key === "trust" || key === "suspicion") {
      const n = expectNumber(value, `${at}.${key}`, errors);
      if (n !== undefined) effect = key === "trust" ? { trust: n } : { suspicion: n };
    } else if (key === "setFlag") {
      const flag = expectString(value, `${at}.setFlag`, errors);
      if (flag !== undefined) effect = { setFlag: flag };
    } else if (key === "learnFact") {
      const fact = expectString(value, `${at}.learnFact`, errors);
      if (fact !== undefined) effect = { learnFact: fact };
    } else if (key === "opinion" || key === "reputation" || key === "knowledge") {
      if (!isRecord(value)) {
        errors.push(`${at}.${key} is not a mapping.`);
      } else if (key === "opinion") {
        const subject = expectString(value.subject, `${at}.opinion.subject`, errors);
        const delta = expectNumber(value.delta, `${at}.opinion.delta`, errors);
        if (subject !== undefined && delta !== undefined) effect = { opinion: { subject, delta } };
      } else if (key === "reputation") {
        const scope = expectString(value.scope, `${at}.reputation.scope`, errors);
        const delta = expectNumber(value.delta, `${at}.reputation.delta`, errors);
        if (scope !== undefined && delta !== undefined) effect = { reputation: { scope, delta } };
      } else {
        const fact = expectString(value.fact, `${at}.knowledge.fact`, errors);
        if (typeof value.disposition !== "string" || !VALID_KNOWLEDGE.has(value.disposition)) {
          errors.push(`${at}.knowledge.disposition must be one of: ${[...VALID_KNOWLEDGE].join(", ")}.`);
        } else if (fact !== undefined) {
          effect = { knowledge: { fact, disposition: value.disposition as KnowledgeDisposition } };
        }
      }
    } else if (key === "memory") {
      if (typeof value !== "string") {
        errors.push(`${at}.memory must be a string like "npc:barkeep saw player @docks".`);
      } else {
        const parsed = parseMemoryShorthand(value);
        if ("error" in parsed) errors.push(`${at}.memory: ${parsed.error}`);
        else effect = { memory: parsed };
      }
    } else {
      errors.push(`${at} has unknown effect "${key}" — must be one of: trust, suspicion, opinion, reputation, setFlag, knowledge, memory, learnFact.`);
    }
    if (effect === undefined) ok = false;
    else effects.push(effect);
  });
  return ok ? effects : undefined;
}

/** A memory pattern's YAML form: `{ verb?, subject?, object?, locationId?, withinMinutes? }`, with `subject`/`object` as ref tokens ("player", "npc:barkeep"). */
function parseMemoryPattern(raw: unknown, where: string, errors: string[]): MemoryPattern | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const pattern: MemoryPattern = {};
  let ok = true;
  if (raw.verb !== undefined) {
    if (typeof raw.verb !== "string" || !(MEMORY_VERBS as readonly string[]).includes(raw.verb)) {
      errors.push(`${where}.verb must be one of: ${MEMORY_VERBS.join(", ")}.`);
      ok = false;
    } else {
      pattern.verb = raw.verb as MemoryPattern["verb"];
    }
  }
  for (const key of ["subject", "object"] as const) {
    if (raw[key] === undefined) continue;
    const ref = typeof raw[key] === "string" ? parseRef(raw[key] as string) : `${where}.${key} must be a string like "npc:barkeep".`;
    if (typeof ref === "string") {
      errors.push(ref.startsWith(where) ? ref : `${where}.${key}: ${ref}`);
      ok = false;
    } else {
      pattern[key] = ref;
    }
  }
  if (raw.locationId !== undefined) {
    const loc = expectString(raw.locationId, `${where}.locationId`, errors);
    if (loc === undefined) ok = false;
    else pattern.locationId = loc;
  }
  if (raw.withinMinutes !== undefined) {
    const within = expectNumber(raw.withinMinutes, `${where}.withinMinutes`, errors);
    if (within === undefined) ok = false;
    else pattern.withinMinutes = within;
  }
  return ok ? pattern : undefined;
}

/** Referential checks a condition can't do while parsing: label/fact ids must exist. */
function checkConditionReferences(
  condition: Condition,
  where: string,
  labels: Record<string, NpcLabel>,
  facts: Record<string, Fact>,
  errors: string[],
): void {
  if ("not" in condition) checkConditionReferences(condition.not, where, labels, facts, errors);
  else if ("all" in condition) condition.all.forEach((c) => checkConditionReferences(c, where, labels, facts, errors));
  else if ("any" in condition) condition.any.forEach((c) => checkConditionReferences(c, where, labels, facts, errors));
  else if ("hasLabel" in condition && !labels[condition.hasLabel]) {
    errors.push(`${where} references label "${condition.hasLabel}", which has no entry in labels.`);
  } else if ("reputation" in condition && condition.reputation.scope !== "global" && !labels[condition.reputation.scope]) {
    errors.push(`${where} references reputation scope "${condition.reputation.scope}", which is neither "global" nor a label.`);
  } else if ("playerKnows" in condition && !facts[condition.playerKnows]) {
    errors.push(`${where} references fact "${condition.playerKnows}", which has no entry in facts.`);
  }
}

function validateTransitLine(raw: unknown, where: string, errors: string[], locale: Record<string, Record<string, string>>): TransitLine | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const id = expectString(raw.id, `${where}.id`, errors);
  if (id === undefined) return undefined;

  const fareMinor = expectNumber(raw.fareMinor, `${where}.fareMinor`, errors);
  const fields = validateText(raw.text, where, errors, locale, `line.${id}`, ["name"]);
  if (fields === undefined || fareMinor === undefined) return undefined;
  return { id, nameKey: `line.${id}.name`, fareMinor };
}

function validatePass(raw: unknown, where: string, errors: string[], locale: Record<string, Record<string, string>>): Pass | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const id = expectString(raw.id, `${where}.id`, errors);
  if (id === undefined) return undefined;

  const aliases = expectStringArrayOr(raw.aliases, `${where}.aliases`, errors, []);
  const priceMinor = expectNumber(raw.priceMinor, `${where}.priceMinor`, errors);
  const durationDays = expectNumber(raw.durationDays, `${where}.durationDays`, errors);
  const lineIds = expectStringArrayOr(raw.lineIds, `${where}.lineIds`, errors, []);
  const fields = validateText(raw.text, where, errors, locale, `pass.${id}`, ["name"]);
  if (fields === undefined || priceMinor === undefined || durationDays === undefined) return undefined;
  return { id, nameKey: `pass.${id}.name`, aliases, priceMinor, durationDays, lineIds };
}

function validateNotebookProduct(
  raw: unknown,
  where: string,
  errors: string[],
  locale: Record<string, Record<string, string>>,
): NotebookProduct | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const id = expectString(raw.id, `${where}.id`, errors);
  if (id === undefined) return undefined;

  const aliases = expectStringArrayOr(raw.aliases, `${where}.aliases`, errors, []);
  const priceMinor = expectNumber(raw.priceMinor, `${where}.priceMinor`, errors);
  const pageCount = expectNumber(raw.pageCount, `${where}.pageCount`, errors);
  const charCapacity = expectNumber(raw.charCapacity, `${where}.charCapacity`, errors);
  const fields = validateText(raw.text, where, errors, locale, `notebookProduct.${id}`, ["name"]);
  if (fields === undefined || priceMinor === undefined || pageCount === undefined || charCapacity === undefined) {
    return undefined;
  }
  return { id, nameKey: `notebookProduct.${id}.name`, aliases, priceMinor, pageCount, charCapacity };
}

/**
 * Validates an entity's `text: { en: {...}, ... }` block (see this file's
 * doc comment): `text.en.<field>` must exist as a non-empty string for
 * every field in `requiredFields`; any OTHER language block is accepted
 * as-is, whatever fields it happens to have (completeness across
 * languages is deliberately not enforced here — see
 * `i18n/translationCoverage.test.ts`). Every field found, in every
 * language present, is recorded into `locale[lang][keyPrefix.field]` as a
 * side effect. Returns the SET of field names present in baseline
 * (letting callers detect an authored-but-optional field, e.g.
 * `PartState`'s `summary`), or `undefined` if the block is missing/
 * malformed/missing a required field.
 */
export function validateText(
  rawText: unknown,
  where: string,
  errors: string[],
  locale: Record<string, Record<string, string>>,
  keyPrefix: string,
  requiredFields: readonly string[],
): Set<string> | undefined {
  if (!isRecord(rawText)) {
    errors.push(`"${where}.text" is required and must be a mapping.`);
    return undefined;
  }
  const baseline = rawText[BASELINE_LANGUAGE];
  if (!isRecord(baseline)) {
    errors.push(`"${where}.text.${BASELINE_LANGUAGE}" is required and must be a mapping.`);
    return undefined;
  }

  let missingRequired = false;
  for (const field of requiredFields) {
    const value = baseline[field];
    if (typeof value !== "string" || value.length === 0) {
      errors.push(`"${where}.text.${BASELINE_LANGUAGE}.${field}" is required and must be a non-empty string.`);
      missingRequired = true;
    }
  }
  if (missingRequired) return undefined;

  const baselineFields = new Set<string>();
  for (const [lang, block] of Object.entries(rawText)) {
    if (!isRecord(block)) {
      errors.push(`"${where}.text.${lang}" must be a mapping.`);
      continue;
    }
    for (const [field, value] of Object.entries(block)) {
      if (typeof value !== "string" || value.length === 0) {
        errors.push(`"${where}.text.${lang}.${field}" must be a non-empty string.`);
        continue;
      }
      (locale[lang] ??= {})[`${keyPrefix}.${field}`] = value;
      if (lang === BASELINE_LANGUAGE) baselineFields.add(field);
    }
  }
  return baselineFields;
}

// --- Shared plumbing ------------------------------------------------------
// Exported (not just used internally) so `content/prefabLoader.ts` — the
// EDITOR-ONLY loader for location prefabs, see that file's doc comment —
// can validate the same bare-YAML-array-of-mappings shape and inline
// `text: {...}` convention without duplicating this logic. Prefabs are
// never loaded by the game itself, only by `src/editor/main.ts`.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads `field` off `raw` as an array, defaulting to `[]` unless `required`. Pushes an error and returns `[]` if present but not actually an array, so callers can keep validating rather than crash on a malformed document. */
export function expectArray(value: unknown, field: string, errors: string[], opts: { required?: boolean }): unknown[] {
  if (value === undefined) {
    if (opts.required) errors.push(`"${field}" is required.`);
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push(`"${field}" must be a list.`);
    return [];
  }
  return value;
}

export function expectString(value: unknown, field: string, errors: string[]): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`"${field}" is required and must be a non-empty string.`);
    return undefined;
  }
  return value;
}

function expectNumber(value: unknown, field: string, errors: string[]): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`"${field}" is required and must be a number.`);
    return undefined;
  }
  return value;
}

function expectBoolean(value: unknown, field: string, errors: string[]): boolean | undefined {
  if (typeof value !== "boolean") {
    errors.push(`"${field}" is required and must be true/false.`);
    return undefined;
  }
  return value;
}

/** A required list of strings — pushes an error and returns `undefined` if the field is missing or not actually a list of strings. */
function expectStringArray(value: unknown, field: string, errors: string[]): string[] | undefined {
  if (value === undefined) {
    errors.push(`"${field}" is required.`);
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    errors.push(`"${field}" must be a list of strings.`);
    return undefined;
  }
  return value;
}

/** An OPTIONAL list of strings — `fallback` (typically `[]`) is used silently when the field is entirely absent, so authors don't have to write empty lists for every location with no items/NPCs. Still errors (returning `fallback`, so validation can continue) if the field is present but malformed. */
export function expectStringArrayOr(value: unknown, field: string, errors: string[], fallback: string[]): string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    errors.push(`"${field}" must be a list of strings.`);
    return fallback;
  }
  return value;
}

/** Pairs each raw array entry with a `"${label}[i]"` location tag — the uniform shape `buildById` expects, used for world.yaml's flat npcs/transitLines/passes arrays (which don't come from `collectFileEntries`). */
export function tagEntries(rawEntries: unknown[], label: string): { raw: unknown; where: string }[] {
  return rawEntries.map((raw, i) => ({ raw, where: `${label}[${i}]` }));
}

/**
 * Reads every file in `files` (path -> YAML text), each expected to be a
 * bare YAML array at the document root (no wrapping key — see this
 * module's doc comment), and flattens them into one list of entries
 * tagged with their source file + index (e.g. `"objects/desk.yaml[0]"`)
 * for error messages. An empty file is skipped silently (no empty-array
 * boilerplate required); a file whose root isn't a list is one error, not
 * a crash, so the rest of the batch still gets checked.
 */
export function collectFileEntries(files: Record<string, string>, category: string, errors: string[]): { raw: unknown; where: string }[] {
  const entries: { raw: unknown; where: string }[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (text.trim() === "") continue;
    let root: unknown;
    try {
      root = parseYaml(text);
    } catch (err) {
      errors.push(`${path}: invalid YAML — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (root === null || root === undefined) continue;
    if (!Array.isArray(root)) {
      errors.push(`${path}: must be a YAML list of ${category} at the document root.`);
      continue;
    }
    root.forEach((raw, i) => entries.push({ raw, where: `${path}[${i}]` }));
  }
  return entries;
}

/** Validates every entry via `validate`, keyed by its own `id` into a Record — mirroring the `Object.fromEntries` step `content/world.ts` used to do for hardcoded arrays. Pushes an error on a duplicate id (silently overwriting, as `Object.fromEntries` would, hides a real authoring mistake) — duplicates can now span different FILES, which is exactly the case this guards against. */
export function buildById<T extends { id: string }>(
  entries: { raw: unknown; where: string }[],
  category: string,
  errors: string[],
  validate: (raw: unknown, where: string, errors: string[]) => T | undefined,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const { raw, where } of entries) {
    const entry = validate(raw, where, errors);
    if (!entry) continue;
    if (result[entry.id]) {
      errors.push(`${category} has more than one entry with id "${entry.id}" (duplicate at ${where}).`);
      continue;
    }
    result[entry.id] = entry;
  }
  return result;
}

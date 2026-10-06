import { buildById, collectFileEntries, expectString, expectStringArrayOr, isRecord, validateText } from "./cityLoader";

/**
 * Parses and validates `content/prefabs/*.yaml` — a location prefab is a
 * reusable TEMPLATE for a location (a description plus a starting
 * decoration of world objects/NPCs) that isn't itself part of the live
 * city graph: it has no `x`/`y`, no `connections`, no `exteriorId`, and
 * `parseCity`/the game never load it. It's authored and consumed ENTIRELY
 * by the map editor's "Prefabs" tab (`src/editor/main.ts`) — see
 * `docs/architecture.md`'s "The location prefab editor" — as the source
 * material for the planned "stamp a prefab into the world" flow (Phase 3
 * of the worldObject/prefab editor plan), which will clone a prefab's
 * decoration into fresh world-object/NPC placements at a NEW, freshly-
 * assigned location id — never a live link back to the prefab.
 *
 * Deliberately reuses `cityLoader.ts`'s generic validation plumbing
 * (`isRecord`/`expectString`/`expectArray`/`expectStringArrayOr`/
 * `validateText`/`collectFileEntries`/`buildById`) rather than
 * duplicating it — a prefab file is the exact same "bare YAML array of
 * mappings, each with inline `text: { en: {...} }`" shape every other
 * content category already uses (see `docs/content-schema.md`).
 *
 * A prefab's `worldObjectIds`/`npcIds` reference EXISTING catalog entries
 * (authored via the Objects tab / hand-edited `world.yaml`) — a prefab
 * doesn't embed its own object/NPC definitions. This keeps prefabs
 * lightweight ("decorate this location template with objects/NPCs that
 * already exist") but means, per the Phase 3 plan, that "stamping" the
 * SAME prefab more than once will need to CLONE each referenced
 * object/NPC under a fresh id for every stamp (an object can only ever be
 * placed in one `Placement` slot at a time — see `engine/types.ts`'s
 * `Placement` doc comment) rather than reusing the referenced id
 * directly. That cloning logic is out of scope here — this module only
 * validates that the referenced ids exist in the currently loaded
 * catalog, via `knownWorldObjectIds`/`knownNpcIds`.
 */

export type PrefabId = string;

export interface LocationPrefab {
  id: PrefabId;
  /** Same two kinds a real Location can be — determines what the instantiated location will need (an exteriorId, for "interior") once Phase 3 exists. */
  kind: "exterior" | "interior";
  nameKey: string;
  descriptionKey: string;
  /** Copied verbatim onto the instantiated Location's own aliases — see this file's doc comment on cloning. */
  aliases: string[];
  /** Existing `WorldObject` ids (from the loaded object catalog) this prefab decorates its instantiated location with. */
  worldObjectIds: WorldObjectId[];
  /** Existing `Npc` ids this prefab decorates its instantiated location with — e.g. a handful of NPCs picked to read as a "crowd." */
  npcIds: NpcId[];
}

type WorldObjectId = string;
type NpcId = string;

export interface PrefabSourceFiles {
  /** path -> YAML text, each document a bare array of `LocationPrefab` entries — see this file's doc comment. */
  prefabFiles: Record<string, string>;
}

export interface PrefabContent {
  prefabs: Record<PrefabId, LocationPrefab>;
  /** `{ language: { derivedKey: text } }` for every prefab's inline `text:` block — same shape/convention as `CityContent.derivedLocale`, registered nowhere at runtime (prefabs aren't game content) but read back by the editor to populate its form fields, same as `city.derivedLocale` is for locations/objects. */
  derivedLocale: Record<string, Record<string, string>>;
}

const VALID_KINDS = new Set(["exterior", "interior"]);

/**
 * Parses every prefab file, validating structure AND that every
 * `worldObjectIds`/`npcIds` reference actually exists in the currently
 * loaded catalog (`knownWorldObjectIds`/`knownNpcIds` — the editor passes
 * `Object.keys(city.worldObjects)`/`Object.keys(city.npcs)`). Throws ONE
 * `Error` listing every problem found, tagged by source file — same
 * convention as `parseCity`.
 */
export function parsePrefabs(
  files: PrefabSourceFiles,
  knownWorldObjectIds: ReadonlySet<string>,
  knownNpcIds: ReadonlySet<string>,
): PrefabContent {
  const errors: string[] = [];
  const locale: Record<string, Record<string, string>> = {};

  const entries = collectFileEntries(files.prefabFiles, "prefabs", errors);
  const prefabs = buildById(entries, "prefabs", errors, (raw, where, errs) =>
    validatePrefab(raw, where, errs, locale, knownWorldObjectIds, knownNpcIds),
  );

  if (errors.length > 0) {
    throw new Error([`Invalid prefab content — ${errors.length} problem(s) found:`, ...errors.map((e) => `  - ${e}`)].join("\n"));
  }

  return { prefabs, derivedLocale: locale };
}

function validatePrefab(
  raw: unknown,
  where: string,
  errors: string[],
  locale: Record<string, Record<string, string>>,
  knownWorldObjectIds: ReadonlySet<string>,
  knownNpcIds: ReadonlySet<string>,
): LocationPrefab | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where} is not a mapping.`);
    return undefined;
  }
  const id = expectString(raw.id, `${where}.id`, errors);
  if (id === undefined) return undefined;

  const kind = expectString(raw.kind, `${where}.kind`, errors);
  if (kind === undefined) return undefined;
  if (kind !== "exterior" && kind !== "interior") {
    errors.push(`${where}.kind is "${kind}" — must be one of: ${[...VALID_KINDS].join(", ")}.`);
    return undefined;
  }

  const aliases = expectStringArrayOr(raw.aliases, `${where}.aliases`, errors, []);
  const worldObjectIds = expectStringArrayOr(raw.worldObjectIds, `${where}.worldObjectIds`, errors, []);
  const npcIds = expectStringArrayOr(raw.npcIds, `${where}.npcIds`, errors, []);
  for (const worldObjectId of worldObjectIds) {
    if (!knownWorldObjectIds.has(worldObjectId)) {
      errors.push(`${where}.worldObjectIds references "${worldObjectId}", which has no entry in the loaded object catalog.`);
    }
  }
  for (const npcId of npcIds) {
    if (!knownNpcIds.has(npcId)) {
      errors.push(`${where}.npcIds references "${npcId}", which has no entry in the loaded NPC catalog.`);
    }
  }

  const fields = validateText(raw.text, where, errors, locale, `prefab.${id}`, ["name", "description"]);
  if (fields === undefined) return undefined;

  return {
    id,
    kind,
    nameKey: `prefab.${id}.name`,
    descriptionKey: `prefab.${id}.description`,
    aliases,
    worldObjectIds,
    npcIds,
  };
}

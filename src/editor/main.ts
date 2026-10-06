import { dump, load } from "js-yaml";
import type { GameState, Location, Npc, Part, PartState, SceneImage, ScheduleSlot, StatBlock, StatKey, TransportMode, VisibilityTier, WorldObject } from "../engine/types";
import { isRecord, parseCity } from "../content/cityLoader";
import type { CityContent } from "../content/cityLoader";
import { STAT_DEFINITIONS } from "../engine/stats/stats";
import { parsePrefabs } from "../content/prefabLoader";
import type { LocationPrefab, PrefabContent } from "../content/prefabLoader";
import { isInteriorHop } from "../engine/navigation/interiorHops";
import { containedWorldObjectsIn, npcsAtLocation, worldObjectsAtLocation } from "../engine/placement";
import { INTERACT_VERB_ALIASES } from "../engine/parsing/EnglishCommandParser";
import { MapView } from "../mapview/MapView";
import type { MapNode } from "../mapview/MapView";
import { buildConnectionEdges } from "../mapview/connectionEdges";
import type { ConnectionGroupEntry } from "../mapview/connectionEdges";
import { openImageEditor } from "./imageEditor";
import type { ImageDraft } from "./imageEditor";

/**
 * Map editor entry point. Opens the project folder via the File System
 * Access API (`showDirectoryPicker`), renders/edits the CURRENT
 * multi-file, inline-text content pipeline through the same shared
 * `MapView` and the same `cityLoader.ts` validator the game itself uses
 * — see `docs/content-schema.md` and `docs/architecture.md`'s "The map
 * editor" section.
 *
 * Locations live across many files under `src/content/city/locations/*.yaml`
 * (see `docs/content-schema.md`'s "Authoring workflow"); world objects
 * under `src/content/city/objects/*.yaml`; `npcs`/`labels`/`facts`/
 * `transitLines`/`passes` in `src/content/city/world.yaml`; location
 * PREFABS (reusable location templates — see `content/prefabLoader.ts`'s
 * doc comment) under `src/content/prefabs/*.yaml`, a SEPARATE tree from
 * `content/city/` entirely, since a prefab is never part of the live city
 * graph and the game never loads it. The toolbar's Locations/Objects/
 * NPCs/Prefabs tabs (`editorMode`) switch between four editors sharing
 * this one open project: the map-based location editor described below,
 * the world object (item/setpiece) editor — id, kind, portable, aliases,
 * description, the `parts`/`states` sub-hierarchy, and each state's
 * `enterAliases` verb hooks (see `docs/systems/parts.md`) — the NPC
 * editor (id, aliases, name/description/fallback-dialogue text, labels,
 * starting location, schedule, trust/suspicion/stats — see
 * `docs/systems/npcs.md`; `dialogueRules`/`topics` remain hand-edit-only,
 * a deliberate scope decision, not an oversight) — and the prefab editor,
 * which decorates a name/description template with existing catalog world
 * objects/NPCs for later "stamping" into the world (Phase 3 of the
 * worldObject/prefab editor plan — not built yet; see
 * `docs/open-issues.md`). Locations/Objects/Prefabs follow the per-file
 * dirty-write save design (`regenerateLocationFile`/`regenerateObjectFile`/
 * `regeneratePrefabFile`); NPCs live in `world.yaml` instead, which has its
 * own single-file write-back (`regenerateWorldFile` — see `worldRaw`'s doc
 * comment) since `labels`/`facts`/`transitLines`/`passes` in that same file
 * remain hand-edit-only and are kept as an opaque parsed blob rather than
 * being reconstructed from typed content this editor doesn't otherwise
 * touch.
 *
 * Each location's own display text lives inline on it now (`text: {
 * en: {...}, ... }` — see `docs/content-schema.md`'s "Inline localized
 * text"), not in a separate per-language locale file, so there's no
 * longer a separate set of locale-file handles to manage — just
 * `city.derivedLocale`, the same `{ language: { key: text } }` table
 * `cityLoader.ts` builds for the game itself.
 *
 * KNOWN LIMITATION: a location/object/prefab file, or `world.yaml`, that
 * gets touched this session (an add, an edit, a drag, a new/curved
 * connection, a part/state change, an NPC add/edit/remove) is re-serialized
 * whole via `js-yaml`'s `dump`, which does NOT preserve hand-written
 * comments or formatting — see docs/open-issues.md. A file that's never
 * touched is left completely alone on disk — `save()` only rewrites files
 * it actually changed in memory — so opening the project and saving
 * without touching NPCs (or a particular location/object/prefab file) can
 * never destroy that file's comments. `transitLines`/`passes`, inside
 * `world.yaml`, still have no editor UI, but touching an NPC still rewrites
 * the WHOLE `world.yaml` file (comments/formatting loss for the rest of it
 * too, same limitation), since a single file can't be partially rewritten.
 */

const DRAFT_NODE_ID = "__draft__";
/** Where a brand-new location (Add flow) is written — see save()'s per-file dirty-write design in this file's doc comment. Existing locations always stay in whichever file they were loaded from. */
const NEW_LOCATION_FILE = "editor-additions.yaml";
/** Where a brand-new world object (Add flow) is written — mirrors NEW_LOCATION_FILE, one level down in objects/. */
const NEW_OBJECT_FILE = "editor-additions.yaml";

let city: CityContent | null = null;
let locationsDirHandle: FileSystemDirectoryHandle | null = null;
/** filename -> its file handle, populated for every location file found when a project folder is opened, plus lazily for NEW_LOCATION_FILE the first time it's actually needed. */
let locationFileHandles = new Map<string, FileSystemFileHandle>();
/** filename -> that file's current YAML text — the source of truth `save()` re-validates and (for dirty files) writes to disk. Untouched files keep the exact text they were loaded with. */
let locationFileTexts = new Map<string, string>();
/** locationId -> which location file it lives in — set on load (from the file it was found in) and on Add (to NEW_LOCATION_FILE); never changes after that (this editor has no "move to a different file" operation). */
let locationOrigin = new Map<string, string>();
/** Location files whose in-memory text has changed since the last save and so need writing to disk — see save(). */
let dirtyLocationFiles = new Set<string>();

let objectsDirHandle: FileSystemDirectoryHandle | null = null;
/** filename -> its file handle — mirrors locationFileHandles, one level down in objects/. */
let objectFileHandles = new Map<string, FileSystemFileHandle>();
/** filename -> that file's current YAML text — mirrors locationFileTexts. Also what `save()` feeds `parseCity` as `objectFiles` for full-city revalidation. */
let objectFileTexts = new Map<string, string>();
/** worldObjectId -> which object file it lives in — mirrors locationOrigin. */
let objectOrigin = new Map<string, string>();
/** Object files whose in-memory text has changed since the last save — mirrors dirtyLocationFiles. */
let dirtyObjectFiles = new Set<string>();

let worldYamlText = "";
/** `world.yaml`'s own file handle — separate from `worldYamlText` (that's kept up to date for `parseCity` revalidation regardless), since writing it needs the handle. Null until a project is opened. */
let worldYamlHandle: FileSystemFileHandle | null = null;
/**
 * `world.yaml` parsed ONCE (at project-open) into a plain object via
 * js-yaml's `load()`, kept as the living on-disk source of truth for the
 * WHOLE file — not just `npcs`. Unlike locations/objects/prefabs (each
 * reconstructed from typed, locale-stripped `city.*`/`prefabs.*` records
 * via a `*ToRaw` function), `labels`/`facts`/`transitLines`/`passes` here
 * have no editor UI and no reason to round-trip through typed records —
 * reconstructing them would need new reversal logic for content this
 * editor never touches, for no benefit. So only `worldRaw.npcs` is ever
 * mutated (by `npcToRaw`'s callers); every other top-level key is carried
 * through untouched and opaque. `regenerateWorldFile` re-dumps this whole
 * object whenever `npcs` changes.
 */
let worldRaw: Record<string, unknown> | null = null;
/** Whether `world.yaml` has unsaved NPC changes — a single boolean (not a per-file Set like `dirtyObjectFiles`) since there's only ever one `world.yaml`. */
let dirtyWorldFile = false;

/** The currently loaded prefab library — separate from `city` entirely (see this file's doc comment: prefabs aren't city content, `parseCity` never sees them). Null before a project is opened, same as `city`. */
let prefabs: PrefabContent | null = null;
let prefabsDirHandle: FileSystemDirectoryHandle | null = null;
/** filename -> its file handle — mirrors objectFileHandles, under prefabs/. */
let prefabFileHandles = new Map<string, FileSystemFileHandle>();
/** filename -> that file's current YAML text — mirrors objectFileTexts. Also what `save()` feeds `parsePrefabs` for full revalidation. */
let prefabFileTexts = new Map<string, string>();
/** prefabId -> which prefab file it lives in — mirrors objectOrigin. */
let prefabOrigin = new Map<string, string>();
/** Prefab files whose in-memory text has changed since the last save — mirrors dirtyObjectFiles. */
let dirtyPrefabFiles = new Set<string>();
/** Where a brand-new prefab (Add flow) is written — mirrors NEW_OBJECT_FILE, one level down in prefabs/. */
const NEW_PREFAB_FILE = "editor-additions.yaml";

let selectedLanguage = "en";

/** Current text in the Objects tab's search box — filters `populateObjectList()`'s rows by id/display-name substring (case-insensitive). Lives outside `objectDraft` since it's list-view state, not part of any one object's edit. */
let objectSearchQuery = "";

/** Which objects `populateObjectList()` shows, by placement status — see `isObjectPlaced`. "storage" surfaces the unplaced "original copies" the project's catalog/clone workflow relies on (see docs/architecture.md's "world object editor" section, "In storage" objects), which are otherwise easy to lose track of once the catalog grows. */
let objectPlacementFilter: "all" | "placed" | "storage" = "all";

/** Current text in the NPCs tab's search box — mirrors `objectSearchQuery`. */
let npcSearchQuery = "";

/** Which top-level editor is showing — the map-based location editor, the world object (item/setpiece) editor, the NPC editor, or the location prefab editor. Toggled by the toolbar's Locations/Objects/NPCs/Prefabs tabs. */
let editorMode: "locations" | "objects" | "npcs" | "prefabs" = "locations";

let connectFromId: string | null = null;
let curveEditMode = false;
/** Whether Connect also authors the reverse Connection automatically — the toolbar's "Two-way" checkbox, default on and remembered across toggles (see onNodeClicked's connect-mode branch). Rendering never depends on this: a foot path drawn one-way and a bus line drawn the other still merge into one line via buildConnectionEdges regardless of how each Connection was authored. */
let twoWayOn = true;
/** edgeId (see render) -> every real Connection the grouped line represents, from either direction — see connectionEdges.ts's buildConnectionEdges. A curve/click handler writes to every entry so the whole group stays one consistent line. */
let edgeLookup = new Map<string, ConnectionGroupEntry[]>();

/**
 * The in-progress sidebar draft, or null when the sidebar is closed. Same
 * shape for both flows the sidebar handles:
 *  - Add: `editingId` is null. Rendered as an extra MapView node (id
 *    DRAFT_NODE_ID) merged in by render() — nothing is written into
 *    `city` until the sidebar's own Save commits it. `prefabId`, when
 *    set (via the Add-only "Start from prefab" picker — see
 *    `buildSidebar`), means Save also STAMPS that prefab: its
 *    `worldObjectIds` get cloned under fresh ids and placed at the new
 *    location — see `commitDraft`/`cloneWorldObjectForStamp`. Always
 *    null for Edit; stamping only ever happens once, at creation.
 *  - Edit: `editingId` is the location's own (immutable) id. render()
 *    renders that SAME node id at the draft's (possibly dragged) x/y
 *    instead of the stored position, so edges follow it live too — but,
 *    same as Add, nothing is written into `city`/its origin file until
 *    Save; Cancel discards the draft and the node snaps back.
 */
let draft:
  | {
      editingId: string | null;
      x: number;
      y: number;
      kind: "exterior" | "interior";
      exteriorId: string;
      prefabId: string | null;
      baseVisibility: VisibilityTier;
      affectedByDaylight: boolean;
      /** Edited via the "Edit image" popup (see `imageEditor.ts`) — converted to a real `SceneImage` only at Save (`commitDraft`). `null` = no image. */
      image: ImageDraft | null;
    }
  | null = null;
let draftName = "";
let draftDescription = "";

/** One part's editable draft — see `objectDraft`'s doc comment. */
interface ObjectPartDraft {
  id: string;
  aliasesCsv: string;
  name: string;
  description: string;
  defaultStateId: string;
  states: ObjectStateDraft[];
}

/** One part-state's editable draft — see `objectDraft`'s doc comment. */
interface ObjectStateDraft {
  id: string;
  name: string;
  description: string;
  summary: string;
  important: boolean;
  exposesContents: boolean;
  revealInAmbientListing: boolean;
  /** Comma-separated, as typed — validated against KNOWN verbs only for the WARNING (see `unknownVerbs`), never blocked, per the project's decision to let content authors stage verb ideas ahead of the engine. */
  enterAliasesCsv: string;
  /** Edited via the "Edit image" popup (see `imageEditor.ts`) — overrides the object's own image while this state is current (see `GameEngine.getSceneImage`). `null` = no image. */
  image: ImageDraft | null;
}

/**
 * The in-progress object sidebar draft, or null when it's closed. Same
 * Add/Edit split as location's `draft` — `editingId` null means Add
 * (nothing written into `city` until Save), otherwise Edit (the object's
 * own immutable id). Text fields are plain strings/CSVs here rather than
 * being split out like `draftName`/`draftDescription` are for locations,
 * since there's no map-node live-preview need pulling them out separately.
 */
let objectDraft: {
  editingId: string | null;
  kind: "item" | "setpiece";
  portable: boolean;
  announceOnRevisit: boolean;
  aliasesCsv: string;
  name: string;
  description: string;
  /** "" = not contained anywhere (yet) — see the containment fields' doc comment on the sidebar form. */
  containerId: string;
  containerPartId: string;
  parts: ObjectPartDraft[];
  /** Edited via the "Edit image" popup (see `imageEditor.ts`) — shown while the object is examined, unless a part state's own image overrides it. `null` = no image. */
  image: ImageDraft | null;
} | null = null;

/**
 * The in-progress prefab sidebar draft, or null when it's closed. Same
 * Add/Edit split as `objectDraft`. `worldObjectIds`/`npcIds` are `Set`s
 * (not CSV strings, unlike `aliasesCsv`) since the sidebar picks them
 * from a checklist of the currently loaded catalog rather than typing —
 * see `buildPrefabSidebar`.
 */
let prefabDraft: {
  editingId: string | null;
  kind: "exterior" | "interior";
  aliasesCsv: string;
  name: string;
  description: string;
  worldObjectIds: Set<string>;
  npcIds: Set<string>;
} | null = null;

/**
 * The in-progress NPC sidebar draft, or null when it's closed. Same
 * Add/Edit split as `objectDraft`/`prefabDraft`. `locationId` is the
 * NPC's starting placement — sibling YAML data (like a location's
 * `itemIds`), not a literal field on the `Npc` record itself, so it's
 * tracked here on the draft and written into `city.initialPlacement.
 * npcLocationId` on commit, mirroring how `objectDraft.containerId`
 * writes into `city.initialPlacement.containedIn`.
 */
/** Draft-form shape of one `ScheduleSlot` (`engine/types.ts`) — hours kept as edited strings (parsed/range-validated only at commit time, in `commitNpcDraft`) and `weekdays: null` meaning "every day," which is omitted from the saved YAML entirely, matching `ScheduleSlot.weekdays` being optional there. */
interface ScheduleSlotDraft {
  fromHour: string;
  toHour: string;
  locationId: string;
  weekdays: Set<number> | null;
}

let npcDraft: {
  editingId: string | null;
  aliasesCsv: string;
  name: string;
  description: string;
  dialogue: string;
  locationId: string;
  labels: Set<string>;
  /** Empty array = no schedule authored at all (the field is omitted from YAML) — this is what realizes "blank means the NPC always stays at its starting location," not a special sentinel. */
  schedule: ScheduleSlotDraft[];
  /** Edited as strings; parsed/validated only at commit time. Not part of `Npc` — written into `city.initialNpcStates[id]`, mirroring `locationId`'s placement-data treatment. `"0"` (the loader's own default) is a normal, non-blocking value, not a sentinel for "unset." */
  trustStr: string;
  suspicionStr: string;
  /** `""` per key = not authored (falls back to `STAT_DEFINITIONS[key].default` via `getStatValue` — see docs/systems/stats.md), NOT the same as authoring `0`. */
  stats: { stealth: string; intimidation: string; handguns: string };
  /** Edited via the "Edit image" popup (see `imageEditor.ts`) — the NPC's portrait. `null` = no image. */
  image: ImageDraft | null;
} | null = null;

const root = document.querySelector<HTMLDivElement>("#editor-app")!;

const toolbar = document.createElement("div");
toolbar.className = "editor__toolbar";

const openButton = button("Open folder", () => void openProject(), { startEnabled: true });
const locationsTabButton = button("Locations", () => setEditorMode("locations"));
const objectsTabButton = button("Objects", () => setEditorMode("objects"));
const npcsTabButton = button("NPCs", () => setEditorMode("npcs"));
const prefabsTabButton = button("Prefabs", () => setEditorMode("prefabs"));
const addButton = button("Add location", () => startAddLocation());
const moveButton = button("Move", () => setMoveMode(!moveModeOn));
const connectButton = button("Connect", () => setConnectMode(!connectModeOn));
// Remembered across toggles via the module-level `twoWayOn`, not reset when Connect mode itself is toggled off/on — see onNodeClicked's connect-mode branch.
const twoWayCheckbox = document.createElement("input");
twoWayCheckbox.type = "checkbox";
twoWayCheckbox.id = "editor-two-way-checkbox";
twoWayCheckbox.checked = twoWayOn;
twoWayCheckbox.addEventListener("change", () => {
  twoWayOn = twoWayCheckbox.checked;
});
const twoWayLabel = document.createElement("label");
twoWayLabel.className = "editor__two-way-label";
twoWayLabel.htmlFor = twoWayCheckbox.id;
twoWayLabel.append(twoWayCheckbox, document.createTextNode(" Two-way"));
const curveButton = button("Edit curve", () => setCurveMode(!curveEditMode));
const addObjectButton = button("Add object", () => startAddObject());
const addNpcButton = button("Add NPC", () => startAddNpc());
const addPrefabButton = button("Add prefab", () => startAddPrefab());
const saveButton = button("Save world", () => void save());

// Commits/discards whichever of the three editors' drafts is currently
// open (see `setActiveDraftKind`) — lets a user act on a draft without
// scrolling down to that editor's own sidebar, which can be a long way
// down once an object has several parts/states. Distinct from `saveButton`
// above, which writes the whole PROJECT to disk regardless of whether a
// draft is even open. `startEnabled: true` because these two are never
// reachable without a draft open anyway (their `.hidden`, toggled by
// `setActiveDraftKind`, already gates that) — they'd otherwise sit
// disabled forever, since they aren't in openProject()'s "enable
// everything" sweep the way every other project-scoped button is.
const draftSaveButton = button(
  "Save",
  () => {
    if (draft) sidebar.save();
    else if (objectDraft) objectSidebar.save();
    else if (npcDraft) npcSidebar.save();
    else if (prefabDraft) prefabSidebar.save();
  },
  { startEnabled: true },
);
const draftCancelButton = button(
  "Cancel",
  () => {
    if (draft) endLocationForm();
    else if (objectDraft) endObjectForm();
    else if (npcDraft) endNpcForm();
    else if (prefabDraft) endPrefabForm();
  },
  { startEnabled: true },
);

const languageLabel = document.createElement("label");
languageLabel.className = "editor__language-label";
languageLabel.textContent = "Text language:";
const languageSelect = document.createElement("select");
languageSelect.disabled = true;
languageSelect.addEventListener("change", () => {
  selectedLanguage = languageSelect.value;
  render(); // node labels/tooltips are read from the selected language's table — see displayName().
  populateObjectList(); // object list rows also show a name in the selected language — see populateObjectList().
  populatePrefabList(); // ditto for prefab list rows — see populatePrefabList().
});
languageLabel.append(languageSelect);

/** A thin vertical rule between toolbar groups — purely visual, no behavior. */
function toolbarSeparator(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "editor__toolbar-separator";
  return el;
}

// The toolbar reads as three groups, left to right: project-level actions
// (Open/Save), the Locations/Objects/Prefabs editor switch, and — always
// last, always context-sensitive to whichever of those three is active —
// that editor's own manipulation buttons (see setEditorMode, which shows/
// hides each one by `mode`). Only the Locations group is populated today;
// Objects/Prefabs just contribute their single "Add ___" button to the same
// slot, and an editor with nothing to show there simply renders it empty.
const projectGroup = document.createElement("div");
projectGroup.className = "editor__toolbar-group";
projectGroup.append(openButton, saveButton);

const editorSwitchGroup = document.createElement("div");
editorSwitchGroup.className = "editor__toolbar-group";
editorSwitchGroup.append(locationsTabButton, objectsTabButton, npcsTabButton, prefabsTabButton);

const contextGroup = document.createElement("div");
contextGroup.className = "editor__toolbar-group";
contextGroup.append(addButton, moveButton, connectButton, twoWayLabel, curveButton, addObjectButton, addNpcButton, addPrefabButton);

// The fourth group: draft Save/Cancel, right-aligned next to the language
// selector (margin-left: auto pushes this and everything after it to the
// far right — see editor.css) — hidden together with its own separator
// whenever no draft is open, so it doesn't sit there empty. See
// `setActiveDraftKind`.
const draftActionsSeparator = toolbarSeparator();
draftActionsSeparator.hidden = true;
const draftActionsGroup = document.createElement("div");
draftActionsGroup.className = "editor__toolbar-group editor__toolbar-group--trailing";
draftActionsGroup.append(draftSaveButton, draftCancelButton);
draftActionsGroup.hidden = true;

toolbar.append(
  projectGroup,
  toolbarSeparator(),
  editorSwitchGroup,
  toolbarSeparator(),
  contextGroup,
  draftActionsSeparator,
  draftActionsGroup,
  languageLabel,
);

/** Which editor's draft (if any) is currently open — drives which sidebar's `save()` the top Save/Cancel buttons act on, and whether that button pair shows at all. Set from each sidebar's own `open`/`close` (see buildSidebar/buildObjectSidebar/buildPrefabSidebar), since those already run at exactly the moments a draft starts/stops existing. */
function setActiveDraftKind(kind: "location" | "object" | "npc" | "prefab" | null): void {
  draftActionsSeparator.hidden = kind === null;
  draftActionsGroup.hidden = kind === null;
}

const notice = document.createElement("p");
notice.className = "editor__notice";
notice.hidden = true;

const status = document.createElement("p");
status.className = "editor__status";

const body = document.createElement("div");
body.className = "editor__body";

const mapMount = document.createElement("div");
mapMount.className = "editor__map";

const sidebar = buildSidebar();
sidebar.root.hidden = true;

// The Objects tab is a fixed-width searchable list (objectListPanel, the
// element whose `hidden` is toggled per-mode) on the left, feeding an
// always-visible inspector (objectSidebar) on the right that fills the
// remaining width — a click on a row opens that object for editing in
// place, rather than the list growing/shrinking around an appearing sidebar.
const objectListPanel = document.createElement("div");
objectListPanel.className = "editor__object-list-panel";
objectListPanel.hidden = true;

const objectSearchInput = document.createElement("input");
objectSearchInput.type = "search";
objectSearchInput.className = "editor__object-search";
objectSearchInput.placeholder = "Search objects by id or name…";
objectSearchInput.addEventListener("input", () => {
  objectSearchQuery = objectSearchInput.value;
  populateObjectList();
});

/** Filters the Objects tab's list by `objectPlacementFilter` — see `isObjectPlaced`. */
const objectPlacementFilterSelect = document.createElement("select");
objectPlacementFilterSelect.className = "editor__object-placement-filter";
for (const [value, label] of [
  ["all", "All objects"],
  ["placed", "Placed only"],
  ["storage", "Storage only"],
] as const) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  objectPlacementFilterSelect.append(option);
}
objectPlacementFilterSelect.addEventListener("change", () => {
  objectPlacementFilter = objectPlacementFilterSelect.value as typeof objectPlacementFilter;
  populateObjectList();
});

const objectListMount = document.createElement("div");
objectListMount.className = "editor__object-list";

objectListPanel.append(objectSearchInput, objectPlacementFilterSelect, objectListMount);

const objectSidebar = buildObjectSidebar();
objectSidebar.root.hidden = true;

// The NPCs tab follows the same fixed-width-list + always-visible-inspector
// shape as Objects mode (not the Prefabs-mode hide/show sidebar) — an NPC
// catalog is small but authors will want to jump between NPCs to compare
// fields, and an always-visible sidebar avoids an extra click to reveal it.
const npcListPanel = document.createElement("div");
// Second class so tests/CSS can target this panel specifically — it
// shares "editor__object-list-panel" styling with objectListPanel, but
// both coexist in the DOM at once, same rationale as npcListMount's
// "--npc" suffix below.
npcListPanel.className = "editor__object-list-panel editor__object-list-panel--npc";
npcListPanel.hidden = true;

const npcSearchInput = document.createElement("input");
npcSearchInput.type = "search";
npcSearchInput.className = "editor__object-search";
npcSearchInput.placeholder = "Search NPCs by id or name…";
npcSearchInput.addEventListener("input", () => {
  npcSearchQuery = npcSearchInput.value;
  populateNpcList();
});

const npcListMount = document.createElement("div");
// Shares "editor__object-list" styling, plus a second class so tests/CSS
// can target this one specifically — same rationale as prefabListMount.
npcListMount.className = "editor__object-list editor__object-list--npc";

npcListPanel.append(npcSearchInput, npcListMount);

const npcSidebar = buildNpcSidebar();
npcSidebar.root.hidden = true;

const prefabListMount = document.createElement("div");
// Shares "editor__object-list" styling with objectListMount, plus a
// second class so tests/CSS can target this one specifically — same
// rationale as objectSidebar/prefabSidebar's "--object"/"--prefab"
// classes, since both list panels coexist in the DOM at once.
prefabListMount.className = "editor__object-list editor__object-list--prefab";
prefabListMount.hidden = true;

const prefabSidebar = buildPrefabSidebar();
prefabSidebar.root.hidden = true;

addObjectButton.hidden = true;
addNpcButton.hidden = true;
addPrefabButton.hidden = true;
locationsTabButton.classList.add("is-active");

body.append(mapMount, sidebar.root, objectListPanel, objectSidebar.root, npcListPanel, npcSidebar.root, prefabListMount, prefabSidebar.root);
root.append(toolbar, notice, status, body);

const mapView = new MapView(mapMount);
mapView.enableCurveEdit(onCurveDragged);
mapView.onNodeClick(onNodeClicked);
mapView.onEdgeClick(onEdgeClicked);

/**
 * Switches between the map-based location editor, the world object
 * editor, the NPC editor, and the prefab editor — closes any in-progress
 * draft in the mode being left (same as clicking Cancel) rather than
 * trying to keep more than one draft alive at once, and toggles which
 * toolbar buttons/body panels are visible for the mode being entered. All
 * four editors share the same `notice`/`status`/`languageSelect` — only
 * which panel is mounted (and which of `city`/`prefabs` is being edited)
 * changes.
 */
function setEditorMode(mode: "locations" | "objects" | "npcs" | "prefabs"): void {
  if (mode === editorMode) return;
  if (draft) endLocationForm();
  if (objectDraft) endObjectForm();
  if (npcDraft) endNpcForm();
  if (prefabDraft) endPrefabForm();
  setConnectMode(false);
  setMoveMode(false);
  setCurveMode(false);
  editorMode = mode;

  locationsTabButton.classList.toggle("is-active", mode === "locations");
  objectsTabButton.classList.toggle("is-active", mode === "objects");
  npcsTabButton.classList.toggle("is-active", mode === "npcs");
  prefabsTabButton.classList.toggle("is-active", mode === "prefabs");
  for (const b of [addButton, moveButton, connectButton, curveButton]) b.hidden = mode !== "locations";
  twoWayLabel.hidden = mode !== "locations";
  addObjectButton.hidden = mode !== "objects";
  addNpcButton.hidden = mode !== "npcs";
  addPrefabButton.hidden = mode !== "prefabs";
  mapMount.hidden = mode !== "locations";
  objectListPanel.hidden = mode !== "objects";
  npcListPanel.hidden = mode !== "npcs";
  prefabListMount.hidden = mode !== "prefabs";
  // Each sidebar's hidden state is set unconditionally here, not only
  // inside an `if (mode === ...)` branch — leaving a branch to set it
  // `false` and never having a corresponding branch set it back to `true`
  // is exactly how the object inspector was left stuck on-screen after
  // switching back to Locations (its `hidden` was only ever toggled while
  // *entering* Objects mode, never while leaving it).
  sidebar.root.hidden = mode !== "locations" || draft === null;
  // The object/NPC inspectors are always on for the DURATION of their mode
  // — they just show an empty-state placeholder until a row is clicked
  // (see buildObjectSidebar/buildNpcSidebar) — but still hide completely
  // outside that mode.
  objectSidebar.root.hidden = mode !== "objects";
  npcSidebar.root.hidden = mode !== "npcs";
  prefabSidebar.root.hidden = mode !== "prefabs" || prefabDraft === null;
  if (mode === "objects") populateObjectList();
  if (mode === "npcs") populateNpcList();
  if (mode === "prefabs") populatePrefabList();
}

function button(label: string, onClick: () => void, opts: { startEnabled?: boolean } = {}): HTMLButtonElement {
  const el = document.createElement("button");
  el.textContent = label;
  el.disabled = !opts.startEnabled; // everything but "Open" starts disabled until a project is loaded
  el.addEventListener("click", onClick);
  return el;
}

/** Buttons whose mode would conflict with an in-progress location add/edit, or that need a loaded project — disabled for the duration of a location draft, re-enabled on the sidebar's Save/Cancel. */
function modeButtons(): HTMLButtonElement[] {
  return [addButton, moveButton, connectButton, curveButton];
}

/** Mirrors modeButtons() for the object editor — just "Add object", since objects have no move/connect/curve modes of their own. */
function objectModeButtons(): HTMLButtonElement[] {
  return [addObjectButton];
}

/** Mirrors objectModeButtons() for the NPC editor. */
function npcModeButtons(): HTMLButtonElement[] {
  return [addNpcButton];
}

/** Mirrors objectModeButtons() for the prefab editor. */
function prefabModeButtons(): HTMLButtonElement[] {
  return [addPrefabButton];
}

/** The Locations/Objects/NPCs/Prefabs tabs — disabled for the duration of ANY editor's in-progress draft, since switching mid-draft would silently discard it (setEditorMode closes whatever draft is open in the mode being left). */
function tabButtons(): HTMLButtonElement[] {
  return [locationsTabButton, objectsTabButton, npcsTabButton, prefabsTabButton];
}

let connectModeOn = false;
let moveModeOn = false;

function setConnectMode(on: boolean): void {
  connectModeOn = on;
  connectButton.classList.toggle("is-active", on);
  connectFromId = null;
  mapView.setSelectedNode(null);
  if (on) setMoveMode(false);
}

/**
 * Node dragging is opt-in via this button rather than always-on. It used
 * to be enabled unconditionally, which meant it was ALWAYS competing with
 * node clicks elsewhere in the editor (Connect in particular): MapView
 * treats any pointer movement past a small threshold between mousedown
 * and mouseup as a drag rather than a click (CLICK_MOVEMENT_THRESHOLD_PX),
 * and an ordinary mouse/trackpad click easily exceeds that — so a click
 * meant to pick a connection endpoint routinely got swallowed as a
 * micro-drag instead, silently nudging the node and never firing
 * onNodeClick. Gating dragging behind its own explicit mode means every
 * other mode's node clicks are never in competition with a drag gesture.
 */
function setMoveMode(on: boolean): void {
  moveModeOn = on;
  moveButton.classList.toggle("is-active", on);
  if (on) {
    setConnectMode(false);
    mapView.enableNodeDrag(onNodeDragged);
  } else {
    mapView.disableNodeDrag();
  }
}

function setCurveMode(on: boolean): void {
  curveEditMode = on;
  curveButton.classList.toggle("is-active", on);
  if (!on) mapView.selectEdgeForCurveEdit(null);
}

/**
 * Opens the project's root folder (not a single file) via
 * `showDirectoryPicker`, so the editor can read every location/object
 * file plus `world.yaml` together in one session, without a separate
 * permission grant per file — and so a location file added later shows
 * up automatically next time, no editor code change required.
 */
async function openProject(): Promise<void> {
  notice.hidden = true;
  let rootDir: FileSystemDirectoryHandle;
  try {
    rootDir = await window.showDirectoryPicker({ mode: "readwrite" });
  } catch {
    return; // user cancelled the picker
  }

  let worldHandle: FileSystemFileHandle;
  let locDir: FileSystemDirectoryHandle;
  let objDir: FileSystemDirectoryHandle;
  let prefabDir: FileSystemDirectoryHandle;
  try {
    const contentDir = await rootDir.getDirectoryHandle("src").then((d) => d.getDirectoryHandle("content"));
    const cityDir = await contentDir.getDirectoryHandle("city");
    worldHandle = await cityDir.getFileHandle("world.yaml");
    locDir = await cityDir.getDirectoryHandle("locations");
    objDir = await cityDir.getDirectoryHandle("objects");
    // Auto-created if missing — `src/content/prefabs/` is a newer, optional
    // tree (see this file's doc comment) that may not exist yet in an
    // older checkout; creating an empty directory is harmless (nothing on
    // disk changes unless a prefab is actually saved into it) and means
    // opening the project works the same whether or not anyone has
    // authored a prefab yet.
    prefabDir = await contentDir.getDirectoryHandle("prefabs", { create: true });
  } catch (err) {
    notice.hidden = false;
    notice.textContent = `Couldn't find src/content/city/world.yaml, src/content/city/locations/, and src/content/city/objects/ under the selected folder — pick the project's root folder (${err instanceof Error ? err.message : String(err)}).`;
    return;
  }

  const newWorldText = await (await worldHandle.getFile()).text();

  const newLocationFileHandles = new Map<string, FileSystemFileHandle>();
  const newLocationFileTexts = new Map<string, string>();
  for await (const [name, handle] of locDir.entries()) {
    if (handle.kind !== "file" || !name.endsWith(".yaml")) continue;
    newLocationFileHandles.set(name, handle);
    newLocationFileTexts.set(name, await (await handle.getFile()).text());
  }

  const newObjectFileHandles = new Map<string, FileSystemFileHandle>();
  const newObjectFileTexts = new Map<string, string>();
  for await (const [name, handle] of objDir.entries()) {
    if (handle.kind !== "file" || !name.endsWith(".yaml")) continue;
    newObjectFileHandles.set(name, handle);
    newObjectFileTexts.set(name, await (await handle.getFile()).text());
  }

  const newPrefabFileHandles = new Map<string, FileSystemFileHandle>();
  const newPrefabFileTexts = new Map<string, string>();
  for await (const [name, handle] of prefabDir.entries()) {
    if (handle.kind !== "file" || !name.endsWith(".yaml")) continue;
    newPrefabFileHandles.set(name, handle);
    newPrefabFileTexts.set(name, await (await handle.getFile()).text());
  }

  let newCity: CityContent;
  try {
    newCity = parseCity({
      world: newWorldText,
      objectFiles: Object.fromEntries(newObjectFileTexts),
      locationFiles: Object.fromEntries(newLocationFileTexts),
    });
  } catch (err) {
    notice.hidden = false;
    notice.textContent = err instanceof Error ? err.message : String(err);
    return;
  }

  let newPrefabs: PrefabContent;
  try {
    newPrefabs = parsePrefabs(
      { prefabFiles: Object.fromEntries(newPrefabFileTexts) },
      new Set(Object.keys(newCity.worldObjects)),
      new Set(Object.keys(newCity.npcs)),
    );
  } catch (err) {
    notice.hidden = false;
    notice.textContent = err instanceof Error ? err.message : String(err);
    return;
  }

  // Parsed separately from `parseCity` above (which only reads `world.yaml`
  // for validation context) — this is the raw object the NPC editor
  // mutates directly, see `worldRaw`'s doc comment.
  const newWorldRaw = load(newWorldText);
  if (!isRecord(newWorldRaw)) {
    notice.hidden = false;
    notice.textContent = "world.yaml must be a mapping at the top level.";
    return;
  }

  city = newCity;
  locationsDirHandle = locDir;
  locationFileHandles = newLocationFileHandles;
  locationFileTexts = newLocationFileTexts;
  locationOrigin = buildOriginMap(newLocationFileTexts);
  dirtyLocationFiles = new Set();
  objectsDirHandle = objDir;
  objectFileHandles = newObjectFileHandles;
  objectFileTexts = newObjectFileTexts;
  objectOrigin = buildOriginMap(newObjectFileTexts);
  dirtyObjectFiles = new Set();
  prefabs = newPrefabs;
  prefabsDirHandle = prefabDir;
  prefabFileHandles = newPrefabFileHandles;
  prefabFileTexts = newPrefabFileTexts;
  prefabOrigin = buildOriginMap(newPrefabFileTexts);
  dirtyPrefabFiles = new Set();
  worldYamlText = newWorldText;
  worldYamlHandle = worldHandle;
  worldRaw = newWorldRaw;
  dirtyWorldFile = false;
  selectedLanguage = city.derivedLocale["en"] ? "en" : ([...Object.keys(city.derivedLocale)][0] ?? "en");
  populateLanguageSelect();

  for (const b of [...modeButtons(), ...objectModeButtons(), ...npcModeButtons(), ...prefabModeButtons(), ...tabButtons(), saveButton]) b.disabled = false;
  languageSelect.disabled = Object.keys(city.derivedLocale).length === 0;
  status.textContent = `Loaded ${newLocationFileTexts.size} location file(s), ${newObjectFileTexts.size} object file(s), ${newPrefabFileTexts.size} prefab file(s), and world.yaml.`;
  render();
  populateObjectList();
  populateNpcList();
  populatePrefabList();
}

/**
 * Reads each location/object file's raw YAML just far enough to record
 * which file every entry's `id` came from — `parseCity` itself (already
 * run successfully by the time this is called) doesn't track per-entity
 * origin file, since the game never needs to write content back out.
 * Generic across both categories: a bare YAML array of mappings each with
 * a top-level `id` is exactly what both `locations/*.yaml` and
 * `objects/*.yaml` are — see `collectFileEntries` in `cityLoader.ts`.
 */
function buildOriginMap(files: Map<string, string>): Map<string, string> {
  const origin = new Map<string, string>();
  for (const [path, text] of files) {
    if (text.trim() === "") continue;
    const root = load(text);
    if (!Array.isArray(root)) continue;
    for (const entry of root) {
      if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
        origin.set((entry as { id: string }).id, path);
      }
    }
  }
  return origin;
}

function populateLanguageSelect(): void {
  languageSelect.replaceChildren(
    ...Object.keys(city?.derivedLocale ?? {})
      .sort()
      .map((language) => {
        const option = document.createElement("option");
        option.value = language;
        option.textContent = language;
        return option;
      }),
  );
  languageSelect.value = selectedLanguage;
}

/**
 * Looks up a location's display name in the CURRENTLY SELECTED language's
 * in-memory derived-locale table — deliberately not `resolver.ts`'s `t()`.
 * Two reasons: (1) `t()` always resolves against the app's bundled,
 * build-time `en` table, not whichever language is picked in the
 * editor's own toolbar selector, and not the text the user is actively
 * editing before it's saved; (2) `resolver.ts` statically imports
 * `content/en.yaml?raw`, and Vite's dev server watches that exact file —
 * if the editor's own bundle depended on it, saving the very file the
 * editor writes would trigger Vite to reload the editor's OWN page,
 * wiping all in-memory state (this is what "the whole map disappears
 * after Save" turned out to be). Falls back to the raw key, matching
 * `t()`'s own "visible fallback for a missing key" behavior.
 */
function displayName(loc: Location): string {
  return city?.derivedLocale[selectedLanguage]?.[loc.nameKey] ?? loc.nameKey;
}

/** Rebuilds MapView's node/edge lists (and edgeLookup) from `city`, plus the in-progress draft node if one exists, and re-renders. Called after any structural edit; node drags/curve drags mutate `city` (or `draft`) in place and re-render more directly. */
function render(): void {
  if (!city) return;
  const locations = Object.values(city.locations);
  const placed = locations.filter((loc) => loc.x !== undefined && loc.y !== undefined);
  const unplaced = locations.length - placed.length;

  const nodes: MapNode[] = placed.map((loc) => {
    // While editing this location, preview the draft's (possibly dragged)
    // position instead of the stored one — MapView resolves edge
    // endpoints by looking up node ids in this same array, so connections
    // attached to this node follow the live preview too, with nothing
    // actually written into `city` until Save.
    const isEditingThis = draft !== null && draft.editingId === loc.id;
    const pos = isEditingThis ? draft! : loc;
    const kind = isEditingThis ? draft!.kind : loc.kind;
    return { id: loc.id, x: pos.x!, y: pos.y!, label: displayName(loc), tooltip: nodeTooltip(loc), kind };
  });
  if (draft && draft.editingId === null) {
    nodes.push({
      id: DRAFT_NODE_ID,
      x: draft.x,
      y: draft.y,
      label: "(new location)",
      tooltip: "Unsaved — fill out the form on the right",
      kind: draft.kind,
    });
  }
  const groups = buildConnectionEdges(placed, (id) => {
    const loc = city!.locations[id];
    return loc ? displayName(loc) : id;
  });
  edgeLookup = new Map(groups.map((g) => [g.edge.id, g.entries]));
  mapView.setData(
    nodes,
    groups.map((g) => g.edge),
  );

  notice.hidden = unplaced === 0;
  if (unplaced > 0) notice.textContent = `${unplaced} location(s) have no map position (x/y) yet and aren't shown.`;
}

/** Hover-popup text for a node — surfaces the location's id (needed to fill in another location's exteriorId field, but not otherwise visible anywhere on the graph) alongside its name and kind. */
function nodeTooltip(loc: Location): string {
  const lines = [loc.id, displayName(loc), loc.kind];
  if (loc.kind === "interior") lines.push(`exteriorId: ${loc.exteriorId}`);
  return lines.join("\n");
}

function onNodeDragged(id: string, x: number, y: number): void {
  const loc = city?.locations[id];
  if (!loc) return;
  loc.x = x;
  loc.y = y;
  regenerateLocationFile(locationOrigin.get(id));
  status.textContent = `Moved ${id} to (${x.toFixed(0)}, ${y.toFixed(0)}).`;
}

function onCurveDragged(edgeId: string, cx: number, cy: number): void {
  const entries = edgeLookup.get(edgeId);
  if (!entries || entries.length === 0) return;
  const touchedOrigins = new Set<string>();
  for (const entry of entries) {
    entry.connection.curve = { cx, cy };
    const origin = locationOrigin.get(entry.location.id);
    if (origin) touchedOrigins.add(origin);
  }
  for (const origin of touchedOrigins) regenerateLocationFile(origin);
  const first = entries[0]!;
  status.textContent = `Curved connection between ${first.location.id} and ${first.connection.toId}${entries.length > 1 ? ` (${entries.length} connections, all directions/modes)` : ""}.`;
}

function onNodeClicked(id: string): void {
  if (!city || draft) return; // a sidebar (add or edit) is already open — ignore other node clicks until it closes
  if (!connectModeOn) {
    startEditLocation(id);
    return;
  }
  if (!connectFromId) {
    connectFromId = id;
    mapView.setSelectedNode(id);
    status.textContent = `Connecting from "${id}" — click the destination location.`;
    return;
  }
  const fromId = connectFromId;
  connectFromId = null;
  mapView.setSelectedNode(null);
  if (fromId === id) return;

  // Entering/exiting a building, or moving between two interiors of the
  // SAME building (verified via exteriorId ownership, not just "one side
  // is kind: interior" — see isInteriorHop's own doc comment), always
  // gets a flat free 1-minute rate from the ENGINE regardless of what's
  // stored here (transportModes.ts's hopMinutesAndCost checks
  // isInteriorHop before ever looking at distanceKm/mode speed). Since
  // distanceKm/modes are provably inert for a real interior hop, skip
  // the prompts entirely and just record the flat 0.1km/foot-only values
  // — asking the author to type numbers the engine will never use would
  // be pure friction. It would NOT be safe to skip these prompts just
  // because one side looks like an interior: a connection between
  // UNRELATED buildings (exteriorId doesn't actually match) is a real,
  // timed/priced hop the engine computes from distanceKm/modes, so that
  // case still asks.
  // Two-way (see the toolbar's "Two-way" checkbox, default on) authors the
  // reverse Connection too, mirroring whatever fields the forward one gets
  // — including the interior-hop flat-rate special case below — so a
  // two-way door between a building's exterior and its own interior is
  // just as free/instant coming back as it was going in.
  const touchedOrigins = new Set<string>();
  const markTouched = (locationId: string) => {
    const origin = locationOrigin.get(locationId);
    if (origin) touchedOrigins.add(origin);
  };

  if (isInteriorHop({ locations: city.locations } as GameState, fromId, id)) {
    city.locations[fromId]!.connections.push({ toId: id, distanceKm: 0.1, modes: ["foot"] });
    markTouched(fromId);
    if (twoWayOn) {
      city.locations[id]!.connections.push({ toId: fromId, distanceKm: 0.1, modes: ["foot"] });
      markTouched(id);
    }
    for (const origin of touchedOrigins) regenerateLocationFile(origin);
    status.textContent = `Added interior connection ${fromId} → ${id}${twoWayOn ? " (two-way)" : ""} — flat rate, distance/mode don't affect travel time here.`;
    render();
    return;
  }

  const distanceStr = window.prompt("distanceKm:", "1");
  const distanceKm = distanceStr ? Number(distanceStr) : NaN;
  if (!Number.isFinite(distanceKm)) {
    status.textContent = "distanceKm must be a number — connection not added.";
    return;
  }
  const modesStr = window.prompt('modes (comma-separated, e.g. "foot,taxi"):', "foot");
  const modes = (modesStr ?? "").split(",").map((m) => m.trim()).filter(Boolean) as TransportMode[];
  if (modes.length === 0) {
    status.textContent = "At least one mode is required — connection not added.";
    return;
  }

  city.locations[fromId]!.connections.push({ toId: id, distanceKm, modes });
  markTouched(fromId);
  if (twoWayOn) {
    city.locations[id]!.connections.push({ toId: fromId, distanceKm, modes });
    markTouched(id);
  }
  for (const origin of touchedOrigins) regenerateLocationFile(origin);
  status.textContent = `Added connection ${fromId} → ${id}${twoWayOn ? " (two-way)" : ""}.`;
  render();
}

function onEdgeClicked(edgeId: string): void {
  if (!curveEditMode) return;
  mapView.selectEdgeForCurveEdit(edgeId);
  status.textContent = "Drag the yellow handle to bend this connection.";
}

/** Node-drag handler installed while the sidebar (add or edit) is open — scoped to ONLY the node the sidebar is currently about, whether that's the not-yet-real DRAFT_NODE_ID (add) or a real location's own id (edit). Other nodes stay undraggable while a draft is in progress, same as before. */
function onSidebarNodeDragged(id: string, x: number, y: number): void {
  if (!draft) return;
  if (id !== (draft.editingId ?? DRAFT_NODE_ID)) return;
  draft.x = x;
  draft.y = y;
  sidebar.xInput.value = String(Math.round(x));
  sidebar.yInput.value = String(Math.round(y));
}

/** Starts a new "Add location" draft: spawns a node at the current view's center (so it's always somewhere the user is actually looking at) and opens the sidebar form. Nothing is written into `city` until the form's own Save. */
function startAddLocation(): void {
  if (!city) return;
  setConnectMode(false);
  setMoveMode(false);
  setCurveMode(false);

  const center = mapView.getViewCenter() ?? { x: 0, y: 0 };
  draft = {
    editingId: null,
    x: center.x,
    y: center.y,
    kind: "exterior",
    exteriorId: "",
    prefabId: null,
    baseVisibility: "normal",
    affectedByDaylight: true,
    image: null,
  };
  draftName = "";
  draftDescription = "";

  for (const b of [...modeButtons(), ...tabButtons()]) b.disabled = true;
  mapView.enableNodeDrag(onSidebarNodeDragged);
  sidebar.open(draft, draftName, draftDescription);
  render();
}

/** Opens the sidebar to edit an EXISTING location — reached by clicking any node when not in Connect mode (see onNodeClicked). id/kind/exteriorId/x/y/name/description all start pre-filled from `loc`/the selected language's derived-locale table; nothing is written back into `city`/its origin file until Save — Cancel discards the whole edit, including any dragging done while the sidebar was open. The id itself is never editable — see the project's "ids are permanent handles" convention. */
function startEditLocation(id: string): void {
  const loc = city?.locations[id];
  if (!city || !loc || loc.x === undefined || loc.y === undefined) return;
  setConnectMode(false);
  setMoveMode(false);
  setCurveMode(false);

  draft = {
    editingId: id,
    x: loc.x,
    y: loc.y,
    kind: loc.kind,
    exteriorId: loc.kind === "interior" ? loc.exteriorId : "",
    prefabId: null,
    baseVisibility: loc.baseVisibility ?? "normal",
    affectedByDaylight: loc.kind === "interior" ? (loc.affectedByDaylight ?? true) : true,
    image: loc.image !== undefined ? sceneImageToDraft(loc.image) : null,
  };
  const table = city.derivedLocale[selectedLanguage];
  draftName = table?.[loc.nameKey] ?? "";
  draftDescription = table?.[loc.descriptionKey] ?? "";

  for (const b of [...modeButtons(), ...tabButtons()]) b.disabled = true;
  mapView.enableNodeDrag(onSidebarNodeDragged);
  mapView.setSelectedNode(id);
  sidebar.open(draft, draftName, draftDescription);
  render();
}

function endLocationForm(): void {
  draft = null;
  mapView.disableNodeDrag();
  mapView.setSelectedNode(null);
  for (const b of [...modeButtons(), ...tabButtons()]) b.disabled = false;
  sidebar.close();
  render();
}

function commitDraft(id: string, name: string, description: string): void {
  if (!city || !draft) return;
  const editingId = draft.editingId;

  if (editingId === null && !id.trim()) {
    notice.hidden = false;
    notice.textContent = "Location id is required.";
    return;
  }
  if (editingId === null && city.locations[id]) {
    notice.hidden = false;
    notice.textContent = `"${id}" already exists — choose a different id.`;
    return;
  }
  if (draft.kind === "interior" && (!city.locations[draft.exteriorId] || city.locations[draft.exteriorId]!.kind !== "exterior")) {
    notice.hidden = false;
    notice.textContent = "Pick an exterior location that owns this interior.";
    return;
  }
  notice.hidden = true;

  // A prefab picked via the Add-only "Start from prefab" picker (see
  // buildSidebar) supplies the new location's aliases (there's no
  // aliases field of its own on this form — see that picker's doc
  // comment) and, below, drives cloning its worldObjectIds onto the new
  // location. Only meaningful for Add — startEditLocation always sets
  // draft.prefabId to null, so an edit never re-stamps.
  const stampedPrefab = editingId === null && draft.prefabId ? (prefabs?.prefabs[draft.prefabId] ?? null) : null;

  const existing = editingId !== null ? city.locations[editingId] : undefined;
  const finalId = editingId ?? id;
  const base = {
    id: finalId,
    nameKey: existing?.nameKey ?? `location.${finalId}.name`,
    descriptionKey: existing?.descriptionKey ?? `location.${finalId}.description`,
    aliases: existing?.aliases ?? stampedPrefab?.aliases ?? ([] as string[]),
    connections: existing?.connections ?? ([] as Location["connections"]),
    x: draft.x,
    y: draft.y,
    ...(draft.baseVisibility !== "normal" ? { baseVisibility: draft.baseVisibility } : {}),
    ...(draft.image !== null ? { image: draftImageToScene(draft.image, `location.${finalId}.image`) } : {}),
  };
  city.locations[finalId] =
    draft.kind === "exterior"
      ? { ...base, kind: "exterior" }
      : {
          ...base,
          kind: "interior",
          exteriorId: draft.exteriorId,
          ...(draft.affectedByDaylight !== true ? { affectedByDaylight: draft.affectedByDaylight } : {}),
        };

  let table = city.derivedLocale[selectedLanguage];
  if (!table) {
    table = {};
    city.derivedLocale[selectedLanguage] = table;
  }
  if (name.trim()) table[base.nameKey] = name.trim();
  if (description.trim()) table[base.descriptionKey] = description.trim();

  if (editingId === null) {
    locationOrigin.set(finalId, NEW_LOCATION_FILE);
    if (!locationFileTexts.has(NEW_LOCATION_FILE)) locationFileTexts.set(NEW_LOCATION_FILE, "");
  }

  // Stamp: clone every worldObject the prefab decorates with under a
  // fresh id, placed at the just-created location — see
  // cloneWorldObjectForStamp's doc comment for why this is always a
  // full copy, never a reference to the prefab's own catalog ids.
  // worldObjectIds only — per the project's decision, npcIds decoration
  // isn't instantiated yet (see docs/open-issues.md); surfaced as a
  // status note instead of silently doing nothing. Runs BEFORE
  // regenerateLocationFile below — locationToRaw's itemIds come from
  // `city.initialPlacement` at the moment it's called, so this location's
  // own file has to be (re)serialized AFTER the clones' placement
  // entries exist, not before.
  const clonedIds: string[] = [];
  const missingSourceIds: string[] = [];
  if (stampedPrefab) {
    for (const sourceId of stampedPrefab.worldObjectIds) {
      const clonedId = cloneWorldObjectTo(sourceId, { kind: "location", locationId: finalId });
      if (clonedId) clonedIds.push(clonedId);
      else missingSourceIds.push(sourceId);
    }
  }

  regenerateLocationFile(locationOrigin.get(finalId));

  const missingText = !name.trim() || !description.trim();
  const verb = editingId === null ? "Added" : "Updated";
  const parts = [
    missingText
      ? `${verb} ${draft.kind} location "${finalId}" — its ${selectedLanguage} name/description is still missing.`
      : `${verb} ${draft.kind} location "${finalId}".`,
  ];
  if (stampedPrefab) {
    parts.push(`Stamped prefab "${stampedPrefab.id}", cloning ${clonedIds.length} world object(s).`);
    if (missingSourceIds.length > 0) {
      parts.push(`${missingSourceIds.length} referenced object(s) no longer exist and were skipped: ${missingSourceIds.join(", ")}.`);
    }
    if (stampedPrefab.npcIds.length > 0) {
      parts.push(`This prefab also lists ${stampedPrefab.npcIds.length} NPC(s) — NPC instantiation isn't built yet; place them manually.`);
    }
  }
  status.textContent = parts.join(" ");
  endLocationForm();
}

/**
 * Where a world object's single `Placement` entry points — either a
 * location's `itemIds` (runtime: `worldObjectLocationId`) or another
 * object's part (`containedIn`). Shared by `cloneWorldObjectTo` (what to
 * clone TO), `movePlacementTo` (what to reassign an EXISTING object's
 * placement TO), and the "place an existing object here" picker built by
 * `buildPlacementPicker` — see that function's doc comment for the two UI
 * entry points (a location's "Objects here" section, an object part's
 * "Contents" section) that construct one of these and hand it off.
 */
type PlacementTarget = { kind: "location"; locationId: string } | { kind: "container"; containerId: string; partId: string };

/** Human-readable description of a `PlacementTarget`, for status-line messages (e.g. `movePlacementTo`'s "moved from ..."). */
function describePlacementTarget(target: PlacementTarget): string {
  return target.kind === "location" ? `location "${target.locationId}"` : `"${target.containerId}"'s "${target.partId}" part`;
}

/** `id`'s current `PlacementTarget`, or `null` if it's "in storage" (no `Placement` entry at all — see `isObjectPlaced`). Read BEFORE mutating `city.initialPlacement`, so callers can regenerate whichever file is about to lose the reference (see `regeneratePlacementFiles`). */
function currentPlacementTarget(id: string): PlacementTarget | null {
  if (!city) return null;
  const locationId = city.initialPlacement.worldObjectLocationId[id];
  if (locationId) return { kind: "location", locationId };
  const contained = city.initialPlacement.containedIn[id];
  if (contained) return { kind: "container", containerId: contained.containerId, partId: contained.partId };
  return null;
}

/** Clears `id`'s `Placement` entry, whichever kind it currently is (or does nothing if already in storage) — never both `worldObjectLocationId` and `containedIn` at once, matching `Placement`'s own invariant. */
function clearPlacement(id: string): void {
  if (!city) return;
  delete city.initialPlacement.worldObjectLocationId[id];
  delete city.initialPlacement.containedIn[id];
}

/** Sets `id`'s `Placement` entry to `target`, clearing whatever it had before first — the mutation half of a move/clone/place; file regeneration is a SEPARATE step (see `regeneratePlacementFiles`), since `locationToRaw`/`objectToRaw` only need to be re-run once ALL the placement bookkeeping for one operation is done. */
function applyPlacementTarget(id: string, target: PlacementTarget): void {
  if (!city) return;
  clearPlacement(id);
  if (target.kind === "location") city.initialPlacement.worldObjectLocationId[id] = target.locationId;
  else city.initialPlacement.containedIn[id] = { containerId: target.containerId, partId: target.partId };
}

/**
 * Regenerates exactly the origin file(s) whose DERIVED content just
 * changed because `id`'s placement moved from `oldTarget` to `newTarget`
 * (either may be `null` for "was/now in storage") — must be called AFTER
 * `city.initialPlacement` already reflects the new state, never before,
 * since `locationToRaw`'s `itemIds`/`npcIds` and `objectToRaw`'s
 * `containerId`/`containerPartId` are both derived LIVE from
 * `city.initialPlacement` at regenerate time, not stored fields (see
 * their own doc comments).
 *
 * A location target touches that LOCATION's own file (gaining or losing
 * `id` in its derived `itemIds`); a container target touches `id`'s OWN
 * object file instead (gaining or losing `containerId`/`containerPartId`
 * on itself) — a container's own file never stores its contents, so the
 * container never needs regenerating here. Used by every placement
 * mutation (`cloneWorldObjectTo`'s direct-placement callers,
 * `movePlacementTo`, `unplaceObject`) so this bookkeeping lives in one
 * place instead of being re-derived per call site.
 */
function regeneratePlacementFiles(id: string, oldTarget: PlacementTarget | null, newTarget: PlacementTarget | null): void {
  const locationPaths = new Set<string>();
  const objectPaths = new Set<string>();
  for (const target of [oldTarget, newTarget]) {
    if (target?.kind === "location") {
      const path = locationOrigin.get(target.locationId);
      if (path) locationPaths.add(path);
    }
  }
  if (oldTarget?.kind === "container" || newTarget?.kind === "container") {
    const path = objectOrigin.get(id);
    if (path) objectPaths.add(path);
  }
  for (const path of locationPaths) regenerateLocationFile(path);
  for (const path of objectPaths) regenerateObjectFile(path);
}

/**
 * Reassigns an EXISTING object's single `Placement` entry to `target`,
 * clearing whatever it had before (a location, a container's part, or
 * nothing — "in storage"). Used by `buildPlacementPicker` when its "Place
 * a clone" checkbox is UNCHECKED — the picked object is genuinely moved
 * here, not duplicated.
 *
 * Only guards against the immediate, one-step self-containment case
 * (placing an object inside one of its OWN parts) — a deeper containment
 * cycle (A contains B contains A) is deliberately NOT walked here.
 * `cityLoader.ts`'s `parseCity` already re-validates the WHOLE city,
 * including full containment-cycle detection, on every Save (see
 * `docs/architecture.md`'s "world object editor" section) — a cycle this
 * function lets through surfaces as a normal Save-time validation error
 * through the existing `notice` banner, same as any other invalid edit.
 */
function movePlacementTo(id: string, target: PlacementTarget): { ok: true; movedFrom: string | null } | { ok: false; error: string } {
  if (!city || !city.worldObjects[id]) return { ok: false, error: `Object "${id}" not found.` };
  if (target.kind === "container" && target.containerId === id) {
    return { ok: false, error: "An object can't be placed inside its own part." };
  }
  const oldTarget = currentPlacementTarget(id);
  applyPlacementTarget(id, target);
  regeneratePlacementFiles(id, oldTarget, target);
  return { ok: true, movedFrom: oldTarget ? describePlacementTarget(oldTarget) : null };
}

/** Unplaces `id` — clears its `Placement` entry, returning it to storage — without deleting the `WorldObject` itself. Used by the "Remove" button in the location "Objects here" and object-part "Contents" lists (see `renderPlacementList`); a no-op if `id` was already in storage. */
function unplaceObject(id: string): void {
  if (!city) return;
  const oldTarget = currentPlacementTarget(id);
  if (!oldTarget) return;
  clearPlacement(id);
  regeneratePlacementFiles(id, oldTarget, null);
  status.textContent = `Unplaced "${id}" — now in storage.`;
  populateObjectList();
}

/**
 * Clones `sourceId` (an EXISTING `city.worldObjects` entry) under a
 * fresh id and places the clone at `target` — the core of "stamping" a
 * prefab (see `commitDraft`, which always passes a `{ kind: "location" }`
 * target — see its doc comment for why a prefab decoration is cloned
 * rather than referenced), AND of the direct "place a clone" picker
 * (`buildPlacementPicker`), which can target either a location or a
 * container's part. Always a FULL, independent copy: a new id
 * (`${sourceId}-${locationId}` for a location target, or
 * `${sourceId}-${containerId}-${partId}` for a container target, deduped
 * with a `-2`/`-3`/... suffix if that's already taken), its own
 * `parts`/`states` with keys regenerated under the new id (and their
 * text copied across EVERY language `city.derivedLocale` has, not just
 * the selected one), and its own `Placement` entry — never a second
 * reference to the SOURCE object, which can only ever occupy one
 * `Placement` slot at a time (see `engine/types.ts`'s `Placement` doc
 * comment). This is what lets the SAME catalog object be cloned into
 * many different places, each getting its own independent copy to
 * modify.
 *
 * Deliberately shallow: if `sourceId` itself is a CONTAINER (has other
 * objects placed inside its parts via `containerId`/`containerPartId`),
 * those contained objects are NOT cloned/carried along — only `sourceId`
 * itself. Nested containment inside a clone is out of scope for this
 * phase — see docs/open-issues.md.
 *
 * Only regenerates the CLONE's own new object file — a location-target
 * caller must ALSO regenerate the target location's file (its derived
 * `itemIds` just gained the new id); `commitDraft`'s prefab-stamp loop
 * does this once, itself, after cloning every decoration (see its own
 * comment), while `buildPlacementPicker`'s single-clone case calls
 * `regeneratePlacementFiles(newId, null, target)` right after this
 * returns.
 *
 * Returns the new id, or `undefined` (skipping this decoration, not
 * aborting a whole prefab stamp) if `sourceId` no longer exists in the
 * catalog — reachable if it was deleted THIS session, after the prefab
 * was loaded, before it was re-validated by a Save.
 */
function cloneWorldObjectTo(sourceId: string, target: PlacementTarget): string | undefined {
  if (!city) return undefined;
  const source = city.worldObjects[sourceId];
  if (!source) return undefined;

  const targetSlug = target.kind === "location" ? target.locationId : `${target.containerId}-${target.partId}`;
  let newId = `${sourceId}-${targetSlug}`;
  for (let suffix = 2; city.worldObjects[newId]; suffix++) {
    newId = `${sourceId}-${targetSlug}-${suffix}`;
  }

  const newNameKey = `${source.kind}.${newId}.name`;
  const newDescriptionKey = `${source.kind}.${newId}.description`;
  copyDerivedText(source.nameKey, newNameKey);
  copyDerivedText(source.descriptionKey, newDescriptionKey);

  const clone: WorldObject = {
    id: newId,
    nameKey: newNameKey,
    descriptionKey: newDescriptionKey,
    aliases: [...source.aliases],
    kind: source.kind,
    portable: source.portable,
    ...(source.announceOnRevisit !== undefined ? { announceOnRevisit: source.announceOnRevisit } : {}),
    ...(source.parts ? { parts: source.parts.map((part) => clonePartForStamp(part, source.kind, newId)) } : {}),
    // A clone shares the source's image (and its alt/label locale keys) rather than duplicating text.
    ...(source.image !== undefined ? { image: source.image } : {}),
  };
  city.worldObjects[newId] = clone;
  applyPlacementTarget(newId, target);

  objectOrigin.set(newId, NEW_OBJECT_FILE);
  if (!objectFileTexts.has(NEW_OBJECT_FILE)) objectFileTexts.set(NEW_OBJECT_FILE, "");
  regenerateObjectFile(NEW_OBJECT_FILE);

  return newId;
}

/** Renders a read-only list of placed object ids (`id — name`, in the selected language) each with a "Remove" button that unplaces it (see `unplaceObject`) — never deletes the `WorldObject` itself. Shared by the location sidebar's "Objects here" section and the object sidebar's per-part "Contents" section. */
function renderPlacementList(container: HTMLElement, ids: string[], onRemove: (id: string) => void): void {
  container.replaceChildren();
  if (ids.length === 0) {
    const empty = document.createElement("p");
    empty.className = "editor__status";
    empty.textContent = "(nothing placed here yet)";
    container.append(empty);
    return;
  }
  for (const id of [...ids].sort()) {
    const row = document.createElement("div");
    row.className = "editor__placement-item";
    const obj = city?.worldObjects[id];
    const name = obj ? (city!.derivedLocale[selectedLanguage]?.[obj.nameKey] ?? obj.nameKey) : id;
    const label = document.createElement("span");
    label.textContent = `${id} — ${name}`;
    const removeButton = document.createElement("button");
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => onRemove(id));
    row.append(label, removeButton);
    container.append(row);
  }
}

/**
 * Builds a small "place an existing catalog object here" widget: a
 * select of every catalog object (excluding, for a container target, the
 * container itself — an object can't be placed inside its own part), a
 * "Place a clone" checkbox (checked by default), and a Place button.
 * Checked, Place clones `sourceId` via `cloneWorldObjectTo` and (since
 * that only regenerates the clone's own file — see its doc comment)
 * additionally calls `regeneratePlacementFiles` for the target itself.
 * Unchecked, Place instead MOVES the picked object via `movePlacementTo`
 * — an error (e.g. the self-containment guard) is shown in `notice`
 * instead of proceeding. Either way, `onPlaced()` fires on success so the
 * caller re-renders its own placement list. Shared by the location
 * sidebar's "Objects here" section (`target.kind === "location"`) and the
 * object sidebar's per-part "Contents" section (`target.kind ===
 * "container"`).
 */
function buildPlacementPicker(target: PlacementTarget, onPlaced: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "editor__placement-picker";

  const select = document.createElement("select");
  for (const obj of Object.values(city?.worldObjects ?? {})
    .filter((o) => !(target.kind === "container" && o.id === target.containerId))
    .sort((a, b) => a.id.localeCompare(b.id))) {
    const option = document.createElement("option");
    option.value = obj.id;
    const name = city!.derivedLocale[selectedLanguage]?.[obj.nameKey] ?? obj.nameKey;
    option.textContent = `${obj.id} — ${name}`;
    select.append(option);
  }

  const cloneCheckbox = document.createElement("input");
  cloneCheckbox.type = "checkbox";
  cloneCheckbox.checked = true;
  const cloneLabel = document.createElement("label");
  cloneLabel.append(cloneCheckbox, document.createTextNode(" Place a clone"));

  const placeButton = document.createElement("button");
  placeButton.textContent = "Place";
  placeButton.addEventListener("click", () => {
    if (!city || !select.value) return;
    const sourceId = select.value;
    if (cloneCheckbox.checked) {
      const newId = cloneWorldObjectTo(sourceId, target);
      if (!newId) {
        notice.hidden = false;
        notice.textContent = `Couldn't clone "${sourceId}" — it may have been deleted this session.`;
        return;
      }
      regeneratePlacementFiles(newId, null, target);
      notice.hidden = true;
      status.textContent = `Placed a clone of "${sourceId}" as "${newId}".`;
    } else {
      const result = movePlacementTo(sourceId, target);
      if (!result.ok) {
        notice.hidden = false;
        notice.textContent = result.error;
        return;
      }
      notice.hidden = true;
      status.textContent = result.movedFrom ? `Moved "${sourceId}" here from ${result.movedFrom}.` : `Placed "${sourceId}" here.`;
    }
    populateObjectList();
    onPlaced();
  });

  row.append(select, cloneLabel, placeButton);
  return row;
}

/** Copies `city.derivedLocale[lang][oldKey]` to `[newKey]` for every language that has it — the text half of `cloneWorldObjectTo`'s clone. A language with no text for `oldKey` simply contributes nothing, same as an un-translated entity normally would. */
function copyDerivedText(oldKey: string, newKey: string): void {
  for (const table of Object.values(city!.derivedLocale)) {
    const value = table[oldKey];
    if (value !== undefined) table[newKey] = value;
  }
}

function clonePartForStamp(part: Part, objectKind: WorldObject["kind"], newObjectId: string): Part {
  const keyPrefix = `${objectKind}.${newObjectId}.${part.id}`;
  const nameKey = `${keyPrefix}.name`;
  const descriptionKey = `${keyPrefix}.description`;
  copyDerivedText(part.nameKey, nameKey);
  copyDerivedText(part.descriptionKey, descriptionKey);
  return {
    id: part.id,
    nameKey,
    descriptionKey,
    aliases: [...part.aliases],
    defaultStateId: part.defaultStateId,
    states: part.states.map((state) => clonePartStateForStamp(state, objectKind, newObjectId, part.id)),
  };
}

function clonePartStateForStamp(state: PartState, objectKind: WorldObject["kind"], newObjectId: string, partId: string): PartState {
  const keyPrefix = `${objectKind}.${newObjectId}.${partId}.${state.id}`;
  const nameKey = `${keyPrefix}.name`;
  const descriptionKey = `${keyPrefix}.description`;
  copyDerivedText(state.nameKey, nameKey);
  copyDerivedText(state.descriptionKey, descriptionKey);
  let summaryKey: string | undefined;
  if (state.summaryKey) {
    summaryKey = `${keyPrefix}.summary`;
    copyDerivedText(state.summaryKey, summaryKey);
  }
  return {
    id: state.id,
    nameKey,
    descriptionKey,
    ...(summaryKey ? { summaryKey } : {}),
    ...(state.important !== undefined ? { important: state.important } : {}),
    ...(state.enterAliases ? { enterAliases: [...state.enterAliases] } : {}),
    ...(state.exposesContents !== undefined ? { exposesContents: state.exposesContents } : {}),
    ...(state.revealInAmbientListing !== undefined ? { revealInAmbientListing: state.revealInAmbientListing } : {}),
    ...(state.image !== undefined ? { image: state.image } : {}),
  };
}

/**
 * Everything that needs to change elsewhere in `city` if `id` (plus, if
 * it's an exterior, every interior it owns — see removeLocation's cascade)
 * is deleted: incoming connections pointing at any of those ids from a
 * location that ISN'T itself being removed, and any NPC/worldObject the
 * (runtime, not-yet-built) configuration system currently places there.
 * The NPC/worldObject counts are informational only — this editor never
 * writes `world.yaml` or `objects/*.yaml`, so it can't fix those up, only
 * warn about them (see removeLocation).
 */
function computeRemovalImpact(id: string): {
  interiors: string[];
  incomingConnections: { fromId: string; index: number }[];
  npcIds: string[];
  itemIds: string[];
} {
  if (!city) return { interiors: [], incomingConnections: [], npcIds: [], itemIds: [] };
  const interiors = Object.values(city.locations)
    .filter((loc) => loc.kind === "interior" && loc.exteriorId === id)
    .map((loc) => loc.id);
  const removedIds = new Set([id, ...interiors]);

  const incomingConnections: { fromId: string; index: number }[] = [];
  for (const loc of Object.values(city.locations)) {
    if (removedIds.has(loc.id)) continue; // its own connections vanish with it — not a dangling reference
    loc.connections.forEach((conn, index) => {
      if (removedIds.has(conn.toId)) incomingConnections.push({ fromId: loc.id, index });
    });
  }

  const npcIds = [...removedIds].flatMap((locId) => npcsAtLocation(city!.initialPlacement, locId));
  const itemIds = [...removedIds].flatMap((locId) => worldObjectsAtLocation(city!.initialPlacement, locId));

  return { interiors, incomingConnections, npcIds, itemIds };
}

/**
 * Deletes the location currently open in the sidebar (plus, cascading, any
 * interior it owns) after a confirm() summarizing the blast radius. Per the
 * project's decision: NPC/worldObject references never block deletion —
 * they belong to a future runtime "configuration" system this editor
 * doesn't know about, and that system is expected to validate its own
 * placements against current content when it loads, not the other way
 * around — so those are surfaced as a warning only. Incoming connections
 * ARE auto-stripped so the city stays valid for `parseCity`. Like every
 * other edit here, nothing touches disk until the top-level Save button —
 * only `city`/`locationOrigin`/dirty-file tracking change, so the whole
 * thing is undone by just not saving (or reopening the project).
 */
function removeLocation(): void {
  if (!city || !draft || draft.editingId === null) return;
  const id = draft.editingId;
  const impact = computeRemovalImpact(id);
  const removedIds = [id, ...impact.interiors];

  const lines = [`Remove location "${id}"?`];
  if (impact.incomingConnections.length > 0) {
    const froms = [...new Set(impact.incomingConnections.map((c) => c.fromId))];
    lines.push(`${impact.incomingConnections.length} incoming connection(s), from: ${froms.join(", ")}, will be removed.`);
  }
  if (impact.interiors.length > 0) {
    lines.push(`This location has ${impact.interiors.length} interior(s) that will also be deleted: ${impact.interiors.join(", ")}.`);
  }
  if (impact.npcIds.length > 0 || impact.itemIds.length > 0) {
    lines.push(
      `This location is referenced by ${impact.npcIds.length} NPC(s) and ${impact.itemIds.length} worldObject(s). Do you still want to delete it?`,
    );
  }
  if (!window.confirm(lines.join("\n"))) return;

  const removedSet = new Set(removedIds);
  const touchedPaths = new Set<string>();
  for (const removedId of removedIds) {
    const path = locationOrigin.get(removedId);
    if (path) touchedPaths.add(path);
  }
  for (const { fromId } of impact.incomingConnections) {
    const loc = city.locations[fromId];
    if (loc) loc.connections = loc.connections.filter((conn) => !removedSet.has(conn.toId));
    const path = locationOrigin.get(fromId);
    if (path) touchedPaths.add(path);
  }
  for (const removedId of removedIds) {
    delete city.locations[removedId];
    locationOrigin.delete(removedId);
  }

  for (const path of touchedPaths) regenerateLocationFile(path);

  status.textContent = `Removed location "${id}"${impact.interiors.length > 0 ? ` and ${impact.interiors.length} interior(s)` : ""}.`;
  endLocationForm();
}

/** Builds the right-hand "Add/Edit location" form, shared by both flows. Returns the mount + a few field handles other functions need to sync (drag <-> x/y) or drive (open/close). */
function buildSidebar(): {
  root: HTMLDivElement;
  xInput: HTMLInputElement;
  yInput: HTMLInputElement;
  open: (
    initial: {
      editingId: string | null;
      x: number;
      y: number;
      kind: "exterior" | "interior";
      exteriorId: string;
      prefabId: string | null;
      baseVisibility: VisibilityTier;
      affectedByDaylight: boolean;
    },
    name: string,
    description: string,
  ) => void;
  close: () => void;
  save: () => void;
} {
  const el = document.createElement("div");
  el.className = "editor__sidebar";

  const title = document.createElement("h2");
  title.textContent = "Add location";

  // Add-only — see draft.prefabId's doc comment. Picking a prefab here
  // pre-fills kind/name/description (aliases are carried onto the new
  // location directly at Save, with no field of their own — locations
  // have no aliases-editing UI yet at all, prefab-started or not) and
  // remembers which prefab to STAMP (clone its worldObjectIds) once
  // Save actually creates the location — see commitDraft.
  const prefabSelect = document.createElement("select");
  const prefabRow = document.createElement("div");
  prefabRow.className = "editor__field editor__field--prefab-picker";
  const prefabLabel = document.createElement("label");
  prefabLabel.textContent = "Start from prefab (optional)";
  prefabRow.append(prefabLabel, prefabSelect);
  const prefabNote = document.createElement("p");
  prefabNote.className = "editor__warning";
  prefabNote.hidden = true;

  const idInput = document.createElement("input");
  idInput.type = "text";
  idInput.placeholder = "id (permanent, unique)";

  const kindSelect = document.createElement("select");
  for (const kind of ["exterior", "interior"] as const) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    kindSelect.append(option);
  }

  const exteriorRow = document.createElement("div");
  exteriorRow.className = "editor__field";
  const exteriorLabel = document.createElement("label");
  exteriorLabel.textContent = "exteriorId";
  const exteriorSelect = document.createElement("select");
  exteriorRow.append(exteriorLabel, exteriorSelect);

  const xInput = document.createElement("input");
  xInput.type = "number";
  const yInput = document.createElement("input");
  yInput.type = "number";
  const positionRow = document.createElement("div");
  positionRow.className = "editor__field editor__field--row";
  positionRow.append(labeled("x", xInput), labeled("y", yInput));

  const visibilitySelect = document.createElement("select");
  for (const tier of ["dark", "dim", "normal", "bright"] as const) {
    const option = document.createElement("option");
    option.value = tier;
    option.textContent = tier;
    visibilitySelect.append(option);
  }

  const daylightRow = document.createElement("div");
  daylightRow.className = "editor__field";
  const daylightLabel = document.createElement("label");
  const daylightCheckbox = document.createElement("input");
  daylightCheckbox.type = "checkbox";
  daylightLabel.append(daylightCheckbox, document.createTextNode(" affected by daylight (has windows)"));
  daylightRow.append(daylightLabel);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Display name";

  const descriptionInput = document.createElement("textarea");
  descriptionInput.rows = 4;
  descriptionInput.placeholder = "Description";

  const imageStatus = document.createElement("p");
  imageStatus.className = "editor__status";
  const editImageButton = document.createElement("button");
  editImageButton.type = "button";
  editImageButton.textContent = "Edit image…";
  function refreshImageStatus(): void {
    imageStatus.textContent = draft?.image ? `Image: ${draft.image.src || "(no filename)"}` : "No image";
  }
  editImageButton.addEventListener("click", () => {
    if (!draft) return;
    openImageEditor({
      baseUrl: import.meta.env.BASE_URL,
      initial: draft.image,
      onSave: (result) => {
        if (!draft) return;
        draft.image = result;
        refreshImageStatus();
      },
    });
  });
  const imageRow = document.createElement("div");
  imageRow.className = "editor__field";
  imageRow.append(imageStatus, editImageButton);

  // "Objects here" — direct placement (see docs/architecture.md's "world
  // object editor" section, "In storage" objects). Only meaningful for
  // the Edit flow: placing something needs a REAL locationId, which a
  // not-yet-saved Add draft doesn't have yet — see refreshObjectsHere's
  // editingId guard below.
  const objectsHereSection = document.createElement("div");
  objectsHereSection.className = "editor__placement-section";
  const objectsHereHeading = document.createElement("h3");
  objectsHereHeading.textContent = "Objects here";
  const objectsHereList = document.createElement("div");
  objectsHereList.className = "editor__placement-list";
  const objectsHerePickerMount = document.createElement("div");
  objectsHereSection.append(objectsHereHeading, objectsHereList, objectsHerePickerMount);

  function refreshObjectsHere(): void {
    if (!city || !draft || draft.editingId === null) {
      objectsHereSection.hidden = true;
      return;
    }
    objectsHereSection.hidden = false;
    const locationId = draft.editingId;
    renderPlacementList(objectsHereList, worldObjectsAtLocation(city.initialPlacement, locationId), (objId) => {
      unplaceObject(objId);
      refreshObjectsHere();
    });
    objectsHerePickerMount.replaceChildren(buildPlacementPicker({ kind: "location", locationId }, () => refreshObjectsHere()));
  }

  // Only meaningful for the Edit flow — there's nothing to remove yet
  // while adding a not-yet-committed location — so open() hides this for
  // editingId === null (see below).
  const removeButton = document.createElement("button");
  removeButton.textContent = "Remove location";
  removeButton.className = "editor__remove-button";
  removeButton.addEventListener("click", () => removeLocation());

  el.append(
    title,
    prefabRow,
    prefabNote,
    labeled("id", idInput),
    labeled("kind", kindSelect),
    exteriorRow,
    positionRow,
    labeled("baseVisibility", visibilitySelect),
    daylightRow,
    labeled("name", nameInput),
    labeled("description", descriptionInput),
    imageRow,
    objectsHereSection,
    removeButton,
  );

  function labeled(text: string, field: HTMLElement): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "editor__field";
    const label = document.createElement("label");
    label.textContent = text;
    row.append(label, field);
    return row;
  }

  function updateExteriorVisibility(): void {
    exteriorRow.hidden = kindSelect.value !== "interior";
    daylightRow.hidden = kindSelect.value !== "interior";
  }

  function populateExteriorOptions(excludeId: string | null): void {
    exteriorSelect.replaceChildren(
      ...Object.values(city?.locations ?? {})
        .filter((loc) => loc.kind === "exterior" && loc.id !== excludeId)
        .map((loc) => {
          const option = document.createElement("option");
          option.value = loc.id;
          option.textContent = `${loc.id} (${displayName(loc)})`;
          return option;
        }),
    );
  }

  function populatePrefabOptions(): void {
    const blankOption = document.createElement("option");
    blankOption.value = "";
    blankOption.textContent = "(blank location)";
    prefabSelect.replaceChildren(
      blankOption,
      ...Object.values(prefabs?.prefabs ?? {})
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((prefab) => {
          const option = document.createElement("option");
          option.value = prefab.id;
          option.textContent = `${prefab.id} (${prefab.kind}, ${prefab.worldObjectIds.length} object(s))`;
          return option;
        }),
    );
    prefabSelect.value = "";
  }

  /** Applies (or, for "(blank location)", clears) the picked prefab's kind/name/description/note onto the draft/form — fired on prefabSelect's own "change". open() doesn't need to call this itself: populatePrefabOptions() always resets prefabSelect to "" (blank), matching startAddLocation's draft.prefabId: null, so a freshly-opened Add form is already consistent without an extra call. */
  function applyPrefabSelection(): void {
    if (!draft) return;
    const prefab = prefabSelect.value ? (prefabs?.prefabs[prefabSelect.value] ?? null) : null;
    draft.prefabId = prefab?.id ?? null;
    if (prefab) {
      draft.kind = prefab.kind;
      kindSelect.value = prefab.kind;
      updateExteriorVisibility();
      const table = prefabs?.derivedLocale[selectedLanguage];
      nameInput.value = table?.[prefab.nameKey] ?? "";
      descriptionInput.value = table?.[prefab.descriptionKey] ?? "";
      draftName = nameInput.value;
      draftDescription = descriptionInput.value;
      prefabNote.hidden = prefab.npcIds.length === 0;
      prefabNote.textContent =
        prefab.npcIds.length > 0
          ? `This prefab also lists ${prefab.npcIds.length} NPC(s) — NPC instantiation isn't built yet; you'll need to place them manually.`
          : "";
    } else {
      // Switching back to "(blank location)" clears whatever a PREVIOUS
      // prefab selection pre-filled — the least-surprising choice, so a
      // changed mind can't leave stale prefab text behind on what's now
      // meant to be a from-scratch location. Doesn't run on the form's
      // initial open (prefabSelect already starts at "" — see
      // populatePrefabOptions/startAddLocation — so this only fires from
      // an actual selection change).
      nameInput.value = "";
      descriptionInput.value = "";
      draftName = "";
      draftDescription = "";
      prefabNote.hidden = true;
    }
    render();
  }
  prefabSelect.addEventListener("change", () => applyPrefabSelection());

  kindSelect.addEventListener("change", () => {
    if (!draft) return;
    draft.kind = kindSelect.value as "exterior" | "interior";
    updateExteriorVisibility();
    render(); // node color previews kind live too — see render()'s isEditingThis handling.
  });
  exteriorSelect.addEventListener("change", () => {
    if (!draft) return;
    draft.exteriorId = exteriorSelect.value;
  });
  visibilitySelect.addEventListener("change", () => {
    if (!draft) return;
    draft.baseVisibility = visibilitySelect.value as VisibilityTier;
  });
  daylightCheckbox.addEventListener("change", () => {
    if (!draft) return;
    draft.affectedByDaylight = daylightCheckbox.checked;
  });
  xInput.addEventListener("input", () => {
    if (!draft) return;
    const value = Number(xInput.value);
    if (Number.isFinite(value)) {
      draft.x = value;
      render();
    }
  });
  yInput.addEventListener("input", () => {
    if (!draft) return;
    const value = Number(yInput.value);
    if (Number.isFinite(value)) {
      draft.y = value;
      render();
    }
  });
  nameInput.addEventListener("input", () => {
    draftName = nameInput.value;
  });
  descriptionInput.addEventListener("input", () => {
    draftDescription = descriptionInput.value;
  });
  function save(): void {
    commitDraft(draft?.editingId ?? idInput.value.trim(), nameInput.value, descriptionInput.value);
  }

  function open(
    initial: {
      editingId: string | null;
      x: number;
      y: number;
      kind: "exterior" | "interior";
      exteriorId: string;
      prefabId: string | null;
      baseVisibility: VisibilityTier;
      affectedByDaylight: boolean;
    },
    name: string,
    description: string,
  ): void {
    title.textContent = initial.editingId === null ? "Add location" : "Edit location";
    prefabRow.hidden = initial.editingId !== null;
    prefabNote.hidden = true;
    if (initial.editingId === null) populatePrefabOptions(); // stamping only applies to Add — see prefabRow.hidden above
    idInput.value = initial.editingId ?? "";
    idInput.disabled = initial.editingId !== null;
    removeButton.hidden = initial.editingId === null;
    kindSelect.value = initial.kind;
    populateExteriorOptions(initial.editingId);
    exteriorSelect.value = initial.exteriorId;
    visibilitySelect.value = initial.baseVisibility;
    daylightCheckbox.checked = initial.affectedByDaylight;
    updateExteriorVisibility();
    xInput.value = String(Math.round(initial.x));
    yInput.value = String(Math.round(initial.y));
    nameInput.value = name;
    descriptionInput.value = description;
    refreshImageStatus();
    refreshObjectsHere();
    el.hidden = false;
    setActiveDraftKind("location");
    (initial.editingId === null ? idInput : nameInput).focus();
  }

  function close(): void {
    el.hidden = true;
    setActiveDraftKind(null);
  }

  return { root: el, xInput, yInput, open, close, save };
}

/**
 * Every language's text found for a set of derived keys, read back out of
 * `city.derivedLocale` — the inverse of what `cityLoader.ts`'s
 * `validateText` did on load. Only languages that actually have text for
 * this entity produce an entry, so an entity with no translations beyond
 * `en` doesn't grow empty `{}` blocks for every other language the
 * project happens to have elsewhere. Shared by locations and every
 * world-object-family entity (the object itself, each part, each part
 * state) — see `locationToRaw`/`objectToRaw`/`partToRaw`/`stateToRaw`.
 */
function buildEntityText(nameKey: string, descriptionKey: string, summaryKey?: string): Record<string, Record<string, string>> {
  const text: Record<string, Record<string, string>> = {};
  for (const [lang, table] of Object.entries(city!.derivedLocale)) {
    const entry: Record<string, string> = {};
    const name = table[nameKey];
    const description = table[descriptionKey];
    const summary = summaryKey ? table[summaryKey] : undefined;
    if (name !== undefined) entry.name = name;
    if (description !== undefined) entry.description = description;
    if (summary !== undefined) entry.summary = summary;
    if (Object.keys(entry).length > 0) text[lang] = entry;
  }
  return text;
}

function buildLocationText(loc: Location): Record<string, Record<string, string>> {
  return buildEntityText(loc.nameKey, loc.descriptionKey);
}

/**
 * Reconstructs the on-disk YAML shape for one location — `itemIds`/
 * `npcIds` aren't stored on `Location` anymore (see engine/types.ts's
 * `Placement` doc comment), so they're rebuilt here from
 * `city.initialPlacement`, same as the old single-`world.yaml` save()
 * used to do; `text` is rebuilt from `city.derivedLocale` (see
 * `buildLocationText`) instead of a `nameKey`/`descriptionKey` pointing
 * into a separate locale file.
 */
function locationToRaw(loc: Location): Record<string, unknown> {
  const raw: Record<string, unknown> = { id: loc.id, kind: loc.kind };
  if (loc.kind === "interior") {
    raw.exteriorId = loc.exteriorId;
    if (loc.floorNumber !== undefined) raw.floorNumber = loc.floorNumber;
    if (loc.affectedByDaylight !== undefined) raw.affectedByDaylight = loc.affectedByDaylight;
  }
  if (loc.baseVisibility !== undefined) raw.baseVisibility = loc.baseVisibility;
  raw.aliases = loc.aliases;
  const itemIds = worldObjectsAtLocation(city!.initialPlacement, loc.id);
  const npcIds = npcsAtLocation(city!.initialPlacement, loc.id);
  if (itemIds.length > 0) raw.itemIds = itemIds;
  if (npcIds.length > 0) raw.npcIds = npcIds;
  raw.connections = loc.connections;
  if (loc.x !== undefined) raw.x = loc.x;
  if (loc.y !== undefined) raw.y = loc.y;
  raw.text = buildLocationText(loc);
  if (loc.image !== undefined) raw.image = imageToRaw(loc.image);
  return raw;
}

/**
 * Rebuilds an `image:` YAML block (see SceneImage) — on a location, world
 * object, part state or NPC — from the typed shape + `city.derivedLocale`.
 * Every commit function calls this (via `draftImageToScene`, below) so an
 * image authored/edited through the "Edit image" popup (`imageEditor.ts`)
 * round-trips through a save exactly like a hand-written one.
 */
function imageToRaw(image: SceneImage): Record<string, unknown> {
  const textFor = (key: string, field: string): Record<string, Record<string, string>> => {
    const text: Record<string, Record<string, string>> = {};
    for (const [lang, table] of Object.entries(city!.derivedLocale)) {
      const value = table[key];
      if (value !== undefined) text[lang] = { [field]: value };
    }
    return text;
  };
  return {
    src: image.src,
    text: textFor(image.altKey, "alt"),
    hotspots: image.hotspots.map((h) => ({
      text: textFor(h.labelKey, "label"),
      command: h.command,
      rect: [h.x, h.y, h.w, h.h],
    })),
  };
}

/** A typed `SceneImage` -> the popup's editable `ImageDraft` shape, resolving alt/label text out of `city.derivedLocale[selectedLanguage]` for display (falls back to the raw key, same convention as every other text field in this file, e.g. `displayName`). */
function sceneImageToDraft(image: SceneImage): ImageDraft {
  const table = city!.derivedLocale[selectedLanguage];
  return {
    src: image.src,
    alt: table?.[image.altKey] ?? "",
    hotspots: image.hotspots.map((h) => ({ label: table?.[h.labelKey] ?? "", command: h.command, x: h.x, y: h.y, w: h.w, h: h.h })),
  };
}

/**
 * The popup's `ImageDraft` -> a real `SceneImage`, writing alt/label text
 * into `city.derivedLocale[selectedLanguage]` under keys matching what
 * `cityLoader.ts`'s `validateImage`/`validateHotspot` would derive for the
 * same content (`${keyPrefix}.alt`, `${keyPrefix}.hotspot${i}.label`), so
 * editor-authored images look identical to hand-written ones after a
 * round-trip. Called at each commit site instead of the old "carry the
 * existing image through untouched" passthrough.
 */
function draftImageToScene(draft: ImageDraft, keyPrefix: string): SceneImage {
  let table = city!.derivedLocale[selectedLanguage];
  if (!table) {
    table = {};
    city!.derivedLocale[selectedLanguage] = table;
  }
  const altKey = `${keyPrefix}.alt`;
  table[altKey] = draft.alt.trim();
  return {
    src: draft.src.trim(),
    altKey,
    hotspots: draft.hotspots.map((h, i) => {
      const labelKey = `${keyPrefix}.hotspot${i}.label`;
      table![labelKey] = h.label.trim();
      return { labelKey, command: h.command.trim(), x: h.x, y: h.y, w: h.w, h: h.h };
    }),
  };
}

/**
 * Recomputes one location file's full YAML text from every location
 * currently assigned to it (via `locationOrigin`) and marks it dirty for
 * the next Save. Called after any mutation that touches a location's own
 * fields (position, connections, kind/exteriorId, name/description) —
 * NOT after loading, since freshly-loaded files already have correct
 * text on disk. `path` is `undefined` only if `locationOrigin` somehow
 * has no entry for the location being edited, which would be an editor
 * bug, not a reachable content state — guarded rather than asserted so a
 * stray call can't crash the whole session.
 */
function regenerateLocationFile(path: string | undefined): void {
  if (!city || path === undefined) return;
  const entries = Object.values(city.locations)
    .filter((loc) => locationOrigin.get(loc.id) === path)
    .map((loc) => locationToRaw(loc));
  locationFileTexts.set(path, dump(entries));
  dirtyLocationFiles.add(path);
}

// --- World object editor -------------------------------------------------
// Mirrors the location editor's draft/commit/regenerate/save shape above,
// but has no map/spatial concept — objects are a flat, id-sorted list
// (objectListMount) with a form sidebar (objectSidebar), covering
// `WorldObject`'s full authored shape: kind/portable/announceOnRevisit,
// aliases, name/description, the optional `parts`/`states` sub-hierarchy
// (see docs/systems/parts.md), and containment (`containerId`/
// `containerPartId`, read/written via `city.initialPlacement.containedIn`
// — never stored on `WorldObject` itself, same as a location's itemIds/
// npcIds — see `engine/types.ts`'s `Placement` doc comment). Initial
// LOCATION placement (`worldObjectLocationId`) has no UI here — that's the
// planned Phase 3 "place a prefab" flow; an object authored here simply
// starts out unplaced until hand-added to a location's itemIds or (later)
// placed through the map editor.
//
// `ObjectPartDraft`/`ObjectStateDraft`/`objectDraft` itself are declared
// up near `draft`/`draftName`/`draftDescription` at the top of this file —
// `objectSidebar = buildObjectSidebar()` below runs at module load time,
// and its closures reference `objectDraft` by name, so the declaration
// needs to already exist (even if not yet initialized-by-use) by then.

/** The engine's actual known interaction-verb words (see `INTERACT_VERB_ALIASES` in `EnglishCommandParser.ts`) — imported directly rather than duplicated, so this list can't silently drift out of sync with the parser. */
const KNOWN_INTERACT_VERBS = new Set(Object.keys(INTERACT_VERB_ALIASES));

/** Lowercased, deduped words in `csv` that the parser doesn't actually recognize as interaction verbs yet — used to WARN (never block, per the project's decision) in the state form and in the post-save status line. */
function unknownVerbs(csv: string): string[] {
  const words = csv
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(words.filter((w) => !KNOWN_INTERACT_VERBS.has(w)))];
}

/** Every unknown verb (see `unknownVerbs`) across every state of every part in a draft, deduped — what the post-save status line reports as "flagged for engine work." */
function collectUnknownVerbs(d: NonNullable<typeof objectDraft>): string[] {
  return [...new Set(d.parts.flatMap((p) => p.states.flatMap((s) => unknownVerbs(s.enterAliasesCsv))))];
}

function csvToAliases(csv: string): string[] {
  return csv
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

function partToRaw(part: Part): Record<string, unknown> {
  return {
    id: part.id,
    aliases: part.aliases,
    defaultStateId: part.defaultStateId,
    text: buildEntityText(part.nameKey, part.descriptionKey),
    states: part.states.map(stateToRaw),
  };
}

function stateToRaw(state: PartState): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    id: state.id,
    text: buildEntityText(state.nameKey, state.descriptionKey, state.summaryKey),
  };
  if (state.important) raw.important = true;
  if (state.enterAliases?.length) raw.enterAliases = state.enterAliases;
  if (state.exposesContents) raw.exposesContents = true;
  if (state.revealInAmbientListing) raw.revealInAmbientListing = true;
  if (state.image !== undefined) raw.image = imageToRaw(state.image);
  return raw;
}

/** Reconstructs the on-disk YAML shape for one world object — mirrors `locationToRaw`. `containerId`/`containerPartId` are pulled from `city.initialPlacement.containedIn`, same rationale as a location's itemIds/npcIds. */
function objectToRaw(obj: WorldObject): Record<string, unknown> {
  const raw: Record<string, unknown> = { id: obj.id, kind: obj.kind, portable: obj.portable };
  raw.aliases = obj.aliases;
  if (obj.announceOnRevisit) raw.announceOnRevisit = true;
  const contained = city!.initialPlacement.containedIn[obj.id];
  if (contained) {
    raw.containerId = contained.containerId;
    raw.containerPartId = contained.partId;
  }
  raw.text = buildEntityText(obj.nameKey, obj.descriptionKey);
  if (obj.parts?.length) raw.parts = obj.parts.map(partToRaw);
  if (obj.image !== undefined) raw.image = imageToRaw(obj.image);
  return raw;
}

/** Recomputes one object file's full YAML text from every object currently assigned to it (via `objectOrigin`) and marks it dirty — mirrors `regenerateLocationFile`. */
function regenerateObjectFile(path: string | undefined): void {
  if (!city || path === undefined) return;
  const entries = Object.values(city.worldObjects)
    .filter((obj) => objectOrigin.get(obj.id) === path)
    .map((obj) => objectToRaw(obj));
  objectFileTexts.set(path, dump(entries));
  dirtyObjectFiles.add(path);
}

/** Whether `id` currently has a `Placement` entry - at a location OR inside a container's part. An object with neither is "in storage": still a full catalog entry, just not standing anywhere in the world yet — the deliberate way to keep an unplaced "original copy" around for future cloning (see docs/architecture.md's "world object editor" section). */
function isObjectPlaced(id: string): boolean {
  if (!city) return false;
  return id in city.initialPlacement.worldObjectLocationId || id in city.initialPlacement.containedIn;
}

/**
 * Rebuilds the object list panel — every world object, id-sorted, as a
 * clickable row showing its id/kind/portable + the selected language's
 * name, narrowed by `objectSearchQuery` (case-insensitive substring match
 * against id OR display name — a fast client-side filter, adequate for
 * a catalog in the thousands; revisit with an index if it isn't). The
 * currently-open object (if any) is highlighted so it's clear which row
 * the always-on inspector on the right is showing.
 */
function populateObjectList(): void {
  if (!city) {
    objectListMount.replaceChildren();
    return;
  }
  const query = objectSearchQuery.trim().toLowerCase();
  const objects = Object.values(city.worldObjects)
    .map((obj) => ({ obj, name: city!.derivedLocale[selectedLanguage]?.[obj.nameKey] ?? obj.nameKey, placed: isObjectPlaced(obj.id) }))
    .filter(({ obj, name }) => query === "" || obj.id.toLowerCase().includes(query) || name.toLowerCase().includes(query))
    .filter(({ placed }) => objectPlacementFilter === "all" || (objectPlacementFilter === "placed" ? placed : !placed))
    .sort((a, b) => a.obj.id.localeCompare(b.obj.id));
  objectListMount.replaceChildren(
    ...objects.map(({ obj, name, placed }) => {
      const row = document.createElement("button");
      row.className = "editor__object-list-item";
      row.classList.toggle("is-active", objectDraft?.editingId === obj.id);
      const label = document.createElement("span");
      label.textContent = `${obj.id} — ${name} (${obj.kind}${obj.portable ? ", portable" : ""}${obj.parts?.length ? `, ${obj.parts.length} part(s)` : ""})`;
      row.append(label);
      if (placed) {
        const badge = document.createElement("span");
        badge.className = "editor__object-placed-badge";
        badge.textContent = "placed";
        row.append(badge);
      }
      row.addEventListener("click", () => startEditObject(obj.id));
      return row;
    }),
  );
  if (objects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "editor__status";
    empty.textContent =
      query !== ""
        ? "No objects match your search."
        : objectPlacementFilter === "placed"
          ? "No placed objects yet."
          : objectPlacementFilter === "storage"
            ? "No objects in storage."
            : "No world objects yet — click \"Add object\" to create one.";
    objectListMount.append(empty);
  }
}

function startAddObject(): void {
  if (!city) return;
  objectDraft = {
    editingId: null,
    kind: "item",
    portable: true,
    announceOnRevisit: false,
    aliasesCsv: "",
    name: "",
    description: "",
    containerId: "",
    containerPartId: "",
    parts: [],
    image: null,
  };
  for (const b of [...objectModeButtons(), ...tabButtons()]) b.disabled = true;
  objectSidebar.open(objectDraft);
  populateObjectList();
}

/** Opens the sidebar to edit an EXISTING world object — id is never editable, same "ids are permanent handles" convention as locations. Every field (including the full parts/states tree and containment) starts pre-filled from `obj`/`city.initialPlacement.containedIn`/the selected language's derived-locale table; nothing is written back until Save. */
function startEditObject(id: string): void {
  const obj = city?.worldObjects[id];
  if (!city || !obj) return;
  const table = city.derivedLocale[selectedLanguage];
  const contained = city.initialPlacement.containedIn[id];
  objectDraft = {
    editingId: id,
    kind: obj.kind,
    portable: obj.portable,
    announceOnRevisit: obj.announceOnRevisit ?? false,
    aliasesCsv: obj.aliases.join(", "),
    name: table?.[obj.nameKey] ?? "",
    description: table?.[obj.descriptionKey] ?? "",
    containerId: contained?.containerId ?? "",
    containerPartId: contained?.partId ?? "",
    parts: (obj.parts ?? []).map((p) => ({
      id: p.id,
      aliasesCsv: p.aliases.join(", "),
      name: table?.[p.nameKey] ?? "",
      description: table?.[p.descriptionKey] ?? "",
      defaultStateId: p.defaultStateId,
      states: p.states.map((s) => ({
        id: s.id,
        name: table?.[s.nameKey] ?? "",
        description: table?.[s.descriptionKey] ?? "",
        summary: s.summaryKey ? (table?.[s.summaryKey] ?? "") : "",
        important: s.important ?? false,
        exposesContents: s.exposesContents ?? false,
        revealInAmbientListing: s.revealInAmbientListing ?? false,
        enterAliasesCsv: (s.enterAliases ?? []).join(", "),
        image: s.image !== undefined ? sceneImageToDraft(s.image) : null,
      })),
    })),
    image: obj.image !== undefined ? sceneImageToDraft(obj.image) : null,
  };
  for (const b of [...objectModeButtons(), ...tabButtons()]) b.disabled = true;
  objectSidebar.open(objectDraft);
  populateObjectList();
}

function endObjectForm(): void {
  objectDraft = null;
  for (const b of [...objectModeButtons(), ...tabButtons()]) b.disabled = false;
  objectSidebar.close();
  populateObjectList();
}

function commitObjectDraft(id: string): void {
  if (!city || !objectDraft) return;
  const editingId = objectDraft.editingId;

  if (editingId === null && !id.trim()) {
    notice.hidden = false;
    notice.textContent = "Object id is required.";
    return;
  }
  if (editingId === null && city.worldObjects[id]) {
    notice.hidden = false;
    notice.textContent = `"${id}" already exists — choose a different id.`;
    return;
  }
  const hasContainerId = objectDraft.containerId.trim() !== "";
  const hasContainerPartId = objectDraft.containerPartId.trim() !== "";
  if (hasContainerId !== hasContainerPartId) {
    notice.hidden = false;
    notice.textContent = "Pick both a container object and one of its parts, or clear both.";
    return;
  }
  for (const part of objectDraft.parts) {
    if (!part.id.trim()) {
      notice.hidden = false;
      notice.textContent = "Every part needs an id.";
      return;
    }
    if (part.states.length === 0) {
      notice.hidden = false;
      notice.textContent = `Part "${part.id}" needs at least one state.`;
      return;
    }
    if (part.states.some((s) => !s.id.trim())) {
      notice.hidden = false;
      notice.textContent = `Part "${part.id}" has a state with no id.`;
      return;
    }
    if (!part.states.some((s) => s.id === part.defaultStateId)) {
      notice.hidden = false;
      notice.textContent = `Part "${part.id}"'s default state "${part.defaultStateId}" doesn't match any of its own states.`;
      return;
    }
  }
  notice.hidden = true;

  const finalId = editingId ?? id.trim();
  const kind = objectDraft.kind;
  const keyPrefix = `${kind}.${finalId}`;

  const parts: Part[] = objectDraft.parts.map((p) => {
    const partKeyPrefix = `${keyPrefix}.${p.id}`;
    const states: PartState[] = p.states.map((s) => {
      const stateKeyPrefix = `${partKeyPrefix}.${s.id}`;
      const enterAliases = csvToAliases(s.enterAliasesCsv).map((a) => a.toLowerCase());
      return {
        id: s.id,
        nameKey: `${stateKeyPrefix}.name`,
        descriptionKey: `${stateKeyPrefix}.description`,
        ...(s.summary.trim() ? { summaryKey: `${stateKeyPrefix}.summary` } : {}),
        ...(s.important ? { important: true } : {}),
        ...(enterAliases.length > 0 ? { enterAliases } : {}),
        ...(s.exposesContents ? { exposesContents: true } : {}),
        ...(s.revealInAmbientListing ? { revealInAmbientListing: true } : {}),
        ...(s.image !== null ? { image: draftImageToScene(s.image, `${stateKeyPrefix}.image`) } : {}),
      };
    });
    return {
      id: p.id,
      nameKey: `${partKeyPrefix}.name`,
      descriptionKey: `${partKeyPrefix}.description`,
      aliases: csvToAliases(p.aliasesCsv),
      states,
      defaultStateId: p.defaultStateId,
    };
  });

  const worldObject: WorldObject = {
    id: finalId,
    nameKey: `${keyPrefix}.name`,
    descriptionKey: `${keyPrefix}.description`,
    aliases: csvToAliases(objectDraft.aliasesCsv),
    kind,
    portable: objectDraft.portable,
    ...(kind === "setpiece" && objectDraft.announceOnRevisit ? { announceOnRevisit: true } : {}),
    ...(parts.length > 0 ? { parts } : {}),
    ...(objectDraft.image !== null ? { image: draftImageToScene(objectDraft.image, `${keyPrefix}.image`) } : {}),
  };
  city.worldObjects[finalId] = worldObject;

  let table = city.derivedLocale[selectedLanguage];
  if (!table) {
    table = {};
    city.derivedLocale[selectedLanguage] = table;
  }
  if (objectDraft.name.trim()) table[worldObject.nameKey] = objectDraft.name.trim();
  if (objectDraft.description.trim()) table[worldObject.descriptionKey] = objectDraft.description.trim();
  for (const p of objectDraft.parts) {
    const partPrefix = `${keyPrefix}.${p.id}`;
    if (p.name.trim()) table[`${partPrefix}.name`] = p.name.trim();
    if (p.description.trim()) table[`${partPrefix}.description`] = p.description.trim();
    for (const s of p.states) {
      const statePrefix = `${partPrefix}.${s.id}`;
      if (s.name.trim()) table[`${statePrefix}.name`] = s.name.trim();
      if (s.description.trim()) table[`${statePrefix}.description`] = s.description.trim();
      if (s.summary.trim()) table[`${statePrefix}.summary`] = s.summary.trim();
    }
  }

  if (hasContainerId) {
    city.initialPlacement.containedIn[finalId] = { containerId: objectDraft.containerId, partId: objectDraft.containerPartId };
  } else {
    delete city.initialPlacement.containedIn[finalId];
  }

  if (editingId === null) {
    objectOrigin.set(finalId, NEW_OBJECT_FILE);
    if (!objectFileTexts.has(NEW_OBJECT_FILE)) objectFileTexts.set(NEW_OBJECT_FILE, "");
  }
  regenerateObjectFile(objectOrigin.get(finalId));

  const flaggedVerbs = collectUnknownVerbs(objectDraft);
  const verb = editingId === null ? "Added" : "Updated";
  status.textContent =
    flaggedVerbs.length > 0
      ? `${verb} ${kind} "${finalId}". Not yet wired into the parser: ${flaggedVerbs.join(", ")} — flagged for engine work, not blocking.`
      : `${verb} ${kind} "${finalId}".`;
  endObjectForm();
  populateObjectList();
}

/**
 * Deletes the object currently open in the sidebar after a confirm()
 * summarizing the blast radius — mirrors `removeLocation`'s "warn, then
 * cascade what's straightforward to fix, never silently corrupt a
 * reference" posture. Unlike a location's itemIds/npcIds (informational
 * only, per `removeLocation`'s doc comment, since the editor has no
 * placement UI to fix them with), CONTAINMENT is something this editor DOES
 * own end to end, so a deleted container's contained objects are actually
 * un-contained here (not just warned about) and their own origin files
 * regenerated so the stale `containerId` never reaches disk.
 */
function removeObject(): void {
  if (!city || !objectDraft || objectDraft.editingId === null) return;
  const id = objectDraft.editingId;

  const placedAt = city.initialPlacement.worldObjectLocationId[id];
  const containedChildren = Object.entries(city.initialPlacement.containedIn)
    .filter(([, c]) => c.containerId === id)
    .map(([childId]) => childId);

  const lines = [`Remove object "${id}"?`];
  if (placedAt) lines.push(`It's placed at location "${placedAt}" — that reference will be removed too.`);
  if (containedChildren.length > 0) {
    lines.push(`${containedChildren.length} object(s) are contained inside its part(s): ${containedChildren.join(", ")}. They'll become uncontained (not placed anywhere) rather than left pointing at a deleted object.`);
  }
  if (!window.confirm(lines.join("\n"))) return;

  delete city.worldObjects[id];
  delete city.initialPlacement.worldObjectLocationId[id];
  delete city.initialPlacement.containedIn[id];

  const touchedObjectPaths = new Set<string>();
  for (const childId of containedChildren) {
    delete city.initialPlacement.containedIn[childId];
    const childPath = objectOrigin.get(childId);
    if (childPath) touchedObjectPaths.add(childPath);
  }

  const ownPath = objectOrigin.get(id);
  objectOrigin.delete(id);
  if (ownPath) touchedObjectPaths.add(ownPath);
  for (const path of touchedObjectPaths) regenerateObjectFile(path);

  if (placedAt) {
    const locationPath = locationOrigin.get(placedAt);
    if (locationPath) regenerateLocationFile(locationPath);
  }

  status.textContent = `Removed object "${id}".`;
  endObjectForm();
  populateObjectList();
}

/**
 * One node in an object's read-only "Structure view" tree (see
 * `buildObjectSidebar`'s `structureDetails`) — a projection over
 * `WorldObject.parts`/`states` plus `city.initialPlacement.containedIn`,
 * never persisted or edited itself; built fresh from the last-SAVED
 * catalog each time the panel is (re)opened, so it does not reflect an
 * in-progress unsaved edit. Beyond the root, `kind: "object"` nodes are
 * OTHER catalog objects placed inside one of this tree's parts (e.g. a
 * photograph in a desk's drawer) — clicking one jumps the inspector to
 * THAT object via `startEditObject`, which is how deep containment stays
 * reachable without a global graph view. See `docs/future_work.md`'s
 * "Interactive object structure graph" entry for why this is read-only
 * for now.
 */
interface ObjectStructureNode {
  kind: "object" | "part" | "state";
  id: string;
  label: string;
  flags: string[];
  children: ObjectStructureNode[];
}

/** Builds the state-and-contained-object children of one `Part` belonging to `objId` — see `buildObjectStructureTree`, which calls this once per part. */
function buildPartStructureNode(objId: string, part: Part, city: CityContent, visited: Set<string>): ObjectStructureNode {
  const stateNodes: ObjectStructureNode[] = part.states.map((state: PartState) => {
    const flags: string[] = [];
    if (state.id === part.defaultStateId) flags.push("default");
    if (state.important) flags.push("important");
    if (state.exposesContents) flags.push("exposesContents");
    if (state.revealInAmbientListing) flags.push("revealInAmbientListing");
    return { kind: "state", id: state.id, label: state.id || "(state needs an id)", flags, children: [] };
  });
  const containedObjectNodes = Object.entries(city.initialPlacement.containedIn)
    .filter(([, c]) => c.containerId === objId && c.partId === part.id)
    .map(([childId]) => buildObjectStructureTree(childId, city, visited))
    .filter((n): n is ObjectStructureNode => n !== null);
  return { kind: "part", id: part.id, label: part.id || "(part needs an id)", flags: [], children: [...stateNodes, ...containedObjectNodes] };
}

/**
 * Builds the structure tree rooted at `objId`: its parts, each part's
 * states, and — recursively — any other catalog object contained in one
 * of those parts. `visited` guards against a containment cycle (never
 * authored intentionally, but nothing in the editor's save validation
 * currently rejects one) turning this into an infinite loop; a cycle just
 * silently stops recursing rather than erroring, since this is a
 * best-effort read-only view, not something save-blocking should depend on.
 */
function buildObjectStructureTree(objId: string, city: CityContent, visited: Set<string> = new Set()): ObjectStructureNode | null {
  const obj = city.worldObjects[objId];
  if (!obj || visited.has(objId)) return null;
  visited.add(objId);
  const name = city.derivedLocale[selectedLanguage]?.[obj.nameKey] ?? obj.nameKey;
  const children = (obj.parts ?? []).map((part) => buildPartStructureNode(objId, part, city, visited));
  return { kind: "object", id: obj.id, label: `${obj.id} — ${name}`, flags: [], children };
}

/** Renders one `ObjectStructureNode` (and its children) as a nested `<li>` — plain recursive DOM, not a canvas/graph library, consistent with the rest of this editor. Object nodes beyond the root are clickable (jump the inspector to that object via `startEditObject`); part/state nodes are inert labels. */
function renderObjectStructureNode(node: ObjectStructureNode, isRoot: boolean): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `editor__structure-node editor__structure-node--${node.kind}`;
  if (node.kind === "object" && !isRoot) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "editor__structure-link";
    link.textContent = node.label;
    link.addEventListener("click", () => startEditObject(node.id));
    li.append(link);
  } else {
    const label = document.createElement("span");
    label.textContent = node.label;
    li.append(label);
  }
  if (node.flags.length > 0) {
    const flags = document.createElement("span");
    flags.className = "editor__structure-flags";
    flags.textContent = ` [${node.flags.join(", ")}]`;
    li.append(flags);
  }
  if (node.children.length > 0) {
    const ul = document.createElement("ul");
    ul.append(...node.children.map((c) => renderObjectStructureNode(c, false)));
    li.append(ul);
  }
  return li;
}

/** Rebuilds `container`'s structure-tree display for `objId` from the current `city` — called whenever the Structure view panel opens or the inspector switches to a different (saved) object. Renders nothing (caller shows the "save this object first" note instead) if `objId` has no entry in `city.worldObjects` yet, e.g. a brand-new unsaved draft. */
function renderObjectStructureTree(container: HTMLElement, objId: string): void {
  container.replaceChildren();
  if (!city) return;
  const root = buildObjectStructureTree(objId, city);
  if (!root) return;
  const ul = document.createElement("ul");
  ul.className = "editor__structure-tree";
  ul.append(renderObjectStructureNode(root, true));
  container.append(ul);
}

/** Builds the right-hand "Add/Edit object" form. Returns the mount + open()/close() — same shape as buildSidebar()'s return, but open() takes only the draft (no separate name/description args) since objectDraft already carries them. */
function buildObjectSidebar(): {
  root: HTMLDivElement;
  open: (initial: NonNullable<typeof objectDraft>) => void;
  close: () => void;
  save: () => void;
} {
  const el = document.createElement("div");
  // Both sidebars share "editor__sidebar" for shared field/action styling,
  // but always coexist in the DOM (only `hidden` toggles) — the second
  // class lets tests/CSS target this one specifically instead of
  // ambiguously matching the location sidebar's identically-placeholder'd
  // "Display name"/"Description" fields via a bare attribute selector.
  el.className = "editor__sidebar editor__sidebar--object";

  const title = document.createElement("h2");

  const idInput = document.createElement("input");
  idInput.type = "text";
  idInput.placeholder = "id (permanent, unique)";

  const kindSelect = document.createElement("select");
  for (const kind of ["item", "setpiece"] as const) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    kindSelect.append(option);
  }
  kindSelect.addEventListener("change", () => {
    if (!objectDraft) return;
    objectDraft.kind = kindSelect.value as "item" | "setpiece";
    updateAnnounceVisibility();
  });

  const portableCheckbox = fieldCheckbox("portable (can be picked up)", (checked) => {
    if (objectDraft) objectDraft.portable = checked;
  });

  const announceRow = fieldCheckboxRow("announce on every revisit (setpieces only)", (checked) => {
    if (objectDraft) objectDraft.announceOnRevisit = checked;
  });
  function updateAnnounceVisibility(): void {
    announceRow.row.hidden = kindSelect.value !== "setpiece";
  }

  const aliasesInput = document.createElement("input");
  aliasesInput.type = "text";
  aliasesInput.placeholder = "letter, note, ...";
  aliasesInput.addEventListener("input", () => {
    if (objectDraft) objectDraft.aliasesCsv = aliasesInput.value;
  });

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Display name";
  nameInput.addEventListener("input", () => {
    if (objectDraft) objectDraft.name = nameInput.value;
  });

  const descriptionInput = document.createElement("textarea");
  descriptionInput.rows = 4;
  descriptionInput.placeholder = "Description";
  descriptionInput.addEventListener("input", () => {
    if (objectDraft) objectDraft.description = descriptionInput.value;
  });

  const imageStatus = document.createElement("p");
  imageStatus.className = "editor__status";
  const editImageButton = document.createElement("button");
  editImageButton.type = "button";
  editImageButton.textContent = "Edit image…";
  function refreshImageStatus(): void {
    imageStatus.textContent = objectDraft?.image ? `Image: ${objectDraft.image.src || "(no filename)"}` : "No image";
  }
  editImageButton.addEventListener("click", () => {
    if (!objectDraft) return;
    openImageEditor({
      baseUrl: import.meta.env.BASE_URL,
      initial: objectDraft.image,
      onSave: (result) => {
        if (!objectDraft) return;
        objectDraft.image = result;
        refreshImageStatus();
      },
    });
  });
  const imageRow = document.createElement("div");
  imageRow.className = "editor__field";
  imageRow.append(imageStatus, editImageButton);

  // Containment — "contained in another object's part" (a photograph
  // inside a desk drawer). Deliberately separate from an initial LOCATION
  // placement, which this editor has no UI for yet — see this section's
  // top-of-block doc comment.
  const containerSelect = document.createElement("select");
  const containerPartSelect = document.createElement("select");
  function populateContainerOptions(): void {
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "(none — not placed anywhere yet)";
    containerSelect.replaceChildren(
      noneOption,
      ...Object.values(city?.worldObjects ?? {})
        .filter((o) => (o.parts?.length ?? 0) > 0 && o.id !== objectDraft?.editingId)
        .map((o) => {
          const opt = document.createElement("option");
          opt.value = o.id;
          opt.textContent = o.id;
          return opt;
        }),
    );
  }
  function populateContainerPartOptions(): void {
    const container = city?.worldObjects[containerSelect.value];
    containerPartSelect.replaceChildren(
      ...(container?.parts ?? []).map((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.id;
        return opt;
      }),
    );
    containerPartSelect.disabled = containerSelect.value === "";
  }
  containerSelect.addEventListener("change", () => {
    if (!objectDraft) return;
    objectDraft.containerId = containerSelect.value;
    populateContainerPartOptions();
    objectDraft.containerPartId = containerPartSelect.value;
  });
  containerPartSelect.addEventListener("change", () => {
    if (objectDraft) objectDraft.containerPartId = containerPartSelect.value;
  });

  // Structure view — a read-only tree of this object's parts/states plus
  // anything contained inside them (see `buildObjectStructureTree`'s doc
  // comment). Built from the last-SAVED `city`, not the live draft, so it
  // does not reflect an unsaved part/state edit until you Save and reopen
  // it — acceptable for a read-only overview panel; a live-from-draft
  // version would need to re-derive the tree from `objectDraft.parts`
  // instead, not worth the complexity for v1 (see docs/future_work.md).
  const structureDetails = document.createElement("details");
  structureDetails.className = "editor__structure";
  const structureSummary = document.createElement("summary");
  structureSummary.textContent = "Structure view (read-only)";
  const structureTreeContainer = document.createElement("div");
  structureTreeContainer.className = "editor__structure-tree-container";
  const structureEmptyNote = document.createElement("p");
  structureEmptyNote.className = "editor__status";
  structureEmptyNote.textContent = "Save this object first to see its structure.";
  structureDetails.append(structureSummary, structureTreeContainer, structureEmptyNote);
  function refreshStructureView(): void {
    if (!objectDraft?.editingId) {
      structureTreeContainer.replaceChildren();
      structureEmptyNote.hidden = false;
      return;
    }
    structureEmptyNote.hidden = true;
    renderObjectStructureTree(structureTreeContainer, objectDraft.editingId);
  }
  structureDetails.addEventListener("toggle", () => {
    if (structureDetails.open) refreshStructureView();
  });

  const partsHeading = document.createElement("h3");
  partsHeading.textContent = "Parts";
  const partsContainer = document.createElement("div");
  partsContainer.className = "editor__parts";
  const addPartButton = document.createElement("button");
  addPartButton.textContent = "+ Add part";
  addPartButton.addEventListener("click", () => {
    if (!objectDraft) return;
    objectDraft.parts.push({ id: "", aliasesCsv: "", name: "", description: "", defaultStateId: "", states: [] });
    renderParts();
  });

  function renderParts(): void {
    partsContainer.replaceChildren();
    if (!objectDraft) return;
    objectDraft.parts.forEach((part, partIndex) => partsContainer.append(buildPartBlock(part, partIndex)));
  }

  /** Builds one part's editable block, including its nested states list — rebuilt wholesale by `renderParts()` on any structural change (add/remove part or state); individual text/checkbox edits mutate the draft in place without a re-render, except where a state's own `id` needs to be reflected live in its part's `defaultStateId` dropdown (see `refreshDefaultStateOptions`). */
  function buildPartBlock(part: ObjectPartDraft, partIndex: number): HTMLElement {
    const block = document.createElement("div");
    block.className = "editor__part";

    const heading = document.createElement("div");
    heading.className = "editor__part-heading";
    heading.append(document.createTextNode(`Part ${partIndex + 1}`));
    const removePartButton = document.createElement("button");
    removePartButton.textContent = "Remove part";
    removePartButton.addEventListener("click", () => {
      objectDraft?.parts.splice(partIndex, 1);
      renderParts();
    });
    heading.append(removePartButton);

    const defaultStateSelect = document.createElement("select");
    function refreshDefaultStateOptions(): void {
      defaultStateSelect.replaceChildren(
        ...part.states.map((s) => {
          const opt = document.createElement("option");
          opt.value = s.id;
          opt.textContent = s.id || "(state needs an id)";
          return opt;
        }),
      );
      defaultStateSelect.value = part.defaultStateId;
    }
    defaultStateSelect.addEventListener("change", () => {
      part.defaultStateId = defaultStateSelect.value;
    });

    const statesContainer = document.createElement("div");
    function renderStates(): void {
      statesContainer.replaceChildren();
      part.states.forEach((state, stateIndex) => statesContainer.append(buildStateBlock(part, state, stateIndex, () => renderStates())));
      refreshDefaultStateOptions();
    }

    const addStateButton = document.createElement("button");
    addStateButton.textContent = "+ Add state";
    addStateButton.addEventListener("click", () => {
      part.states.push({
        id: "",
        name: "",
        description: "",
        summary: "",
        important: false,
        exposesContents: false,
        revealInAmbientListing: false,
        enterAliasesCsv: "",
        image: null,
      });
      if (part.states.length === 1) part.defaultStateId = part.states[0]!.id;
      renderStates();
    });

    block.append(
      heading,
      fieldRow("part id", textInput(part.id, (v) => (part.id = v))),
      fieldRow("aliases (comma-separated)", textInput(part.aliasesCsv, (v) => (part.aliasesCsv = v))),
      fieldRow("name", textInput(part.name, (v) => (part.name = v))),
      fieldRow("description", textArea(part.description, (v) => (part.description = v))),
      fieldRow("default state", defaultStateSelect),
      statesContainer,
      addStateButton,
    );

    // "Contents" — direct placement of OTHER objects into THIS part (see
    // docs/architecture.md's "world object editor" section). Only
    // meaningful once both this object AND this part have a real, saved
    // id to contain against — a brand-new object (Add flow) or a
    // just-added, not-yet-saved part has neither yet, so this section is
    // simply omitted rather than pointing containment at ids that don't
    // exist on disk. Distinct from the top-level "contained in" dropdown
    // above (editing THIS object's own placement); this edits OTHER
    // objects' placement into one of THIS object's parts. KNOWN
    // LIMITATION: `partId` is captured once, at build time — renaming an
    // existing part's id afterward (without Save+reopen) leaves this
    // section targeting the OLD id until the form is reopened; harmless
    // (Save-time validation still requires the part to exist), just stale
    // in the UI for the rest of that edit session.
    if (objectDraft?.editingId && part.id.trim() !== "") {
      const containerId = objectDraft.editingId;
      const partId = part.id;
      const contentsSection = document.createElement("div");
      contentsSection.className = "editor__placement-section";
      const contentsHeading = document.createElement("h4");
      contentsHeading.textContent = "Contents";
      const contentsList = document.createElement("div");
      contentsList.className = "editor__placement-list";
      const contentsPickerMount = document.createElement("div");
      contentsSection.append(contentsHeading, contentsList, contentsPickerMount);

      function refreshContents(): void {
        if (!city) return;
        renderPlacementList(contentsList, containedWorldObjectsIn(city.initialPlacement, containerId, partId), (objId) => {
          unplaceObject(objId);
          refreshContents();
        });
        contentsPickerMount.replaceChildren(buildPlacementPicker({ kind: "container", containerId, partId }, () => refreshContents()));
      }
      refreshContents();
      block.append(contentsSection);
    }

    renderStates();
    return block;
  }

  /** Builds one state's editable block. `onStructuralChange` is `buildPartBlock`'s `renderStates`, called only when this state's own id changes (to keep the part's default-state dropdown in sync) or when it's removed — never on every keystroke of an unrelated field. */
  function buildStateBlock(part: ObjectPartDraft, state: ObjectStateDraft, stateIndex: number, onStructuralChange: () => void): HTMLElement {
    const block = document.createElement("div");
    block.className = "editor__state";

    const heading = document.createElement("div");
    heading.className = "editor__state-heading";
    heading.append(document.createTextNode(`State ${stateIndex + 1}`));
    const removeStateButton = document.createElement("button");
    removeStateButton.textContent = "Remove state";
    removeStateButton.addEventListener("click", () => {
      part.states.splice(stateIndex, 1);
      onStructuralChange();
    });
    heading.append(removeStateButton);

    const idInputEl = textInput(state.id, (v) => {
      // If this state WAS the part's default (by id match) before the
      // rename, keep it the default under its new id — otherwise renaming
      // a part's only/default state would silently leave `defaultStateId`
      // pointing at an id that no longer exists on any state, which
      // commitObjectDraft's validation would then reject at Save time.
      const wasDefault = state.id === part.defaultStateId;
      state.id = v;
      if (wasDefault) part.defaultStateId = v;
      onStructuralChange();
    });

    const enterAliasesInput = document.createElement("input");
    enterAliasesInput.type = "text";
    enterAliasesInput.placeholder = "open, unlock, ...";
    enterAliasesInput.value = state.enterAliasesCsv;
    const verbWarning = document.createElement("p");
    verbWarning.className = "editor__warning";
    function refreshVerbWarning(): void {
      const unknown = unknownVerbs(state.enterAliasesCsv);
      verbWarning.hidden = unknown.length === 0;
      verbWarning.textContent =
        unknown.length > 0
          ? `"${unknown.join('", "')}" ${unknown.length === 1 ? "isn't" : "aren't"} wired into the parser yet (INTERACT_VERB_ALIASES in EnglishCommandParser.ts) — flagged for engine work, not blocking save.`
          : "";
    }
    enterAliasesInput.addEventListener("input", () => {
      state.enterAliasesCsv = enterAliasesInput.value;
      refreshVerbWarning();
    });
    refreshVerbWarning();
    const enterAliasesRow = fieldRow("enterAliases (comma-separated verb words)", enterAliasesInput);
    enterAliasesRow.append(verbWarning);

    const stateImageStatus = document.createElement("p");
    stateImageStatus.className = "editor__status";
    stateImageStatus.textContent = state.image ? `Image: ${state.image.src || "(no filename)"}` : "No image";
    const editStateImageButton = document.createElement("button");
    editStateImageButton.type = "button";
    editStateImageButton.textContent = "Edit image…";
    editStateImageButton.addEventListener("click", () => {
      openImageEditor({
        baseUrl: import.meta.env.BASE_URL,
        initial: state.image,
        onSave: (result) => {
          state.image = result;
          stateImageStatus.textContent = state.image ? `Image: ${state.image.src || "(no filename)"}` : "No image";
        },
      });
    });
    const stateImageRow = document.createElement("div");
    stateImageRow.className = "editor__field";
    stateImageRow.append(stateImageStatus, editStateImageButton);

    block.append(
      heading,
      fieldRow("state id", idInputEl),
      fieldRow("name", textInput(state.name, (v) => (state.name = v))),
      fieldRow("description", textArea(state.description, (v) => (state.description = v))),
      fieldRow("summary (optional — for the parent's ambient bubble-up)", textInput(state.summary, (v) => (state.summary = v))),
      fieldCheckboxRow("important (surface in the parent's general examine)", (v) => (state.important = v), state.important).row,
      enterAliasesRow,
      fieldCheckboxRow("exposesContents (reveals what's inside while current)", (v) => (state.exposesContents = v), state.exposesContents).row,
      fieldCheckboxRow("revealInAmbientListing (also join the location's item line)", (v) => (state.revealInAmbientListing = v), state.revealInAmbientListing).row,
      stateImageRow,
    );
    return block;
  }

  // Re-reads the top-level fields straight from their inputs at click time
  // (same as buildSidebar()'s location form does for name/description) —
  // guards against relying solely on "input" events having fired for
  // every field, the way an autofill/programmatic value-set sometimes
  // skips them.
  function save(): void {
    if (!objectDraft) return;
    objectDraft.aliasesCsv = aliasesInput.value;
    objectDraft.name = nameInput.value;
    objectDraft.description = descriptionInput.value;
    commitObjectDraft(objectDraft.editingId ?? idInput.value.trim());
  }

  const removeButton = document.createElement("button");
  removeButton.textContent = "Remove object";
  removeButton.className = "editor__remove-button";
  removeButton.addEventListener("click", () => removeObject());

  const placeholder = document.createElement("p");
  placeholder.className = "editor__status editor__inspector-placeholder";
  placeholder.textContent = 'Select an object from the list, or click "Add object" to create one.';

  // The inspector itself is always visible in Objects mode (see
  // setEditorMode) — only which of these two children is shown toggles,
  // so the panel's width/position never jumps around depending on whether
  // something is selected.
  const idKindRow = document.createElement("div");
  idKindRow.className = "editor__field editor__field--row";
  idKindRow.append(fieldRow("id", idInput), fieldRow("kind", kindSelect));

  const flagsRow = document.createElement("div");
  flagsRow.className = "editor__field editor__field--row";
  flagsRow.append(portableCheckbox.row, announceRow.row);

  const containerRow = document.createElement("div");
  containerRow.className = "editor__field editor__field--row";
  containerRow.append(fieldRow("contained in — object", containerSelect), fieldRow("contained in — part", containerPartSelect));

  const formContent = document.createElement("div");
  formContent.className = "editor__inspector-form";
  formContent.hidden = true;
  formContent.append(
    title,
    idKindRow,
    flagsRow,
    fieldRow("aliases (comma-separated)", aliasesInput),
    fieldRow("name", nameInput),
    fieldRow("description", descriptionInput),
    imageRow,
    containerRow,
    structureDetails,
    partsHeading,
    partsContainer,
    addPartButton,
    removeButton,
  );

  el.append(placeholder, formContent);

  function open(initial: NonNullable<typeof objectDraft>): void {
    title.textContent = initial.editingId === null ? "Add object" : "Edit object";
    idInput.value = initial.editingId ?? "";
    idInput.disabled = initial.editingId !== null;
    removeButton.hidden = initial.editingId === null;
    kindSelect.value = initial.kind;
    updateAnnounceVisibility();
    (portableCheckbox.input as HTMLInputElement).checked = initial.portable;
    (announceRow.input as HTMLInputElement).checked = initial.announceOnRevisit;
    aliasesInput.value = initial.aliasesCsv;
    nameInput.value = initial.name;
    descriptionInput.value = initial.description;
    refreshImageStatus();
    populateContainerOptions();
    containerSelect.value = initial.containerId;
    populateContainerPartOptions();
    containerPartSelect.value = initial.containerPartId;
    renderParts();
    structureDetails.open = false;
    refreshStructureView();
    placeholder.hidden = true;
    formContent.hidden = false;
    setActiveDraftKind("object");
    (initial.editingId === null ? idInput : nameInput).focus();
  }

  function close(): void {
    placeholder.hidden = false;
    formContent.hidden = true;
    setActiveDraftKind(null);
  }

  return { root: el, open, close, save };
}

// --- Shared small-form helpers (used by the object sidebar above) --------

function fieldRow(text: string, field: HTMLElement): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "editor__field";
  const label = document.createElement("label");
  label.textContent = text;
  row.append(label, field);
  return row;
}

function textInput(value: string, onInput: (v: string) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function textArea(value: string, onInput: (v: string) => void): HTMLTextAreaElement {
  const area = document.createElement("textarea");
  area.rows = 3;
  area.value = value;
  area.addEventListener("input", () => onInput(area.value));
  return area;
}

function fieldCheckbox(labelText: string, onChange: (v: boolean) => void): { row: HTMLDivElement; input: HTMLInputElement } {
  return fieldCheckboxRow(labelText, onChange);
}

function fieldCheckboxRow(labelText: string, onChange: (v: boolean) => void, checked = false): { row: HTMLDivElement; input: HTMLInputElement } {
  const row = document.createElement("div");
  row.className = "editor__field editor__field--checkbox";
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  label.append(input, document.createTextNode(" " + labelText));
  row.append(label);
  return { row, input };
}

// --- Location prefab editor -----------------------------------------------
// A prefab is a reusable location TEMPLATE (name/description/kind plus a
// decoration of EXISTING catalog world objects/NPCs) — see
// `content/prefabLoader.ts`'s doc comment for why it's a wholly separate
// content graph (`prefabs`, not `city`) that the game never loads. Mirrors
// the object editor's list+sidebar+per-file-dirty-write shape closely,
// but has no parts/states concept of its own — decoration is just picking
// existing ids off a checklist, not authoring new content inline.

/** Every language's text for a PREFAB's own name/description — reads `prefabs.derivedLocale`, a separate table from `city.derivedLocale` (see `buildEntityText`, which every OTHER entity kind in this file uses instead). */
function buildPrefabText(prefab: LocationPrefab): Record<string, Record<string, string>> {
  const text: Record<string, Record<string, string>> = {};
  for (const [lang, table] of Object.entries(prefabs!.derivedLocale)) {
    const entry: Record<string, string> = {};
    const name = table[prefab.nameKey];
    const description = table[prefab.descriptionKey];
    if (name !== undefined) entry.name = name;
    if (description !== undefined) entry.description = description;
    if (Object.keys(entry).length > 0) text[lang] = entry;
  }
  return text;
}

/** Reconstructs the on-disk YAML shape for one prefab — mirrors `objectToRaw`. */
function prefabToRaw(prefab: LocationPrefab): Record<string, unknown> {
  const raw: Record<string, unknown> = { id: prefab.id, kind: prefab.kind, aliases: prefab.aliases };
  if (prefab.worldObjectIds.length > 0) raw.worldObjectIds = prefab.worldObjectIds;
  if (prefab.npcIds.length > 0) raw.npcIds = prefab.npcIds;
  raw.text = buildPrefabText(prefab);
  return raw;
}

/** Recomputes one prefab file's full YAML text from every prefab currently assigned to it (via `prefabOrigin`) and marks it dirty — mirrors `regenerateObjectFile`. */
function regeneratePrefabFile(path: string | undefined): void {
  if (!prefabs || path === undefined) return;
  const entries = Object.values(prefabs.prefabs)
    .filter((p) => prefabOrigin.get(p.id) === path)
    .map((p) => prefabToRaw(p));
  prefabFileTexts.set(path, dump(entries));
  dirtyPrefabFiles.add(path);
}

/** Rebuilds the prefab list panel — every prefab, id-sorted, as a clickable row. */
function populatePrefabList(): void {
  if (!prefabs) {
    prefabListMount.replaceChildren();
    return;
  }
  const rows = Object.values(prefabs.prefabs).sort((a, b) => a.id.localeCompare(b.id));
  prefabListMount.replaceChildren(
    ...rows.map((prefab) => {
      const row = document.createElement("button");
      row.className = "editor__object-list-item";
      const name = prefabs!.derivedLocale[selectedLanguage]?.[prefab.nameKey] ?? prefab.nameKey;
      row.textContent = `${prefab.id} — ${name} (${prefab.kind}, ${prefab.worldObjectIds.length} object(s), ${prefab.npcIds.length} npc(s))`;
      row.addEventListener("click", () => startEditPrefab(prefab.id));
      return row;
    }),
  );
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "editor__status";
    empty.textContent = 'No prefabs yet — click "Add prefab" to create one.';
    prefabListMount.append(empty);
  }
}

function startAddPrefab(): void {
  if (!city || !prefabs) return;
  prefabDraft = {
    editingId: null,
    kind: "exterior",
    aliasesCsv: "",
    name: "",
    description: "",
    worldObjectIds: new Set(),
    npcIds: new Set(),
  };
  for (const b of [...prefabModeButtons(), ...tabButtons()]) b.disabled = true;
  prefabSidebar.open(prefabDraft);
}

/** Opens the sidebar to edit an EXISTING prefab — id never editable, same convention as locations/objects. */
function startEditPrefab(id: string): void {
  const prefab = prefabs?.prefabs[id];
  if (!city || !prefabs || !prefab) return;
  const table = prefabs.derivedLocale[selectedLanguage];
  prefabDraft = {
    editingId: id,
    kind: prefab.kind,
    aliasesCsv: prefab.aliases.join(", "),
    name: table?.[prefab.nameKey] ?? "",
    description: table?.[prefab.descriptionKey] ?? "",
    worldObjectIds: new Set(prefab.worldObjectIds),
    npcIds: new Set(prefab.npcIds),
  };
  for (const b of [...prefabModeButtons(), ...tabButtons()]) b.disabled = true;
  prefabSidebar.open(prefabDraft);
}

function endPrefabForm(): void {
  prefabDraft = null;
  for (const b of [...prefabModeButtons(), ...tabButtons()]) b.disabled = false;
  prefabSidebar.close();
}

function commitPrefabDraft(id: string): void {
  if (!city || !prefabs || !prefabDraft) return;
  const editingId = prefabDraft.editingId;

  if (editingId === null && !id.trim()) {
    notice.hidden = false;
    notice.textContent = "Prefab id is required.";
    return;
  }
  if (editingId === null && prefabs.prefabs[id]) {
    notice.hidden = false;
    notice.textContent = `"${id}" already exists — choose a different id.`;
    return;
  }
  notice.hidden = true;

  const finalId = editingId ?? id.trim();
  const prefab: LocationPrefab = {
    id: finalId,
    kind: prefabDraft.kind,
    nameKey: `prefab.${finalId}.name`,
    descriptionKey: `prefab.${finalId}.description`,
    aliases: csvToAliases(prefabDraft.aliasesCsv),
    worldObjectIds: [...prefabDraft.worldObjectIds],
    npcIds: [...prefabDraft.npcIds],
  };
  prefabs.prefabs[finalId] = prefab;

  let table = prefabs.derivedLocale[selectedLanguage];
  if (!table) {
    table = {};
    prefabs.derivedLocale[selectedLanguage] = table;
  }
  if (prefabDraft.name.trim()) table[prefab.nameKey] = prefabDraft.name.trim();
  if (prefabDraft.description.trim()) table[prefab.descriptionKey] = prefabDraft.description.trim();

  if (editingId === null) {
    prefabOrigin.set(finalId, NEW_PREFAB_FILE);
    if (!prefabFileTexts.has(NEW_PREFAB_FILE)) prefabFileTexts.set(NEW_PREFAB_FILE, "");
  }
  regeneratePrefabFile(prefabOrigin.get(finalId));

  const verb = editingId === null ? "Added" : "Updated";
  status.textContent = `${verb} prefab "${finalId}".`;
  endPrefabForm();
  populatePrefabList();
}

function removePrefab(): void {
  if (!prefabs || !prefabDraft || prefabDraft.editingId === null) return;
  const id = prefabDraft.editingId;
  if (!window.confirm(`Remove prefab "${id}"?`)) return;

  const path = prefabOrigin.get(id);
  delete prefabs.prefabs[id];
  prefabOrigin.delete(id);
  if (path) regeneratePrefabFile(path);

  status.textContent = `Removed prefab "${id}".`;
  endPrefabForm();
  populatePrefabList();
}

/** Builds one checkbox list (used for both the world-object and NPC decoration pickers) — every KNOWN id from the loaded catalog, checked state driven by `selected`, mutating it in place via `onToggle`. */
function renderChecklist(container: HTMLElement, ids: string[], selected: Set<string>, onToggle: (id: string, checked: boolean) => void): void {
  container.replaceChildren();
  if (ids.length === 0) {
    const empty = document.createElement("p");
    empty.className = "editor__status";
    empty.textContent = "(none authored yet)";
    container.append(empty);
    return;
  }
  for (const id of ids) {
    const row = document.createElement("label");
    row.className = "editor__checklist-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selected.has(id);
    input.addEventListener("change", () => {
      if (input.checked) selected.add(id);
      else selected.delete(id);
      onToggle(id, input.checked);
    });
    row.append(input, document.createTextNode(" " + id));
    container.append(row);
  }
}

/** Builds the right-hand "Add/Edit prefab" form. */
function buildPrefabSidebar(): {
  root: HTMLDivElement;
  open: (initial: NonNullable<typeof prefabDraft>) => void;
  close: () => void;
  save: () => void;
} {
  const el = document.createElement("div");
  el.className = "editor__sidebar editor__sidebar--prefab";

  const title = document.createElement("h2");

  const idInput = document.createElement("input");
  idInput.type = "text";
  idInput.placeholder = "id (permanent, unique)";

  const kindSelect = document.createElement("select");
  for (const kind of ["exterior", "interior"] as const) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    kindSelect.append(option);
  }
  kindSelect.addEventListener("change", () => {
    if (prefabDraft) prefabDraft.kind = kindSelect.value as "exterior" | "interior";
  });

  const aliasesInput = document.createElement("input");
  aliasesInput.type = "text";
  aliasesInput.placeholder = "alley, the alley, ...";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Display name";

  const descriptionInput = document.createElement("textarea");
  descriptionInput.rows = 4;
  descriptionInput.placeholder = "Description";

  const worldObjectsHeading = document.createElement("h3");
  worldObjectsHeading.textContent = "Decorate with world objects";
  const worldObjectsChecklist = document.createElement("div");
  worldObjectsChecklist.className = "editor__checklist";

  const npcsHeading = document.createElement("h3");
  npcsHeading.textContent = "Decorate with NPCs";
  const npcsChecklist = document.createElement("div");
  npcsChecklist.className = "editor__checklist";

  // Re-reads the top-level fields straight from their inputs at click
  // time, same rationale as the object sidebar's Save button.
  function save(): void {
    if (!prefabDraft) return;
    prefabDraft.aliasesCsv = aliasesInput.value;
    prefabDraft.name = nameInput.value;
    prefabDraft.description = descriptionInput.value;
    commitPrefabDraft(prefabDraft.editingId ?? idInput.value.trim());
  }

  const removeButton = document.createElement("button");
  removeButton.textContent = "Remove prefab";
  removeButton.className = "editor__remove-button";
  removeButton.addEventListener("click", () => removePrefab());

  el.append(
    title,
    fieldRow("id", idInput),
    fieldRow("kind", kindSelect),
    fieldRow("aliases (comma-separated)", aliasesInput),
    fieldRow("name", nameInput),
    fieldRow("description", descriptionInput),
    worldObjectsHeading,
    worldObjectsChecklist,
    npcsHeading,
    npcsChecklist,
    removeButton,
  );

  function open(initial: NonNullable<typeof prefabDraft>): void {
    title.textContent = initial.editingId === null ? "Add prefab" : "Edit prefab";
    idInput.value = initial.editingId ?? "";
    idInput.disabled = initial.editingId !== null;
    removeButton.hidden = initial.editingId === null;
    kindSelect.value = initial.kind;
    aliasesInput.value = initial.aliasesCsv;
    nameInput.value = initial.name;
    descriptionInput.value = initial.description;
    renderChecklist(worldObjectsChecklist, Object.keys(city?.worldObjects ?? {}).sort(), initial.worldObjectIds, () => {});
    renderChecklist(npcsChecklist, Object.keys(city?.npcs ?? {}).sort(), initial.npcIds, () => {});
    el.hidden = false;
    setActiveDraftKind("prefab");
    (initial.editingId === null ? idInput : nameInput).focus();
  }

  function close(): void {
    el.hidden = true;
    setActiveDraftKind(null);
  }

  return { root: el, open, close, save };
}

// --- NPC editor ------------------------------------------------------------
// Unlike Locations/Objects/Prefabs (each reconstructed from typed content
// via a `*ToRaw` function that owns the WHOLE on-disk shape), the NPC
// editor only edits a subset of what an NPC can have — id, aliases,
// starting location, labels, name/description/fallback-dialogue text,
// (Stage 2) schedule, and (Stage 3) stats/trust/suspicion.
// `dialogueRules`/`topics`, and the NPC's initial knowledge/memories
// (which aren't even on the `Npc` record — see `CityContent.
// initialNpcStates`), have no UI here — a
// deliberate scope decision (see this file's top doc comment), not
// something to silently drop. So `upsertNpcRaw` MERGES its changes onto
// whatever raw YAML mapping already exists for that id in `worldRaw.npcs`
// (see `worldRaw`'s doc comment) rather than reconstructing the whole
// entry — every field this editor doesn't edit survives untouched, in its
// exact original YAML shape, with no lossy round-trip through typed
// reconstruction needed. The in-memory `city.npcs[id]` record is kept
// consistent the same way: `commitNpcDraft` spreads the PREVIOUS typed
// `Npc` forward before overwriting only the fields it actually edits.

/** Ensures `worldRaw.npcs` exists as an array (every real project's `world.yaml` already declares one; this only guards a hand-edited or brand-new one that doesn't) and returns it for in-place mutation. */
function npcsRawArray(): unknown[] {
  if (!worldRaw) return [];
  if (!Array.isArray(worldRaw.npcs)) worldRaw.npcs = [];
  return worldRaw.npcs as unknown[];
}

/** Recomputes `world.yaml`'s full text from `worldRaw` (whose `npcs` array is the only part this editor ever mutates — see the section doc comment above) and marks it dirty — mirrors `regenerateObjectFile`, but for the single file instead of per-origin fan-out. */
function regenerateWorldFile(): void {
  if (!worldRaw) return;
  worldYamlText = dump(worldRaw);
  dirtyWorldFile = true;
}

/** Every language's text for an NPC's name/description/fallback-dialogue — mirrors `buildEntityText`, but NPC text nests under `text.<lang>.{name,description,dialogue}` (a "dialogue" field, not "summary") — see `cityLoader.ts`'s `validateNpc`. */
function buildNpcText(nameKey: string, descriptionKey: string, dialogueKey: string): Record<string, Record<string, string>> {
  const text: Record<string, Record<string, string>> = {};
  for (const [lang, table] of Object.entries(city!.derivedLocale)) {
    const entry: Record<string, string> = {};
    const name = table[nameKey];
    const description = table[descriptionKey];
    const dialogue = table[dialogueKey];
    if (name !== undefined) entry.name = name;
    if (description !== undefined) entry.description = description;
    if (dialogue !== undefined) entry.dialogue = dialogue;
    if (Object.keys(entry).length > 0) text[lang] = entry;
  }
  return text;
}

/**
 * Writes one NPC's Stage-1-editable fields into `worldRaw.npcs`, merging
 * onto (not replacing) any existing raw entry for the same id — see this
 * section's doc comment for why. Then regenerates `world.yaml`.
 */
function upsertNpcRaw(npc: Npc): void {
  const npcs = npcsRawArray();
  const index = npcs.findIndex((entry) => isRecord(entry) && entry.id === npc.id);
  const candidate = index >= 0 ? npcs[index] : undefined;
  const existing: Record<string, unknown> = isRecord(candidate) ? candidate : {};
  const existingText: Record<string, unknown> = isRecord(existing.text) ? existing.text : {};
  const raw: Record<string, unknown> = {
    ...existing,
    id: npc.id,
    aliases: npc.aliases,
    locationId: city!.initialPlacement.npcLocationId[npc.id] ?? "",
    labels: npc.labels,
    text: { ...existingText, ...buildNpcText(npc.nameKey, npc.descriptionKey, npc.dialogueKey) },
  };
  if (npc.schedule && npc.schedule.length > 0) raw.schedule = npc.schedule;
  else delete raw.schedule;
  if (npc.stats && Object.keys(npc.stats).length > 0) raw.stats = npc.stats;
  else delete raw.stats;
  // Unlike the fields above, `image:` isn't rebuilt from `npc.*` by
  // `buildNpcText` — it needs its own explicit set-or-delete, otherwise the
  // `...existing` spread above would silently keep (or, if `commitNpcDraft`
  // removed the image, silently revive) whatever was already in this raw
  // entry, same hazard `commitDraft`/`commitObjectDraft` guard against.
  if (npc.image !== undefined) raw.image = imageToRaw(npc.image);
  else delete raw.image;
  // trust/suspicion live in `city.initialNpcStates`, not on `npc` — read
  // them from there (`commitNpcDraft` always sets an entry before calling
  // this). Only written when non-default (0), mirroring the loader's own
  // "trust/suspicion default to 0" posture and this editor's "only write
  // non-default optional fields" convention elsewhere.
  const initialState = city!.initialNpcStates[npc.id];
  if (initialState && initialState.trust !== 0) raw.trust = initialState.trust;
  else delete raw.trust;
  if (initialState && initialState.suspicion !== 0) raw.suspicion = initialState.suspicion;
  else delete raw.suspicion;
  if (index >= 0) npcs[index] = raw;
  else npcs.push(raw);
  regenerateWorldFile();
}

/**
 * Rebuilds the NPC list panel — every NPC, id-sorted, as a clickable row
 * showing its id, the selected language's display name, and its starting
 * location; narrowed by `npcSearchQuery` (case-insensitive substring
 * match against id OR display name) — mirrors `populateObjectList`.
 */
function populateNpcList(): void {
  if (!city) {
    npcListMount.replaceChildren();
    return;
  }
  const query = npcSearchQuery.trim().toLowerCase();
  const rows = Object.values(city.npcs)
    .map((npc) => ({
      npc,
      name: city!.derivedLocale[selectedLanguage]?.[npc.nameKey] ?? npc.nameKey,
      locationId: city!.initialPlacement.npcLocationId[npc.id] ?? "?",
    }))
    .filter(({ npc, name }) => query === "" || npc.id.toLowerCase().includes(query) || name.toLowerCase().includes(query))
    .sort((a, b) => a.npc.id.localeCompare(b.npc.id));
  npcListMount.replaceChildren(
    ...rows.map(({ npc, name, locationId }) => {
      const row = document.createElement("button");
      row.className = "editor__object-list-item";
      row.classList.toggle("is-active", npcDraft?.editingId === npc.id);
      row.textContent = `${npc.id} — ${name} (${locationId})`;
      row.addEventListener("click", () => startEditNpc(npc.id));
      return row;
    }),
  );
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "editor__status";
    empty.textContent = query !== "" ? "No NPCs match your search." : 'No NPCs yet — click "Add NPC" to create one.';
    npcListMount.append(empty);
  }
}

function startAddNpc(): void {
  if (!city) return;
  npcDraft = {
    editingId: null,
    aliasesCsv: "",
    name: "",
    description: "",
    dialogue: "",
    locationId: Object.keys(city.locations)[0] ?? "",
    labels: new Set(),
    schedule: [],
    trustStr: "0",
    suspicionStr: "0",
    stats: { stealth: "", intimidation: "", handguns: "" },
    image: null,
  };
  for (const b of [...npcModeButtons(), ...tabButtons()]) b.disabled = true;
  npcSidebar.open(npcDraft);
  populateNpcList();
}

/** Opens the sidebar to edit an EXISTING NPC — id never editable, same "ids are permanent handles" convention as locations/objects/prefabs. Fields with no UI yet (dialogueRules/topics, and initial knowledge/memories) aren't part of the draft at all — see this section's doc comment on how they survive a Save regardless. */
function startEditNpc(id: string): void {
  const npc = city?.npcs[id];
  if (!city || !npc) return;
  const table = city.derivedLocale[selectedLanguage];
  npcDraft = {
    editingId: id,
    aliasesCsv: npc.aliases.join(", "),
    name: table?.[npc.nameKey] ?? "",
    description: table?.[npc.descriptionKey] ?? "",
    dialogue: table?.[npc.dialogueKey] ?? "",
    locationId: city.initialPlacement.npcLocationId[id] ?? "",
    labels: new Set(npc.labels),
    schedule: (npc.schedule ?? []).map((slot) => ({
      fromHour: String(slot.fromHour),
      toHour: String(slot.toHour),
      locationId: slot.locationId,
      weekdays: slot.weekdays ? new Set(slot.weekdays) : null,
    })),
    trustStr: String(city.initialNpcStates[id]?.trust ?? 0),
    suspicionStr: String(city.initialNpcStates[id]?.suspicion ?? 0),
    stats: {
      stealth: npc.stats?.stealth !== undefined ? String(npc.stats.stealth) : "",
      intimidation: npc.stats?.intimidation !== undefined ? String(npc.stats.intimidation) : "",
      handguns: npc.stats?.handguns !== undefined ? String(npc.stats.handguns) : "",
    },
    image: npc.image !== undefined ? sceneImageToDraft(npc.image) : null,
  };
  for (const b of [...npcModeButtons(), ...tabButtons()]) b.disabled = true;
  npcSidebar.open(npcDraft);
  populateNpcList();
}

function endNpcForm(): void {
  npcDraft = null;
  for (const b of [...npcModeButtons(), ...tabButtons()]) b.disabled = false;
  npcSidebar.close();
  populateNpcList();
}

function commitNpcDraft(id: string): void {
  if (!city || !npcDraft) return;
  const editingId = npcDraft.editingId;

  if (editingId === null && !id.trim()) {
    notice.hidden = false;
    notice.textContent = "NPC id is required.";
    return;
  }
  if (editingId === null && city.npcs[id]) {
    notice.hidden = false;
    notice.textContent = `"${id}" already exists — choose a different id.`;
    return;
  }
  if (!npcDraft.locationId.trim() || !city.locations[npcDraft.locationId]) {
    notice.hidden = false;
    notice.textContent = "Pick a valid starting location.";
    return;
  }
  if (!npcDraft.name.trim()) {
    notice.hidden = false;
    notice.textContent = "Name is required.";
    return;
  }
  if (!npcDraft.description.trim()) {
    notice.hidden = false;
    notice.textContent = "Description is required.";
    return;
  }
  if (!npcDraft.dialogue.trim()) {
    notice.hidden = false;
    notice.textContent = "Fallback dialogue is required.";
    return;
  }
  for (const labelId of npcDraft.labels) {
    if (!city.labels[labelId]) {
      notice.hidden = false;
      notice.textContent = `"${labelId}" is not a known label.`;
      return;
    }
  }
  // Schedule slots — validated here (not blocking as-you-type) so a
  // mid-edit invalid value doesn't fight the user; `fromHour > toHour`
  // (wraps past midnight, e.g. 22 -> 6) is explicitly VALID per
  // `ScheduleSlot`'s own doc comment, so it's deliberately not checked.
  const parsedSchedule: ScheduleSlot[] = [];
  for (let i = 0; i < npcDraft.schedule.length; i++) {
    const slot = npcDraft.schedule[i]!;
    const fromHour = Number.parseInt(slot.fromHour, 10);
    const toHour = Number.parseInt(slot.toHour, 10);
    if (!Number.isInteger(fromHour) || fromHour < 0 || fromHour > 23) {
      notice.hidden = false;
      notice.textContent = `Schedule slot ${i + 1} has an invalid "from" hour (must be 0-23).`;
      return;
    }
    if (!Number.isInteger(toHour) || toHour < 0 || toHour > 24) {
      notice.hidden = false;
      notice.textContent = `Schedule slot ${i + 1} has an invalid "to" hour (must be 0-24).`;
      return;
    }
    if (fromHour === toHour) {
      notice.hidden = false;
      notice.textContent = `Schedule slot ${i + 1} has zero duration (from and to hours are the same).`;
      return;
    }
    if (!slot.locationId.trim() || !city.locations[slot.locationId]) {
      notice.hidden = false;
      notice.textContent = `Schedule slot ${i + 1} needs a valid location.`;
      return;
    }
    parsedSchedule.push({
      fromHour,
      toHour,
      locationId: slot.locationId,
      ...(slot.weekdays !== null ? { weekdays: [...slot.weekdays].sort((a, b) => a - b) } : {}),
    });
  }

  const trust = Number.parseFloat(npcDraft.trustStr);
  if (!Number.isFinite(trust)) {
    notice.hidden = false;
    notice.textContent = "Trust must be a number.";
    return;
  }
  const suspicion = Number.parseFloat(npcDraft.suspicionStr);
  if (!Number.isFinite(suspicion)) {
    notice.hidden = false;
    notice.textContent = "Suspicion must be a number.";
    return;
  }
  const statsBlock: StatBlock = {};
  for (const key of Object.keys(npcDraft.stats) as StatKey[]) {
    const raw = npcDraft.stats[key].trim();
    if (raw === "") continue;
    const value = Number.parseInt(raw, 10);
    const def = STAT_DEFINITIONS[key];
    if (!Number.isInteger(value) || value < def.min || value > def.max) {
      notice.hidden = false;
      notice.textContent = `${key} must be a whole number between ${def.min} and ${def.max} (or left blank).`;
      return;
    }
    statsBlock[key] = value;
  }
  notice.hidden = true;

  const finalId = editingId ?? id.trim();
  const keyPrefix = `npc.${finalId}`;
  // Spread the PREVIOUS typed Npc forward (dialogueRules/topics/schedule/
  // stats) before overwriting only what this form actually edits — see
  // this section's doc comment. A brand-new NPC starts with no rules.
  const previous = editingId !== null ? city.npcs[editingId] : undefined;
  const npc: Npc = {
    ...(previous ?? { dialogueRules: [] }),
    id: finalId,
    nameKey: `${keyPrefix}.name`,
    descriptionKey: `${keyPrefix}.description`,
    dialogueKey: `${keyPrefix}.dialogue`,
    aliases: csvToAliases(npcDraft.aliasesCsv),
    labels: [...npcDraft.labels],
  };
  // Explicit set-or-delete rather than a conditional spread: since `npc`
  // spreads the PREVIOUS Npc forward (which may carry an old schedule),
  // clearing every slot in the form must actually remove the field, not
  // leave the previous one in place.
  if (parsedSchedule.length > 0) npc.schedule = parsedSchedule;
  else delete npc.schedule;
  if (Object.keys(statsBlock).length > 0) npc.stats = statsBlock;
  else delete npc.stats;
  if (npcDraft.image !== null) npc.image = draftImageToScene(npcDraft.image, `${keyPrefix}.image`);
  else delete npc.image;
  city.npcs[finalId] = npc;

  // trust/suspicion aren't `Npc` fields (see `NpcState`'s doc comment) —
  // they live in the mutable-slice SEED, `city.initialNpcStates`. Spread
  // the previous entry forward so memories/opinions/knowledge (which this
  // form has no UI for) survive, same posture as `npc`'s own spread above.
  const previousState = city.initialNpcStates[finalId];
  city.initialNpcStates[finalId] = {
    ...(previousState ?? { memories: [], opinions: {}, knowledge: {} }),
    trust,
    suspicion,
  };

  let table = city.derivedLocale[selectedLanguage];
  if (!table) {
    table = {};
    city.derivedLocale[selectedLanguage] = table;
  }
  table[npc.nameKey] = npcDraft.name.trim();
  table[npc.descriptionKey] = npcDraft.description.trim();
  table[npc.dialogueKey] = npcDraft.dialogue.trim();

  city.initialPlacement.npcLocationId[finalId] = npcDraft.locationId;

  upsertNpcRaw(npc);

  const verb = editingId === null ? "Added" : "Updated";
  status.textContent = `${verb} NPC "${finalId}".`;
  endNpcForm();
  populateNpcList();
}

/**
 * Deletes the NPC currently open in the sidebar after a confirm() —
 * informational-only warning if any prefab decorates with it (this editor
 * has no fixup path for that, same posture as `removeLocation`'s NPC/item
 * warnings). Unlike a world object, an NPC has no containment/contents of
 * its own to cascade-fix.
 */
function removeNpc(): void {
  if (!city || !npcDraft || npcDraft.editingId === null) return;
  const id = npcDraft.editingId;

  const decoratingPrefabs = Object.values(prefabs?.prefabs ?? {})
    .filter((p) => p.npcIds.includes(id))
    .map((p) => p.id);

  const lines = [`Remove NPC "${id}"?`];
  if (decoratingPrefabs.length > 0) {
    lines.push(`${decoratingPrefabs.length} prefab(s) decorate with it: ${decoratingPrefabs.join(", ")}. Do you still want to delete it?`);
  }
  if (!window.confirm(lines.join("\n"))) return;

  delete city.npcs[id];
  delete city.initialPlacement.npcLocationId[id];
  delete city.initialNpcStates[id];

  const npcs = npcsRawArray();
  const index = npcs.findIndex((entry) => isRecord(entry) && entry.id === id);
  if (index >= 0) npcs.splice(index, 1);
  regenerateWorldFile();

  status.textContent = `Removed NPC "${id}".`;
  endNpcForm();
  populateNpcList();
}

/** Builds the right-hand "Add/Edit NPC" form — mirrors `buildObjectSidebar`'s always-visible-with-placeholder shape (not the prefab sidebar's hide/show shape), since an NPC catalog is small but authors will want to jump between NPCs to compare fields. */
function buildNpcSidebar(): {
  root: HTMLDivElement;
  open: (initial: NonNullable<typeof npcDraft>) => void;
  close: () => void;
  save: () => void;
} {
  const el = document.createElement("div");
  el.className = "editor__sidebar editor__sidebar--npc";

  const title = document.createElement("h2");

  const idInput = document.createElement("input");
  idInput.type = "text";
  idInput.placeholder = "id (permanent, unique)";

  const aliasesInput = document.createElement("input");
  aliasesInput.type = "text";
  aliasesInput.placeholder = "hale, officer, ...";
  aliasesInput.addEventListener("input", () => {
    if (npcDraft) npcDraft.aliasesCsv = aliasesInput.value;
  });

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Display name";
  nameInput.addEventListener("input", () => {
    if (npcDraft) npcDraft.name = nameInput.value;
  });

  const descriptionInput = document.createElement("textarea");
  descriptionInput.rows = 3;
  descriptionInput.placeholder = "Description";
  descriptionInput.addEventListener("input", () => {
    if (npcDraft) npcDraft.description = descriptionInput.value;
  });

  const dialogueInput = document.createElement("textarea");
  dialogueInput.rows = 3;
  dialogueInput.placeholder = "Fallback dialogue (shown when no dialogueRules entry matches)";
  dialogueInput.addEventListener("input", () => {
    if (npcDraft) npcDraft.dialogue = dialogueInput.value;
  });

  const imageStatus = document.createElement("p");
  imageStatus.className = "editor__status";
  const editImageButton = document.createElement("button");
  editImageButton.type = "button";
  editImageButton.textContent = "Edit image…";
  function refreshImageStatus(): void {
    imageStatus.textContent = npcDraft?.image ? `Image: ${npcDraft.image.src || "(no filename)"}` : "No image";
  }
  editImageButton.addEventListener("click", () => {
    if (!npcDraft) return;
    openImageEditor({
      baseUrl: import.meta.env.BASE_URL,
      initial: npcDraft.image,
      onSave: (result) => {
        if (!npcDraft) return;
        npcDraft.image = result;
        refreshImageStatus();
      },
    });
  });
  const imageRow = document.createElement("div");
  imageRow.className = "editor__field";
  imageRow.append(imageStatus, editImageButton);

  function populateLocationOptions(select: HTMLSelectElement): void {
    select.replaceChildren(
      ...Object.keys(city?.locations ?? {})
        .sort()
        .map((id) => {
          const opt = document.createElement("option");
          opt.value = id;
          opt.textContent = id;
          return opt;
        }),
    );
  }

  const locationSelect = document.createElement("select");
  locationSelect.addEventListener("change", () => {
    if (npcDraft) npcDraft.locationId = locationSelect.value;
  });

  const labelsHeading = document.createElement("h3");
  labelsHeading.textContent = "Labels";
  const labelsChecklist = document.createElement("div");
  labelsChecklist.className = "editor__checklist";

  // --- Schedule — a stack of slot cards, mirroring the WorldObject
  // editor's Parts/States pattern (buildPartBlock/renderParts): any
  // structural change (add/remove a slot) re-renders the whole list via
  // renderScheduleSlots(); individual field edits mutate the draft slot
  // in place without a re-render. An empty list is the "always at
  // starting location" case, made visible via `scheduleHint` rather than
  // left as a silent absence.
  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const scheduleHeading = document.createElement("h3");
  scheduleHeading.textContent = "Schedule";
  const scheduleHint = document.createElement("p");
  scheduleHint.className = "editor__status";
  scheduleHint.textContent = "No schedule — NPC stays at its starting location.";
  const scheduleContainer = document.createElement("div");
  scheduleContainer.className = "editor__schedule-slots";
  const addScheduleSlotButton = document.createElement("button");
  addScheduleSlotButton.textContent = "+ Add schedule slot";
  addScheduleSlotButton.addEventListener("click", () => {
    if (!npcDraft) return;
    npcDraft.schedule.push({ fromHour: "8", toHour: "18", locationId: npcDraft.locationId, weekdays: null });
    renderScheduleSlots();
  });

  function renderScheduleSlots(): void {
    scheduleContainer.replaceChildren();
    if (!npcDraft) return;
    scheduleHint.hidden = npcDraft.schedule.length > 0;
    npcDraft.schedule.forEach((slot, index) => scheduleContainer.append(buildScheduleSlotBlock(slot, index)));
  }

  function buildScheduleSlotBlock(slot: ScheduleSlotDraft, index: number): HTMLElement {
    const block = document.createElement("div");
    block.className = "editor__schedule-slot";

    const heading = document.createElement("div");
    heading.className = "editor__schedule-slot-heading";
    heading.append(document.createTextNode(`Slot ${index + 1}`));
    const removeSlotButton = document.createElement("button");
    removeSlotButton.textContent = "Remove slot";
    removeSlotButton.addEventListener("click", () => {
      npcDraft?.schedule.splice(index, 1);
      renderScheduleSlots();
    });
    heading.append(removeSlotButton);

    const fromHourInput = document.createElement("input");
    fromHourInput.type = "number";
    fromHourInput.min = "0";
    fromHourInput.max = "24";
    fromHourInput.value = slot.fromHour;
    fromHourInput.addEventListener("input", () => (slot.fromHour = fromHourInput.value));

    const toHourInput = document.createElement("input");
    toHourInput.type = "number";
    toHourInput.min = "0";
    toHourInput.max = "24";
    toHourInput.value = slot.toHour;
    toHourInput.addEventListener("input", () => (slot.toHour = toHourInput.value));

    const slotLocationSelect = document.createElement("select");
    populateLocationOptions(slotLocationSelect);
    slotLocationSelect.value = slot.locationId;
    slotLocationSelect.addEventListener("change", () => (slot.locationId = slotLocationSelect.value));

    const dayCheckboxesRow = document.createElement("div");
    dayCheckboxesRow.className = "editor__weekday-checkboxes";
    function renderDayCheckboxes(): void {
      dayCheckboxesRow.replaceChildren();
      for (let day = 0; day < 7; day++) {
        const { row } = fieldCheckboxRow(
          WEEKDAY_LABELS[day]!,
          (checked) => {
            if (!slot.weekdays) return;
            if (checked) slot.weekdays.add(day);
            else slot.weekdays.delete(day);
          },
          slot.weekdays?.has(day) ?? false,
        );
        dayCheckboxesRow.append(row);
      }
    }
    renderDayCheckboxes();
    dayCheckboxesRow.hidden = slot.weekdays === null;

    const everyDayCheckbox = fieldCheckboxRow(
      "Every day",
      (checked) => {
        slot.weekdays = checked ? null : new Set();
        dayCheckboxesRow.hidden = checked;
        if (!checked) renderDayCheckboxes();
      },
      slot.weekdays === null,
    );

    block.append(
      heading,
      fieldRow("from hour (0-23)", fromHourInput),
      fieldRow("to hour (0-24)", toHourInput),
      fieldRow("location", slotLocationSelect),
      everyDayCheckbox.row,
      dayCheckboxesRow,
    );
    return block;
  }

  // --- Trust / suspicion / stats — plain number fieldRows, not a
  // repeatable-card structure (unlike schedule); "" in a stat field means
  // "not authored" (falls back to STAT_DEFINITIONS' default via
  // getStatValue), shown as a placeholder hint rather than a 0 that would
  // be indistinguishable from an intentionally-authored 0.
  const trustInput = document.createElement("input");
  trustInput.type = "number";
  trustInput.addEventListener("input", () => {
    if (npcDraft) npcDraft.trustStr = trustInput.value;
  });

  const suspicionInput = document.createElement("input");
  suspicionInput.type = "number";
  suspicionInput.addEventListener("input", () => {
    if (npcDraft) npcDraft.suspicionStr = suspicionInput.value;
  });

  const statsHeading = document.createElement("h3");
  statsHeading.textContent = "Stats";
  const statInputs: Record<StatKey, HTMLInputElement> = {
    stealth: document.createElement("input"),
    intimidation: document.createElement("input"),
    handguns: document.createElement("input"),
  };
  for (const key of Object.keys(statInputs) as StatKey[]) {
    const input = statInputs[key];
    input.type = "number";
    input.placeholder = `default: ${STAT_DEFINITIONS[key].default}`;
    input.addEventListener("input", () => {
      if (npcDraft) npcDraft.stats[key] = input.value;
    });
  }

  function save(): void {
    if (!npcDraft) return;
    npcDraft.aliasesCsv = aliasesInput.value;
    npcDraft.name = nameInput.value;
    npcDraft.description = descriptionInput.value;
    npcDraft.dialogue = dialogueInput.value;
    npcDraft.trustStr = trustInput.value;
    npcDraft.suspicionStr = suspicionInput.value;
    for (const key of Object.keys(statInputs) as StatKey[]) npcDraft.stats[key] = statInputs[key].value;
    commitNpcDraft(npcDraft.editingId ?? idInput.value.trim());
  }

  const removeButton = document.createElement("button");
  removeButton.textContent = "Remove NPC";
  removeButton.className = "editor__remove-button";
  removeButton.addEventListener("click", () => removeNpc());

  const placeholder = document.createElement("p");
  placeholder.className = "editor__status editor__inspector-placeholder";
  placeholder.textContent = 'Select an NPC from the list, or click "Add NPC" to create one.';

  const formContent = document.createElement("div");
  formContent.className = "editor__inspector-form";
  formContent.hidden = true;
  formContent.append(
    title,
    fieldRow("id", idInput),
    fieldRow("aliases (comma-separated)", aliasesInput),
    fieldRow("name", nameInput),
    fieldRow("description", descriptionInput),
    fieldRow("fallback dialogue", dialogueInput),
    imageRow,
    fieldRow("starting location", locationSelect),
    labelsHeading,
    labelsChecklist,
    scheduleHeading,
    scheduleHint,
    scheduleContainer,
    addScheduleSlotButton,
    fieldRow("trust", trustInput),
    fieldRow("suspicion", suspicionInput),
    statsHeading,
    fieldRow(`stealth (${STAT_DEFINITIONS.stealth.min}-${STAT_DEFINITIONS.stealth.max})`, statInputs.stealth),
    fieldRow(`intimidation (${STAT_DEFINITIONS.intimidation.min}-${STAT_DEFINITIONS.intimidation.max})`, statInputs.intimidation),
    fieldRow(`handguns (${STAT_DEFINITIONS.handguns.min}-${STAT_DEFINITIONS.handguns.max})`, statInputs.handguns),
    removeButton,
  );

  el.append(placeholder, formContent);

  function open(initial: NonNullable<typeof npcDraft>): void {
    title.textContent = initial.editingId === null ? "Add NPC" : "Edit NPC";
    idInput.value = initial.editingId ?? "";
    idInput.disabled = initial.editingId !== null;
    removeButton.hidden = initial.editingId === null;
    aliasesInput.value = initial.aliasesCsv;
    nameInput.value = initial.name;
    descriptionInput.value = initial.description;
    dialogueInput.value = initial.dialogue;
    refreshImageStatus();
    populateLocationOptions(locationSelect);
    locationSelect.value = initial.locationId;
    renderChecklist(labelsChecklist, Object.keys(city?.labels ?? {}).sort(), initial.labels, () => {});
    renderScheduleSlots();
    trustInput.value = initial.trustStr;
    suspicionInput.value = initial.suspicionStr;
    for (const key of Object.keys(statInputs) as StatKey[]) statInputs[key].value = initial.stats[key];
    placeholder.hidden = true;
    formContent.hidden = false;
    setActiveDraftKind("npc");
    (initial.editingId === null ? idInput : nameInput).focus();
  }

  function close(): void {
    placeholder.hidden = false;
    formContent.hidden = true;
    setActiveDraftKind(null);
  }

  return { root: el, open, close, save };
}

async function save(): Promise<void> {
  if (!city || !prefabs || !locationsDirHandle || !objectsDirHandle || !prefabsDirHandle || !worldYamlHandle) return;

  // Re-validate the full city (every location/object file's CURRENT
  // in-memory text, plus the current world.yaml text — which now reflects
  // any in-session NPC edit via regenerateWorldFile, not necessarily what's
  // still on disk) before writing anything — the same startup safety net
  // the game gets, applied before a save instead of after the fact.
  try {
    parseCity({
      world: worldYamlText,
      objectFiles: Object.fromEntries(objectFileTexts),
      locationFiles: Object.fromEntries(locationFileTexts),
    });
  } catch (err) {
    notice.hidden = false;
    notice.textContent = `Not saved — ${err instanceof Error ? err.message : String(err)}`;
    return;
  }

  // Prefabs are re-validated too, against the SAME just-revalidated
  // catalog — a prefab referencing a world object/NPC deleted this
  // session blocks the WHOLE save (nothing partially written), same as
  // any other invalid edit. See `content/prefabLoader.ts`.
  try {
    parsePrefabs(
      { prefabFiles: Object.fromEntries(prefabFileTexts) },
      new Set(Object.keys(city.worldObjects)),
      new Set(Object.keys(city.npcs)),
    );
  } catch (err) {
    notice.hidden = false;
    notice.textContent = `Not saved — ${err instanceof Error ? err.message : String(err)}`;
    return;
  }

  // Only files/world.yaml actually touched this session get written —
  // anything with no edits is left completely alone, so its comments/
  // formatting survive even though js-yaml's `dump` can't preserve them
  // for something that DOES get rewritten — see this file's KNOWN
  // LIMITATION doc comment above.
  for (const path of dirtyLocationFiles) {
    let handle = locationFileHandles.get(path);
    if (!handle) {
      handle = await locationsDirHandle.getFileHandle(path, { create: true });
      locationFileHandles.set(path, handle);
    }
    const writable = await handle.createWritable();
    await writable.write(locationFileTexts.get(path) ?? "");
    await writable.close();
  }
  dirtyLocationFiles.clear();

  for (const path of dirtyObjectFiles) {
    let handle = objectFileHandles.get(path);
    if (!handle) {
      handle = await objectsDirHandle.getFileHandle(path, { create: true });
      objectFileHandles.set(path, handle);
    }
    const writable = await handle.createWritable();
    await writable.write(objectFileTexts.get(path) ?? "");
    await writable.close();
  }
  dirtyObjectFiles.clear();

  for (const path of dirtyPrefabFiles) {
    let handle = prefabFileHandles.get(path);
    if (!handle) {
      handle = await prefabsDirHandle.getFileHandle(path, { create: true });
      prefabFileHandles.set(path, handle);
    }
    const writable = await handle.createWritable();
    await writable.write(prefabFileTexts.get(path) ?? "");
    await writable.close();
  }
  dirtyPrefabFiles.clear();

  if (dirtyWorldFile) {
    const writable = await worldYamlHandle.createWritable();
    await writable.write(worldYamlText);
    await writable.close();
    dirtyWorldFile = false;
  }

  status.textContent = "Saved.";
}

# Architecture

## The core boundary

```
 raw input                  Command                 ActionResult              display text
"take letter"  ─parse──▶  {kind:"take",...}  ─act──▶  {ok, events[]}  ─resolve──▶  "You take the case file."
     (view)              (CommandParser, engine)      (GameEngine)          (i18n resolver, view)
```

- **`src/engine/`** — the headless simulation. `GameState`/`GameEngine`
  own all world data and mutate it via synchronous action methods.
  `src/engine/parsing/` turns free text into a typed `Command` (see
  `docs/systems/parsing.md`); `src/engine/navigation/` is pathfinding over
  the location graph and `src/engine/time/` is clock formatting (see
  `docs/systems/navigation.md` and `docs/systems/time.md`). Nothing here
  imports from `src/view/` or touches the DOM. This is what makes the
  engine independently testable (see `GameEngine.test.ts`,
  `pathfinding.test.ts`) and reusable under a future, different view.
- **`src/content/`** — data describing the actual game world (locations,
  items, NPCs, cases). Authored as YAML (`city/world.yaml`), parsed and
  validated by `cityLoader.ts` at app startup; `world.ts` itself now only
  sets up a new game (starting location, money, clock epoch) — see
  `content-schema.md` for the authoring workflow and the shape content
  should follow.
- **`src/i18n/`** — translation tables and `resolver.ts`, which turns a
  `textKey` + params into display text (both engine events and UI chrome
  strings go through this same resolver). Each language's text is split
  across two sources merged into one table: `<code>.ts` (hand-written,
  chrome/event strings) and `content/<code>.yaml` (data, world-content
  strings — parsed by `contentLocale.ts`) — see `docs/localization.md`'s
  "Content text vs. chrome text".
- **`src/view/`** — `TerminalView` is the only current renderer: it
  displays engine events as scrollback text and turns player input into
  engine calls via `CommandParser`. It is a consumer of the engine's
  public surface only.
- **`src/mapview/`** — `MapView`, a framework-free SVG renderer for the
  city graph (`Location.x`/`y`, `Connection.curve`, see
  `content-schema.md`). Shared, unmodified, between the game's in-game
  map (`TerminalView`'s `worldmap` command, below) and the standalone map
  editor — the two must never render the graph differently, so there is
  exactly one component, not a game-side and an editor-side copy. Pan/
  zoom only ever mutates the root `<svg>`'s `viewBox` (never per-node
  attributes), which is what keeps it cheap at large node counts — see
  `docs/future_work.md`'s node-graph-editor entry for the SVG-scalability
  reasoning this was built around. Node/edge clicks, node dragging, and
  curve-handle dragging are all opt-in (`enableNodeDrag`/
  `enableCurveEdit`) — a read-only game view never enables them; the
  editor does. A `MapNode` may also carry a `tooltip` string, shown as a
  hover popup near the cursor while over that node (`.mapview__tooltip`);
  unlike drag/click, this is not opt-in — `MapView` always wires the
  hover listener, but does nothing for a node with no `tooltip` set, so a
  caller that never sets it (today, `TerminalView`'s `worldmap`) sees no
  change in behavior. The editor sets it to the location's id, resolved
  name, and kind (plus `exteriorId` for an interior) — the id in
  particular isn't otherwise visible anywhere on the graph, and is what
  the "add interior location" prompt asks for. A `MapNode` may also carry
  `kind`, mirroring `Location.kind` — MapView adds a
  `mapview__node--interior` class for one, but picks no color itself
  (`.mapview__node--interior circle` is defined per-caller: the game's
  `terminal.css` reuses its own theme's already-muted `--dim` green, the
  editor's `editor.css` a muted variant of its own blue), keeping the
  actual color choice with whoever owns the visual theme rather than
  baked into the shared renderer.

## The in-game world map

`TerminalView`'s `worldmap` command (`Command.ts`'s `toggleWorldMap`,
distinct from the pre-existing `map`/`locations` command, which toggles
a plain TEXT list of location names) opens a full-screen `MapView`
overlay. Defaults to `Player.visitedLocationIds` only, spoiler-safe like
the text locations panel, with a button to switch to every location.
Clicking a discovered node travels there via `GameEngine.travelTo`,
passing the location's own displayed name (guaranteed to be in its
`aliases`, lowercased — see `content-schema.md`'s "Rules") as the query
— no id-based travel entry point was added to the engine just for this,
since the existing name-based path already does the job.

## The scene image pane

A view-only feature: `TerminalView.updateStatusBar()` reads
`engine.getSceneImage()` each turn and hands it to `renderImagePane`;
hotspot clicks re-enter through `runInput`, the same path as typed text. The
engine only carries authored data and emits no events for it. What the pane
shows is the examined object/part-state/NPC image while examining, else the
location's. The panel is a fixed-size UI element inside a fixed-height
terminal column: an image crops the log from the top, and a toggle button
cycles how the log covers it (auto/expanded/collapsed). The map editor
authors these images directly via a popup (`src/editor/imageEditor.ts`).
See `docs/systems/image-pane.md`.

## The case board overlay (added 2026-09-23)

`TerminalView`'s `board`/`corkboard` command opens a full-screen overlay
— same category/CSS treatment as the world-map overlay above, distinct
from the smaller centered notebook overlay. See
`docs/systems/case-board.md` for the full writeup; in short:
`src/view/boardView.ts`'s `renderBoard()` is a stateless render function
over `GameEngine.getBoard()`'s `BoardState`, redrawn wholesale after
every change — `TerminalView` owns all transient interaction state
(drag, pending connect-mode, open color-swatch popover) the same way it
already owns `editingBlockId`/`newNoteDraftOpen` for the notebook
overlay. Nodes are absolutely-positioned HTML cards, not SVG (unlike
`MapView`), inside a large scrollable canvas with no pan/zoom.

Only the click-vs-drag movement threshold was actually extracted as
shared code with `MapView.ts` (`src/mapview/dragGesture.ts`) — MapView's
pan/node-drag math is tied to SVG viewBox conversion with no equivalent
in the board's plain-CSS-transform card layout, so a fuller shared
"DragGesture" abstraction was deliberately not built; `MapView.test.ts`
passes unmodified after the extraction, confirming no behavior changed.

The overlay's "+ Add node" picker is plain DOM (`boardView.ts`'s
`renderAddNodeMenu`), not a `MenuFlow` screen — `MenuFlow` renders into
the terminal scrollback, which sits behind a full-screen overlay, so it
can't be shown while one is open (see `docs/systems/menu.md`).

## The map editor — a second entry point, same project

`editor.html` (→ `src/editor/main.ts`) is a second Vite build entry
(`vite.config.ts`'s `build.rollupOptions.input`) alongside `index.html`,
not a separate app/repo. It imports `src/mapview/MapView.ts` and
`src/content/cityLoader.ts` directly — the SAME validator (`parseCity`)
the game loads through at every startup, reused as-is (this is exactly
the reuse `docs/future_work.md`'s original node-graph-editor entry
anticipated, and — after `docs/open-issues.md`'s "map editor doesn't
understand the new format" entry was closed — the real, current content
pipeline, not a frozen copy of an old one). Keeping it in-project means
the shared viewer and the validator can never drift out of sync between
"what the game renders" and "what the editor lets you build" — a real
risk if they were separate packages someone has to remember to keep in
lockstep.

The editor opens the whole project folder — not a single file — via the
browser's File System Access API (`window.showDirectoryPicker`,
`mode: "readwrite"` — Chromium-only; an accepted limitation for a local,
single-author dev tool, see `src/editor/fileSystemAccess.d.ts` for the
minimal ambient types this needs, since none of this is yet part of
TypeScript's shipped DOM lib). One grant gives it `src/content/city/
world.yaml` AND every file under `src/content/city/locations/` and
`src/content/city/objects/` (see `docs/content-schema.md`'s "Authoring
workflow") — it iterates each directory's entries rather than hardcoding
a file list, so a file added later (a new building's locations, say)
shows up automatically with no editor code change. A single-file
`showOpenFilePicker` would have meant a separate permission grant per
file, repeated every session, once there was more than one file to write
to. The toolbar's Locations/Objects/NPCs/Prefabs tabs (`editorMode` in
`main.ts`) switch between four editors: the map-based location editor
described below, a world object editor (own subsection below) covering
`objects/*.yaml` — id, kind, portable, aliases, description, the
`parts`/`states` sub-hierarchy, and containment — an NPC editor (own
subsection below, added 2026-09-23) covering `world.yaml`'s `npcs:`
core fields, and a location prefab editor (own subsection below)
covering the SEPARATE `content/prefabs/` tree (see
`content/prefabLoader.ts`). The first three edit `city` (`CityContent`,
from `cityLoader.ts`); the prefab editor edits a wholly different,
parallel `prefabs` (`PrefabContent`, from `prefabLoader.ts`) that the
game never loads. `labels`/`facts`/`notebookProducts` still have no editor UI;
`world.yaml` is read purely so `parseCity` can validate referential
integrity against them. NPCs are a partial
exception: the NPC editor writes core fields (id, aliases, starting
location, labels, name/description/fallback-dialogue text) back into
`world.yaml`, but `dialogueRules`/`topics`/`schedule`/`stats`/initial
trust-suspicion-knowledge-memories still have no UI and survive an NPC
edit only because the write-back merges onto the existing raw entry
rather than reconstructing it from typed fields — see the NPC editor
subsection below.

It supports the full editing loop:
- **Add or edit a location** — one sidebar form serves both, driven by a
  single `draft` object (`{ editingId: string | null, x, y, kind,
  exteriorId }` in `main.ts`) that's never written into the loaded
  `city`/its origin file until the form's own "Save location" — "Cancel"
  discards the whole thing, position included.
  - **Add**: pressing "Add location" spawns a draft at the current
    view's center (`MapView.getViewCenter()`) with `editingId: null`,
    rendered as an ordinary `MapNode` with a synthetic id (`__draft__`)
    merged into `render()`'s node list. A committed new location always
    lands in `content/city/locations/editor-additions.yaml` (created on
    first save if it doesn't exist yet) — the editor has no "pick a file"
    step, since inventing one would mean either prompting for a filename
    every time or guessing at a grouping the author didn't ask for; a
    hand-edit can always move the entry into a more sensible file later.
    An Add-only "Start from prefab" picker also sits atop this form —
    see "The location prefab editor" section's instantiation bullet
    for the full stamp mechanics (`draft.prefabId`, cloning, the
    NPC-decoration caveat).
  - **Edit**: clicking any existing node OUTSIDE Connect mode (see
    `onNodeClicked`) opens the same form with `editingId` set to that
    location's own id, pre-filled from `city.locations[id]` and the
    selected language's derived-locale table (`city.derivedLocale`, from
    `cityLoader.ts` — see `docs/content-schema.md`'s "Inline localized
    text"). The id field is shown but disabled
    — never editable, matching the project's "ids are permanent handles"
    convention. Rather than a second, parallel node, `render()` renders
    that SAME real node id at the draft's (possibly dragged) position
    instead of its stored one while editing is in progress — since
    MapView resolves an edge's endpoints by looking up its `fromId`/
    `toId` in that same node list, any of the location's existing
    connections visually follow it live too, with nothing touched in
    `city` until Save.
  - Both cases: kind/exteriorId (exteriorId shown only for
    `kind: interior`, and excludes the location currently being edited
    from its own dropdown — no self-ownership), a `baseVisibility` tier
    picker and an "affected by daylight" checkbox (the latter shown only
    for `kind: interior` — see `docs/systems/visibility.md`), and a
    name/description for whichever language is selected in the toolbar.
    Dragging the node
    (drag is force-enabled for just this one node while the form is
    open, regardless of Move mode's own state) live-syncs the form's x/y
    fields, and typing into x/y moves the node — either path keeps the
    two in sync through the same `render()`. This replaced an earlier
    `window.prompt()`-chain flow for the same reasons Connect's own
    prompts were awkward.
- **Move one** — the "Move" button arms node dragging for existing
  locations, off by default and mutually exclusive with every other mode
  (see below).
- **Draw a connection** — click two nodes in sequence (still
  `window.prompt()`-based for distanceKm/modes; a real form for this is
  the same future work as above) — UNLESS the two endpoints form a
  genuine interior hop, in which case the prompts are skipped entirely
  and the connection is added directly as flat `distanceKm: 0.1`,
  `modes: ["foot"]`. "Genuine" is checked by reusing the engine's own
  `isInteriorHop` (from `engine/navigation/interiorHops.ts`) against
  `city.locations`, i.e. actual `exteriorId` ownership — not just "one
  side is `kind: interior`". Skipping the prompts (rather than merely
  pre-filling them) is safe specifically because
  `transportModes.ts`'s `hopMinutesAndCost` checks `isInteriorHop` FIRST
  and ignores `distanceKm`/mode speed entirely for a real interior hop
  (flat 1-minute/free, always) — asking the author to type numbers the
  engine will never look at would be pure friction. It would NOT be safe
  to skip the prompts for a connection between unrelated buildings
  (interior/exterior with a non-matching `exteriorId`), since THAT is a
  real, timed/priced hop the engine actually computes from `distanceKm` —
  reusing the engine's own ownership check, rather than a simpler
  kind-based heuristic, is what keeps this from silently mis-modeling
  that case; it still prompts normally. The toolbar's "Two-way" checkbox
  (default checked, remembered across toggles — module-level `twoWayOn`)
  makes Connect author the reverse `Connection` too, mirroring whichever
  path (interior-hop flat rate, or the prompted distanceKm/modes) the
  forward one took, so a two-way door is just as free coming back as
  going in.
- **A map line is "reachability between two locations," not one
  `Connection`.** `Location.connections[]` is unchanged — the engine still
  needs one `Connection` per mode/transit line for fares/availability —
  but the renderer groups every `Connection` between the same UNORDERED
  location pair into a single `MapEdge`
  (`src/mapview/connectionEdges.ts`'s `buildConnectionEdges`, shared by
  this editor and the game's `worldmap` view — see
  `TerminalView.renderWorldMap`), since a player thinks "can I get
  there," not "how many separate routes exist." Each `MapEdge` carries
  `arrows` (which direction(s) — `fromId→toId`, `toId→fromId` — have at
  least one real `Connection`; `MapView.render()` draws one arrowhead per
  direction present, positioned via the pure `pointAtT` helper at t=0.6
  of that direction's own traversal — a two-way pair's two arrowheads
  land at t=0.6/t=0.4 of the same shared path, so they never overlap) and
  a hover `tooltip` summarizing each direction's modes (split by
  direction only when they actually differ — `MapView`'s existing
  node-hover tooltip mechanism, extended to edges). "Two-way" above is
  purely editor-side sugar over two independent `Connection`s — grouping
  makes a foot path drawn one-way and a bus line drawn the other merge
  into one line regardless of how each was authored; there is no
  `pairId`/`linkedTo` schema field, two-way-ness is inferred structurally
  from which `Connection`s exist.
- **Bend a connection's curve** — drag its handle; since a group renders
  as one line, the drag writes the same `{cx, cy}` to EVERY `Connection`
  in the resolved group (both directions, every mode), so there is
  nothing to keep in sync and no separate "sync" step.
- **Remove a location** — the "Remove location" button on the Edit form
  (hidden while adding, since there's nothing to remove yet) deletes the
  location currently open in the sidebar, after `window.confirm()` shows
  the blast radius computed by `computeRemovalImpact()`: incoming
  connections (any OTHER location's `connections[].toId` pointing at this
  id — connections are directional/embedded per origin location, see
  `docs/content-schema.md`, so this is a reverse scan over every loaded
  location, not just this one's own file), any interior locations this one
  owns (`exteriorId` pointing at it), and how many NPCs/world objects
  `city.initialPlacement` currently places here. On confirm: every interior
  the location owns is cascade-deleted with it (an orphaned interior
  pointing at a since-deleted `exteriorId` would otherwise fail
  `parseCity`), and every matched incoming connection is stripped from its
  owning location so the city stays structurally valid. NPC/world-object
  references are surfaced as a warning ONLY, never a block — the editor
  has no fixup path for them (deleting a location an NPC's `locationId`
  still points at doesn't update that NPC, even now that the NPC editor
  can write `world.yaml` — no code here walks `city.npcs` on a location
  delete), and per project decision, that's intentionally left for a
  future runtime "configuration" system to validate its own placements
  against current content when IT loads, rather than have the editor
  refuse to ever delete a location some configuration still references.
  Like every other edit here, this only mutates in-memory
  `city`/`locationOrigin` and marks files dirty — nothing is written to
  disk until the top-level **Save world** button.
- **Save world** — re-validates the WHOLE city first (`cityLoader.ts`'s
  `parseCity`, over every location AND object file's current in-memory
  text plus the current `world.yaml` text — which reflects any in-session
  NPC edit, not necessarily what's still on disk), THEN re-validates
  prefabs (`prefabLoader.ts`'s `parsePrefabs`, against that same
  just-validated catalog), so an invalid edit in EITHER graph is reported
  inline rather than written and blocks the WHOLE save — nothing
  partially written — then writes back ONLY the location/object/prefab
  files actually touched this session (`FileSystemFileHandle.createWritable()`)
  plus `world.yaml` itself if any NPC was touched — see `main.ts`'s
  `dirtyLocationFiles`/`regenerateLocationFile`, its object/prefab-editor
  mirrors `dirtyObjectFiles`/`regenerateObjectFile`/`dirtyPrefabFiles`/
  `regeneratePrefabFile`, and its single-boolean `world.yaml` mirror
  `dirtyWorldFile`/`regenerateWorldFile` (see the NPC editor subsection
  below — there's only one `world.yaml`, so a boolean suffices where the
  others need a per-file `Set`).

### The world object editor

The **Objects** tab (`editorMode: "objects"`) swaps the map/sidebar pair
for a flat, id-sorted object LIST (`objectListMount`) plus its own form
sidebar (`objectSidebar`, class `editor__sidebar--object`) — there's no
spatial concept for a world object the way there is for a location, so
no map view. It authors `WorldObject`'s full shape (see
`docs/content-schema.md` and `docs/systems/parts.md`): id, `kind`
(item/setpiece), `portable`, `announceOnRevisit` (setpieces only),
aliases, name/description for the selected language, the optional
`parts`/`states` sub-hierarchy, and containment.

- **Parts/states** are edited as a nested, structurally-rebuilt tree
  (`renderParts`/`buildPartBlock`/`buildStateBlock` in `main.ts`) —
  add/remove a part or state re-renders that part's whole block (needed
  to keep the part's `defaultStateId` dropdown's OPTIONS in sync with
  its current states), but an ordinary text/checkbox edit mutates the
  in-memory draft directly without a re-render. Renaming a state's id
  while it's the part's current default keeps it the default under the
  new id (tracked by identity, not by comparing strings after the
  fact) — otherwise a rename would silently leave `defaultStateId`
  pointing at an id no state has anymore, which commit-time validation
  would then reject.
- **`enterAliases` verb words are never blocked, only flagged.** Each
  state's `enterAliases` field is checked against the SAME table the
  parser actually uses (`INTERACT_VERB_ALIASES`, exported from
  `EnglishCommandParser.ts` specifically so this can't drift out of
  sync with the real parser) — a word not in that table gets a visible
  warning under the field (and a summary line in the post-save status
  message), but committing/saving still succeeds. This is a deliberate
  project decision: a designer can stage a verb idea in content ahead
  of the engine actually wiring it up, as long as the gap stays
  visible rather than silently doing nothing at play time.
- **Containment** ("this object lives inside another object's part" —
  e.g. a photograph in a desk drawer) is edited via a container-object
  + container-part picker on the CONTAINED object's own form, read from
  and written to `city.initialPlacement.containedIn` — same as a
  location's itemIds/npcIds, containment is never a field on
  `WorldObject` itself.
- **Direct placement** — clone or move an EXISTING catalog object
  straight into a location or a container's part, from wherever you're
  already working, rather than hunting down the object's own form. Two
  UI entry points share one mechanism:
  - The location sidebar's **"Objects here"** section (existing
    locations only — see `buildSidebar` in `main.ts`).
  - Each part's own **"Contents"** section inside `buildPartBlock`
    (existing objects only, since containment needs the container's
    real, saved id) — additive to, not a replacement for, the
    container-object/container-part picker above (that edits THIS
    object's own placement; Contents edits OTHER objects' placement
    into one of THIS object's parts).

  Both build the same `buildPlacementPicker(target, onPlaced)` widget —
  a `PlacementTarget` (`{ kind: "location" }` or `{ kind: "container" }`),
  a catalog-object `<select>` (excluding a container's own id — the
  UI-level guard against self-containment), a "Place a clone" checkbox
  (checked by default), and a Place button. Checked, it clones via
  `cloneWorldObjectTo(sourceId, target)` — the SAME function prefab
  stamping uses (generalized from the earlier `cloneWorldObjectForStamp`,
  which only ever cloned to a location; its id scheme,
  `${sourceId}-${locationId}`, is preserved exactly for a location
  target, with `${sourceId}-${containerId}-${partId}` added for a
  container target). Unchecked, it instead MOVES the picked object via
  `movePlacementTo`, which reassigns that object's single `Placement`
  entry and clears whatever it had before — a defense-in-depth
  self-containment check lives here too (redundant with the picker's own
  exclusion, but reachable if this function is ever called from
  somewhere else); a DEEPER containment cycle isn't walked here at all,
  left to Save's full `parseCity` re-validation to catch, surfacing as a
  normal `notice` error like any other invalid edit. Every placement
  mutation (clone, move, or "Remove" un-placing an object back to
  storage — see `unplaceObject`) funnels through one shared
  `regeneratePlacementFiles(id, oldTarget, newTarget)` so the right
  origin file(s) — the location(s) losing/gaining the id in derived
  `itemIds`, or the object's OWN file losing/gaining derived
  `containerId`/`containerPartId` — get regenerated exactly once, since
  `locationToRaw`/`objectToRaw` derive those fields live from
  `city.initialPlacement` rather than storing them.
- **Remove** cascades further than a location's removal does: since
  this editor DOES own containment end-to-end (unlike NPC/item
  placement, which it can't fix), deleting a container also
  un-contains whatever was inside its parts (regenerating THEIR origin
  files too) rather than just warning about the dangling reference.
- **Save** follows the identical per-file dirty-write design as
  locations — `objectOrigin`/`dirtyObjectFiles`/`regenerateObjectFile`
  mirror `locationOrigin`/`dirtyLocationFiles`/`regenerateLocationFile`
  exactly, including writing a brand-new object to
  `objects/editor-additions.yaml`.
- **"In storage" objects** — a `WorldObject` with no `Placement` entry
  (not in any location's `itemIds`, not `containedIn` another object) is
  perfectly valid content, not an error: it's the deliberate way to keep
  an unplaced "original copy" around purely to clone from later (see
  "Direct placement", above). The object list badges every row that DOES
  have a `Placement` entry (`isObjectPlaced` in `main.ts`) and can filter
  to just placed or just storage objects, so the catalog stays navigable
  once it holds a mix of both — see `docs/editor_guide.md`'s "The Objects
  tab".
- **Structure view** is a collapsed, read-only panel in the form
  (`buildObjectStructureTree`/`renderObjectStructureTree` in `main.ts`)
  showing a saved object's parts → states, plus any other catalog object
  contained in one of those parts (recursing across containment), as a
  nested tree; clicking a contained object jumps the inspector to it. It's
  a pure projection over the last-SAVED `city` (`worldObjects` +
  `initialPlacement.containedIn`) — not the live in-progress draft, and
  not editable — see `docs/editor_guide.md`'s "Structure view" and
  `docs/future_work.md`'s "Interactive object structure graph" entry for
  the planned drag/edit/live-draft follow-ups.

### The NPC editor (added 2026-09-23)

The **NPCs** tab follows the Objects tab's layout shape (fixed-width
searchable list + always-visible inspector, not the Locations/Prefabs
hide-show sidebar) but a genuinely different SAVE shape: `city.npcs`
comes from `world.yaml`'s `npcs:` array, not a per-entity file the
Locations/Objects/Prefabs editors' `*Origin`/`dirty*Files` machinery was
built around, and `world.yaml` also carries `labels`/`facts`/
`notebookProducts` this editor doesn't edit at all.

- **Core fields plus schedule plus stats/trust/suspicion.** The form
  edits id (locked once created, same convention as every other entity),
  aliases, starting location, labels (`renderChecklist`, the same widget
  the prefab editor's NPC/world-object decoration checklists use), name/
  description/fallback-dialogue text, (Stage 2, added 2026-09-23) a
  schedule-slot list, and (Stage 3, also added 2026-09-23) trust/
  suspicion and the three `StatKey` values. `dialogueRules`/`topics`, and
  an NPC's starting knowledge/memories, still have no fields on the draft
  at all — a deliberate scope decision (see `docs/open-issues.md`), not
  an oversight.
- **Trust/suspicion/stats — plain fields, not a card list.** Unlike
  schedule, these are flat scalars with no repeatable structure, so
  they're just number `fieldRow`s. `trust`/`suspicion` aren't `Npc`
  fields at all (see `NpcState`'s doc comment in `engine/types.ts`) — the
  draft's `trustStr`/`suspicionStr` are committed into
  `city.initialNpcStates[id]`, spreading the PREVIOUS entry forward first
  (so `memories`/`opinions`/`knowledge`, which this form has no UI for,
  survive) exactly like `commitNpcDraft` already does for the typed `Npc`
  object itself. Each of the three stat fields is a STRING in the draft
  where `""` means "not authored at all" (falls back to
  `STAT_DEFINITIONS[key].default` via `getStatValue` — see
  `docs/systems/stats.md`) — deliberately not the same as authoring `0`,
  shown via a `placeholder` hint ("default: 30") rather than pre-filling
  the field with the default value, so a saved NPC's YAML doesn't
  suddenly gain three stat keys it never had. `upsertNpcRaw` writes
  `trust`/`suspicion` only when non-zero and `stats` only when at least
  one key is authored, deleting the raw key entirely otherwise — the same
  "omit rather than round-trip a default/empty value" posture the
  schedule editor established.
- **Schedule editor mirrors the WorldObject editor's Parts/States card
  pattern** (`buildPartBlock`/`renderParts`): each `ScheduleSlotDraft`
  (`fromHour`/`toHour` kept as edited strings, `locationId`, and
  `weekdays: Set<number> | null` where `null` means "every day") gets its
  own bordered card with a heading-row Remove button; any structural
  change (add/remove a slot, toggling "Every day") triggers
  `renderScheduleSlots()`, a full wholesale re-render of the list —
  individual field edits just mutate the draft slot in place. An empty
  `npcDraft.schedule` array is the "always at starting location" case,
  and stays that way end to end: `commitNpcDraft` only attaches a
  `schedule` field to the `Npc` (and only writes a `schedule:` key via
  `upsertNpcRaw`) when at least one slot is authored — clearing every
  slot on a previously-scheduled NPC explicitly `delete`s the field
  rather than letting an empty array round-trip into `world.yaml` as
  `schedule: []`. Validation (in `commitNpcDraft`, same shared `notice`
  banner as every other check) blocks non-integer/out-of-range hours and
  an unknown location, but deliberately does NOT block `fromHour >
  toHour` — that's a valid overnight-wrapping slot per `ScheduleSlot`'s
  own doc comment in `engine/types.ts`, only `fromHour === toHour`
  (zero-duration) is rejected.
- **`worldRaw`: parse once, mutate only `npcs`, never reconstruct the
  rest.** Unlike `objectToRaw`/`locationToRaw`/`prefabToRaw` (each
  rebuilds ITS entity's entire on-disk shape from typed, locale-stripped
  records), the NPC editor keeps `world.yaml` parsed into a plain
  `worldRaw: Record<string, unknown>` at project-open time (`load()` from
  `js-yaml`) and treats everything except `worldRaw.npcs` as opaque —
  `labels`/`facts`/`notebookProducts` are carried through byte-
  identical at the parsed-value level, with no reversal ("toRaw") logic
  written for content this editor never touches. `regenerateWorldFile()`
  just re-dumps the whole `worldRaw` object and sets a single
  `dirtyWorldFile` boolean (not a per-file `Set`, since there's only ever
  one `world.yaml`).
- **`upsertNpcRaw` MERGES onto the existing raw entry, rather than
  replacing it.** This is what keeps `dialogueRules`/`topics`/initial
  knowledge/memories intact across an edit even though the form has no
  UI for them: it finds the NPC's existing mapping in `worldRaw.npcs`
  (by `id`) and overwrites only `id`/`aliases`/`locationId`/`labels`/
  `text`/`schedule`/`stats`/`trust`/`suspicion`, spreading every other key
  forward untouched. `commitNpcDraft` keeps the in-memory typed
  `city.npcs[id]` consistent the same way — it spreads the PREVIOUS `Npc`
  object forward before overwriting only the fields the form actually
  edited, so `dialogueRules`/`topics` (typed fields) survive there too,
  not just in the raw YAML.
- **Starting location is placement data, not an `Npc` field** — same
  pattern as a world object's `containerId`/`containerPartId`: the draft
  tracks `locationId` itself, and commit writes it into
  `city.initialPlacement.npcLocationId[id]`, never onto the `Npc` record.
- **Delete** warns (informational only, same posture as every other
  cross-reference warning in this editor) if a prefab still decorates
  with the NPC being removed, then deletes `city.npcs[id]`,
  `city.initialPlacement.npcLocationId[id]`, `city.initialNpcStates[id]`,
  and splices the raw entry out of `worldRaw.npcs`.
- **Save** participates in the same top-level `save()` as every other
  editor — `world.yaml`'s current text (already reflecting any in-session
  NPC edit via `regenerateWorldFile`) is part of the same pre-write
  `parseCity` revalidation, and gets its own write branch
  (`worldYamlHandle.createWritable()`) alongside the location/object/
  prefab per-file loops, gated on `dirtyWorldFile`.

### The location prefab editor

The **Prefabs** tab authors `content/prefabs/*.yaml` — a SEPARATE
content tree from `content/city/`, parsed by `content/prefabLoader.ts`
(not `cityLoader.ts`) into its own `prefabs` (`PrefabContent`), never
`city`. A `LocationPrefab` is a reusable location TEMPLATE: kind
(exterior/interior), name/description/aliases for the selected
language, and a DECORATION of existing catalog ids — `worldObjectIds`/
`npcIds` picked off a checklist (`renderChecklist` in `main.ts`)
populated from whatever `city.worldObjects`/`city.npcs` currently
holds. A prefab has no `x`/`y`/`connections`/`exteriorId` of its own —
it is not, and never becomes, a node in the location graph until
something explicitly instantiates it.

- **Why a separate content graph, not more fields on `Location`:** a
  prefab is authoring-time-only. The game (`content/world.ts`) never
  imports `prefabLoader.ts` and never sees a prefab; only
  `src/editor/main.ts` does. This keeps the engine's content model
  (`GameState`, `CityContent`) exactly as small as gameplay needs — see
  CLAUDE.md's "content is data, not code" boundary — without the
  editor's own authoring conveniences leaking into it.
- **Decoration references existing ids, not inline definitions.** A
  prefab does not embed its own copies of the objects/NPCs it
  decorates with — it points at ids already authored via the Objects
  tab (or `world.yaml`, for NPCs). `parsePrefabs` validates every
  referenced id actually exists in the CURRENTLY loaded catalog
  (`knownWorldObjectIds`/`knownNpcIds`, passed in by the editor as
  `Object.keys(city.worldObjects)`/`Object.keys(city.npcs)`); deleting
  an object a prefab still references doesn't auto-fix the prefab —
  it surfaces as a "Not saved" validation error blocking the WHOLE
  save (see `save()`'s doc comment) the next time anyone saves, until
  the prefab is fixed or the reference removed.
- **Instantiation ("stamping a prefab into the world") — built 2026-09-08.**
  The Locations tab's Add-location form gets a Add-only "Start from
  prefab" picker (`prefabSelect` in `buildSidebar`) — picking a prefab
  pre-fills kind/name/description (there's no aliases field of its own
  on this form at all — see below) and remembers which prefab via
  `draft.prefabId`; picking "(blank location)" clears the pre-fill back
  out. The actual stamp happens in `commitDraft`, once the location id
  is typed and Save is clicked:
  - The new location's `aliases` are the prefab's own `aliases` (copied
    directly — there's no aliases-editing field on this form for a
    hand-typed location either, prefab-started or not).
  - Every id in the prefab's `worldObjectIds` is CLONED — never
    referenced directly — via `cloneWorldObjectForStamp`: a fresh id
    (`-`, deduped with a `-2`/`-3`/... suffix
    on collision), its own `parts`/`states` with every key regenerated
    under the new id and their text copied across EVERY language (not
    just the selected one), and a fresh `Placement` entry at the new
    location — written to `objects/editor-additions.yaml` like any other
    newly-added object. This is what lets the SAME prefab be stamped
    into many different locations, each with its own independent
    decoration, since an object id can only ever occupy one `Placement`
    slot at a time (see `engine/types.ts`'s `Placement` doc comment).
    Deliberately SHALLOW: an object contained inside a decorated
    object's part is NOT cloned/carried along — only the prefab's own
    directly-listed `worldObjectIds`. A decoration whose source object
    was deleted THIS session (after the prefab loaded, before a Save
    re-validated it) is skipped with a status note, not an error.
  - `npcIds` decoration is still deliberately NOT instantiated — cloning
    an NPC on stamp is a separate feature from the NPC editor's own
    `world.yaml` write-back (added 2026-09-23, see "The NPC editor"
    above), and hasn't been built on top of it yet (see
    `docs/open-issues.md`). A prefab with NPCs still shows a status note
    ("N NPC(s) ... place them manually") both in the picker and after
    Save, so the gap stays visible rather than silent.
- **Save** follows the identical per-file dirty-write design as
  locations/objects — `prefabOrigin`/`dirtyPrefabFiles`/
  `regeneratePrefabFile` mirror the object editor's exactly, including
  writing a brand-new prefab to `prefabs/editor-additions.yaml`. The
  `prefabs/` directory itself is auto-created (empty) on `openProject`
  if missing, so opening an older checkout that predates this tab
  works unchanged.

**The editor never imports `resolver.ts`/`t()`.** It looks up a
location's display name from `city.derivedLocale` (`displayName()` in
`main.ts`), not through the shared translation resolver. Two reasons,
one of them a real bug this was written to fix: `t()` resolves against
whichever language is currently active for the GAME, not whatever the
editor's own toolbar selector has picked (wrong once a second language
exists), and — the actual bug, now historical — `resolver.ts` used to
statically import `content/en.yaml?raw` (a single central content-locale
file that no longer exists — content text is inline per-entity now),
which Vite's dev server watched; since `editor.html`'s bundle depended on
that import (even transitively, through nothing more than importing
`t`), saving that file — one the editor itself had just written — made
Vite reload the editor's own page out from under itself, wiping every
bit of in-memory state (the loaded city, an open draft) with no warning.
`world.yaml` never triggered this because only `content/world.ts` (the
GAME's setup file, `index.html`'s bundle) imported it via `?raw` —
`editor/main.ts` only ever imported the parser FUNCTION, never the
file's raw text. The general rule this leaves standing, still true even
though the specific file involved is gone: a page that writes a file via
File System Access must not also have that same file in its own
Vite-watched import graph, even indirectly through a shared module.

**Known limitation:** a location, object, prefab, or (as of 2026-09-23)
`world.yaml` touched this session (an add, an edit, a drag, a new/curved
connection, a part/state change, a decoration checklist toggle, an NPC
add/edit/remove) is re-serialized whole via `js-yaml`'s `dump`, which
does not preserve hand-written comments/formatting — see
`docs/open-issues.md`. A file never touched this session is left
completely alone on disk, so its comments survive regardless — but
`world.yaml` is single-file, so touching any ONE NPC means the WHOLE
file (including its untouched `labels`/`facts`/`notebookProducts`
content) loses its comments/formatting too, not just that NPC's own
entry.

## Static content vs. mutable state

`GameState` splits into two kinds of data, and it matters which is which. (There
is no save/load anymore, so nothing is persisted; the split keeps content
reloadable and the mutable slice small and JSON-safe.)

- **Static content**: `locations`, `items`, `npcs`, `notebookProducts`, labels,
  facts. Authored in `content/city/world.yaml` and the per-folder YAML, parsed by
  `cityLoader.ts`, reloaded fresh every launch.
- **Mutable state**: `player`, `clock`, and `placement` (`Placement`,
  `engine/types.ts`: WHERE every world object/NPC currently is), plus flags, NPC
  state, notebooks, facts learned and the case board.

`placement` deliberately isn't folded into `locations`/`npcs` — a
location's `Location.itemIds`/`npcIds` and an NPC's `locationId` don't
exist as fields on those types at all, even though `world.yaml` still
authors them per-location/per-NPC (`cityLoader.ts` reads them, then moves
them into a separate `initialPlacement`, which seeds `GameState.placement`
for a new game). The reason: world object/NPC placement is CASE-INSTANCE
data — it's set up once per case (today, straight from `world.yaml`;
later, by a procedural case generator) and changes during play
(`GameEngine.takeItem` mutates `state.placement.worldObjectLocationId`,
not any `Location`). Treating it as static content would mean either
baking one fixed arrangement into every case, or losing a
player's progress the moment content gets reloaded.
`GameEngine` looks up "what's at this location" via `engine/placement.ts`'s
`worldObjectsAtLocation`/`npcsAtLocation` (a reverse index over
`Placement`), never via a field on `Location`/`Npc`. A world object can
also be placed INSIDE another's part instead of at a location
(`Placement.containedIn`) — see `docs/systems/parts.md`'s "Containment".

The map editor still round-trips a location's `itemIds`/`npcIds` when it
rewrites that location's file — `save()` reconstructs them from
`city.initialPlacement` via `worldObjectsAtLocation`/`npcsAtLocation`
before writing, since the editor writes whole location records back to
the authoring format even though the engine no longer carries those
fields at runtime. An NPC's own `locationId` gets the same treatment in
the other direction, as of the NPC editor (2026-09-23, see "The NPC
editor" above): `upsertNpcRaw` reads it straight from
`city.initialPlacement.npcLocationId[npc.id]` when writing that NPC's
raw entry into `worldRaw.npcs`.

## Why events, not strings

`GameEngine` actions return `GameEvent[]` — `{ type, textKey, params }` —
never pre-formatted text. This does two things at once:

1. **Localization** falls out for free: the engine never decides what
   language to speak, only what happened.
2. **View flexibility**: a view walks the event list and decides how to
   present each event. `TerminalView.consumeEvents` awaits each event
   individually — today that's a no-op await, but it is the seam a future
   animated view will use to insert real delays (play an animation, wait
   for it, then move to the next event) without any change to
   `GameEngine`. See CLAUDE.md, point 2, for the reasoning.

## Adding a new view

A new view must:
- Construct a `GameEngine` (or receive one).
- Call engine actions directly, or via an `ICommandParser` if it also
  accepts free text.
- Render by resolving each returned event's `textKey`/`params` through
  `t()` from `src/i18n/resolver.ts` — never invent its own strings for
  game content.
- Never reach into `GameEngine`'s private state or `GameState` fields to
  mutate them directly; only call public action methods.

## Packaging

The app builds to a static bundle (`npm run build` → `dist/`). Wrapping it
as a desktop `.exe` (Tauri preferred) is a packaging step around this
bundle and requires no engine or view changes — see CLAUDE.md.

# Documentation Index

This folder is the source of truth for how Text Detective's systems work and
how they interact. See the project root `CLAUDE.md` for architecture
decisions and the documentation policy that governs this folder.

## Contents

- `context.md` — short handoff note: what the most recent working session
  did, so the next session can pick up without re-reading everything else
- `architecture.md` — engine/view boundary, data flow, event model
- `systems/engine-core.md` — inventory, NPC talk/examine, top-level engine
  action table; what's still missing (dynamic NPC state like mood/
  suspicion/knowledge beyond the flag-gated lines in `systems/
  dialogue.md`, case/deduction system, event log)
- `systems/navigation.md` — the Location graph, Connections, transport
  modes, Dijkstra pathfinding, the compass-vs-named-destination resolution
  split, and interior/exterior locations (multi-story buildings, `in`/`out`
  directions, the flat free interior-travel rate)
- `systems/time.md` — the simulated clock: a single absolute real-world
  calendar date (the ONLY time format shown — an earlier relative "Day N"
  display was dropped entirely, see the doc for why), `formatCalendarDate`'s
  token-based date formatting, and the general "absolute expiry minute,
  compared lazily" pattern for any time-sensitive/countdown state
- `systems/economy.md` — player money (integer minor units), why it's a
  Player scalar rather than an inventory item, the engine/i18n formatting
  split, the full paid-transportation arc (cost model → preference →
  inquire → selection → charging → guided menu → natural travel
  categories), and a purchasable multi-day transit pass system — feature-
  complete; only vehicle ownership and cross-trip transit-line
  persistence remain unbuilt
- `systems/menu.md` — the domain-agnostic multi-screen `MenuFlow` system
  (numbered choice lists + free-text prompts, universal back/exit), and
  `travelMenus.ts`, the one real domain built on it so far
- `systems/notebooks.md` — player-carried notebooks for jotting notes,
  built end to end: engine/data layer (types, `GameEngine` mutation
  calls, `NotebookProduct` content, `SAVE_SCHEMA_VERSION` 4), the
  generalized `buy` menu, `notebook`/`jotDown` commands, and a
  full-screen page-view overlay (native-textarea editing, commit-time
  strikethrough diffing, live overflow hard-stop via `maxLength`)
- `systems/save.md` — the save/load design: the `Placement` split that
  separates static content from mutable case-instance state (done), and
  the planned `SaveData`/save-file mechanism built on it (not yet built)
- `systems/parsing.md` — the ICommandParser interface, why parsing is
  swappable per language, and why `inquire` was retired as a standalone
  verb in favor of the `travel` menu
- `systems/visibility.md` — the ambient visibility signal (0-100,
  authored via a small `dark`/`dim`/`normal`/`bright` tier per location)
  driven by time of day, dampened for interiors with windows and toggled
  off for windowless ones; a player-facing line shows it on location
  entry and `look` — now consumed by a stealth check (`systems/
  checks.md`); NPC-notice and examine-gating are still unbuilt
- `systems/stats.md` — a universal 0-100 stat lookup (`stealth`,
  `intimidation`, `handguns`) shared by Player and NPC, one central
  registry + one fallback function; storage + content-authoring + query
  only, no mutation verb yet
- `systems/checks.md` — a generic opposed-check resolver (2d10-curve
  randomness, a hand-tuned modifier table, difficulty-vs-contested as two
  functions sharing one roll primitive, a six-tier margin-based outcome),
  the first system needing randomness (an injectable `rng` on
  `GameEngine`); `getStealthConcealment()` (player stealth vs. location
  visibility) plus the `sneak` verb (`toggleStealth()`) are its first
  consumers
- `systems/dialogue.md` — a flat `GameState.flags` store plus an ordered
  `Npc.dialogueRules` list, so `talkTo` can pick a conditional line
  instead of always returning the same one; `talkTo`/`askAbout` are the
  only flag writers so far (`talkedTo.<npcId>`); `Npc.topics` layers a
  selectable topic menu on top (`talk <npc>` opens it when any topic is
  unlocked), reusing the same rule/effects machinery one level deeper
- `systems/npcs.md` — the three-layer NPC model (authored / case-instance /
  mutable): multi-valued `labels`, per-NPC trust/suspicion/memories/
  opinions/knowledge plus global and per-label player reputation, a
  no-LLM structured memory syntax and witness step, lookup-table schedules
  behind a swappable provider, and structured dialogue conditions; nothing
  yet spends the trust/opinion mutators, and there is no NPC UI
- `systems/case-system.md` — the first, deliberately minimal fact-tracking
  slice: a player-visible, chronological log of learned `Fact`s
  (`learnFact`/`playerKnows`, a facts side panel) that never concludes
  anything on the player's behalf — no confidence meter, no auto-detected
  "case solved"; solving a case stays entirely content-authored
- `systems/case-board.md` — a purely player-authored spatial corkboard
  view: draggable cards for known facts/NPCs met/locations visited/
  inventory items plus free-text notes, connected by colored strings the
  player draws themselves; no auto-inference, no contradiction detection
  (all three stages built)
- `systems/parts.md` — sub-parts and states on world objects (a desk's
  drawers, a lighter's engraved symbol), the `open`/`close` `interact`
  verb, the point-and-click-style focus mode that gates targeting (with
  an `important`-state exception and a small set of actions that break
  focus), and containment (placing one object inside another's part,
  concealed until exposed)
- `content-schema.md` — data formats for locations (incl. connections/transport
  modes), NPCs, items, transit lines, passes, location prefabs, and player
  starting state; the YAML authoring workflow (`content/city/world.yaml`,
  order-independent, validated at every app startup by `cityLoader.ts`)
- `editor_guide.md` — practical, task-by-task how-to for the map editor
  (Locations/Objects/Prefabs tabs) — what you can do and the exact clicks,
  as opposed to `architecture.md`'s WHY it's built this way
- `localization.md` — translation key conventions and how to add a language
- `open-issues.md` — known gaps consciously left open for now, each with
  why it's deferred and what closing it should look like (distinct from
  `future_work.md`: these are identified weak spots, not just ideas)
- `systems/image-pane.md` — per-location scene image with percent-positioned
  clickable hotspots that run commands through the normal input path
  (authored content only: no save change, no engine events)
- `website/site-map.md` — the studio website's rooms, first slice, navigation UX and real-time clock
- `website/puzzle_system.md` — design sketch (not built) for reusing the
  engine as a studio website with a small breadcrumb puzzle
- `future_work.md` — ideas worth remembering but not being built now (not a
  prioritized roadmap)

## Status

Scaffold stage: headless engine covering inventory, NPC dialogue, examine,
an 11-location navigation graph — 5 exterior, 6 interior across 3
buildings including a 3-level hotel (Dijkstra pathfinding — with a
secondary tie-break metric so tied-cost/tied-time routes don't resolve
arbitrarily — mixed-transport travel time including a ship-mode route,
`in`/`out` directions, and a flat free rate for entering/exiting/moving
within a building, derived purely from `Location.kind`/`exteriorId` — see
`systems/navigation.md`), and a **feature-complete paid-transportation
system**: a full fare/cost model (`taxi`/`bus` transport modes, a metered
taxi formula, line-based fares with free transfers via
`Connection.transitLineId`/`TransitLine`), a player-controlled travel
preference among natural categories — foot, public transit, taxi (a
future car category once the player can own one) — that
`findCategoryRoute` genuinely optimizes for by riding that category's own
mode wherever offered (falling back to foot, then whatever's forced —
see `systems/economy.md`). `transit`/`taxi` minimize total time; `foot`
minimizes total COST instead (it's free itself, so the real choice is
which forced fallback costs least), and a report says so plainly when
even "foot" can't avoid a paid leg entirely. `spendMoney` actually
charging for travel
(checked BEFORE moving the player or advancing the clock, so an
unaffordable trip fails cleanly with nothing partially applied), and a
guided multi-screen `travel` menu (bare `travel` → direct-connections
overview, "Pick a custom destination" pinned to position 1 regardless of
how many connections follow it (for muscle memory) → detailed foot/transit/taxi
breakdown, preferred category listed first and annotated, whichever
option(s) are fastest/cheapest labeled as a prefix, selectable by number
OR by typing the category/label word, with universal `back`/`exit` — see
`systems/menu.md`) built on a domain-agnostic `MenuFlow` mechanism. The
older mixed-mode fastest/cheapest search (`TravelStrategy`/`findRoute`)
still exists, fully implemented, reserved for a future "navigator device"
item — not reachable through any current UI. `inquire` is retired as a
standalone verb, freed for future investigation use. The sample map
carries fare-system test content exercising all of this end-to-end:
`taxi` on every exterior↔exterior connection except the boat-only
`docks↔pier` (a flat $10.00 ship fare each way), and one bus line
(`bus-1`, $3.00, free transfers) on the `alley↔street↔highway↔docks`
corridor — see `systems/economy.md`'s "Known gaps" for why the bus is
naturally dominated by `foot`/`taxi` under this content and isn't picked
by ordinary route selection. A purchasable pass (`Pass`/`ActivePass` —
see `systems/economy.md`'s "Passes") makes a covered `TransitLine` free
for a stretch of CALENDAR days — always expiring at a day boundary, not
a fixed number of minutes from purchase (`minutesUntilDayAlignedExpiry`,
`systems/time.md`) — bought via `buy <pass>`; one sample pass exists ($15,
7 days, covers `bus-1`). No `car` category/mode exists in the sample
content yet — the player doesn't own one; `TransportMode` still lists
`car` for when vehicle ownership (with a gas cost) is built. Starting
cash is $150.00. Also: a simulated clock showing ONLY an absolute
real-world calendar date (e.g. "18 September 1946 · 08:00" — an earlier
relative "Day N" display was dropped entirely, see `systems/time.md`),
terminal view with a persistent clock+money+current-location status bar,
a horizontal divider printed in the scrollback on every actual location
change (so a session's log reads as clearly bounded per-location
sections — see `TerminalView.consumeEvents`), discovered-location
tracking (`Player.visitedLocationIds`, grown by `GameEngine`'s `moveTo`
choke point) driving a spoiler-safe locations panel default, two fixed
side-panel slots (left/right) whose CONTENT is player-selectable —
`verbs`/`locations`/`inventory`, or a `closed` state that shows a small
placeholder ascii motif rather than hiding the slot — via `panel <slot>
<content>` (legacy `verbs`/`locations`/`map` words still work as sugar
for their historical slot, see `docs/systems/parsing.md`'s "Side
panels"), two dev-only commands (`devmoney`,
`devlocations` — gated out of existence, not just hidden, in a
production build via Vite's `import.meta.env.DEV` — see
`docs/systems/parsing.md`), English localization, and a swappable
`ICommandParser` (data-driven `EnglishCommandParser`) — all wired
end-to-end and covered by 208 tests across `GameEngine.test.ts`,
`EnglishCommandParser.test.ts`, `pathfinding.test.ts`,
`transportModes.test.ts`, `interiorHops.test.ts`, `calendar.test.ts`,
`calendarFormat.test.ts`, `money.test.ts`, `MenuFlow.test.ts`,
`travelMenus.test.ts`, `world.test.ts`, `cityLoader.test.ts`,
`resolver.test.ts`,
`translationCoverage.test.ts`, `MapView.test.ts`,
`connectionEdges.test.ts`, `save.test.ts`,
`browserSaveStore.test.ts`, and `main.test.ts` (the map
editor).

**Content is authored as YAML, split across many files, with text
inline** — see `content-schema.md` and `localization.md`. Every location
lives under `src/content/city/locations/*.yaml`, every world object under
`src/content/city/objects/*.yaml` (each file a bare array, one or several
entries, author's choice of grouping — a `desk.yaml`, a `furniture.yaml`,
whatever reads naturally), discovered automatically via Vite's
`import.meta.glob` — no manifest to hand-maintain. `src/content/city/world.yaml`
itself holds only `npcs`/`transitLines`/`passes`. Every entity's display
text is an inline `text: { en: {...}, ... }` block on the entity itself
— `en` required, any other language optional per entity — instead of a
`nameKey` pointing into a separate hand-maintained locale file;
`src/content/cityLoader.ts`'s `parseCity` derives the lookup key from the
entity's own `id` and emits every language's text as
`CityContent.derivedLocale`, which `content/world.ts` pushes into
`i18n/resolver.ts` (`registerContentLocale`) at module load. Validation
(required fields, valid enum values, and full referential integrity
across `toId`/`exteriorId`/`transitLineId`/`locationId`/`itemIds`/
`npcIds`/`lineIds`/`containerId`/`containerPartId`, plus containment-
cycle detection) runs at every app startup across every file, throwing
one error listing EVERY problem found (each tagged with its source
file), not just the first. A separate, on-demand test
(`i18n/translationCoverage.test.ts`) reports every content key missing
from a non-baseline language, once that language has any text at all —
see `localization.md`. `src/content/world.ts` itself now only discovers
content files and sets up a new game (starting location, money, clock
epoch).

**A visual map viewer/editor exists, feature-complete through editing,
adapted onto the current multi-file/inline-text content pipeline**:
`Location` carries optional `x`/`y` map-canvas coordinates and
`Connection` an optional bezier `curve` (see `content-schema.md`), and
`src/mapview/MapView.ts` is a shared, framework-free SVG renderer for the
city graph — pan/zoom (`viewBox`-only, so it stays cheap at large node
counts), click callbacks, and opt-in node/curve dragging. It's used in
two places: the game's `worldmap` command (`TerminalView`, full-screen
overlay, spoiler-safe "discovered only" by default, click a location to
travel there) and a second Vite entry point (`editor.html` →
`src/editor/main.ts`, same project, not a separate app — see
`architecture.md`'s "The map editor" section), which opens the whole
project folder via the browser's File System Access API
(`showDirectoryPicker`). Its toolbar's **Locations**/**Objects**/
**Prefabs** tabs switch between three full edit loops sharing one loaded
project: the original location editor — add OR edit a location through
one shared sidebar form (id/kind/exteriorId/x/y plus name/description
text for the selected language; id is disabled when editing an existing
location), move one without opening the form (drag, gated behind an
explicit "Move" button), draw connections, bend curves; the world object
editor (added 2026-09-08 — see `architecture.md`'s "The world object
editor"), which authors `objects/*.yaml` entries directly: id/kind/
portable/aliases/description, the `parts`/`states` sub-hierarchy
(including each state's `enterAliases` verb hooks, checked against the
parser's actual known verbs and FLAGGED rather than blocked when a word
isn't wired up yet), and containment (`containerId`/`containerPartId`);
the NPC editor (added 2026-09-23 — see "The NPC editor"), which authors
`world.yaml`'s `npcs:` core fields (id/aliases/starting location/labels/
name/description/fallback-dialogue) — `dialogueRules`/`topics`/
`schedule`/`stats`/initial trust-suspicion-knowledge-memories have no UI
yet and survive an edit only because the write-back merges onto the
existing raw entry rather than reconstructing it; and the location
prefab editor (also added 2026-09-08 — see "The location prefab
editor"), which authors a SEPARATE content tree, `content/prefabs/*.yaml`
— never loaded by the game — as reusable location TEMPLATES:
kind/name/description/aliases plus a decoration of EXISTING world
objects/NPCs picked off a checklist. The location/object/NPC editors
read/write via `cityLoader.ts`'s `parseCity` — the SAME validator the
game uses, not a frozen copy; the prefab editor uses its own parallel
`prefabLoader.ts`/`parsePrefabs`, validating decoration references
against that same catalog. `content/city/world.yaml`'s `transitLines`/
`passes` are still read-only everywhere, purely to validate against them
— see `open-issues.md`. `save()` re-validates the whole city AND the
whole prefab library before writing anything, then writes back only the
location/object/prefab files actually touched this session, plus
`world.yaml` itself if any NPC was touched — an untouched location/
object/prefab file keeps its exact on-disk text and comments, and
`world.yaml` is untouched (and keeps its comments) unless an NPC was
added/edited/removed this session; anything touched still loses its
comments/formatting to `js-yaml`'s `dump()` (see `open-issues.md`). A
brand-new location lands in `content/city/locations/editor-additions.yaml`;
a brand-new object lands in `content/city/objects/editor-additions.yaml`;
a brand-new prefab lands in `content/prefabs/editor-additions.yaml`; a
brand-new NPC is appended into `world.yaml`'s existing `npcs:` array
(there's only one file, so no "additions" file of its own). The
Locations tab's Add-location form also has an Add-only "Start from
prefab" picker (built 2026-09-08): picking a prefab pre-fills
kind/name/description, and Save both creates the location AND clones
the prefab's `worldObjectIds` (fresh ids, fresh placements — see
`architecture.md`'s "The location prefab editor") onto it. `npcIds`
decoration is still NOT instantiated (a status note says so) — see
`open-issues.md`. Still ahead: NPC `dialogueRules`/`topics`/`schedule`/
`stats` authoring, a UI for transit lines/passes (still hand-edited
YAML), NPC stamping (the write-back plumbing now exists via the NPC
editor, but cloning-on-stamp itself hasn't been built on top of it),
cloning what's nested inside a stamped object's own parts, viewport
culling/clustering (only needed well past the current sample map's
size), and a real form for connection details (currently
`window.prompt()` dialogs) — see `future_work.md`.

**A `WorldObject` can sit "in storage" — no `Placement` entry at all —
and be cloned or moved straight into place from wherever you're editing
(2026-09-10/11).** The Objects tab badges every "placed" row (one with a
`Placement` entry, at a location or inside a container's part) and can
filter the list to **Placed only**/**Storage only**, so a catalog mixing
one-off "original copy" objects with their in-world clones stays
navigable. Direct placement itself has two entry points sharing one
`buildPlacementPicker(target, onPlaced)` widget: an existing location's
edit form gets an **Objects here** section, and each of an existing
object's parts gets its own **Contents** section (both additive to
already-existing containment/decoration UI, not replacements) — each
picker offers every other catalog object plus a **Place a clone**
checkbox, checked by default. Checked, Place clones the picked object
via `cloneWorldObjectTo` (the same function prefab-stamping uses,
generalized from a location-only `cloneWorldObjectForStamp` to also
target a container's part — its location-target id scheme,
`${sourceId}-${locationId}`, is unchanged). Unchecked, Place instead
MOVES the picked object here via `movePlacementTo`, clearing wherever it
was before (guarded against the immediate self-containment case; a
deeper containment cycle is left to Save's existing full-city
re-validation to catch). Every placement change — clone, move, or a
list row's **Remove** (un-places back to storage, never deletes) — funnels
through one shared `regeneratePlacementFiles` so exactly the right
origin file(s) get regenerated, since a location's `itemIds` and an
object's own `containerId`/`containerPartId` are both derived live from
`city.initialPlacement`, never stored fields — see `architecture.md`'s
"The world object editor" ("Direct placement") and `editor_guide.md`.

**A map line represents reachability between two locations, not one
`Connection` — grouped, directional, hoverable (2026-09-10).** A foot
path and a bus line between the same two locations used to render as two
overlapping lines; `src/mapview/connectionEdges.ts`'s
`buildConnectionEdges` now groups every real `Connection` among a set of
locations by UNORDERED pair into a single `MapEdge`, shared by BOTH the
editor and the game's own `worldmap` view (`TerminalView.renderWorldMap`)
— no engine/schema change, `Location.connections[]` is exactly as before.
Each grouped edge carries `arrows` (which direction(s) — `fromId→toId`,
`toId→fromId` — have at least one real Connection; `MapView` draws one
arrowhead per direction present, via a pure `pointAtT` helper placing it
at t=0.6 of that direction's own traversal so a two-way pair's two
arrowheads — t=0.6 and t=0.4 of the same shared path — never overlap) and
a hover `tooltip` summarizing each direction's modes, split by direction
only when they actually differ (extends `MapView`'s existing node-hover
tooltip mechanism to edges). The editor's Connect tool gained a "Two-way"
checkbox (default on, remembered across toggles) that auto-authors the
reverse `Connection` — mirroring the forward one's fields, including the
interior-hop flat-rate special case — and curve-editing now writes the
dragged curve to EVERY `Connection` in a pair's group at once, since the
group renders as one line and there's nothing left to keep in sync.

**Save/load now exists**: manual `save`/`load` commands, one
`localStorage` slot, built on a `GameState` split between static content
(`locations`/`items`/`npcs`/`transitLines`/`passes`, reloaded fresh from
`world.yaml` every launch, never saved) and a mutable slice
(`player`/`clock`/`placement`) that a save actually persists — see
`systems/save.md` and `architecture.md`'s "Static content vs. mutable
state". `placement` (`Placement`, `engine/types.ts`) is a new
`GameState` field holding WHERE every item/NPC currently is —
`Location`/`Npc` no longer carry `itemIds`/`npcIds`/`locationId` at
runtime, even though `world.yaml` still authors them per-location/per-NPC
(`cityLoader.ts` moves them into `CityContent.initialPlacement`), since
item/NPC placement is case-instance data (expected to change per case,
eventually procedurally) rather than fixed content. Not yet built:
autosave, multiple save slots, and schema migration (see `systems/save.md`
for what each would take).

**World objects can now have sub-parts, states, and containment** (a
desk's drawers, open/closed; a lighter's engraved symbol; a torn
photograph placed inside a drawer) — see `systems/parts.md`. A `Part`
needs no interactivity to exist (a purely descriptive one, revealed only
by examining it directly, is enough); an interactive one wires
`open`/`close`/etc. via `PartState.enterAliases`, entirely as content —
no engine change per new verb TARGET. Targeting a part requires **focus**
(`examine <object>` "zooms in," point-and-click style), with two
exceptions: a part whose current state is flagged `important` is
immediately actionable (it was already surfaced in the object's general
`examine`, via `summaryKey ?? descriptionKey`), and `travel`/`talk`/
opening the travel menu break focus automatically. A `Part`'s state can
also `exposesContents` — objects `containedIn` it (`Placement.containedIn`)
become `examine`/`interact`/`take`-able, though not ambient-listed unless
that state also sets `revealInAmbientListing`. `SAVE_SCHEMA_VERSION`
bumped to 3 (2 for `partStates`, 3 for `Placement.containedIn` and its
`itemLocationId` → `worldObjectLocationId` rename); `focusedWorldObjectId`
itself is deliberately NOT persisted.

**Terminology: `object` is now the umbrella term**, `item` names a
movable one and `setpiece` a fixed one (`WorldObject.kind`) — previously
"item"/"object" were used ambiguously as both the umbrella and one
specific kind. The rename reached the TypeScript layer too: `Item` →
`WorldObject`, `ItemId` → `WorldObjectId`, `GameState.items` →
`.worldObjects`, `itemsAtLocation` → `worldObjectsAtLocation`, and their
content-key/event counterparts (`event.objectsPresent` →
`event.setpiecesPresent`, content key prefix `object.*` → `setpiece.*`).
`takeItem` and the `event.item*` family keep "item" — they're inherently
item-specific (only a movable object is ever portable).

**Notebooks: built end to end (v1), through three rounds of playtesting
fixes** — see `docs/systems/notebooks.md`. Player-carried notebooks
(`NotebookState` on `GameState`'s mutable slice, `SAVE_SCHEMA_VERSION`
7), bought via the generalized `buy` verb (bare `buy` opens a `MenuFlow`
menu of notebooks + `Pass`es; `buy <query>` tries both catalogs) against
a new `NotebookProduct` content type (`world.yaml`'s `notebookProducts:`,
validated like `Pass`), with block/span-based note-taking (`jotDown` —
prompting which notebook when none is active, and `jot down last`/`that`
to jot whatever was just printed instead of retyping it) and commit-time
strikethrough editing (`amendNote`/`commitBlockEdit` in
`engine/notebooks.ts`) — never actually deletes text, just flags it
struck and stamped. Each page carries a single FLAT character budget
(`Page.charCapacity`, `engine/notebooks.ts`'s `charsUsed`/
`charsRemaining`) — no separate per-entry cap, and no character-per-line
concept anywhere at all (both were tried and dropped across rounds 1-3;
see the doc's round-by-round recap for why each didn't work). The
`notebook` command opens a page-view overlay sized/styled like a small
object (capped to the terminal's own width) with a ruled grid whose
alignment comes entirely from a shared `--notebook-row` `line-height`
(the header, read-mode text, and the editor all use it) — entry text is
simply full-width with natural word-wrap, since the ruled lines only
care about row height, never where a row wraps horizontally. Per-block
editing is a plain `<textarea>` whose native undo and `maxLength` cover
"reversible until exit" and the live overflow hard-stop for free, with
its height autosized (reset-to-`auto`-then-`scrollHeight`) and the
toolbar's `{used}/{capacity}` meter updated LIVE on every keystroke, not
just after a block is committed. Known v1 simplification: the
commit-time diff is prefix/suffix-based, not a full LCS.

**A location visibility signal exists (2026-09-13)**: `Location.baseVisibility`
(a `dark`/`dim`/`normal`/`bright` tier, default `normal`) and
`InteriorLocation.affectedByDaylight` (default `true`) feed
`engine/visibility/visibility.ts`'s `computeVisibility`, a pure function
combining the authored tier with time of day (a full swing for exteriors,
a dampened one for interiors, none at all when `affectedByDaylight` is
`false`), queryable via `GameEngine.getVisibility()` — see
`docs/systems/visibility.md`. Computed lazily from content + the clock,
so no save-schema change. Authoring is editor-supported (Locations tab);
a player-facing line now shows it on location entry and `look`, and a
stealth check now consumes it (see below) — NPC-notice and examine-detail
gating still don't exist to justify those consumers.

**A universal stat system exists (2026-09-17)**: `StatKey`/`StatBlock`
(`engine/types.ts`) and a central `STAT_DEFINITIONS` registry +
`getStatValue` fallback function (`engine/stats/stats.ts`) give Player
and NPC alike a shared 0-100 stat lookup (`stealth`, `intimidation`,
`handguns` to start). `Npc.stats?` is fixed, content-authored data;
`Player.stats?` lives in the mutable/saved slice (`SAVE_SCHEMA_VERSION`
8, with the codebase's first real save migration) but has no mutation
API yet. Queryable via `GameEngine.getPlayerStat`/`getNpcStat` — see
`docs/systems/stats.md`. Deliberately built with no consumer at the time
(no NPC-runtime stat changes still, but a full stealth check + `sneak`
verb now exist — see below) — mirrored the Visibility system's own v1
scope and was meant to unblock it.

**A generic skill-check resolver exists (2026-09-18)**: `engine/checks/
checks.ts`'s `resolveDifficultyCheck`/`resolveContestedCheck` roll 2d10
(triangular around 11) through a hand-tuned modifier table and bucket the
result into a six-tier `CheckOutcomeTier` (`failedSpectacularly` through
`succeededSpectacularly`), each carrying an explicit `success: boolean`.
Difficulty checks (vs. a static number, one roll) and contested checks
(vs. another actor's skill, two independent rolls) are deliberately two
functions rather than one with a boolean flag. This is the first system
needing randomness at all — `GameEngine`'s constructor gained an
optional, test-injectable `rng: () => number = Math.random`.
`GameEngine.getStealthConcealment()` (player stealth vs. current-location
visibility) is a pure-query building block; see `docs/systems/checks.md`.
`resolveContestedCheck` has no caller yet (reserved for a future
combat/NPC-notice system).

**A `sneak` verb consumes the stealth check (2026-09-18)**:
`GameEngine.toggleStealth()` flips `Player.stealthMode` (persistent
player intent) — turning it on rolls `getStealthConcealment()`
immediately for the current location; every successful travel while
already sneaking re-rolls it for the destination. The roll's outcome is
stored separately, on `Player.concealment?: CheckOutcomeTier`, cleared on
toggle-off; a failed roll does NOT turn `stealthMode` back off. Both
fields are saved (`SAVE_SCHEMA_VERSION` 9). No gameplay consequence of
being exposed yet — no NPC reacts, nothing restricts movement/verbs while
sneaking. See `docs/systems/checks.md`.

**Dialogue can now vary by flag (2026-09-20)**: a flat `GameState.flags:
Record<string, boolean>` (`SAVE_SCHEMA_VERSION` 10) plus an ordered
`Npc.dialogueRules: DialogueRule[]` let `GameEngine.talkTo` pick the
first rule whose `requires` are all `true`, falling back to the NPC's
original single `dialogueKey` line when none match. `talkTo` also sets
`flags["talkedTo.<npcId>"]` afterward — the only flag write that exists
yet. No topic/choice menu UI (still future work for `MenuFlow`), no flag
negation, no other flag writers. See `docs/systems/dialogue.md`.

**NPC model built (2026-09-21)**: `Npc.labels`, per-NPC `NpcState`
(trust, suspicion, memories, opinions, knowledge) and a global + per-label
`Reputation` (`SAVE_SCHEMA_VERSION` 11); structured memories with an
authoring shorthand and a witness step honoring stealth concealment
(`talkTo`/`takeItem`/travel emit observations); lookup-table `schedule`s
synced from `advanceClock` through a swappable `NpcScheduleProvider`; and
structured `Condition`s usable in `dialogueRules[].when`. Nothing yet
spends trust/opinion/reputation; no gossip, perception stat, or NPC UI. See
`docs/systems/npcs.md`.

Not yet built: NPC gossip/valence rules/NPC-facing UI, case/deduction/event-log
system, a generalized (non-travel) `MenuFlow` domain, vehicle ownership
gating (the `car` category), a
"leave the building" shortcut (walking out of the Grand Hotel's third
floor is `down, down, out`/`down, down, south`, not one action —
`exteriorId` is what a future shortcut would use), `Player.boardedLineId`
cross-trip persistence (fares are currently charged per `travelTo` call;
a later separate trip doesn't know the player is still "on" a line from
an earlier one), any purchase flow for a pass besides the direct `buy`
command, and a player-facing way to list currently-held passes (see
`systems/economy.md`'s "Passes"). See `systems/navigation.md`,
`systems/economy.md`, `systems/time.md`, `systems/menu.md`, and
`content-schema.md`. Add a `systems/*.md` doc as each of those lands.

# Future Work

Ideas that are worth remembering but deliberately not being built now —
either because they depend on something unbuilt, or because they're a
nice-to-have past the current scope. Not a backlog/roadmap with
priorities or dates; just a place to not lose good ideas. Move an entry
into a real `systems/*.md` doc once it's actually built.

## Waypoint-aware route planning (visual map)

Once there's a visual/coordinate map (see `docs/systems/navigation.md`'s
"known gaps" — locations have no `{x, y}` yet), it would be good to show
the player not just "the route to your destination" but the shape of
routes in general, so they can plan detours themselves. E.g.: "I can stop
at the office on my way to the docks, so let me go there first, then head
to the docks from there."

Important: this is explicitly a **player-planning convenience**, not a
new mechanical waypoint system — the player would still just issue plain
`go to X` commands one at a time (go to the office, then go to the docks);
nothing needs multi-destination itinerary support. What's missing without
a visual map is *visibility* into the graph shape — right now the player
can only reason about routes via `look`'s immediate connections or a
future `inquire` result for one named destination at a time. A visual map
would let them see, at a glance, that a detour is nearly free time-wise
because it's on the way, without needing the game to compute or suggest
that for them.

This depends on:
- The coordinate/visual map system itself (deferred, see
  `docs/systems/navigation.md`).
- Possibly the multi-option `inquire` result (see
  `docs/systems/economy.md`/recent design discussion) — a map view could
  reuse the same "here are some route shapes" data.

No engine changes implied by this on its own — it's a view/presentation
idea. Revisit when a visual map is actually being built.

## Visual node-graph editor for city content

**Phase 1 is built** (see `docs/architecture.md`'s "The map editor"
section): `Location.x`/`y` exist in the schema, `src/mapview/MapView.ts`
is a shared, framework-free SVG renderer, and `editor.html`/
`src/editor/main.ts` (a second Vite entry in this same project — not a
separate app) opens the project folder via the File System Access API,
validates content through the same validator (`cityLoader.ts`'s
`parseCity`) the game uses, and renders it read-only through `MapView`.
This proved the shared-viewer/shared-validator contract end to end —
exactly the reuse this entry originally anticipated (the validation
logic is authoring-format-agnostic, operating on parsed data, not YAML
syntax). The editor was later adapted onto the game's current
multi-file, inline-localized-text content pipeline
(`docs/content-schema.md`) — see `docs/architecture.md`'s "The map
editor" section for the per-file open/save design this uses now.

**All phases through editing and in-game display are now built:**
- Pan/zoom (root-`<svg>` `viewBox` manipulation only, never per-node
  attribute updates — see the SVG-scalability note below) and
  configurable map bounds (`MapView.setBounds`), plus click callbacks
  (`onNodeClick`/`onEdgeClick`) and a hover tooltip on both nodes
  (`MapNode.tooltip`) and edges (`MapEdge.tooltip`, added 2026-09-10 — see
  `docs/architecture.md`'s "The map editor"). A map line represents
  reachability between two locations, not one `Connection`: every real
  Connection between the same unordered pair (a foot path, a bus line, ...)
  merges into ONE line (`src/mapview/connectionEdges.ts`'s
  `buildConnectionEdges`, shared by the editor and the game's `worldmap`),
  with directional arrowheads (`MapEdge.arrows`) and a hover tooltip
  summarizing modes per direction. A "Two-way" checkbox on Connect (default
  on) auto-authors the reverse Connection.
- Editor write path: add OR edit a location via one shared sidebar form
  (id — disabled/uneditable when editing, kind, exteriorId, x/y, and
  name/description text for the selected language). Adding spawns a draft
  at the current view's center; editing opens the same form for any
  existing node clicked outside Connect mode, pre-filled from it. Either
  way the node is draggable while the form is open and nothing commits
  until Save (Cancel discards the whole draft, position included — for
  Edit, existing connections visually follow the node while dragging,
  since MapView resolves edge endpoints from the same node list). Move an
  existing one without opening the form (the "Move" button arms
  dragging — off by default and mutually exclusive with every other mode,
  so it never competes with another mode's node clicks), draw connections
  (click node
  A, then node B — still `window.prompt()`-based, see the "Not yet
  built" entry below), edit a connection's bezier curve (a draggable
  control-point handle — one quadratic control point, not a full
  two-handle cubic curve, kept deliberately simple), and save back — per
  file, only the location files actually touched this session — via
  their `FileSystemFileHandle`s' `createWritable()`, the whole city
  re-validated (`cityLoader.ts`'s `parseCity`) before any write.
- Opening the project grants one `showDirectoryPicker` (not a per-file
  `showOpenFilePicker`), so the editor can read every file under
  `src/content/city/locations/`, `src/content/city/objects/`, and
  `src/content/city/world.yaml` without a separate grant per file — and a
  location file added later just shows up, no editor code change.
- The game itself: a `worldmap` command (distinct from the existing text
  `map`/`locations` toggle) opens a full-screen `MapView` overlay,
  defaulting to `Player.visitedLocationIds` only with a button to show
  the entire map, and clicking a location travels there (reusing
  `GameEngine.travelTo` with the location's own displayed name as the
  query — no new engine method needed).

**Beyond locations: the editor now also authors world objects and
location prefabs.** An **Objects** tab (2026-09-08) authors
`objects/*.yaml` entries directly — kind/portable/aliases/description,
the `parts`/`states` sub-hierarchy, and each state's `enterAliases` verb
hooks (flagged, never blocked, when a word isn't wired into the parser
yet). A **Prefabs** tab (2026-09-08) authors `content/prefabs/*.yaml` —
a NEW content tree, entirely separate from `content/city/` and never
loaded by the game — decorating a name/description template with
existing catalog world objects/NPCs. The Locations tab's Add-location
form now also has a "Start from prefab" picker (2026-09-08) that STAMPS
a prefab into a brand-new location: kind/aliases/name/description copied
onto it, and its `worldObjectIds` cloned (fresh ids, fresh placements)
and placed there. See `docs/architecture.md`'s "The world object editor"
and "The location prefab editor" sections. Still open: NPC decoration
isn't instantiated (would need `world.yaml` write support, scoped out of
this phase), and nothing nested inside a decorated object's own parts
gets cloned along with it — see `docs/open-issues.md`.

**Known limitation, not yet addressed:** a location file touched this
session is re-serialized whole via `js-yaml`'s `dump`, which does NOT
preserve hand-written comments or formatting — see
`docs/open-issues.md`. Safe for content authored purely through the
editor; a real risk if you hand-edit comments into a location file and
then also touch it in the editor. `world.yaml` and every `objects/*.yaml`
file are never rewritten at all, so their comments (including
`world.yaml`'s current hand-written top-of-file comment) are unaffected.

**Not yet built:**
- Adding a location now has a real sidebar form (id/kind/exteriorId/x/y
  plus name/description text — see `docs/architecture.md`'s map-editor
  section), but drawing a **connection** still uses `window.prompt()` for
  distanceKm/modes — the same "worth a real form" reasoning applies there
  once the editor sees more use.
- Viewport culling / clustering — only becomes necessary once the map
  grows well past the current sample size. SVG comfortably scales to
  1000+ locations as long as pan/zoom stays a `viewBox`-only operation
  (never per-node attribute updates every frame, which is how this was
  built) and culling/clustering are added before the map is large enough
  to need them, not retrofitted after a slowdown is already felt.

## Interactive object structure graph

**v1 is built** (2026-09-10): the Objects tab's inspector has a
**Structure view** panel — a read-only, click-to-navigate tree of an
object's parts, each part's states, and any other catalog object
contained inside a part, recursing across containment. See
`docs/editor_guide.md`'s "Structure view" and `buildObjectStructureTree`/
`renderObjectStructureTree` in `src/editor/main.ts`.

A future version could make this an actual interactive graph instead of
a static read-only tree:
- Drag-to-reparent: dragging a contained-object node onto a different
  part to change its `containerId`/`containerPartId` directly, instead of
  only through that object's own form dropdowns.
- Edit-in-place: click a part/state node to open (or scroll to) its
  editable block, instead of only object nodes being clickable.
- A live view driven by the in-progress draft (`objectDraft.parts`)
  rather than only the last-saved `city`, so adding a part/state shows up
  in the tree immediately, before Save.
- Possibly a genuine node-graph layout (not just nested `<ul>` indentation)
  once an object's structure gets deep/wide enough that a tree reads
  awkwardly — no evidence yet that today's content needs this.

Revisit once the read-only version is actually used and one of these is a
felt need, not speculatively now.

## Live cross-page note splitting (notebooks)

See `docs/systems/notebooks.md` (designed, not yet implemented). v1's
plan for a block that overflows the current page while the player is
actively typing it is to hard-stop input — the player has to finish
elsewhere (delete the note, turn to a page with room, start a new
block). A nicer version would let the note flow onto the next page live
as the player keeps typing, with the overflow rendered as a new block
whose header is a small "continued" marker instead of the usual
timestamp/location.

This is feasible without any real typesetting work — the page's line
budget is pure character-count arithmetic (`lineCharCap`/`lineCapacity`),
not font metrics — but it's a genuine live-reflow feature: the view
would need to continuously recompute the overflow point as the buffer
changes, render two page panels in sync, keep undo coherent across a
buffer that can pull text back across the split point, and recurse for a
note long enough to overflow more than one page. Data-model-wise it's
cheap (a `NoteBlock` with a `{kind: "continuation"}` header linked via
`continuesBlockId` instead of the usual timestamp header) — the cost is
entirely in the view's live text-flow logic, closer to a small word
processor's pagination than anything else in the codebase today.

Build the v1 hard-stop behavior first; revisit this once notebooks are
actually in play and it's clear the hard-stop feels bad in practice
rather than assuming it will.

## Shop system (generalized `buy`)

v1 of notebooks (`docs/systems/notebooks.md`) needs a purchase flow but
explicitly does NOT get a real shop system: the existing `buy` verb is
generalized to open a `MenuFlow` listing purchasable goods (notebooks and
`Pass`es, for now), with no vendor NPC/location content behind it.

A real shop system — vendor NPCs or fixed vendor locations, per-location
catalogs, stock/availability, maybe pricing that varies by location —
is worth building once there's more than one or two flat item types to
sell. Revisit when a case actually wants NPC- or location-specific
inventory, not speculatively now.

## Jump-to-location-divider scrollback navigation

`TerminalView` prints a horizontal divider in the scrollback on every
actual location change (`.terminal__divider`, see
`TerminalView.consumeEvents`). The idea: an up/down arrow pair
("somewhere convenient" near the log) that jumps the scrollback to the
previous/next divider, scrolling so the first line after that divider
lands at the top of the log viewport (`scrollIntoView`-style) — quick
navigation through "what happened since I arrived here" for each
location visited during a session.

Purely a view/DOM concern — the divider already exists, this is just
scroll-position UI state, no engine or event-model change implied.

Deliberately not built yet:
- Placement is genuinely unsettled ("somewhere convenient" needs an
  actual decision — next to the log, floating, in the status bar — and
  competes for space with the terminal's minimal aesthetic).
- Payoff is unproven — today's scrollback is short enough that normal
  scrolling already gets there in a flick; this is worth building once a
  real play session's log is long enough that divider-hopping is a felt
  need, not a hypothetical one.
- If/when it's built, consider keyboard shortcuts (e.g. `Alt+↑`/`Alt+↓`)
  as an alternative or complement to on-screen buttons — doesn't cost UI
  real estate.


## Ideas

### Visibility system

**Computation + authoring built (2026-09-13); a player-facing consumer
built (2026-09-16)** — see `docs/systems/visibility.md`: a single
computed 0-100 signal per location, driven by an authored
`dark`/`dim`/`normal`/`bright` tier and time of day (full swing for
exteriors, dampened for interiors, off entirely for a windowless
interior via `affectedByDaylight: false`), queryable via
`GameEngine.getVisibility()`. A `location_visibility` line now shows on
location entry and `look`. Still open: how much `examine` reveals, and
whether an NPC notices the player — see "Stealth" below, now unblocked
by the Stats system.

### Stealth

**Check + `sneak` verb built (2026-09-18)** — see `docs/systems/checks.md`:
`GameEngine.getStealthConcealment()` resolves player stealth against a
location's visibility via a 2d10-based `resolveDifficultyCheck`,
combining `getVisibility()` (`docs/systems/visibility.md`) and
`getPlayerStat("stealth")` (`docs/systems/stats.md`). The `sneak` verb
(`GameEngine.toggleStealth()`) now consumes it: toggling stealth on rolls
immediately for the current location; every successful travel while
already sneaking re-rolls for the destination. `Player.stealthMode`
(persistent intent) and `Player.concealment` (last roll's outcome,
cleared on toggle-off) are separate saved fields (`SAVE_SCHEMA_VERSION`
9) — a failed roll does NOT turn `stealthMode` off. Still open: no
gameplay consequence of being exposed (no NPC reacts, no movement/verb
restriction), and no NPC-notice check — that needs an NPC
perception/awareness `StatKey` that doesn't exist in `STAT_DEFINITIONS`
yet, and would use the already-built `resolveContestedCheck` instead
(both sides — player stealth, NPC perception — are actors that roll).

### Dialogue

**Flags + declarative conditional lines built (2026-09-20); topic/choice
menus built (2026-09-22)** — see `docs/systems/dialogue.md`: a flat
`GameState.flags: Record<string, boolean>` plus an ordered
`Npc.dialogueRules: DialogueRule[]` (`{ requires: string[]; textKey:
string }`). `GameEngine.talkTo` picks the first rule whose `requires` are
all `true` in `flags`, falling back to the NPC's original single
`dialogueKey` line when none match, and sets `flags["talkedTo.<npcId>"]`
afterward. `SAVE_SCHEMA_VERSION` bumped 9 → 10 for `flags`. On top of
that, `Npc.topics?: DialogueTopic[]` gives selectable conversation
topics: `talk <npc>` opens a `MenuFlow` choice screen (`src/view/menu/
npcMenus.ts`'s `buildTopicsScreen`) whenever any topic is currently
unlocked, reusing the exact same rule-matching/effects machinery one
level deeper (`GameEngine.askAbout`). Rosa in the "Ledger" mini-case
(`world.yaml`) is the one live example — her `ledger` topic is gated
behind `opinionOfPlayer >= 2`. Still open: no flag negation on
`dialogueRules.requires` (use a topic/rule's `when` instead — `not`/`any`
are supported there), and nothing besides `talkTo`/`askAbout` writes a
flag yet — case progress, item-giving, etc. wait for their own systems.

### Stats

**Storage + fallback + query built (2026-09-17)** — see
`docs/systems/stats.md`: a universal 0-100 `StatKey`/`StatBlock`
lookup (`stealth`, `intimidation`, `handguns` to start) shared by Player
and NPC through one central registry (`STAT_DEFINITIONS`) and one
fallback function (`getStatValue`), so an entity with no authored/stored
value for a key falls back to that stat's own default rather than a
single global one. `Npc.stats?` is fixed content; `Player.stats?` is
mutable/saved (`SAVE_SCHEMA_VERSION` 8) but has no mutation API yet.
Queryable via `GameEngine.getPlayerStat`/`getNpcStat`. Still open: no way
to actually change a stat during play (training, a skill check
succeeding/failing, NPC stats shifting at runtime), no combat system, no
`Location.stats` — the registry/`getStatValue` are already generic
enough to support that later without a redesign.

### Combat system

I don't know if a traditional combat system with HP and hit chances etc would make sense in this game, but there may be a "combat mode" that changes the game rules/verbs a little bit. If it lands, `resolveContestedCheck` (`docs/systems/checks.md`) — built but with no caller yet — is the natural fit for an actor-vs-actor roll like a handguns check.

## Image pane follow-ups

`docs/systems/image-pane.md` covers what shipped (fixed panel, hover/toggle
log expansion, examine/state-driven images, the map editor's authoring
popup, the fade-to-blank transition). Not built:

- **Dithering — shipped as a transition effect** (a stepped pixel dissolve
  replacing the opacity fade; the image is clean at rest; off by default,
  needs visual tuning in a browser). See `docs/systems/image-pane.md`'s
  "Dithering (dissolve transition)". This replaced the original plan of a
  permanent grayscale/posterize/noise filter, which was not what was wanted.
  - **Real per-pixel dithering (deferred further, not planned)** —
    ordered/Floyd–Steinberg dithering via an offscreen `<canvas>`, needing
    per-image caching (keyed by `src`) to avoid reprocessing on every
    revisit, and a `<canvas>`-vs-`<img>` rendering-target change. Only
    worth it if the CSS/SVG version above turns out visually unconvincing.
- Polygon hotspots (rectangles only today).
- NPC/item portraits shown outside of `examinedTarget` (e.g. a persistent
  corner portrait during dialogue) — the same `SceneImage` shape could be
  reused, but nothing surfaces it that way yet.
- Other image fit modes (`cover`/`stretch`) — would need explicit
  content-rect math for hotspots, since the current fixed-panel layout
  deliberately avoids `object-fit` on a panel-sized `<img>` for exactly
  this reason.
- Preloading (a hotspot leading to a new image currently loads it cold on
  navigation).

### Gambling

Ability to gamble. You can play poker, which you would have more control on; or true gambling like slot machines etc.
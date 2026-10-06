# Case board

**Status: all three stages built.** See `docs/plans/npc-editor-plan.md`
for the staging style this follows (three independently-shippable stages,
each covered by `npx tsc --noEmit && npx vitest run && npm run build`).

## What it is

A purely **player-authored** spatial layer over things the player has
already encountered in the game: known facts, NPCs they've talked to,
locations they've visited, items in their inventory — plus free-text
"note" cards they write themselves — laid out spatially and connected by
colored "strings" the player draws between any two cards, like a
detective's corkboard. This is content-free, engine-native state; it adds
no new game content type, no new authored data in `world.yaml`.

**Deliberately not built here, and not planned:**
- No auto-inferred connections, no contradiction/corroboration detection
  — every string is placed and colored by the player, and nothing here
  ever concludes anything on the player's behalf. This is a UI/expression
  tool, not a deduction engine — see `docs/systems/case-system.md`, whose
  `Fact`/`playerFacts` this feature reads from but doesn't extend.
- No text labels on connections (a fixed 4-color palette instead — see
  "Colors" below).

## Data model (`src/engine/types.ts`)

- `BoardNode` — one card: `{ id, refKind, refId, text, x, y }`.
  `refKind` is `"fact" | "npc" | "location" | "item" | "note"`. For a
  reference kind, `refId` names the real entity (a `FactId`/`NpcId`/
  `LocationId`/`WorldObjectId`) and `text` is `null`. For `"note"`,
  `refId` is `null` and `text` is the player-authored free-text body —
  never a translation key, same posture as `Notebook.name` (see
  docs/systems/notebooks.md's "Localization note").
- `BoardStringColor` — `"red" | "blue" | "yellow" | "green"`, the fixed
  v1 palette (`BOARD_STRING_COLORS` in `src/engine/board/board.ts`).
- `BoardConnection` — `{ id, fromNodeId, toNodeId, color }`. Undirected —
  `fromNodeId`/`toNodeId` order carries no meaning.
- `BoardState` — `{ nodes: BoardNode[]; connections: BoardConnection[] }`.
  Part of `GameState`'s mutable slice (`GameState.board`), sibling to
  `notebooks`/`flags`/`playerFacts`, per `CLAUDE.md` boundary #6.

## Three named v1 scope limits (not oversights)

- **Item nodes are inventory-only.** There is no "examined but not
  taken" tracking anywhere in the engine — an item only seen, never
  picked up, can't be offered as a node. Sourced from
  `Player.inventory`.
- **"NPCs met" reuses the existing `talkedTo.<npcId>` flag** (set by
  `GameEngine.talkTo`, see `docs/systems/dialogue.md`) rather than a new
  dedicated `Player` field — `listAddableEntities` scans `state.flags`
  for that prefix.
- **No connection labels, no auto-connections** — see "What it is" above.

## Pure logic — `src/engine/board/board.ts`

Mirrors `src/engine/npc/schedule.ts`/`src/engine/notebooks.ts`'s split:
pure functions taking/returning `BoardState`, no `GameState` coupling
except the one read-only query. `GameEngine` calls these and wires the
results into its own mutation methods.

- `addNode(board, node)` / `moveNode(board, id, x, y)` /
  `removeNode(board, id)` (cascades: also removes any connection
  touching the removed node) / `editNoteText(board, id, text)` (no-op if
  `id` isn't a `"note"` node).
- `addConnection(board, from, to, color)` — returns `null` (mutating
  nothing) on a self-connection, a connection to a missing node id, or a
  duplicate of an existing UNORDERED pair. `removeConnection(board, id)`
  / `recolorConnection(board, id, color)` (no-op if `id` doesn't exist).
- `listAddableEntities(state): AddableEntity[]` — everything the "add
  node" picker (Stage 3) can offer: known facts (`state.playerFacts` +
  `state.facts`), NPCs met (flag-prefix scan), locations visited
  (`Player.visitedLocationIds`), items carried (`Player.inventory`),
  each excluding an entity that already has a node. `AddableEntity` never
  covers `"note"` — notes are authored as free text directly, not picked
  from a list.
- Ids generated via `generateNotebookId` (`src/engine/notebooks.ts`,
  despite the name — it's a general "short, sufficiently-unique id"
  helper already shared across systems, not notebook-specific).

## `GameEngine` methods

`getBoard()` (read-only, mirrors `getNotebooks()`), `listAddableBoardEntities()`,
`addBoardNode(refKind, refId, text, x, y)`, `moveBoardNode(id, x, y)`,
`removeBoardNode(id)`, `editBoardNoteText(id, text)`,
`addBoardConnection(from, to, color)`, `removeBoardConnection(id)`,
`recolorBoardConnection(id, color)`. All follow the standard
`ActionResult` convention (`docs/systems/event-log.md`) — one exception:
`moveBoardNode` deliberately returns NO printable event, since it's
called on every drag-END during Stage 2's drag gesture (not per-frame,
but still not scrollback-worthy), the same posture `setPanel` already
has.

## Save integration

`SAVE_SCHEMA_VERSION` bumped 12 → 13 (see `docs/systems/save.md`).
`board` is a REQUIRED field (a fresh board is `{ nodes: [], connections:
[] }`, not optional/undefined), so the 12→13 migration step does a real
backfill rather than just accepting the version bump — matching the
`flags` 9→10 precedent, not the optional-field `stats` 7→8 precedent.

## Command

`board`/`corkboard` parse to `{ kind: "board" }` (`src/engine/parsing/
Command.ts`/`EnglishCommandParser.ts`). As of Stage 1, `TerminalView`
handles this as a no-op placeholder (keeps the `Command` union
exhaustive) — Stage 2 replaces it with the actual overlay toggle.

## Stage 2 — full-screen overlay view

`board`/`corkboard` now opens a full-screen overlay (`TerminalView`'s
`showBoard`/`hideBoard`, same category/CSS treatment as the world-map
overlay — edge-to-edge, not the smaller centered notebook-overlay
treatment). `src/view/boardView.ts`'s `renderBoard()` is a stateless
render function — all transient UI-only interaction state (which
color-swatch popover is open, which note is being edited) lives on
`TerminalView.boardUiState`/`boardEditingNoteId`, and `renderBoardOverlay()`
does a full wholesale redraw after every change, same posture as
`renderNotebookPage`.

- **Nodes** are absolutely-positioned HTML `<div>` cards (not SVG, unlike
  `MapView`) inside a large (3000×3000px) scrollable canvas —
  `overflow: auto`, no pan/zoom. Every node kind shows its resolved label
  at rest (via `TerminalView.resolveBoardNodeLabel` — `t()`-resolved for a
  referenced entity, raw `node.text` for a note, so `boardView.ts` itself
  never calls `t()`); a `"note"` card additionally has a hover-revealed
  pencil button that swaps its text for an inline `<textarea>` (commits on
  blur via `editBoardNoteText`, tracked by `TerminalView.boardEditingNoteId`
  so only one note is ever mid-edit at a time). Each card has a thin
  header strip (`.board-node__header`) holding a pin (the connection
  handle — see below) and a small "×" remove button.
- **Dragging the card body** — `src/view/boardView.ts`'s `attachDrag`
  tracks plain client-pixel deltas directly against the card's own `x`/`y`
  (no viewBox conversion needed, since there's no zoom); click-vs-drag is
  resolved via `dragGesture.ts`'s shared `isClick`/`movedDistance`. The
  engine is only called once, on drag-end (`moveBoardNode`) — live
  position feedback during the drag is a pure `style.left`/`style.top`
  update, no engine call per pointermove. A plain click (below the
  threshold) is now a no-op — connections no longer start from a
  card-body click (see below).
- **Connections** anchor to each card's pin (`.board-node__pin`, a small
  "O" at top-center of the header strip) rather than the card's raw
  `x,y`, via `boardView.ts`'s `pinAnchor()` helper (`node.x +
  BOARD_NODE_WIDTH / 2, node.y + BOARD_NODE_PIN_Y` — fixed constants kept
  in sync with the CSS card width/header height, not a DOM measurement,
  since jsdom can't lay out real geometry). Starting a connection is a
  **press-and-hold drag on the pin** (`attachPinDrag`, a separate pointer
  listener from the card-body's own drag handle, so grabbing one never
  triggers the other): pointerdown on a pin appends one temporary `<svg>
  <line>` into the strings layer and mutates its endpoint directly on
  every `pointermove` (no re-render mid-gesture, same posture as node
  dragging); releasing over a DIFFERENT node's pin resolves the drop
  target via `document.elementFromPoint` (routed through an overridable
  test hook, `setElementFromPointForTest`, since jsdom's
  `elementFromPoint` always returns `null`) and opens the 4-swatch color
  popover (`BOARD_STRING_COLORS`, imported from `engine/board/board.ts`
  rather than duplicated) — picking a swatch calls `addBoardConnection`.
  Releasing over the same node or empty space is a silent no-op (the temp
  line is simply discarded). Clicking an existing string (a wide,
  invisible hit-stroke under the visible line, mirroring `MapView`'s edge
  click-hitbox technique) reopens the same swatch popover to recolor it,
  plus a "×" to remove it.
- **Stacking** — `.board-strings` renders above `.board-node` by default
  (`z-index: 5` vs `1`), so the corkboard-string look reads clearly even
  where a string crosses a card's text; a card rises above the strings
  layer only while hovered/focused (`z-index: 10`), so its text stays
  legible on demand without permanently hiding the strings.
- **`dragGesture.ts` extraction** (`src/mapview/dragGesture.ts`): only
  the click-vs-drag threshold (`CLICK_MOVEMENT_THRESHOLD_PX`,
  `isClick`, `movedDistance`) is actually shared with `MapView.ts` —
  MapView's `dragState`/pan/node-drag logic is all tied to SVG viewBox
  math with no equivalent in the board's plain-CSS-transform card
  layout, so extracting a full shared `DragGesture` state machine would
  have forced an abstraction over two genuinely different coordinate
  systems for no real benefit. This is the deliberate, documented
  fallback the original plan allowed for. `MapView.test.ts` passes
  unmodified post-refactor (the regression gate).
- **Deferred polish, not required for v1**: no pan/zoom (see above).

**Post-ship refinement (view-layer only, no engine/save changes):** the
original Stage 2 shipped a click-node/click-node connect flow with
strings anchored to each card's raw top-left corner and notes permanently
showing an editable textarea. All three were revised after manual review
surfaced real usability problems (notes were nearly undraggable because
the textarea's `pointerdown` handler silently ate the card's own drag
listener; nothing signaled how to start a connection; strings anchored
messily and cards always covered them). The section above describes the
current, as-built behavior — the pin, the press-and-hold drag gesture,
and the hover-revealed pencil icon are not a new stage, just Stage 2's
interaction model corrected.

## Stage 3 — node picker, note authoring

`src/view/boardView.ts`'s `renderAddNodeMenu()` renders a "+ Add node"
dropdown in the overlay's toolbar. **Deliberate deviation from the
original plan sketch**: this is plain DOM, NOT a `MenuFlow` screen —
`MenuFlow` renders into the terminal scrollback, which sits entirely
BEHIND this full-screen overlay, so it has no way to be shown while the
board is open. Discovered by inspecting how the pre-existing notebook
overlay's own "+ New note" affordance works: it's plain DOM inside the
overlay too, for the same structural reason — not a `MenuFlow` prompt.

- Top level: five categories (Fact/Person/Place/Item/Note). A reference
  category drills into `GameEngine.listAddableBoardEntities()` filtered
  to that `refKind`, each entity a button labeled via its `labelKey`
  (`t()`-resolved). Selecting one calls `addBoardNode(refKind, refId,
  null, x, y)`. An empty category shows `ui.boardNoAddableEntities`
  instead of a blank list.
- "Note" opens a plain text input + "+" submit button, calling
  `addBoardNode("note", null, text, x, y)`.
- New nodes' default position comes from `board.ts`'s
  `defaultNodePosition(existingNodeCount)` — a simple 5-column staggered
  grid (180px/140px spacing), not load-bearing; it only exists so
  freshly-added cards don't all land exactly on top of each other.
- The dropdown closes and the canvas re-renders after any add — same
  "full wholesale redraw" posture as the rest of the overlay.

Node/connection removal and recoloring shipped in Stage 2 already (see
above) — nothing further was needed for those in this stage.

## How it interacts with other systems

- **Case system** (`docs/systems/case-system.md`): fact nodes read the
  same `getPlayerFacts()`/`playerFacts` surface the flat facts panel
  already uses — the board is an alternate, spatial VIEW of a subset of
  the same "what has the player learned" state, not a new source of
  truth for facts.
- **Dialogue** (`docs/systems/dialogue.md`): NPC nodes are gated by the
  same `talkedTo.<npcId>` flag dialogue conditions already read.
- **Navigation** (`docs/systems/navigation.md`): location nodes are
  gated by `Player.visitedLocationIds`, the same list the locations
  panel already uses for its spoiler-safe default.
- **Save** (`docs/systems/save.md`): `board` is part of the mutable
  slice — see "Save integration" above.

## Known gaps

- No pan/zoom on the canvas (a large scrollable area instead) — see
  "Stage 2" above.
- Item nodes miss anything only examined, never taken (see "Three named
  v1 scope limits" above) — would need new "examined" tracking, not
  planned.
- No connection labels, no auto-inferred/contradiction-detected
  connections — deliberate, not planned for this feature; see "What it
  is" above.

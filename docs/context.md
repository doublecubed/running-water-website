# Handoff — 2026-09-29 (Scene image pane fade transition; a dither toggle is planned but NOT built)

Short version: since the 2026-09-27 handoff this project gained (1) a
refinement pass on the case board, (2) a **scene image pane** — a
fixed-size picture of the current location (or of whatever's examined)
with clickable hotspots that run commands, above a log whose coverage of
it is a three-way toggle (auto/expanded/collapsed, default collapsed), (3)
a **map editor popup** to author those images (draw hotspot zones, no more
hand-YAML-only), and (4) a **fade-to-blank transition** between scene
images (old-adventure-game style, not a crossfade). It was built partly as
groundwork for reusing this engine as a game-studio website. The right
side panel now defaults to Inventory (was Verbs). The full suite is green
(33 files, 609 tests), `tsc --noEmit` and `npm run build` are clean. The
old `diner-upper-floor` alias failure is fixed (see below).

**Update (dither built, uncommitted):** the dither is implemented as a
**transition effect**: with `ditherEnabled`, scene-image fades become a stepped
pixel dissolve (out with increasing dither, in from fully dissolved) instead of
an opacity fade, and the image is clean at rest. Settings live in `src/main.ts`
(`IMAGE_DITHER_ENABLED`, `IMAGE_DITHER_STEPS`); see `docs/systems/image-pane.md`'s
"Dithering (dissolve transition)". 612 tests, `tsc` and build clean. It has NOT
been seen in a browser: tune the noise frequency/range in `buildDissolveFilter`
and the step count by eye, then do the manual checklists below.

## Website implications — READ THIS if you are in the website repo

This repo is being turned into a **GitHub template**; the studio website is
generated from it as a separate repo (no shared history, no upstream link).
Decisions already made:

- **The website is a plain text adventure plus one small "breadcrumb
  puzzle"** (go here, talk to an object as if it were an NPC, follow a chain
  of leads) — not a full case-solving experience. The design sketch is
  `docs/website/puzzle_system.md`; it maps the puzzle onto existing systems
  (locations/exits as pages, NPCs as talking objects, facts/dialogue
  conditions as gating). Follow the guidelines there: 5–7 steps, a payoff,
  hints, nothing valuable hidden behind it, plain links always available.
- **Direction of change is cutting, not adding.** Expect the website to
  delete features (map/NPC/object editors, case board, notebook, probably
  travel/transit depth) rather than extend them. Little is expected to flow
  back to the game; if a shared fix is needed, copy it by hand or add the
  template as a second git remote and cherry-pick.
- **Delete the editors first** (`src/editor/`, the second Vite entry
  point), then leave other engine internals alone unless tests prove a
  removal safe. Keep `src/engine/` close to unchanged so cherry-picks stay
  easy.
- **The client bundle is always public.** Nothing can be hidden from a
  visitor who opens dev tools; do not put anything secret in content or
  code. Minification strips comments, so any in-jokes for curious readers
  belong in `index.html` or console output, not source comments.
- **Website-specific content to author:** real location art in
  `public/images/` (only placeholder SVGs exist: `alley.svg` and the desk set), hotspots on
  every page location so visitors who don't know text-adventure syntax can
  click instead of type, and the puzzle's locations/NPCs/dialogue.
- The project rules in `CLAUDE.md` (headless engine, no inline strings,
  content is data, save only the mutable slice) still apply to the fork
  unless the website owner changes them explicitly.

## What shipped — scene image pane

Full writeup: `docs/systems/image-pane.md`; manual checklist:
`docs/image-pane-manual-tests-plan.md`.

- **Data:** optional `image:` block on a location in YAML (`src`, alt text,
  hotspots with `command` and a `rect: [x, y, w, h]` in percent of the
  image). Loader validation and locale-key derivation in
  `cityLoader.ts` (`validateImage`/`validateHotspot`); types
  `LocationImage`/`Hotspot` in `engine/types.ts`. Authored content, so **no
  save-schema change and no engine events.** Schema in
  `docs/content-schema.md`.
- **View:** `src/view/imagePane.ts` (`renderImagePane`, idempotent via a
  JSON signature) driven from `TerminalView.updateStatusBar()`. Hotspots are
  real `<button>`s; a click runs its command through `runInput()` (the same
  path as typed Enter, echoed in the log), so a hotspot can never do more
  than typing.
- **Layout (latest change):** the terminal is a fixed-height column
  (`100dvh` minus page padding), so the page never scrolls. The image panel
  is a fixed size (`--image-panel-height`, `clamp(160px, 35vh, 360px)`); the
  image is centered at natural size and scaled down if larger. The log fills
  the rest and is cropped from the top, pinned to the newest line by a
  `ResizeObserver`. A top-right toggle button cycles three modes on click —
  Auto (hover overlays it, leaving the top quarter of the panel visible),
  Expanded (always overlays), Collapsed (default; hover does nothing). The
  percent-hotspot math requires the
  figure to shrink-wrap the image — do not switch to `object-fit` on a
  panel-sized `<img>`; any upscaling/cropping fit mode would need explicit
  content-rect math for hotspots.
- **Examine-driven and state-driven images (added 2026-09-27):** the same
  `image:` block is valid on world objects, part states and NPCs. While the
  player examines one, its image replaces the location's until `back`/
  travel/talk; a part state's image overrides the object's, so `open`/`close`
  swap pictures. Resolved by the pure engine getter `getSceneImage()` from a
  new transient, unsaved `GameState.examinedTarget` (cleared with focus);
  part state is already saved, so no schema bump. Placeholder art is on the
  office desk's right drawer. The website should reuse this for its "talk to
  the object" puzzle steps (an NPC/object image per lead).
- **Map editor authoring UI (added 2026-09-27):** an "Edit image…" popup
  (`src/editor/imageEditor.ts`, the editor's first `<dialog>`) on each of
  the four entities — pick a filename (live preview against
  `public/images/`, no upload), drag rectangles to create hotspots, fill in
  label + command, fine-tune x/y/w/h numerically. Nothing writes to `city`
  until the parent form's own Save, same as every other field. Website note:
  this is the tool for authoring the puzzle's per-lead images/hotspots.
- **Content-quality tests:** every hotspot command must parse to a known
  command (`world.test.ts`); location display names must be aliases of their
  own location — this caught `diner-upper-floor` and `docks-office`, fixed
  by adding the missing aliases.
- **Placeholder art:** `public/images/alley.svg` with two hotspots on the
  `alley` location, only so there is something to look at.

## What shipped — scene image fade transition (2026-09-29)

Full writeup: `docs/systems/image-pane.md`'s "Fade transition" section.

- **Fade-to-blank, not crossfade:** the outgoing picture fades to nothing,
  THEN the new `<figure>` is built and faded in — matches Sierra/LucasArts-
  style scene cuts. Applies to appearing/disappearing too (no image ↔
  image), not just image-to-image. Only one `<figure>` is ever in the DOM.
- `renderImagePane` (`src/view/imagePane.ts`) takes a `fadeDurationMs`
  parameter (default `DEFAULT_IMAGE_FADE_DURATION_MS = 200`, `0` =
  instant/disabled) — a **developer/content-level knob, not a player
  setting** (confirmed with the user). `TerminalView`'s constructor takes
  it as an optional 4th argument and threads it through every
  `updateStatusBar()` call.
- Pure view-layer timing (CLAUDE.md's engine/view boundary) — the engine's
  `getSceneImage()` stays a plain synchronous getter, unaware any of this
  happens. The transition duration is set inline per-swap
  (`figure.style.transitionDuration`), never duplicated in CSS, so JS and
  CSS timing can't drift apart. The very first render never fades (nothing
  to fade from).
- Existing `TerminalView.test.ts` call sites now construct `TerminalView`
  with `fadeDurationMs: 0` explicitly, so the ~40 pre-existing assertions
  that check DOM state synchronously right after a turn keep working
  unchanged. Three new tests (in a `"TerminalView — scene image fade
  transition"` describe block) cover the deferred swap, fade-through-hidden,
  and the instant `0` case using real (not fake) timers/awaits, matching
  this file's existing style (see the log auto-collapse test).
- The dither toggle raised alongside the fade has since been built (see the
  update at the top of this file).

## What shipped — case board refinement

Committed as `5165fd5`, following the three-stage case board (see
`docs/systems/case-board.md`, `docs/architecture.md`'s "The case board
overlay", and `docs/case-board-manual-tests-plan.md`). The board is
purely player-authored by explicit design: no auto-inferred connections, no
contradiction detection, no connection text labels (four colors only).

## Not yet verified — manual browser checks

Nothing has been exercised in a real browser (no browser tool is available,
and the user has declined the Chrome extension — do not suggest it).
jsdom covers DOM structure and event wiring, not layout. Outstanding
checklists, highest value first:

1. `docs/image-pane-manual-tests-plan.md` — the fixed panel size, log
   cropping and hover-expand were built and tested in jsdom only; confirm
   no browser scrollbar, hotspots line up with the picture, and the log
   stays on the newest line as it shrinks.
2. `docs/case-board-manual-tests-plan.md` — drag persistence across
   close/reopen and save/load, the connect flow, the add-node dropdown.
3. `docs/npc-editor-manual-tests-plan.md` — the three NPC-editor stages and
   the topic-menu/panel-menu re-verification.

## Deliberately deferred / known gaps

- **Image pane:** per-pixel (canvas) dithering, polygon hotspots, NPC/item portraits shown outside `examinedTarget`,
  other fit modes, preloading (see `docs/future_work.md`, "Image pane
  follow-ups").
- **Case board:** no pan/zoom (a large scrollable canvas instead), no live
  preview line while connecting, item nodes are inventory-only, and "NPCs
  met" reuses the `talkedTo.<npcId>` flag convention.

## Recommended next step

Tune the dither filter in a real browser, then walk through the image-pane checklist
(including the new fade transition and dither toggle) in a real browser.
After that, mark the repo as a template and start the website repo from it
(delete editors first, then author the art and the breadcrumb puzzle).
Otherwise, the next game-side work is authoring the more complex case the
NPC editor and case board were built to support.

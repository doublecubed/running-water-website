# Image pane (scene image + hotspots)

A picture of the current location — or of whatever the player is examining —
shown between the location header and the log, with optional clickable rectangles ("hotspots") that run commands. Built
so players who don't know text-adventure syntax can click instead of type,
and so the engine can later be forked into a studio website reusing it.

## What it is — and isn't

- **Authored content, not state.** An `image:` block (on a location, world
  object, part state or NPC — see `docs/content-schema.md`) is loaded fresh
  every launch and never saved, so there is no save-schema change.
- **No engine events.** The view asks `engine.getSceneImage()` each turn, the
  same way `updateStatusBar()` derives the location header. It is a pure
  function of state, so it is testable headless.
- **A hotspot is typed input.** Clicking one feeds its `command` string
  through `TerminalView.runInput()` — the same path as Enter — so it echoes
  `> command` in the log and can never do anything typing couldn't.
  Half-typed text in the input box is left alone.

## Pieces

| Piece | Where |
|---|---|
| `SceneImage` (alias `LocationImage`) / `Hotspot` types; `image?` on `BaseLocation`, `WorldObject`, `PartState`, `Npc` | `src/engine/types.ts` |
| `examinedTarget` state, `getSceneImage()` | `GameEngine.ts` |
| YAML validation, locale-key derivation | `validateImage`/`validateHotspot` in `src/content/cityLoader.ts` (key-prefix parameterised) |
| Rendering | `renderImagePane` in `src/view/imagePane.ts` |
| Mount + per-turn refresh | `TerminalView` template and `updateStatusBar()` |
| Styling | `.terminal__image`, `.scene-image*` in `src/view/terminal.css` |
| Assets | `public/images/` (served at `<BASE_URL>images/<src>`) |

## Behavior notes

- Hidden entirely (no empty box) for locations without an image. The log is
  always complete on its own — the pane is an addition, never the only way
  to do anything.
- `renderImagePane` runs after every turn, so it compares a JSON signature
  of the image and only rebuilds the DOM when it changes (no flicker, no
  lost hover/focus).
- Hotspots are real `<button>`s with the label as `title`/`aria-label`:
  keyboard focus and activation, and screen-reader names, come free.
  Outline shows only on hover/focus.
- Coordinates are percent of the image, so they hold at any display size.
  The figure is `inline-block`, so percentages are relative to the picture,
  not a wider container.

## Which image shows: examine and state images

`GameEngine.getSceneImage()` resolves, in order:

1. **While examining something** (`GameState.examinedTarget`):
   - an **object** → the `image` of the last part (authored order) whose
     *current* state has one, else the object's own `image`;
   - an **NPC** → its `image`.
2. If the examined thing has no image → the **location's** image (the pane
   never blanks mid-scene).
3. Otherwise the location's image (or nothing → pane hidden).

- `examinedTarget` is set by `examine` (objects with or without parts, NPCs,
  parts → their parent) and by a successful `interact`; it is cleared exactly
  where focus is (`back`/`stop`, travel, talking, opening the travel menu —
  `clearFocus`). It is **transient and not saved** (like
  `focusedWorldObjectId`), so after a load the location image shows until the
  player examines something again.
- **Part state IS saved** (`partStates`), so a state's image is correct the
  moment the object is re-examined after a load. Changing state with
  `interact` (`open`/`close`) swaps the picture on the next refresh.
- Hotspots on these images work identically (e.g. an open-drawer image can
  carry `take torn photograph` / `close right drawer` hotspots).
- Location variants keyed by object state are deliberately not supported: one
  panel, one thing in focus.
- Placeholder art: `desk.svg`, `desk-drawer-open.svg`, `desk-drawer-closed.svg`
  on the office desk's right drawer.

## Layout: fixed panel, cropped log, hover-expand

- **Fixed-size panel.** `.terminal__image` has a fixed height
  (`--image-panel-height`, `clamp(160px, 35vh, 360px)`, defined on
  `.terminal`) whatever the image's size. The image is centered at its
  natural size and scaled down (never up) to fit; the rest is padding. This
  is done with `max-width`/`max-height` on a shrink-wrapped figure, NOT
  `object-fit` on a panel-sized `<img>`: hotspot percentages must map onto
  the rendered picture, and letterboxing inside a larger `<img>` box would
  misplace them. Any future fit mode that upscales or crops ("cover",
  "stretch") needs explicit content-rect math for hotspots.
- **Fixed-height terminal column.** `.terminal` is `100dvh` minus the page
  padding, so the page never scrolls. The stage (`.terminal__stage`) holds
  image + log; the log is `flex: 1; min-height: 0`, so showing an image
  crops the log from the top rather than pushing the page down. With no
  image the log takes the whole stage.
- **Scroll pinning.** Shrinking the log doesn't move `scrollTop`, which would
  crop the newest lines. A `ResizeObserver` (skipped where absent, i.e.
  jsdom) re-pins the log to the bottom on height changes, but only if it
  was already at the bottom.
- **Expanding the log.** With an image showing, the log can overlay it via
  `.terminal__log--expanded` (absolute overlay anchored to the bottom, so
  nothing reflows), covering all but the top quarter of the image panel so
  hotspots there stay reachable. A toggle button (`.terminal__log-toggle`,
  top-right of the stage) cycles three modes on click, in order: **Auto** —
  hovering the log expands it, leaving collapses after 250 ms to avoid edge
  flicker; **Expanded** — always overlays the image, no hover needed (the
  touch/keyboard route, since hover doesn't exist on phones); **Collapsed**
  (default) — never overlays, hover does nothing. The button's label
  shows the current mode (`ui.logModeAuto` / `ui.logModeExpanded` /
  `ui.logModeCollapsed`) and gets a `.terminal__log-toggle--active` style
  when pinned to Expanded or Collapsed; its `title` is the fixed hint
  `ui.logToggleHint`. `aria-expanded` reflects whether the log is actually
  overlaying right now, not the mode. Typing does not change the mode. The
  toggle is inert (hidden) while no image shows.
- **Authoring in the editor.** Locations, world objects, part states and
  NPCs each get an "Edit image…" button (the object form has one for the
  object itself plus one inside each part state's block) opening a popup
  (`src/editor/imageEditor.ts`, `openImageEditor` — the editor's first use
  of a native `<dialog>` rather than its usual always-mounted sidebar). The
  designer types a filename against `public/images/` (a live `<img>`
  preview, no upload — that's still a manual step), drags rectangles over it
  to create hotspots, and fills in each one's label + command; numeric
  x/y/w/h fields allow fine-tuning without redrawing. The popup only knows
  the shared `ImageDraft`/`HotspotDraft` shapes, not `SceneImage` or
  `city` — `main.ts`'s `sceneImageToDraft`/`draftImageToScene` convert on
  open/commit, deriving locale keys the same way `cityLoader.ts`'s
  `validateImage`/`validateHotspot` would (`${keyPrefix}.alt`,
  `${keyPrefix}.hotspot${i}.label`). Nothing is written into `city` until
  the PARENT form's own Save, same as every other field — the popup's own
  Save/Remove only update that form's in-progress draft. `imageToRaw` still
  does the actual YAML serialization, unchanged.
- `world.test.ts` checks every hotspot command parses to a known command.

## Fade transition

- **Fade-to-blank, not crossfade** — an old-adventure-game-style cut: the
  outgoing picture fades to nothing, THEN the new `<figure>` is built and
  faded in. Only one `<figure>` is ever in the DOM at a time; going to or
  from "no image" fades the same way (fade out to hidden, or fade in from
  hidden), not just image-to-image.
- `renderImagePane`'s last argument, `fadeDurationMs` (default
  `DEFAULT_IMAGE_FADE_DURATION_MS`, `src/view/imagePane.ts`), is a
  developer/content-level knob, not a player setting — `0` disables it
  (instant swap, the historical behavior). `TerminalView`'s constructor
  takes it as an optional 4th argument and threads it through on every
  `updateStatusBar()` call.
- This is pure view-layer timing (CLAUDE.md's engine/view boundary):
  `GameEngine.getSceneImage()` stays a plain synchronous getter, unaware
  any of this happens. `renderImagePane` alone decides to defer the DOM
  swap with a `setTimeout`, driven by a `.scene-image--fade-hidden`
  (`opacity: 0`) class whose transition duration is set inline per swap
  (`figure.style.transitionDuration`), so JS and CSS timing can never
  drift apart. The very first render has nothing to fade from, so it
  always appears instantly regardless of `fadeDurationMs`.
## Dithering (dissolve transition)

An optional retro replacement for the opacity fade. The dither is a
**transition effect only**: the image is always clean at rest. Fading out, the
picture loses more and more randomly-placed pixels over stepped frames until
nothing is left; fading in, the new one starts fully dissolved (zero visible
pixels) and fills in. Same fade-to-blank structure as above (one `<figure>` at a
time, swap after `fadeDurationMs`); only the visual differs. With dither on, no
`.scene-image--fade-hidden` opacity class is used.

- **Toggle + step count, both set in code.** `renderImagePane`'s 6th/7th
  arguments are `ditherEnabled` (default `false`) and `ditherSteps` (default
  `DEFAULT_IMAGE_DITHER_STEPS = 8`: fewer = chunkier). `TerminalView`'s
  constructor takes them as its 5th/6th arguments, and `src/main.ts` holds the
  named constants (`IMAGE_DITHER_ENABLED`, `IMAGE_DITHER_STEPS`) to edit. Not a
  player setting, same as the fade duration. Dither only applies when
  `fadeDurationMs > 0`.
- **Mechanism.** `buildDissolveFilter(progress)` returns a CSS `filter` value
  (`""` at 0, so a resting image has no filter): an inline SVG filter in a
  `data:` URI that turns `feTurbulence` noise into a hard on/off alpha mask
  (`feColorMatrix` → `feComponentTransfer` with a steep slope) and keeps source
  pixels with `feComposite operator="in"`. `progress` sweeps the threshold from
  `DISSOLVE_NOISE_LOW` to `DISSOLVE_NOISE_HIGH` (single-octave noise clusters
  mid-range); at 1 nothing survives. The filter is built and animated in code
  (`stepDissolve`, discrete `setTimeout` frames: the chunkiness is the look)
  because a CSS `url(data:...)` can't read CSS variables or transition its
  contents. Applied to the `<img>` only, so hotspot percent-math is unaffected.
  No signature/caching change: it's per-session config.
- **The first render ever never dissolves** (nothing to come from); after that,
  including appearing from "no image", it does.
- **Needs visual tuning.** jsdom can't render SVG filters, so tests only check
  that a filter is applied mid-dissolve, cleared at rest, and that the opacity
  class is absent. Noise frequency (0.9) and the low/high range are a starting
  point; tune by eye in a browser.
- Real per-pixel dithering (canvas, ordered/Floyd–Steinberg) is not built; see
  `docs/future_work.md`.

## Not built

See `docs/future_work.md`'s "Image pane follow-ups": per-pixel dithering, polygon
hotspots, persistent NPC/item portraits outside of `examinedTarget`, other
fit modes, preloading. Placeholder art (`alley.svg`) and two hotspots on
the alley location exist purely so there's something to look at.

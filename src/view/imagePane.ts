import type { LocationImage } from "../engine/types";

/**
 * Default fade duration (ms) between scene images — see "Behavior notes"
 * below. A developer/content-level knob, not a player-facing setting: pass
 * a different value (0 to disable, i.e. an instant swap) as `renderImagePane`'s
 * last argument. `TerminalView` exposes it as a constructor option.
 */
export const DEFAULT_IMAGE_FADE_DURATION_MS = 500;

/**
 * Default number of discrete dissolve steps when `ditherEnabled` is on. The
 * dither is a TRANSITION effect (the image is clean at rest): the outgoing
 * picture loses more and more randomly-placed pixels over this many stepped
 * frames, and the incoming one fills in over the same number. Fewer steps =
 * chunkier, more retro; more = smoother. A developer-level knob adjusted in
 * code, not a player setting.
 */
export const DEFAULT_IMAGE_DITHER_STEPS = 8;

/** The noise range the dissolve threshold sweeps (single-octave fractal noise clusters mid-range, so sweeping 0-1 would waste steps at both ends). */
const DISSOLVE_NOISE_LOW = 0.2;
const DISSOLVE_NOISE_HIGH = 0.8;

/**
 * Builds the CSS `filter` value for one frame of the dither dissolve: an SVG
 * filter in a `data:` URI that turns fractal noise into a hard on/off mask
 * and keeps only the source pixels where noise exceeds a threshold.
 * `progress` 0 = fully visible (returns "" so the resting image carries no
 * filter at all), 1 = fully dissolved. Built in code, not terminal.css,
 * because the threshold changes every frame and a CSS `url(data:...)` can't
 * read variables. Applied to the `<img>` only, so hotspot percent-math is
 * unaffected. The noise frequency/range are a starting point: filters can't
 * be previewed headlessly, so tune by eye in a browser.
 */
export function buildDissolveFilter(progress: number): string {
  if (progress <= 0) {
    return "";
  }
  // At full progress nothing may survive, however high a noise pixel is.
  const threshold = progress >= 1 ? 1.01 : DISSOLVE_NOISE_LOW + (DISSOLVE_NOISE_HIGH - DISSOLVE_NOISE_LOW) * progress;
  const slope = 255; // makes the alpha ramp a hard edge: pixel is either fully kept or fully dropped
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg"><filter id="d" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" stitchTiles="stitch"/>` +
    // noise's red channel becomes the alpha channel, then is thresholded
    `<feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0"/>` +
    `<feComponentTransfer result="mask"><feFuncA type="linear" slope="${slope}" intercept="${+(-slope * threshold).toFixed(3)}"/></feComponentTransfer>` +
    `<feComposite in="SourceGraphic" in2="mask" operator="in"/>` +
    `</filter></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}#d")`;
}

/**
 * Steps `img`'s dissolve filter from progress `from` to `to` over `durationMs`
 * in `steps` discrete frames (setTimeout, not a smooth CSS transition — the
 * chunkiness IS the look). The first frame is applied synchronously; the last
 * lands at `durationMs`. Ending at 0 clears the filter, leaving a clean image.
 */
function stepDissolve(img: HTMLElement, from: number, to: number, durationMs: number, steps: number): void {
  const frame = (i: number) => {
    img.style.filter = buildDissolveFilter(from + ((to - from) * i) / steps);
  };
  frame(0);
  for (let i = 1; i <= steps; i++) {
    setTimeout(() => frame(i), (durationMs * i) / steps);
  }
}

/**
 * Renders (or hides) the scene-image pane for the current location — see
 * docs/systems/image-pane.md. A pure view function in the style of
 * boardView.ts: it owns no state beyond a signature stashed on the mount.
 *
 * Called from `TerminalView.updateStatusBar()` after EVERY turn, so it must
 * be cheap and idempotent: it only rebuilds the DOM when the image or its
 * hotspots actually change (a re-render mid-hover would drop focus/hover
 * state from the hotspot buttons, and re-adding the <img> would flicker).
 *
 * When the image changes (including to/from no image) and `fadeDurationMs`
 * is nonzero, the outgoing picture fades to blank first (or, with
 * `ditherEnabled`, dissolves away in stepped, randomly-stippled frames and the
 * new one dissolves in — see `buildDissolveFilter`), THEN the new one
 * is built and faded in — an old-adventure-game-style transition, not a
 * crossfade, so only one `<figure>` is ever on screen. This is timing, so
 * it belongs here in the view layer, never the engine (CLAUDE.md's
 * engine/view boundary): `getSceneImage()` stays a plain synchronous
 * getter, and this function alone decides to wait between DOM swaps. A
 * duration of 0 (or the very first render, which has nothing to fade from)
 * swaps synchronously, matching every existing caller/test's expectations.
 *
 * Hotspots are real `<button>`s over the image (percent-positioned), so
 * keyboard focus, Enter/Space activation and screen-reader labels come for
 * free. Clicking one calls `onHotspot(command)`; the caller feeds it through
 * the normal input path, so a hotspot can never do more than typing could.
 */
export function renderImagePane(
  mount: HTMLElement,
  image: LocationImage | undefined,
  resolve: (key: string) => string,
  onHotspot: (command: string) => void,
  fadeDurationMs: number = DEFAULT_IMAGE_FADE_DURATION_MS,
  ditherEnabled: boolean = false,
  ditherSteps: number = DEFAULT_IMAGE_DITHER_STEPS,
): void {
  const signature = image === undefined ? "" : JSON.stringify(image);
  const initialized = mount.dataset.signature !== undefined;
  if (initialized && mount.dataset.signature === signature) {
    return;
  }
  mount.dataset.signature = signature;

  const swap = () => {
    if (image === undefined) {
      mount.hidden = true;
      mount.replaceChildren();
      return;
    }
    mount.hidden = false;
    const figure = buildFigure(image, resolve, onHotspot);
    mount.replaceChildren(figure);
    if (fadeDurationMs > 0 && ditherEnabled) {
      // Dithered fade-in: start fully dissolved (zero visible pixels), fill in.
      // The very first render has nothing to transition from, so it appears clean.
      if (initialized) stepDissolve(figure.querySelector<HTMLElement>(".scene-image__img")!, 1, 0, fadeDurationMs, ditherSteps);
    } else if (fadeDurationMs > 0) {
      figure.style.transitionDuration = `${fadeDurationMs}ms`;
      figure.classList.add("scene-image--fade-hidden");
      // Force a layout so the browser commits the opacity:0 state before we
      // remove the class — otherwise the two style changes coalesce and
      // there's nothing to transition FROM, so it would just appear.
      void figure.offsetWidth;
      figure.classList.remove("scene-image--fade-hidden");
    }
  };

  const outgoing = fadeDurationMs > 0 && initialized ? (mount.firstElementChild as HTMLElement | null) : null;
  if (outgoing) {
    if (ditherEnabled) {
      // Dithered fade-out: the image loses more and more pixels each step.
      stepDissolve(outgoing.querySelector<HTMLElement>(".scene-image__img")!, 0, 1, fadeDurationMs, ditherSteps);
    } else {
      outgoing.style.transitionDuration = `${fadeDurationMs}ms`;
      outgoing.classList.add("scene-image--fade-hidden");
    }
    setTimeout(swap, fadeDurationMs);
  } else {
    swap();
  }
}

/** Builds the `<figure>` for one scene image — split out so `renderImagePane` can build it either immediately or after a fade-out delay. */
function buildFigure(
  image: LocationImage,
  resolve: (key: string) => string,
  onHotspot: (command: string) => void,
): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "scene-image";

  const img = document.createElement("img");
  img.className = "scene-image__img";
  img.src = `${import.meta.env.BASE_URL}images/${image.src}`;
  img.alt = resolve(image.altKey);
  figure.append(img);

  for (const hotspot of image.hotspots) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scene-image__hotspot";
    const label = resolve(hotspot.labelKey);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.style.left = `${hotspot.x}%`;
    button.style.top = `${hotspot.y}%`;
    button.style.width = `${hotspot.w}%`;
    button.style.height = `${hotspot.h}%`;
    button.addEventListener("click", () => onHotspot(hotspot.command));
    figure.append(button);
  }

  return figure;
}

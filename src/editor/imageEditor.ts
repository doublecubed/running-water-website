/**
 * Popup editor for a `SceneImage` (see `src/engine/types.ts` and
 * `docs/systems/image-pane.md`) — lets a designer point at a file under
 * `public/images/`, drag out hotspot rectangles on a live preview, and give
 * each one a label + command. Used by `main.ts` for locations, world
 * objects, part states and NPCs alike: it knows nothing about which kind of
 * entity it's editing, only the shared `ImageDraft` shape, so `main.ts`
 * handles converting to/from the real typed `SceneImage` (locale keys,
 * etc.) on open/save.
 *
 * Deliberately decoupled from `main.ts`'s engine-content imports (no
 * `SceneImage`/`city` references here) so it can be unit-tested in
 * isolation and reused for all four entity kinds without circular concerns.
 *
 * Built as a single lazily-created, reused `<dialog>` (this editor's first
 * use of one) rather than the sidebar's "always-mounted, toggle `.hidden`"
 * convention — a true popup fits "pick a file, draw some zones" better
 * than a permanent panel, and `<dialog>` gives focus-trap/Esc/backdrop for
 * free.
 */

export interface HotspotDraft {
  label: string;
  command: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageDraft {
  src: string;
  alt: string;
  hotspots: HotspotDraft[];
}

export interface OpenImageEditorOptions {
  /** The image's base URL prefix (e.g. `import.meta.env.BASE_URL`), so the preview resolves the same way the game view does. */
  baseUrl: string;
  initial: ImageDraft | null;
  /** `null` means "Remove image" was clicked. Not called on Cancel. */
  onSave: (result: ImageDraft | null) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function row(labelText: string, field: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "editor__field";
  const label = document.createElement("label");
  label.textContent = labelText;
  el.append(label, field);
  return el;
}

function textInputEl(value: string, onInput: (v: string) => void, placeholder = ""): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function numberInputEl(value: number, onInput: (v: number) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.1";
  input.value = String(round2(value));
  input.addEventListener("input", () => {
    const n = Number.parseFloat(input.value);
    if (Number.isFinite(n)) onInput(n);
  });
  return input;
}

let cachedUi: ReturnType<typeof buildDialog> | null = null;
/** The current open session's listener-teardown, invoked by the dialog's native "close" event (Esc, backdrop click) as well as by Save/Remove/Cancel — see `buildDialog`. */
let activeCleanup: (() => void) | null = null;

/** Lazily builds the single reused dialog and returns its interactive parts. Only ever called once — see the module-level `cachedUi` cache. */
function buildDialog(): {
  dialog: HTMLDialogElement;
  srcInput: HTMLInputElement;
  altInput: HTMLInputElement;
  previewImg: HTMLImageElement;
  previewWrap: HTMLDivElement;
  drawSurface: HTMLDivElement;
  notFoundMsg: HTMLParagraphElement;
  hotspotList: HTMLDivElement;
  warningMsg: HTMLParagraphElement;
  saveButton: HTMLButtonElement;
  removeButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
} {
  const dialog = document.createElement("dialog");
  dialog.className = "editor__image-dialog";
  // Esc / clicking the backdrop closes a <dialog> natively without going
  // through our Save/Remove/Cancel buttons — still must release the
  // document-level drag listeners either way, so route through the one
  // module-level hook every close path (including this) fires.
  dialog.addEventListener("close", () => activeCleanup?.());

  const heading = document.createElement("h2");
  heading.textContent = "Edit image";

  const srcInput = document.createElement("input");
  srcInput.type = "text";
  srcInput.placeholder = "desk.svg";

  const notFoundMsg = document.createElement("p");
  notFoundMsg.className = "editor__warning";
  notFoundMsg.textContent = "Not found under public/images/ — type an existing filename to draw zones.";

  const previewWrap = document.createElement("div");
  previewWrap.className = "editor__image-dialog__preview";

  const previewImg = document.createElement("img");
  previewImg.className = "editor__image-dialog__img";
  previewImg.alt = "";

  const drawSurface = document.createElement("div");
  drawSurface.className = "editor__image-dialog__draw-surface";

  previewWrap.append(previewImg, drawSurface);

  const altInput = document.createElement("input");
  altInput.type = "text";

  const hotspotList = document.createElement("div");
  hotspotList.className = "editor__image-dialog__hotspot-list";

  const warningMsg = document.createElement("p");
  warningMsg.className = "editor__warning";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove image";
  removeButton.className = "editor__remove-button";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  const actions = document.createElement("div");
  actions.className = "editor__sidebar-actions";
  actions.append(saveButton, removeButton, cancelButton);

  dialog.append(
    heading,
    row("image filename (under public/images/)", srcInput),
    notFoundMsg,
    previewWrap,
    row("alt text", altInput),
    hotspotList,
    warningMsg,
    actions,
  );
  document.body.append(dialog);

  return { dialog, srcInput, altInput, previewImg, previewWrap, drawSurface, notFoundMsg, hotspotList, warningMsg, saveButton, removeButton, cancelButton };
}

/**
 * Opens the popup image editor. `opts.initial === null` means "no image
 * yet" (Add flow) — the dialog starts empty and hides "Remove image".
 * Nothing is written back to the caller until Save/Remove; Cancel (or the
 * dialog's own Esc-to-close) discards every in-dialog edit.
 */
export function openImageEditor(opts: OpenImageEditorOptions): void {
  const ui = cachedUi ?? buildDialog();
  cachedUi = ui;

  const hotspots: HotspotDraft[] = opts.initial ? opts.initial.hotspots.map((h) => ({ ...h })) : [];
  let imageLoaded = false;
  const markerEls: HTMLDivElement[] = [];

  function markLoaded(): void {
    imageLoaded = true;
    ui.drawSurface.classList.remove("is-disabled");
    ui.notFoundMsg.hidden = true;
  }

  function markNotFound(): void {
    imageLoaded = false;
    ui.drawSurface.classList.add("is-disabled");
    ui.notFoundMsg.hidden = ui.srcInput.value.trim() === "";
  }

  function updatePreview(): void {
    const filename = ui.srcInput.value.trim();
    imageLoaded = false;
    ui.drawSurface.classList.add("is-disabled");
    ui.notFoundMsg.hidden = true;
    if (!filename) {
      ui.previewImg.removeAttribute("src");
      return;
    }
    const url = `${opts.baseUrl}images/${filename}`;
    // Re-assigning the SAME src (e.g. reopening on an existing image) is a
    // no-op in a real browser — it won't re-fire `load`, so the draw
    // surface would stay stuck disabled. Detect that case directly instead
    // of waiting for an event that isn't coming.
    if (ui.previewImg.src === url && ui.previewImg.complete && ui.previewImg.naturalWidth > 0) {
      markLoaded();
      return;
    }
    ui.previewImg.src = url;
  }

  function refreshValidity(): void {
    const valid = ui.srcInput.value.trim() !== "" && ui.altInput.value.trim() !== "" && hotspots.every((h) => h.label.trim() !== "" && h.command.trim() !== "");
    ui.saveButton.disabled = !valid;
    ui.warningMsg.hidden = valid;
    ui.warningMsg.textContent = "Fill in a filename, alt text, and every hotspot's label and command before saving.";
  }

  function renderMarkerRect(marker: HTMLDivElement, h: HotspotDraft): void {
    marker.style.left = `${h.x}%`;
    marker.style.top = `${h.y}%`;
    marker.style.width = `${h.w}%`;
    marker.style.height = `${h.h}%`;
    marker.title = h.label;
  }

  const listRowEls: HTMLDivElement[] = [];

  function renderAll(): void {
    for (const el of markerEls.splice(0)) el.remove();
    ui.hotspotList.replaceChildren();
    listRowEls.splice(0);

    hotspots.forEach((h, i) => {
      const marker = document.createElement("div");
      marker.className = "editor__image-dialog__hotspot";
      renderMarkerRect(marker, h);
      marker.addEventListener("click", () => {
        listRowEls[i]?.scrollIntoView({ block: "nearest" });
        listRowEls[i]?.classList.add("is-selected");
        setTimeout(() => listRowEls[i]?.classList.remove("is-selected"), 600);
      });
      ui.previewWrap.append(marker);
      markerEls.push(marker);

      const rowEl = document.createElement("div");
      rowEl.className = "editor__image-dialog__hotspot-row";
      const labelInput = textInputEl(h.label, (v) => {
        h.label = v;
        marker.title = v;
        refreshValidity();
      });
      const commandInput = textInputEl(h.command, (v) => {
        h.command = v;
        refreshValidity();
      });
      const xInput = numberInputEl(h.x, (v) => {
        h.x = clamp(v, 0, 100);
        renderMarkerRect(marker, h);
      });
      const yInput = numberInputEl(h.y, (v) => {
        h.y = clamp(v, 0, 100);
        renderMarkerRect(marker, h);
      });
      const wInput = numberInputEl(h.w, (v) => {
        h.w = clamp(v, 0.01, 100);
        renderMarkerRect(marker, h);
      });
      const hInput = numberInputEl(h.h, (v) => {
        h.h = clamp(v, 0.01, 100);
        renderMarkerRect(marker, h);
      });
      const removeRowButton = document.createElement("button");
      removeRowButton.type = "button";
      removeRowButton.textContent = "Remove";
      removeRowButton.addEventListener("click", () => {
        hotspots.splice(i, 1);
        renderAll();
        refreshValidity();
      });
      rowEl.append(
        row("label", labelInput),
        row("command", commandInput),
        row("x %", xInput),
        row("y %", yInput),
        row("w %", wInput),
        row("h %", hInput),
        removeRowButton,
      );
      ui.hotspotList.append(rowEl);
      listRowEls.push(rowEl);
    });
    refreshValidity();
  }

  ui.previewImg.onload = () => markLoaded();
  ui.previewImg.onerror = () => markNotFound();

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let ghost: HTMLDivElement | null = null;

  function dragBox(clientX: number, clientY: number): { left: number; top: number; w: number; h: number; rectW: number; rectH: number } {
    const rect = ui.previewWrap.getBoundingClientRect();
    const x0 = clamp(dragStartX - rect.left, 0, rect.width);
    const y0 = clamp(dragStartY - rect.top, 0, rect.height);
    const x1 = clamp(clientX - rect.left, 0, rect.width);
    const y1 = clamp(clientY - rect.top, 0, rect.height);
    return { left: Math.min(x0, x1), top: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), rectW: rect.width, rectH: rect.height };
  }

  const onMouseDown = (e: MouseEvent): void => {
    if (!imageLoaded || ui.drawSurface.classList.contains("is-disabled")) return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    ghost = document.createElement("div");
    ghost.className = "editor__image-dialog__ghost";
    ui.previewWrap.append(ghost);
    e.preventDefault();
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!dragging || !ghost) return;
    const box = dragBox(e.clientX, e.clientY);
    ghost.style.left = `${box.left}px`;
    ghost.style.top = `${box.top}px`;
    ghost.style.width = `${box.w}px`;
    ghost.style.height = `${box.h}px`;
  };
  const onMouseUp = (e: MouseEvent): void => {
    if (!dragging) return;
    dragging = false;
    const box = dragBox(e.clientX, e.clientY);
    ghost?.remove();
    ghost = null;
    if (box.rectW <= 0 || box.rectH <= 0) return;
    const xPct = (box.left / box.rectW) * 100;
    const yPct = (box.top / box.rectH) * 100;
    const wPct = (box.w / box.rectW) * 100;
    const hPct = (box.h / box.rectH) * 100;
    if (wPct < 1 || hPct < 1) return; // accidental click, not a drag
    hotspots.push({
      label: "",
      command: "",
      x: round2(clamp(xPct, 0, 100)),
      y: round2(clamp(yPct, 0, 100)),
      w: round2(clamp(wPct, 0.01, 100 - xPct)),
      h: round2(clamp(hPct, 0.01, 100 - yPct)),
    });
    renderAll();
  };
  ui.drawSurface.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  function cleanup(): void {
    ui.drawSurface.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    ui.previewImg.onload = null;
    ui.previewImg.onerror = null;
    if (activeCleanup === cleanup) activeCleanup = null;
  }
  activeCleanup = cleanup;

  function closeDialog(): void {
    cleanup();
    // jsdom (tests) implements <dialog> only partially across versions —
    // fall back to removing the `open` attribute either way. Calling
    // close() here also fires the "close" listener above, which re-runs
    // `cleanup()` — harmless, it's a no-op the second time.
    try {
      ui.dialog.close();
    } catch {
      ui.dialog.removeAttribute("open");
    }
  }

  ui.srcInput.oninput = () => {
    updatePreview();
    refreshValidity();
  };
  ui.altInput.oninput = () => refreshValidity();

  ui.saveButton.onclick = () => {
    closeDialog();
    opts.onSave({ src: ui.srcInput.value.trim(), alt: ui.altInput.value.trim(), hotspots: hotspots.map((h) => ({ ...h })) });
  };
  ui.removeButton.onclick = () => {
    closeDialog();
    opts.onSave(null);
  };
  ui.cancelButton.onclick = () => {
    closeDialog();
  };

  // Reset the dialog's fields from `opts.initial` (or empty, for Add).
  ui.srcInput.value = opts.initial?.src ?? "";
  ui.altInput.value = opts.initial?.alt ?? "";
  ui.removeButton.hidden = opts.initial === null;
  renderAll();
  updatePreview();
  refreshValidity();

  try {
    ui.dialog.showModal();
  } catch {
    ui.dialog.setAttribute("open", ""); // jsdom (tests) has no full <dialog> behavior — just show it
  }
}

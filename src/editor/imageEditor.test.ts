import { describe, expect, it, vi } from "vitest";
import { openImageEditor } from "./imageEditor";

function dialog(): HTMLDialogElement {
  return document.querySelector<HTMLDialogElement>(".editor__image-dialog")!;
}

function field(labelText: string): HTMLInputElement {
  const rows = Array.from(dialog().querySelectorAll(".editor__field"));
  const row = rows.find((r) => r.querySelector("label")?.textContent === labelText)!;
  return row.querySelector("input, textarea")!;
}

function preview(): HTMLElement {
  return dialog().querySelector(".editor__image-dialog__preview")!;
}

function drawSurface(): HTMLElement {
  return dialog().querySelector(".editor__image-dialog__draw-surface")!;
}

function previewImg(): HTMLImageElement {
  return dialog().querySelector(".editor__image-dialog__img")!;
}

function saveButton(): HTMLButtonElement {
  return Array.from(dialog().querySelectorAll("button")).find((b) => b.textContent === "Save")!;
}

function removeImageButton(): HTMLButtonElement {
  return Array.from(dialog().querySelectorAll("button")).find((b) => b.textContent === "Remove image")!;
}

function cancelButton(): HTMLButtonElement {
  return Array.from(dialog().querySelectorAll("button")).find((b) => b.textContent === "Cancel")!;
}

function hotspotRows(): HTMLElement[] {
  return Array.from(dialog().querySelectorAll(".editor__image-dialog__hotspot-row"));
}

/** Simulates the load/error the browser would fire for `previewImg().src` — jsdom never actually fetches images. */
function fireImageLoad(): void {
  previewImg().dispatchEvent(new Event("load"));
}

/** Makes `preview()` behave like a real rendered box of the given size, at the origin, so the drag-to-percent math has something to divide by (jsdom's layout always reports 0x0). */
function stubPreviewRect(width: number, height: number): void {
  preview().getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function drag(x0: number, y0: number, x1: number, y1: number): void {
  drawSurface().dispatchEvent(new MouseEvent("mousedown", { clientX: x0, clientY: y0, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: x1, clientY: y1, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mouseup", { clientX: x1, clientY: y1, bubbles: true }));
}

describe("imageEditor — openImageEditor", () => {
  it("opens empty for a new image, with Save disabled and Remove hidden", () => {
    openImageEditor({ baseUrl: "/", initial: null, onSave: vi.fn() });
    expect(field("image filename (under public/images/)").value).toBe("");
    expect(field("alt text").value).toBe("");
    expect(saveButton().disabled).toBe(true);
    expect(removeImageButton().hidden).toBe(true);
    cancelButton().click();
  });

  it("pre-fills every field from an existing image, and shows Remove image", () => {
    const onSave = vi.fn();
    openImageEditor({
      baseUrl: "/",
      initial: { src: "desk.svg", alt: "A desk.", hotspots: [{ label: "Open drawer", command: "open drawer", x: 10, y: 20, w: 30, h: 40 }] },
      onSave,
    });
    expect(field("image filename (under public/images/)").value).toBe("desk.svg");
    expect(field("alt text").value).toBe("A desk.");
    expect(removeImageButton().hidden).toBe(false);
    const rows = hotspotRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector("input")!.value).toBe("Open drawer");

    removeImageButton().click();
    expect(onSave).toHaveBeenCalledWith(null);
    expect(dialog().hasAttribute("open")).toBe(false);
  });

  it("enables the draw surface only once the preview image loads, and disables it again on error", () => {
    openImageEditor({ baseUrl: "/", initial: null, onSave: vi.fn() });
    expect(drawSurface().classList.contains("is-disabled")).toBe(true);

    field("image filename (under public/images/)").value = "desk.svg";
    field("image filename (under public/images/)").dispatchEvent(new Event("input"));
    fireImageLoad();
    expect(drawSurface().classList.contains("is-disabled")).toBe(false);

    previewImg().dispatchEvent(new Event("error"));
    expect(drawSurface().classList.contains("is-disabled")).toBe(true);
    cancelButton().click();
  });

  it("drags a new hotspot out at the correct clamped percent, ignores a sub-1% drag, and Save reports it", () => {
    const onSave = vi.fn();
    openImageEditor({ baseUrl: "/", initial: null, onSave });
    field("image filename (under public/images/)").value = "desk.svg";
    field("image filename (under public/images/)").dispatchEvent(new Event("input"));
    fireImageLoad();
    stubPreviewRect(200, 100);

    drag(1, 1, 2, 2); // under 1% in a 200x100 box — accidental click, not a zone
    expect(hotspotRows()).toHaveLength(0);

    drag(20, 10, 100, 60); // 10%,10% to 50%,60% of a 200x100 box
    const rows = hotspotRows();
    expect(rows).toHaveLength(1);
    const numberInputs = rows[0]!.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(Array.from(numberInputs).map((i) => Number(i.value))).toEqual([10, 10, 40, 50]);

    const [labelInput, commandInput] = Array.from(rows[0]!.querySelectorAll<HTMLInputElement>("input[type=text]"));
    labelInput!.value = "Open drawer";
    labelInput!.dispatchEvent(new Event("input"));
    commandInput!.value = "open drawer";
    commandInput!.dispatchEvent(new Event("input"));
    field("alt text").value = "A desk.";
    field("alt text").dispatchEvent(new Event("input"));

    expect(saveButton().disabled).toBe(false);
    saveButton().click();
    expect(onSave).toHaveBeenCalledWith({
      src: "desk.svg",
      alt: "A desk.",
      hotspots: [{ label: "Open drawer", command: "open drawer", x: 10, y: 10, w: 40, h: 50 }],
    });
  });

  it("keeps Save disabled while any hotspot is missing a label or command, and Remove-hotspot clears it", () => {
    openImageEditor({
      baseUrl: "/",
      initial: { src: "desk.svg", alt: "A desk.", hotspots: [{ label: "", command: "", x: 10, y: 10, w: 10, h: 10 }] },
      onSave: vi.fn(),
    });
    expect(saveButton().disabled).toBe(true);

    const removeHotspotButton = Array.from(hotspotRows()[0]!.querySelectorAll("button")).find((b) => b.textContent === "Remove")!;
    removeHotspotButton.click();
    expect(hotspotRows()).toHaveLength(0);
    expect(saveButton().disabled).toBe(false); // src+alt already filled, no hotspots left to require
    cancelButton().click();
  });

  it("Cancel discards edits without calling onSave", () => {
    const onSave = vi.fn();
    openImageEditor({ baseUrl: "/", initial: null, onSave });
    field("image filename (under public/images/)").value = "desk.svg";
    field("image filename (under public/images/)").dispatchEvent(new Event("input"));
    cancelButton().click();
    expect(onSave).not.toHaveBeenCalled();
    expect(dialog().hasAttribute("open")).toBe(false);
  });

  it("reuses the same dialog across repeated opens, cleanly handing drag interaction to the new session", () => {
    const firstOnSave = vi.fn();
    openImageEditor({ baseUrl: "/", initial: null, onSave: firstOnSave });
    cancelButton().click();

    const secondOnSave = vi.fn();
    openImageEditor({ baseUrl: "/", initial: null, onSave: secondOnSave });
    field("image filename (under public/images/)").value = "desk.svg";
    field("image filename (under public/images/)").dispatchEvent(new Event("input"));
    fireImageLoad();
    stubPreviewRect(200, 100);
    drag(20, 10, 100, 60);

    // Only the SECOND session's drag handler should have run — the first
    // session's onSave must never fire from a stale, un-removed listener.
    expect(hotspotRows()).toHaveLength(1);
    expect(firstOnSave).not.toHaveBeenCalled();
  });
});

import type { SaveData } from "../../engine/save/save";

/**
 * The one piece of the save/load feature that knows a save lives in the
 * browser's `localStorage` — see `engine/save/save.ts` for the actual
 * `SaveData` shape and docs/systems/save.md for the overall design.
 * Single slot, manual save/load (no autosave) for now.
 */
const SAVE_KEY = "textdetective:save";

export function saveToStorage(data: SaveData): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

/** Returns `null` if nothing has been saved yet — `JSON.parse`'s result is trusted as `SaveData` here; `buildStateFromSave` is what actually validates `schemaVersion` before this is used to build a `GameState`. */
export function loadFromStorage(): SaveData | null {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw === null) return null;
  return JSON.parse(raw) as SaveData;
}

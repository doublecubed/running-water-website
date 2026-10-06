import { beforeEach, describe, expect, it } from "vitest";
import { createInitialState } from "../../content/world";
import { serializeState } from "../../engine/save/save";
import { loadFromStorage, saveToStorage } from "./browserSaveStore";

describe("browserSaveStore", () => {
  beforeEach(() => localStorage.clear());

  it("returns null when nothing has been saved yet", () => {
    expect(loadFromStorage()).toBeNull();
  });

  it("round-trips a SaveData through localStorage", () => {
    const data = serializeState(createInitialState());
    saveToStorage(data);
    expect(loadFromStorage()).toEqual(data);
  });

  it("overwrites the single save slot on a second save", () => {
    const first = serializeState(createInitialState());
    saveToStorage(first);
    const state = createInitialState();
    state.player.money = 999;
    const second = serializeState(state);
    saveToStorage(second);
    expect(loadFromStorage()).toEqual(second);
  });
});

import { describe, expect, it } from "vitest";
import { createInitialState } from "../../content/world";
import { GameEngine } from "../GameEngine";
import { SAVE_SCHEMA_VERSION, buildStateFromSave, serializeState } from "../save/save";
import type { Condition, GameState, Npc, NpcLabel } from "../types";
import { compare, evaluateCondition } from "./conditions";
import { MAX_MEMORIES_PER_NPC, addMemory, memoryMatches, parseMemoryShorthand, witnessObservation } from "./memory";
import { getOpinionOfNpc, getOpinionOfPlayer } from "./opinion";
import { syncNpcLocations } from "./schedule";
import { adjustOpinion, adjustReputation, adjustTrust, getNpcState, setKnowledge } from "./state";

function label(id: string, extra: Partial<NpcLabel> = {}): NpcLabel {
  return { id, nameKey: `label.${id}.name`, trustOffset: 0, labelOpinions: {}, ...extra };
}

/** A real initial state with two NPCs at the player's location and two labels. */
function fixture(): { state: GameState; a: Npc; b: Npc; here: string } {
  const state = createInitialState();
  const here = state.player.locationId;
  // Synthetic NPCs, so the tests don't depend on how many the real content authors.
  const make = (id: string): Npc => ({ id, nameKey: `npc.${id}.name`, descriptionKey: `npc.${id}.description`, aliases: [id], dialogueRules: [], dialogueKey: `npc.${id}.dialogue`, labels: [] });
  const a = make("test-a");
  const b = make("test-b");
  state.npcs = { ...state.npcs, [a.id]: a, [b.id]: b };
  state.labels = { worker: label("worker", { trustOffset: 1, labelOpinions: { official: -2 } }), official: label("official", { trustOffset: -1 }) };
  a.labels = ["worker"];
  b.labels = ["official"];
  state.placement.npcLocationId[a.id] = here;
  state.placement.npcLocationId[b.id] = here;
  return { state, a, b, here };
}

describe("memory shorthand", () => {
  it("parses subject verb object @location", () => {
    expect(parseMemoryShorthand("npc:barkeep saw player @docks")).toEqual({
      verb: "saw",
      subject: { kind: "npc", id: "barkeep" },
      object: { kind: "player" },
      locationId: "docks",
    });
  });
  it("parses an object-less form", () => {
    expect(parseMemoryShorthand("player left @docks")).toEqual({ verb: "left", subject: { kind: "player" }, locationId: "docks" });
  });
  it.each(["player", "player frobnicated", "thing:x saw player", "player took object:", "player took object:x @"])("rejects %s", (text) => {
    expect(parseMemoryShorthand(text)).toHaveProperty("error");
  });
});

describe("memory matching and cap", () => {
  it("treats absent pattern fields as wildcards and honors withinMinutes", () => {
    const m = { verb: "took" as const, subject: { kind: "player" as const }, object: { kind: "object" as const, id: "ledger" }, atMinutes: 100, source: "witnessed" as const, valence: 0 };
    expect(memoryMatches(m, {}, 200)).toBe(true);
    expect(memoryMatches(m, { verb: "took", object: { kind: "object", id: "ledger" } }, 200)).toBe(true);
    expect(memoryMatches(m, { object: { kind: "object", id: "other" } }, 200)).toBe(false);
    expect(memoryMatches(m, { withinMinutes: 50 }, 200)).toBe(false);
    expect(memoryMatches(m, { withinMinutes: 100 }, 200)).toBe(true);
  });
  it("drops the oldest memory beyond the cap", () => {
    const { state, a } = fixture();
    for (let i = 0; i < MAX_MEMORIES_PER_NPC + 5; i++) {
      addMemory(state, a.id, { verb: "saw", subject: { kind: "player" }, atMinutes: i, source: "witnessed", valence: 0 });
    }
    const memories = getNpcState(state, a.id).memories;
    expect(memories).toHaveLength(MAX_MEMORIES_PER_NPC);
    expect(memories[0]?.atMinutes).toBe(5);
  });
});

describe("witness step", () => {
  it("gives a memory to every NPC at the location, and none elsewhere", () => {
    const { state, a, b, here } = fixture();
    const elsewhere = Object.keys(state.locations).find((id) => id !== here)!;
    const c = Object.values(state.npcs).find((n) => n.id !== a.id && n.id !== b.id);
    if (c) state.placement.npcLocationId[c.id] = elsewhere;
    witnessObservation(state, { verb: "entered", subject: { kind: "player" }, locationId: here });
    expect(getNpcState(state, a.id).memories).toHaveLength(1);
    expect(getNpcState(state, b.id).memories).toHaveLength(1);
    if (c) expect(state.npcStates[c.id]?.memories ?? []).toHaveLength(0);
  });
  it("hides a concealed player from bystanders but not from a participant", () => {
    const { state, a, b, here } = fixture();
    state.player.stealthMode = true;
    state.player.concealment = "succeeded";
    witnessObservation(state, { verb: "spoke-to", subject: { kind: "player" }, object: { kind: "npc", id: a.id }, locationId: here }, { participants: [a.id] });
    expect(getNpcState(state, a.id).memories).toHaveLength(1);
    expect(state.npcStates[b.id]?.memories ?? []).toHaveLength(0);
  });
  it("does not hide the player when the concealment roll failed", () => {
    const { state, b, here } = fixture();
    state.player.stealthMode = true;
    state.player.concealment = "failed";
    witnessObservation(state, { verb: "entered", subject: { kind: "player" }, locationId: here });
    expect(getNpcState(state, b.id).memories).toHaveLength(1);
  });
});

describe("engine emits observations", () => {
  it("talkTo records a spoke-to memory", () => {
    const { state: fx, a } = fixture();
    const npcId = a.id;
    const engine = new GameEngine(fx);
    const result = engine.talkTo("test-a");
    expect(result.ok).toBe(true);
    expect(fx.npcStates[npcId]?.memories.some((m) => m.verb === "spoke-to")).toBe(true);
  });
});

describe("conditions", () => {
  it("compare covers every operator", () => {
    expect([compare(1, "<", 2), compare(2, "<=", 2), compare(3, ">", 2), compare(2, ">=", 3), compare(2, "==", 2), compare(2, "!=", 2)]).toEqual([true, true, true, false, true, false]);
  });
  it("evaluates flag/not/all/any/npcStat/knows/memory/hasLabel/reputation", () => {
    const { state, a } = fixture();
    state.flags.seen = true;
    adjustTrust(state, a.id, 3);
    setKnowledge(state, a.id, "alibi", "knows");
    adjustReputation(state, "worker", 2);
    addMemory(state, a.id, { verb: "took", subject: { kind: "player" }, atMinutes: 0, source: "witnessed", valence: 0 });
    const ev = (c: Condition) => evaluateCondition(state, a.id, c);
    expect(ev({ flag: "seen" })).toBe(true);
    expect(ev({ not: { flag: "seen" } })).toBe(false);
    expect(ev({ all: [{ flag: "seen" }, { hasLabel: "worker" }] })).toBe(true);
    expect(ev({ any: [{ flag: "nope" }, { hasLabel: "official" }] })).toBe(false);
    expect(ev({ npcStat: "trust", op: ">=", value: 3 })).toBe(true);
    expect(ev({ knows: "alibi" })).toBe(true);
    expect(ev({ knows: "other" })).toBe(false);
    expect(ev({ memory: { verb: "took", subject: { kind: "player" } } })).toBe(true);
    expect(ev({ memory: { verb: "attacked" } })).toBe(false);
    expect(ev({ reputation: { scope: "worker", op: ">", value: 1 } })).toBe(true);
    expect(ev({ reputation: { scope: "global", op: "==", value: 0 } })).toBe(true);
  });
});

describe("opinions", () => {
  it("sums trust, global + label reputation, and label offsets", () => {
    const { state, a } = fixture();
    adjustTrust(state, a.id, 2);
    adjustReputation(state, "global", 1);
    adjustReputation(state, "worker", 3);
    expect(getOpinionOfPlayer(state, a.id)).toBe(2 + 1 + 3 + 1); // trust + global + byLabel + trustOffset
  });
  it("combines stored opinion with label-to-label offsets", () => {
    const { state, a, b } = fixture();
    adjustOpinion(state, a.id, `npc:${b.id}`, 1);
    expect(getOpinionOfNpc(state, a.id, b.id)).toBe(1 - 2);
    expect(getOpinionOfNpc(state, b.id, a.id)).toBe(0);
  });
});

describe("schedules", () => {
  function scheduled(npc: Npc, target: string) {
    npc.schedule = [{ fromHour: 20, toHour: 6, locationId: target }];
  }
  it("moves a scheduled NPC into a wrapping slot and leaves unscheduled NPCs put", () => {
    const { state, a, b, here } = fixture();
    const target = Object.keys(state.locations).find((id) => id !== here)!;
    scheduled(a, target);
    state.clock.minutesElapsed = 22 * 60; // 22:00 — inside the 20 -> 6 wrap
    const moved = syncNpcLocations(state);
    // Real content NPCs with schedules (e.g. officer-hale) may also move; only the fixture NPCs matter here.
    expect(moved).toContain(a.id);
    expect(moved).not.toContain(b.id);
    expect(state.placement.npcLocationId[a.id]).toBe(target);
    expect(state.placement.npcLocationId[b.id]).toBe(here);
  });
  it("leaves the NPC where they are when no slot matches", () => {
    const { state, a, here } = fixture();
    const target = Object.keys(state.locations).find((id) => id !== here)!;
    scheduled(a, target);
    state.clock.minutesElapsed = 12 * 60;
    expect(syncNpcLocations(state)).toEqual([]);
    expect(state.placement.npcLocationId[a.id]).toBe(here);
  });
  it("honors weekday restriction", () => {
    const { state, a, here } = fixture();
    const target = Object.keys(state.locations).find((id) => id !== here)!;
    state.clock.minutesElapsed = 12 * 60;
    // Epoch 1946-09-18 is a Wednesday (3); day 0 midday.
    a.schedule = [{ fromHour: 0, toHour: 24, locationId: target, weekdays: [0] }];
    expect(syncNpcLocations(state)).toEqual([]);
    a.schedule = [{ fromHour: 0, toHour: 24, locationId: target, weekdays: [3] }];
    expect(syncNpcLocations(state)).toEqual([a.id]);
  });
});

describe("save round-trip", () => {
  it("persists npcStates and reputation and is at the current schema", () => {
    const state = createInitialState();
    const npcId = Object.keys(state.npcs)[0] ?? "someone";
    adjustTrust(state, npcId, 4);
    adjustReputation(state, "global", 2);
    const save = serializeState(state);
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    const rebuilt = buildStateFromSave(createInitialState(), JSON.parse(JSON.stringify(save)));
    expect(rebuilt.npcStates[npcId]?.trust).toBe(4);
    expect(rebuilt.reputation.global).toBe(2);
  });
  it("migrates a schema-10 save with empty NPC state", () => {
    const state = createInitialState();
    const v10 = { ...serializeState(state), schemaVersion: 10 } as Record<string, unknown>;
    delete v10.npcStates;
    delete v10.reputation;
    const rebuilt = buildStateFromSave(createInitialState(), v10 as never);
    expect(rebuilt.npcStates).toEqual({});
    expect(rebuilt.reputation).toEqual({ global: 0, byLabel: {} });
  });
});

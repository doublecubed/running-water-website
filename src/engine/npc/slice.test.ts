import { describe, expect, it } from "vitest";
import { createInitialState } from "../../content/world";
import { GameEngine } from "../GameEngine";
import { getOpinionOfPlayer } from "./opinion";
import { getNpcState } from "./state";

/**
 * Headless playthrough of the "Ledger" mini-case authored in
 * content/city/world.yaml. It exists to prove the NPC systems (witness
 * memories, stealth, trust/opinion, reputation, schedules, dialogue
 * effects) change what NPCs say when driven by real content, not fixtures.
 */
function newGame() {
  const state = createInitialState();
  return { state, engine: new GameEngine(state) };
}

function go(engine: GameEngine, place: string): void {
  const result = engine.travelTo(place);
  expect(result.ok, `travel to ${place}`).toBe(true);
}

/** Text key of the line the NPC said, from the `npc_talked` event. */
function say(engine: GameEngine, npc: string): string {
  const result = engine.talkTo(npc);
  expect(result.ok, `talk to ${npc}`).toBe(true);
  return result.events.find((e) => e.type === "npc_talked")!.textKey;
}

describe("Ledger mini-case", () => {
  it("informant turns hostile once he has seen the player take the ledger", () => {
    const { state, engine } = newGame();
    go(engine, "alley");
    expect(engine.takeItem("ledger").ok).toBe(true);
    expect(getNpcState(state, "informant").memories.some((m) => m.verb === "took" && m.object?.id === "ledger")).toBe(true);

    expect(say(engine, "informant")).toBe("npc.informant.dialogue.0");
    expect(getNpcState(state, "informant").suspicion).toBe(2);
    expect(getNpcState(state, "informant").trust).toBe(-1);

    // The hostile rule doesn't re-fire (no farming); he goes cold instead.
    expect(say(engine, "informant")).toBe("npc.informant.dialogue.1");
    expect(getNpcState(state, "informant").suspicion).toBe(2);
  });

  it("informant stays neutral when the player took the ledger while concealed", () => {
    const { state, engine } = newGame();
    go(engine, "alley");
    state.player.stealthMode = true;
    state.player.concealment = "succeeded";
    engine.takeItem("ledger");
    expect(getNpcState(state, "informant").memories.some((m) => m.verb === "took")).toBe(false);
    expect(say(engine, "informant")).toBe("npc.informant.dialogue");
  });

  it("Hale follows his schedule from precinct to diner", () => {
    const { state, engine } = newGame();
    expect(state.placement.npcLocationId["officer-hale"]).toBe("precinct");
    state.clock.minutesElapsed = 19 * 60;
    go(engine, "alley");
    expect(state.placement.npcLocationId["officer-hale"]).toBe("diner");
  });

  it("Rosa's plain greeting still works, and Hale still vouches (once) — unrelated to the ledger topic", () => {
    const { state, engine } = newGame();

    // Plain talk still greets and then falls back — the reveal now lives behind a topic, not a dialogueRule.
    go(engine, "diner");
    expect(say(engine, "rosa")).toBe("npc.cook-rosa.dialogue.0");
    expect(say(engine, "rosa")).toBe("npc.cook-rosa.dialogue");
    expect(state.flags["learned.courier"]).toBeUndefined();

    // Hale vouches (once — the first-talk rule does not farm reputation).
    go(engine, "precinct");
    expect(say(engine, "hale")).toBe("npc.officer-hale.dialogue.2");
    expect(say(engine, "hale")).toBe("npc.officer-hale.dialogue");
    expect(state.reputation.byLabel.worker).toBe(1);
  });

  it("Rosa's topics: 'herself' is always available; 'ledger' only reveals once vouched for, and telling Hale then closes the case", () => {
    const { state, engine } = newGame();
    go(engine, "diner");
    say(engine, "rosa"); // first-talk trust bump — same as before, still via plain talk/dialogueRules.

    const listedBefore = engine.listTopics("rosa");
    expect(listedBefore.ok).toBe(true);
    if (!listedBefore.ok) throw new Error("unreachable");
    expect(listedBefore.topics.map((topic) => topic.id)).toEqual(["ledger", "herself"]);

    // Not vouched for yet — the ledger topic falls back to its plain textKey, no effects.
    const notYet = engine.askAbout(listedBefore.npcId, "ledger");
    expect(notYet.events.find((e) => e.type === "npc_talked")?.textKey).toBe("npc.cook-rosa.topic.ledger.dialogue");
    expect(engine.getPlayerFacts()).toEqual([]);

    // "herself" needs no gating at all.
    const herself = engine.askAbout(listedBefore.npcId, "herself");
    expect(herself.events.find((e) => e.type === "npc_talked")?.textKey).toBe("npc.cook-rosa.topic.herself.dialogue");

    // Hale vouches, raising Rosa's opinion of the player over the threshold.
    go(engine, "precinct");
    say(engine, "hale");
    expect(state.reputation.byLabel.worker).toBe(1);

    go(engine, "diner");
    expect(getOpinionOfPlayer(state, "cook-rosa")).toBeGreaterThanOrEqual(2);
    const reveal = engine.askAbout("cook-rosa", "ledger");
    expect(reveal.events.find((e) => e.type === "npc_talked")?.textKey).toBe("npc.cook-rosa.topic.ledger.response.0");
    const facts = engine.getPlayerFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ id: "courier", textKey: "fact.courier" });

    // Telling Hale closes the case.
    go(engine, "precinct");
    expect(say(engine, "hale")).toBe("npc.officer-hale.dialogue.0");
    expect(state.flags["case.ledger.solved"]).toBe(true);
    expect(say(engine, "hale")).toBe("npc.officer-hale.dialogue.1");
  });
});

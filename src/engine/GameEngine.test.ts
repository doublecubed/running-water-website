import { describe, expect, it } from "vitest";
import { createInitialState } from "../content/world";
import { GameEngine } from "./GameEngine";
import type { TravelChoice } from "./types";

/**
 * Exercises the engine with zero DOM/view involved — a direct demonstration
 * of the "engine is headless and synchronous" boundary from CLAUDE.md: the
 * simulation is fully testable by calling actions and asserting state/events.
 */
describe("GameEngine", () => {
  it("describes the starting location on look", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.look();
    expect(result.ok).toBe(true);
    expect(result.events[0]?.textKey).toBe("location.office.description");
  });

  it("shows the full description plus a visibility line, an objects-present line, and an items-present line on look, in that order", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.look(); // office starts with the desk (object) and the case file (item)
    expect(result.events.map((e) => e.type)).toEqual([
      "location_described",
      "location_visibility",
      "setpieces_present",
      "items_present",
    ]);
    expect(result.events[1]?.params?.tierKey).toBe("visibility.tier.normal");
    expect(result.events[2]?.params?.objects).toBe("setpiece.desk.name, setpiece.cabinet-glass.name");
    expect(result.events[3]?.params?.items).toBe("item.case-file.name");
  });

  it("shows the full description only on the first-ever arrival, omitting it on a revisit", () => {
    const engine = new GameEngine(createInitialState());

    const first = engine.travelTo("out"); // office -> alley: never visited before
    expect(first.events.some((e) => e.type === "location_described")).toBe(true);
    expect(first.events.some((e) => e.type === "npcs_present")).toBe(true); // the informant is at alley

    engine.travelTo("office"); // back to office, already visited
    const revisit = engine.travelTo("out"); // alley again, already visited
    expect(revisit.events.some((e) => e.type === "location_described")).toBe(false);
    expect(revisit.events.some((e) => e.type === "npcs_present")).toBe(true); // still reported every arrival
  });

  it("omits the items-present line entirely (no 'nothing here' filler) when a location has none", () => {
    const engine = new GameEngine(createInitialState());
    engine.travelTo("out"); // alley has the informant and the streetlamp object; its only item is the ledger
    engine.takeItem("ledger");
    const result = engine.look();
    expect(result.events.some((e) => e.type === "items_present")).toBe(false);
    expect(result.events.some((e) => e.type === "npcs_present")).toBe(true);
  });

  it("shows all objects on first arrival, including one with announceOnRevisit unset", () => {
    const engine = new GameEngine(createInitialState());
    const first = engine.travelTo("out"); // office -> alley, first visit: streetlamp (announceOnRevisit: true)
    expect(first.events.find((e) => e.type === "setpieces_present")?.params?.objects).toBe("setpiece.streetlamp.name");
  });

  it("suppresses a non-announceOnRevisit object on a plain revisit, but keeps showing an announceOnRevisit one", () => {
    const engine = new GameEngine(createInitialState());
    engine.travelTo("out"); // office -> alley, first visit
    const officeRevisit = engine.travelTo("office"); // office revisit: desk has no announceOnRevisit, so no setpieces_present
    expect(officeRevisit.events.some((e) => e.type === "setpieces_present")).toBe(false);

    const alleyRevisit = engine.travelTo("out"); // alley revisit: streetlamp has announceOnRevisit, so it still shows
    expect(alleyRevisit.events.find((e) => e.type === "setpieces_present")?.params?.objects).toBe("setpiece.streetlamp.name");
  });

  it("re-shows the full description on an explicit look even after the location was already visited", () => {
    const engine = new GameEngine(createInitialState());
    engine.travelTo("out");
    engine.travelTo("office");
    engine.travelTo("out"); // revisiting alley — arrival itself omits the description
    const result = engine.look();
    expect(result.events[0]?.type).toBe("location_described");
  });

  it("moves the player through a compass connection and blocks invalid ones", () => {
    const engine = new GameEngine(createInitialState());

    const blocked = engine.travelTo("north");
    expect(blocked.ok).toBe(false);
    expect(blocked.events[0]?.type).toBe("move_blocked");

    const moved = engine.travelTo("out");
    expect(moved.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("alley");
  });

  it("records every location actually arrived at, via both the compass path and pathfound routes, without duplicates", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getVisitedLocationIds()).toEqual(["office"]); // seeded by content/world.ts's createInitialState

    engine.travelTo("out"); // compass hop: office -> alley
    expect(engine.getVisitedLocationIds()).toEqual(["office", "alley"]);

    engine.travelTo("the docks"); // pathfound, multi-hop route
    expect(engine.getVisitedLocationIds()).toContain("docks");

    const before = engine.getVisitedLocationIds().length;
    engine.travelTo("office"); // back to an already-visited location — no duplicate entry
    expect(engine.getVisitedLocationIds().length).toBe(before);
  });

  it("advances the clock by a compass hop's travel time", () => {
    const engine = new GameEngine(createInitialState());
    const before = engine.getState().clock.minutesElapsed;
    engine.travelTo("out"); // office -> alley: an interior/exterior boundary hop, always 1 flat minute
    const after = engine.getState().clock.minutesElapsed;
    expect(after).toBeGreaterThan(before);
  });

  it("pathfinds a multi-hop route to a named, non-adjacent location", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.travelTo("the docks");
    expect(result.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("docks");
    // A "money_spent" event may precede it now that taxi exists on part of
    // the fastest route — see docs/systems/economy.md — so check presence,
    // not position.
    expect(result.events.some((e) => e.type === "player_traveled")).toBe(true);
  });

  it("picks the fast taxi route over the slow direct foot path to the docks, under the taxi preference", () => {
    const engine = new GameEngine(createInitialState());
    engine.setTravelPreference("taxi");
    const before = engine.getState().clock.minutesElapsed;
    engine.travelTo("docks");
    const minutesSpent = engine.getState().clock.minutesElapsed - before;
    // Direct street->docks on foot alone is 72 minutes; the routed path
    // (alley -> street -> highway -> docks, taxi on the highway leg, the
    // only mode there now that there's no car) should be dramatically
    // faster. The DEFAULT "foot" preference would instead pick the free
    // direct path here — see "prefers the free direct foot path" below,
    // since "foot" optimizes for cost, not speed.
    expect(minutesSpent).toBeLessThan(30);
  });

  it("prefers the free direct foot path over a faster route with a forced paid leg, under the default foot preference", () => {
    const engine = new GameEngine(createInitialState());
    const moneyBefore = engine.getMoney();
    const before = engine.getState().clock.minutesElapsed;

    // "foot" optimizes for COST (see CATEGORY_OPTIMIZES_FOR) — the
    // direct street->docks foot path (free, ~72 min) beats the
    // highway route (faster, but forces a paid taxi leg with no foot
    // alternative — see world.ts), since foot itself is always free and
    // the point of choosing it is spending nothing, not saving time.
    const result = engine.travelTo("docks");
    expect(result.ok).toBe(true);
    expect(engine.getMoney()).toBe(moneyBefore);
    expect(engine.getState().clock.minutesElapsed - before).toBeGreaterThan(60);
  });

  it("reports already-there instead of pathfinding to the current location", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.travelTo("office");
    expect(result.ok).toBe(true);
    expect(result.events[0]?.type).toBe("already_there");
  });

  it("fails to resolve an unknown place name", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.travelTo("mars");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("location_not_found");
  });

  it("picks up a portable item into inventory", () => {
    const engine = new GameEngine(createInitialState());

    const taken = engine.takeItem("case file");
    expect(taken.ok).toBe(true);
    expect(engine.getState().player.inventory).toContain("case-file");
    expect(engine.getState().placement.worldObjectLocationId["case-file"]).toBeUndefined();
  });

  it("fails to take an item that isn't in the location", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.takeItem("nonexistent");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("item_not_found");
  });

  it("lets the player talk to an NPC in the current location", () => {
    const engine = new GameEngine(createInitialState());
    engine.travelTo("out");
    const result = engine.talkTo("informant");
    expect(result.ok).toBe(true);
    expect(result.events[0]?.textKey).toBe("npc.informant.dialogue");
  });

  it("talkTo picks a dialogueRules entry whose requires are all satisfied by state.flags, ahead of the fallback dialogueKey", () => {
    const state = createInitialState();
    state.npcs.informant!.dialogueRules = [{ requires: ["someFlag"], textKey: "npc.informant.dialogue.0" }];
    state.flags.someFlag = true;
    const engine = new GameEngine(state);
    engine.travelTo("out");

    const result = engine.talkTo("informant");
    expect(result.events[0]?.textKey).toBe("npc.informant.dialogue.0");
  });

  it("talkTo falls through to the next rule, then dialogueKey, when a rule's requires aren't fully satisfied", () => {
    const state = createInitialState();
    state.npcs.informant!.dialogueRules = [
      { requires: ["missingFlag"], textKey: "npc.informant.dialogue.0" },
      { requires: ["partialA", "partialB"], textKey: "npc.informant.dialogue.1" },
    ];
    state.flags.partialA = true; // partialB stays unset, so this rule doesn't fully match either
    const engine = new GameEngine(state);
    engine.travelTo("out");

    const result = engine.talkTo("informant");
    expect(result.events[0]?.textKey).toBe("npc.informant.dialogue");
  });

  it("talkTo sets flags['talkedTo.<npcId>'] after a successful call, invisible to that same call's own rule matching", () => {
    const state = createInitialState();
    state.npcs.informant!.dialogueRules = [{ requires: ["talkedTo.informant"], textKey: "npc.informant.dialogue.0" }];
    const engine = new GameEngine(state);
    engine.travelTo("out");

    const first = engine.talkTo("informant");
    expect(first.events[0]?.textKey).toBe("npc.informant.dialogue"); // not yet talked to before this call
    expect(engine.getState().flags["talkedTo.informant"]).toBe(true);

    const second = engine.talkTo("informant");
    expect(second.events[0]?.textKey).toBe("npc.informant.dialogue.0"); // now it counts as a prior conversation
  });

  it("reports the current simulated time as absolute calendar params — no relative 'Day N' format exists anymore", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.checkTime();
    expect(result.ok).toBe(true);
    expect(result.events[0]?.params).toEqual({
      day: "18",
      monthKey: "calendar.month.9.long",
      year: "1946",
      weekdayKey: expect.stringMatching(/^calendar\.weekday\.\d\.long$/),
      hour: "08",
      minute: "00",
    });
  });

  it("exposes the absolute calendar date derived from the clock's epoch", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getCalendarDate()).toMatchObject({ year: 1946, month: 9, day: 18, hour: 8, minute: 0 });
  });

  it("getVisibility defaults to the player's current location, at full daylight (08:00, an unauthored 'normal' tier)", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getVisibility()).toEqual({ tier: "normal", value: 65 });
  });

  it("getVisibility accepts an explicit locationId", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getVisibility("office")).toEqual(engine.getVisibility());
  });

  it("getVisibility throws for an unknown locationId", () => {
    const engine = new GameEngine(createInitialState());
    expect(() => engine.getVisibility("nonexistent")).toThrow(/no location "nonexistent"/);
  });

  it("getPlayerStat returns the registry default on a fresh player with no stored value", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getPlayerStat("stealth")).toBe(30);
  });

  it("getPlayerStat returns a stored value when the player has one set", () => {
    const state = createInitialState();
    state.player.stats = { stealth: 77 };
    const engine = new GameEngine(state);
    expect(engine.getPlayerStat("stealth")).toBe(77);
  });

  it("getNpcStat returns a content-authored NPC's stat value", () => {
    const state = createInitialState();
    state.npcs.informant!.stats = { intimidation: 85 };
    const engine = new GameEngine(state);
    expect(engine.getNpcStat("informant", "intimidation")).toBe(85);
  });

  it("getNpcStat returns the registry default for an NPC with no stats authored", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getNpcStat("informant", "handguns")).toBe(10);
  });

  it("getNpcStat throws for an unknown NPC id", () => {
    const engine = new GameEngine(createInitialState());
    expect(() => engine.getNpcStat("nonexistent", "stealth")).toThrow(/no NPC "nonexistent"/);
  });

  it("getStealthConcealment resolves stealth vs. the current location's visibility, using the injected rng", () => {
    const neutralRng = () => 0; // both d10s roll 1 -> sum 2 -> modifier -20, deterministic
    const state = createInitialState();
    state.player.stats = { stealth: 60 };
    const engine = new GameEngine(state, neutralRng);
    const { value: visibility } = engine.getVisibility();
    const result = engine.getStealthConcealment();
    expect(result.rolls).toEqual([-20]);
    expect(result.margin).toBe(60 - 20 - visibility);
  });

  it("getStealthConcealment defaults to real Math.random when no rng is injected", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.getStealthConcealment();
    expect(result.rolls).toHaveLength(1);
    expect(typeof result.margin).toBe("number");
  });

  it("toggleStealth() on sets stealthMode, rolls immediately for the current location, and emits both events in order", () => {
    const neutralRng = () => 0; // both d10s roll 1 -> sum 2 -> modifier -20, deterministic
    const state = createInitialState();
    state.player.stats = { stealth: 60 };
    const engine = new GameEngine(state, neutralRng);

    const result = engine.toggleStealth();

    expect(engine.getState().player.stealthMode).toBe(true);
    expect(engine.getState().player.concealment).toBeDefined();
    expect(result.events.map((e) => e.type)).toEqual(["stealth_mode_on", "concealment_updated"]);
  });

  it("toggleStealth() off clears stealthMode and concealment, and does not roll", () => {
    const engine = new GameEngine(createInitialState(), () => 0);
    engine.toggleStealth(); // on
    const result = engine.toggleStealth(); // off

    expect(engine.getState().player.stealthMode).toBe(false);
    expect(engine.getState().player.concealment).toBeUndefined();
    expect(result.events.map((e) => e.type)).toEqual(["stealth_mode_off"]);
  });

  it("a failed concealment roll on toggle-on does not turn stealthMode back off", () => {
    const state = createInitialState();
    state.player.stats = { stealth: 0 }; // minimum skill, guarantees a failing margin
    const engine = new GameEngine(state, () => 0); // worst-case modifier too
    engine.toggleStealth();

    expect(engine.getState().player.stealthMode).toBe(true);
    const concealment = engine.getState().player.concealment;
    expect(concealment).toMatch(/^failed/);
  });

  it("travelTo re-rolls concealment on arrival while stealthMode is true", () => {
    const state = createInitialState();
    state.player.stats = { stealth: 60 };
    const engine = new GameEngine(state, () => 0);
    engine.toggleStealth();

    const result = engine.travelTo("out"); // office -> alley

    expect(result.events.some((e) => e.type === "concealment_updated")).toBe(true);
    // Confirms the stored outcome was refreshed against the NEW (alley)
    // location's visibility, not left stale from the office roll.
    const { value: alleyVisibility } = engine.getVisibility();
    expect(engine.getStealthConcealment().margin).toBe(60 - 20 - alleyVisibility);
    expect(engine.getState().player.concealment).toBeDefined();
  });

  it("travelTo does not roll or touch concealment while stealthMode is false", () => {
    const engine = new GameEngine(createInitialState(), () => 0);
    const result = engine.travelTo("out"); // office -> alley

    expect(result.events.some((e) => e.type === "concealment_updated")).toBe(false);
    expect(engine.getState().player.concealment).toBeUndefined();
  });

  it("starts with the content-defined balance and reflects it via getMoney", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getMoney()).toBe(15000);
  });

  it("credits money and reports it in the event", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.addMoney(150);
    expect(result.ok).toBe(true);
    expect(engine.getMoney()).toBe(15150);
    expect(result.events[0]?.params).toEqual({ amountSign: "", amountMajor: "1", amountMinor: "50" });
  });

  it("debits money when there's enough", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.spendMoney(200);
    expect(result.ok).toBe(true);
    expect(engine.getMoney()).toBe(14800);
  });

  it("refuses to debit past zero and leaves the balance untouched", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.spendMoney(20_000);
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("insufficient_funds");
    expect(engine.getMoney()).toBe(15000);
  });

  it("buys a pass, debits its price, and reports an expiry DATE (never a duration/countdown)", () => {
    const engine = new GameEngine(createInitialState());
    const moneyBefore = engine.getMoney();

    // Bought Day 1 (18 September 1946), 08:00 — a 7-day pass should
    // expire at the start of Day 8 (25 September), not 7*24*60 minutes
    // later — see minutesUntilDayAlignedExpiry.
    const result = engine.buyPass("weekly pass");
    expect(result.ok).toBe(true);
    expect(engine.getMoney()).toBe(moneyBefore - 1500);
    expect(result.events.some((e) => e.type === "money_spent")).toBe(true);
    const purchased = result.events.find((e) => e.type === "pass_purchased");
    expect(purchased?.params).toMatchObject({ day: "25", monthKey: "calendar.month.9.long", year: "1946" });

    expect(engine.getState().player.activePasses).toEqual([{ passId: "bus1-weekly", expiresAtMinutesElapsed: 7 * 24 * 60 }]);
  });

  it("fails to buy an unrecognized pass without touching the balance", () => {
    const engine = new GameEngine(createInitialState());
    const moneyBefore = engine.getMoney();
    const result = engine.buyPass("mystery pass");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("pass_not_found");
    expect(engine.getMoney()).toBe(moneyBefore);
    expect(engine.getState().player.activePasses).toEqual([]);
  });

  it("refuses to buy a pass it can't afford, leaving the balance and activePasses untouched", () => {
    const state = createInitialState();
    state.player.money = 100; // less than the $15.00 weekly pass
    const engine = new GameEngine(state);
    const result = engine.buyPass("weekly pass");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("insufficient_funds");
    expect(engine.getMoney()).toBe(100);
    expect(engine.getState().player.activePasses).toEqual([]);
  });

  it("rides free on a line a valid pass covers, and pays full fare once the pass has expired", () => {
    const state = createInitialState();
    for (const id of ["alley", "street", "highway"] as const) {
      state.locations[id]!.connections = state.locations[id]!.connections.filter((c) => c.modes.includes("bus"));
    }
    state.player.locationId = "alley";
    const engine = new GameEngine(state);

    engine.buyPass("weekly pass");
    const moneyAfterPurchase = engine.getMoney();
    const freeRide = engine.travelTo("the docks");
    expect(freeRide.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("docks");
    expect(engine.getMoney()).toBe(moneyAfterPurchase); // free — the pass covers bus-1

    // Jump the clock past the pass's expiry and try again.
    engine.getState().clock.minutesElapsed += 8 * 24 * 60;
    engine.getState().player.locationId = "alley";
    const moneyBeforeExpiredRide = engine.getMoney();
    const paidRide = engine.travelTo("the docks");
    expect(paidRide.ok).toBe(true);
    expect(engine.getMoney()).toBeLessThan(moneyBeforeExpiredRide);
  });

  it("reaches the ship-only pier via the docks connection", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.travelTo("the pier");
    expect(result.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("pier");
  });

  it("defaults to the foot travel preference and can change it", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getTravelPreference()).toBe("foot");

    const result = engine.setTravelPreference("taxi");
    expect(result.ok).toBe(true);
    expect(result.events[0]?.params).toEqual({ preferenceKey: "preference.taxi" });
    expect(engine.getTravelPreference()).toBe("taxi");
  });

  it("respects the taxi travel preference on a compass hop, picking the faster paid mode over free foot", () => {
    // Retargeted to alley->street (both exterior) rather than office->alley:
    // office->alley is now an interior/exterior boundary hop and always
    // flat-rate (see docs/systems/navigation.md), so it can't demonstrate
    // distance/mode-based timing anymore.
    const state = createInitialState();
    state.player.locationId = "alley";
    state.locations["alley"]!.connections = [
      { toId: "street", distanceKm: 4, modes: ["foot", "taxi"], compassLabel: "south" },
    ];
    state.player.travelPreference = "taxi";
    const engine = new GameEngine(state);

    const before = engine.getState().clock.minutesElapsed;
    const result = engine.travelTo("south");
    expect(result.ok).toBe(true);
    // taxi at car speed (40km/h) over 4km = 6 minutes, not foot's 48.
    expect(engine.getState().clock.minutesElapsed - before).toBe(6);
  });

  it("inquires about a compass direction without moving, reporting one option per mode on that connection", () => {
    const state = createInitialState();
    state.locations["office"]!.connections = [
      { toId: "alley", distanceKm: 4, modes: ["foot", "taxi"], compassLabel: "south" },
    ];
    const engine = new GameEngine(state);
    const before = engine.getState();

    const result = engine.inquireTravel("south");
    expect(result.ok).toBe(true);
    expect(result.events[0]?.type).toBe("inquiry_header");
    expect(result.choices?.map((c) => c.params?.modeKey)).toEqual(["mode.foot.name", "mode.taxi.name"]);
    expect(result.choices?.map((c) => ({ id: c.id, kind: c.kind }))).toEqual([
      { id: "foot", kind: "mode" },
      { id: "taxi", kind: "mode" },
    ]);
    // Read-only: neither location nor clock changed.
    expect(engine.getState().player.locationId).toBe(before.player.locationId);
    expect(engine.getState().clock.minutesElapsed).toBe(before.clock.minutesElapsed);
  });

  it("labels every category (fastest) and (cheapest) when they all tie on time and cost", () => {
    // A deliberately synthetic single-mode connection, rather than the
    // shared sample map — this test is about the LABELING logic itself,
    // which only needs one connection with no paid alternative (so every
    // category falls back to the same free foot leg) to exercise.
    const state = createInitialState();
    state.player.locationId = "alley";
    state.locations["alley"]!.connections = [{ toId: "street", distanceKm: 0.2, modes: ["foot"] }];
    const engine = new GameEngine(state);
    const beforeMinutes = engine.getState().clock.minutesElapsed;
    const beforeLocationId = engine.getState().player.locationId;

    const result = engine.inquireTravel("street");
    expect(result.ok).toBe(true);
    // All three categories are still listed, even though they all fall
    // back to the identical foot route — see docs/systems/economy.md on
    // why categories aren't merged/deduped like the old fastest/cheapest
    // strategies were.
    expect(result.choices).toHaveLength(3);
    for (const choice of (result.choices ?? []) as TravelChoice[]) {
      expect(choice.params?.fastestNote).toBe("ui.fastestOption");
      expect(choice.params?.cheapestNote).toBe("ui.cheapestOption");
      expect(choice.aliases).toEqual(expect.arrayContaining(["fastest", "cheapest"]));
    }
    expect(engine.getState().player.locationId).toBe(beforeLocationId);
    expect(engine.getState().clock.minutesElapsed).toBe(beforeMinutes);
  });

  it("reports one option per travel category for a named destination, each showing which mode it actually rode", () => {
    const state = createInitialState();
    state.locations["office"]!.connections = [
      { toId: "alley", distanceKm: 4, modes: ["foot", "taxi"], compassLabel: "south" },
    ];
    const engine = new GameEngine(state);

    const result = engine.inquireTravel("alley");
    expect(result.ok).toBe(true);
    expect(result.choices?.map((c) => ({ id: c.id, kind: c.kind }))).toEqual([
      { id: "foot", kind: "category" },
      { id: "transit", kind: "category" },
      { id: "taxi", kind: "category" },
    ]);
    // office->alley is a single interior/exterior boundary hop, so every
    // category ties on time/cost regardless of which mode it rode (see
    // interiorHops.ts) — each still reports which mode it actually used.
    // "transit" has no bus on this connection, so it falls back to foot.
    const byId = new Map(result.choices?.map((c) => [c.id, c.params]));
    expect(byId.get("foot")?.modesKey).toBe("mode.foot.name");
    expect(byId.get("transit")?.modesKey).toBe("mode.foot.name");
    expect(byId.get("taxi")?.modesKey).toBe("mode.taxi.name");
  });

  it("collapses consecutive same-mode hops into one entry in a multi-hop route's modesKey", () => {
    const engine = new GameEngine(createInitialState());

    // office -> alley -> street -> highway -> docks: two 1-minute interior
    // boundary hops (mode picked but not read for timing) bracketing an
    // ordinary multi-hop route — modesKey should read as a short,
    // deduplicated list, not one entry per hop.
    const result = engine.inquireTravel("the docks");
    expect(result.ok).toBe(true);
    const taxi = result.choices?.find((c) => c.id === "taxi");
    expect(taxi?.params?.modesKey).toBeDefined();
    expect(taxi?.params?.modesKey?.split(", ").length).toBeLessThan(4);
  });

  it("flags the foot option as not fully walkable only when EVERY route requires a forced non-foot hop, like the ship-only pier crossing", () => {
    // office -> the docks: a fully free, all-foot direct path exists
    // (street->docks, 6km) alongside the faster highway route — since
    // "foot" optimizes for COST (see CATEGORY_OPTIMIZES_FOR), it picks
    // the free direct path, which IS fully walkable, so no note.
    const engine = new GameEngine(createInitialState());
    const toDocks = engine.inquireTravel("the docks");
    expect(toDocks.events.some((e) => e.type === "foot_route_not_fully_walkable")).toBe(false);
    expect(toDocks.choices?.find((c) => c.id === "foot")?.params?.modesKey).toBe("mode.foot.name");

    // office -> the pier: docks<->pier is ship-only with no foot
    // alternative at all (see world.ts) — a real playtest question ("why
    // does 'foot' include taxi/a paid leg?"). No route can avoid it, so
    // "foot" is forced onto that leg and the report says so plainly.
    const toPier = engine.inquireTravel("the pier");
    expect(toPier.ok).toBe(true);
    expect(toPier.events.some((e) => e.type === "foot_route_not_fully_walkable")).toBe(true);
    expect(toPier.choices?.find((c) => c.id === "foot")?.params?.modesKey).toBe("mode.foot.name, mode.ship.name");
  });

  it("selects a specific mode from a compass inquiry and executes only that one", () => {
    const state = createInitialState();
    state.player.locationId = "alley";
    state.locations["alley"]!.connections = [
      { toId: "street", distanceKm: 4, modes: ["foot", "taxi"], compassLabel: "south" },
    ];
    const engine = new GameEngine(state);
    const before = engine.getState().clock.minutesElapsed;

    const result = engine.travelTo("south", { mode: "taxi" });
    expect(result.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("street");
    // taxi at car speed (40km/h) over 4km = 6 minutes, not foot's 48.
    expect(engine.getState().clock.minutesElapsed - before).toBe(6);
  });

  it("selects the legacy mixed-mode strategy override, without changing the standing preference", () => {
    // Reserved for a future "navigator device" — see TravelOverride.strategy
    // and TravelStrategy's doc comment in types.ts. Exercises that the
    // override path (findRoute) still works even though no current UI
    // reaches it.
    const engine = new GameEngine(createInitialState());
    expect(engine.getTravelPreference()).toBe("foot");

    const result = engine.travelTo("the docks", { strategy: "cheapest" });
    expect(result.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("docks");
    expect(engine.getTravelPreference()).toBe("foot"); // one-trip override only
  });

  it("ignores an override mode the connection doesn't actually list, falling back to normal resolution", () => {
    const state = createInitialState();
    state.locations["office"]!.connections = [{ toId: "alley", distanceKm: 0.1, modes: ["foot"], compassLabel: "south" }];
    const engine = new GameEngine(state);

    const result = engine.travelTo("south", { mode: "taxi" });
    expect(result.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("alley");
  });

  it("fails to inquire about an unrecognized place", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.inquireTravel("mars");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("location_not_found");
  });

  it("reports already-there when inquiring about the current location", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.inquireTravel("office");
    expect(result.ok).toBe(true);
    expect(result.events[0]?.type).toBe("already_there");
  });

  it("charges for a paid compass hop and reports the deduction", () => {
    const state = createInitialState();
    state.player.locationId = "alley";
    state.locations["alley"]!.connections = [
      { toId: "street", distanceKm: 4, modes: ["taxi"], compassLabel: "south" },
    ];
    const engine = new GameEngine(state);
    const before = engine.getMoney();

    const result = engine.travelTo("south");
    expect(result.ok).toBe(true);
    // TAXI_FARE: 300 flag + 50/km * 4km = 500.
    expect(engine.getMoney()).toBe(before - 500);
    expect(result.events.some((e) => e.type === "money_spent")).toBe(true);
    expect(engine.getState().player.locationId).toBe("street");
  });

  it("does not print a spend event for a free hop", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.travelTo("out"); // office -> alley: interior/exterior boundary hop, always free
    expect(result.events.some((e) => e.type === "money_spent")).toBe(false);
  });

  it("refuses to travel when the player can't afford the fare, leaving location, clock, and money untouched", () => {
    const state = createInitialState();
    state.player.locationId = "alley";
    state.locations["alley"]!.connections = [
      { toId: "street", distanceKm: 400, modes: ["taxi"], compassLabel: "south" },
    ];
    state.player.money = 100; // Nowhere near enough for a 400km taxi ride.
    const engine = new GameEngine(state);
    const before = engine.getState();

    const result = engine.travelTo("south");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("insufficient_funds");
    expect(engine.getState().player.locationId).toBe(before.player.locationId);
    expect(engine.getState().clock.minutesElapsed).toBe(before.clock.minutesElapsed);
    expect(engine.getMoney()).toBe(100);
  });

  it("refuses an unaffordable named-destination route the same way", () => {
    const state = createInitialState();
    state.player.locationId = "alley";
    state.locations["alley"]!.connections = [
      { toId: "street", distanceKm: 400, modes: ["taxi"], compassLabel: "south" },
    ];
    state.player.money = 100;
    const engine = new GameEngine(state);

    const result = engine.travelTo("street");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("insufficient_funds");
    expect(engine.getState().player.locationId).toBe("alley");
  });

  it("annotates an unaffordable inquiry option without omitting it", () => {
    const state = createInitialState();
    state.player.locationId = "alley";
    state.locations["alley"]!.connections = [
      { toId: "street", distanceKm: 4, modes: ["foot", "taxi"], compassLabel: "south" },
    ];
    state.player.money = 50; // Enough to walk, not enough for the $3.00 taxi.
    const engine = new GameEngine(state);

    const result = engine.inquireTravel("south");
    expect(result.choices).toHaveLength(2); // Still both options — never filtered.
    const [foot, taxi] = result.choices!;
    expect(foot?.params?.afford).toBe("");
    expect(taxi?.params?.afford).toBe("ui.cannotAfford");
    expect(taxi?.params?.balanceMajor).toBe("0");
    expect(taxi?.params?.balanceMinor).toBe("50");
  });

  it("selecting an unaffordable inquiry choice fails cleanly via the normal insufficient-funds path", () => {
    const state = createInitialState();
    state.player.locationId = "alley";
    state.locations["alley"]!.connections = [
      { toId: "street", distanceKm: 4, modes: ["foot", "taxi"], compassLabel: "south" },
    ];
    state.player.money = 50;
    const engine = new GameEngine(state);

    const result = engine.travelTo("south", { mode: "taxi" });
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("insufficient_funds");
    expect(engine.getMoney()).toBe(50);
    expect(engine.getState().player.locationId).toBe("alley");
  });

  it("lists every direct connection from the current location, using the preferred mode", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.listDirectConnections();
    expect(result.ok).toBe(true);
    // Office has exactly one connection: south to the alley, on foot.
    expect(result.choices).toHaveLength(1);
    expect(result.choices?.[0]).toMatchObject({ id: "alley", kind: "destination" });
    expect(result.choices?.[0]?.params?.modeKey).toBe("mode.foot.name");
  });

  it("changes the direct-connections summary when the travel preference changes", () => {
    const state = createInitialState();
    state.locations["office"]!.connections = [
      { toId: "alley", distanceKm: 4, modes: ["foot", "taxi"], compassLabel: "south" },
    ];
    const engine = new GameEngine(state);

    expect(engine.listDirectConnections().choices?.[0]?.params?.modeKey).toBe("mode.foot.name"); // foot by default
    engine.setTravelPreference("taxi");
    expect(engine.listDirectConnections().choices?.[0]?.params?.modeKey).toBe("mode.taxi.name");
  });

  it("travels along a specific connection by destination id, ignoring name/alias resolution entirely", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.travelToConnection("alley");
    expect(result.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("alley");
  });

  it("fails travelToConnection for a destination the current location has no connection to", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.travelToConnection("docks"); // office has no direct connection to the docks
    expect(result.ok).toBe(false);
    expect(result.events[0]?.type).toBe("route_not_found");
    expect(engine.getState().player.locationId).toBe("office");
  });

  it("lists the player's preferred category first and annotates it, reordering when the preference changes", () => {
    const state = createInitialState();
    state.locations["office"]!.connections = [
      { toId: "alley", distanceKm: 4, modes: ["foot", "taxi"], compassLabel: "south" },
    ];
    const engine = new GameEngine(state);

    const footFirst = engine.inquireTravel("alley");
    expect(footFirst.choices?.map((c) => c.id)).toEqual(["foot", "transit", "taxi"]);
    expect(footFirst.choices?.[0]?.params?.preferredNote).toBe("ui.preferredOption");
    expect(footFirst.choices?.[1]?.params?.preferredNote).toBe("");

    engine.setTravelPreference("taxi");
    const taxiFirst = engine.inquireTravel("alley");
    expect(taxiFirst.choices?.map((c) => c.id)).toEqual(["taxi", "foot", "transit"]);
    expect(taxiFirst.choices?.[0]?.params?.preferredNote).toBe("ui.preferredOption");
  });

  it("marks the player's preferred category as such even when every category ties on fastest/cheapest", () => {
    const state = createInitialState();
    state.player.locationId = "alley";
    state.locations["alley"]!.connections = [{ toId: "street", distanceKm: 0.2, modes: ["foot"] }];
    const engine = new GameEngine(state);
    engine.setTravelPreference("taxi");

    const result = engine.inquireTravel("street");
    const preferred = result.choices?.find((c) => c.id === "taxi");
    expect(preferred?.params?.preferredNote).toBe("ui.preferredOption");
    expect(preferred?.params?.fastestNote).toBe("ui.fastestOption");
    expect(preferred?.params?.cheapestNote).toBe("ui.cheapestOption");
  });

  it("enters the office from the alley via 'in', always taking exactly one free minute", () => {
    const state = createInitialState();
    state.player.locationId = "alley";
    const engine = new GameEngine(state);
    const beforeMinutes = engine.getState().clock.minutesElapsed; // a primitive snapshot — getState() itself returns a live reference, not a copy.

    const result = engine.travelTo("in");
    expect(result.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("office");
    expect(engine.getState().clock.minutesElapsed - beforeMinutes).toBe(1);
    expect(result.events.some((e) => e.type === "money_spent")).toBe(false);
  });

  it("reaches the Grand Hotel lobby by name from the street, and moves between its floors for free", () => {
    const state = createInitialState();
    state.player.locationId = "street";
    const engine = new GameEngine(state);

    const enter = engine.travelTo("the grand hotel");
    expect(enter.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("grand-hotel");

    const before = engine.getState().clock.minutesElapsed;
    const up = engine.travelTo("up");
    expect(up.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("grand-hotel-floor-2");
    expect(engine.getState().clock.minutesElapsed - before).toBe(1);
    expect(up.events.some((e) => e.type === "money_spent")).toBe(false);

    const upAgain = engine.travelTo("up");
    expect(upAgain.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("grand-hotel-floor-3");
  });

  it("charges nothing and takes one flat minute for the interior/exterior boundary hops in a multi-hop pathfound route", () => {
    const state = createInitialState();
    const engine = new GameEngine(state);
    // "foot" is the content's default (see world.ts), and alley<->street
    // offers free foot alongside paid taxi (see docs/systems/economy.md's
    // fare-system test content) — foot keeps the whole route on free
    // modes, so this test isolates "are the interior boundary hops free"
    // from "did the exterior leg happen to also be free."
    const before = engine.getState().clock.minutesElapsed;
    const moneyBefore = engine.getMoney();

    // office -> alley -> street -> grand-hotel: two interior/exterior
    // boundary hops (out, in) plus one ordinary exterior hop (alley->street).
    const result = engine.travelTo("the grand hotel");
    expect(result.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("grand-hotel");
    // 1 (out) + ~2 (alley->street, 0.2km on foot) + 1 (in) — not a huge number either way, just sanity-bounded.
    expect(engine.getState().clock.minutesElapsed - before).toBeLessThan(10);
    expect(engine.getMoney()).toBe(moneyBefore);
  });

  it("offers the new taxi mode, correctly metered, on a direct alley<->street compass inquiry", () => {
    // The compass-word ("south") connection between alley and street only
    // lists foot/taxi — bus-1's alley<->street leg is a SEPARATE Connection
    // with no compassLabel of its own (see world.ts), so it isn't reachable
    // by direction word; the flat $3.00 bus fare is exercised instead by
    // the free-transfers test below, which reaches it by naming a
    // destination.
    const state = createInitialState();
    state.player.locationId = "alley";
    const engine = new GameEngine(state);
    const result = engine.inquireTravel("south");
    expect(result.ok).toBe(true);
    const byMode = new Map(result.choices?.map((c) => [c.id, c.params]));
    expect(byMode.get("foot")?.costMajor).toBe("0");
    expect(byMode.get("foot")?.costMinor).toBe("00");
    // Taxi: $3.00 flag fee + $0.50/km * 0.2km (rounded) = $3.10.
    expect(byMode.get("taxi")?.costMajor).toBe("3");
    expect(byMode.get("taxi")?.costMinor).toBe("10");
  });

  it("charges only one flat bus fare across three consecutive same-line hops in a single findCategoryRoute call", () => {
    // Isolates the free-transfer mechanic against the real bus-1 content
    // by giving the player no alternative at all: strip every other mode
    // off the alley/street/highway/docks corridor so EVERY category
    // (even the "foot" default) has nothing to pick but the bus for all
    // three legs (see resolveCategoryEdges's forced-fallback rule).
    const state = createInitialState();
    for (const id of ["alley", "street", "highway"] as const) {
      state.locations[id]!.connections = state.locations[id]!.connections.filter((c) => c.modes.includes("bus"));
    }
    state.player.locationId = "alley";
    const engine = new GameEngine(state);
    const moneyBefore = engine.getMoney();

    const result = engine.travelTo("the docks");
    expect(result.ok).toBe(true);
    expect(engine.getState().player.locationId).toBe("docks");
    expect(result.events.filter((e) => e.type === "money_spent")).toHaveLength(1);
    expect(moneyBefore - engine.getMoney()).toBe(300);
  });
});

/**
 * The desk (office) has two parts — `left-drawer` (closed by default, not
 * important) and `right-drawer` (OPEN by default, `important: true`) — and
 * `street` has a `lighter` item with a purely descriptive `symbol` part (no
 * `enterAliases`). See content/city/world.yaml.
 */
describe("parts, focus, and interact", () => {
  it("examining an item with parts focuses it, and bubbles up any part currently in an important state", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.examine("desk");
    expect(engine.getFocusedWorldObject()?.id).toBe("desk");
    const bubbled = result.events.filter((e) => e.type === "part_state_noted");
    expect(bubbled).toHaveLength(1); // only the right-drawer (open, important) — left-drawer (closed, not important) doesn't bubble
    expect(bubbled[0]?.textKey).toBe("setpiece.desk.right-drawer.open.summary"); // the SHORT summary, not the full direct-examine text
  });

  it("clears focus when examining a plain item", () => {
    const engine = new GameEngine(createInitialState());
    engine.examine("desk");
    expect(engine.getFocusedWorldObject()).toBeDefined();
    engine.examine("case file"); // a plain item, no parts
    expect(engine.getFocusedWorldObject()).toBeUndefined();
  });

  it("clears focus when examining an NPC", () => {
    const state = createInitialState();
    state.player.locationId = "alley";
    state.focusedWorldObjectId = "desk"; // simulate having focused the desk before arriving here
    const engine = new GameEngine(state);
    engine.examine("informant");
    expect(engine.getFocusedWorldObject()).toBeUndefined();
  });

  it("examines a non-important part directly while focused, regardless of importance", () => {
    const engine = new GameEngine(createInitialState());
    engine.examine("desk"); // focuses the desk
    const result = engine.examine("left drawer");
    expect(result.ok).toBe(true);
    expect(result.events.map((e) => e.type)).toEqual(["part_examined", "part_state_noted"]);
    expect(result.events[1]?.textKey).toBe("setpiece.desk.left-drawer.closed.description");
  });

  it("resolves an important-surfaced part directly, without needing focus first, and sets focus afterward", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.examine("right drawer"); // never examined the desk itself
    expect(result.ok).toBe(true);
    expect(engine.getFocusedWorldObject()?.id).toBe("desk");
  });

  it("refuses to resolve a non-important, non-focused part with a 'look closer first' message", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.examine("left drawer");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.textKey).toBe("event.partNotFocused");
  });

  it("examines a purely descriptive part (no enterAliases) once focused on its parent item", () => {
    const state = createInitialState();
    state.player.locationId = "street";
    const engine = new GameEngine(state);
    engine.examine("lighter"); // focuses the lighter; its base description mentions the symbol
    const result = engine.examine("symbol");
    expect(result.ok).toBe(true);
    expect(result.events[1]?.textKey).toBe("item.lighter.symbol.engraved.description");
  });

  it("interact: opens a closed part, changing its state and keeping focus on the parent", () => {
    const engine = new GameEngine(createInitialState());
    engine.examine("desk");
    const result = engine.interact("open", "left drawer");
    expect(result.ok).toBe(true);
    expect(result.events[0]?.textKey).toBe("setpiece.desk.left-drawer.open.description");
    expect(engine.getFocusedWorldObject()?.id).toBe("desk");
  });

  it("interact: reports 'already in state' without changing anything, when the target state is already current", () => {
    const engine = new GameEngine(createInitialState());
    engine.examine("desk");
    const result = engine.interact("close", "left drawer"); // already closed (its default)
    expect(result.ok).toBe(true);
    expect(result.events[0]?.textKey).toBe("event.partAlreadyInState");
    expect(result.events[0]?.params?.stateKey).toBe("setpiece.desk.left-drawer.closed.name");
  });

  it("interact: reports verb-not-applicable when no state of the part accepts that verb", () => {
    const engine = new GameEngine(createInitialState());
    engine.examine("desk");
    const result = engine.interact("light", "left drawer"); // drawers only accept open/close
    expect(result.ok).toBe(false);
    expect(result.events[0]?.textKey).toBe("event.partVerbNotApplicable");
    expect(result.events[0]?.params).toMatchObject({ verb: "light", partKey: "setpiece.desk.left-drawer.name" });
  });

  it("interact: fails as 'not focused yet' for a non-important part reached without focus", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.interact("open", "left drawer");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.textKey).toBe("event.partNotFocused");
  });

  it("interact: fails as not-found when the alias matches no part anywhere in scope", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.interact("open", "nonexistent thing");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.textKey).toBe("event.itemNotFound");
  });

  it("interact: resolves an important-surfaced part without focus, and sets focus afterward", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.interact("close", "right drawer"); // important, starts open
    expect(result.ok).toBe(true);
    expect(engine.getFocusedWorldObject()?.id).toBe("desk");
  });

  it("keeps focus across compatible commands: look, take, and re-examining", () => {
    const engine = new GameEngine(createInitialState());
    engine.examine("desk");
    engine.look();
    engine.takeItem("case file");
    expect(engine.getFocusedWorldObject()?.id).toBe("desk");
  });

  it("clears focus on a successful travel", () => {
    const engine = new GameEngine(createInitialState());
    engine.examine("desk");
    engine.travelTo("out");
    expect(engine.getFocusedWorldObject()).toBeUndefined();
  });

  it("does NOT clear focus on a blocked/failed travel attempt", () => {
    const engine = new GameEngine(createInitialState());
    engine.examine("desk");
    const blocked = engine.travelTo("north"); // office has no north exit
    expect(blocked.ok).toBe(false);
    expect(engine.getFocusedWorldObject()?.id).toBe("desk");
  });

  it("clears focus when talkTo succeeds, but not when it fails to find the NPC", () => {
    const state = createInitialState();
    state.player.locationId = "alley";
    state.focusedWorldObjectId = "desk";
    const engine = new GameEngine(state);

    const failed = engine.talkTo("nobody");
    expect(failed.ok).toBe(false);
    expect(engine.getFocusedWorldObject()?.id).toBe("desk"); // untouched by the failed lookup

    engine.talkTo("informant");
    expect(engine.getFocusedWorldObject()).toBeUndefined();
  });

  it("unfocus (the back/stop command) clears focus and reports what was focused", () => {
    const engine = new GameEngine(createInitialState());
    engine.examine("desk");
    const result = engine.unfocus();
    expect(result.ok).toBe(true);
    expect(result.events[0]?.textKey).toBe("event.focusCleared");
    expect(result.events[0]?.params?.itemKey).toBe("setpiece.desk.name");
    expect(engine.getFocusedWorldObject()).toBeUndefined();
  });

  it("unfocus reports nothing-focused when nothing was focused", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.unfocus();
    expect(result.ok).toBe(true);
    expect(result.events[0]?.textKey).toBe("event.nothingFocused");
  });

  it("clearFocus is an event-less, unconditional focus break", () => {
    const engine = new GameEngine(createInitialState());
    engine.examine("desk");
    engine.clearFocus();
    expect(engine.getFocusedWorldObject()).toBeUndefined();
  });
});

/**
 * The torn photograph (office) is `containedIn` the desk's right-drawer,
 * whose default state ("open") has `exposesContents: true` but NOT
 * `revealInAmbientListing` — see content/city/world.yaml.
 */
describe("containment", () => {
  it("is reachable (examine/take) once its container part is exposing, without needing focus first", () => {
    const engine = new GameEngine(createInitialState());
    const examined = engine.examine("torn photograph");
    expect(examined.ok).toBe(true);

    const taken = engine.takeItem("torn photograph");
    expect(taken.ok).toBe(true);
    expect(engine.getState().player.inventory).toContain("torn-photograph");
  });

  it("clears its containedIn entry once taken", () => {
    const engine = new GameEngine(createInitialState());
    expect(engine.getState().placement.containedIn["torn-photograph"]).toEqual({ containerId: "desk", partId: "right-drawer" });
    engine.takeItem("torn photograph");
    expect(engine.getState().placement.containedIn["torn-photograph"]).toBeUndefined();
  });

  it("becomes unreachable again once the container is closed", () => {
    const engine = new GameEngine(createInitialState());
    engine.interact("close", "right drawer"); // important + starts open, reachable without focus
    const result = engine.examine("torn photograph");
    expect(result.ok).toBe(false);
    expect(result.events[0]?.textKey).toBe("event.examineNotFound");
  });

  it("does not join the ambient items-present line, even while exposed, since revealInAmbientListing isn't set", () => {
    const engine = new GameEngine(createInitialState());
    const result = engine.look(); // right-drawer starts open (exposesContents: true) — office starts as first visit
    const itemsLine = result.events.find((e) => e.type === "items_present");
    expect(itemsLine?.params?.items).not.toMatch(/photograph/);
  });
});

/**
 * Two in-scope objects sharing an alias — see docs/systems/parts.md's
 * "Ambiguous targets." The case file sits directly at the office; the
 * torn photograph is `containedIn` the desk's already-open right drawer
 * (see the "containment" describe above) — both reachable at once without
 * any setup, so giving the photograph the case file's alias is enough to
 * force the collision.
 */
describe("ambiguous targets", () => {
  function makeAmbiguousState(): GameEngine {
    const state = createInitialState();
    state.worldObjects["torn-photograph"]!.aliases = [...state.worldObjects["torn-photograph"]!.aliases, "case file"];
    return new GameEngine(state);
  }

  it("reports every in-scope match instead of silently picking one", () => {
    const engine = makeAmbiguousState();
    const result = engine.examine("case file");
    expect(result.ok).toBe(true);
    expect(result.events[0]?.textKey).toBe("event.targetAmbiguous");
    expect(result.choices).toHaveLength(2);
    const ids = (result.choices ?? []).map((c) => c.id).sort();
    expect(ids).toEqual(["case-file", "torn-photograph"]);
    for (const choice of result.choices ?? []) {
      expect(choice.kind).toBe("resolution");
      expect(choice.textKey).toBe("ui.disambiguationOption");
    }
  });

  it("labels each candidate by its immediate parent — location for a bare placement, the container for a contained one", () => {
    const engine = makeAmbiguousState();
    const result = engine.examine("case file");
    const byId = Object.fromEntries((result.choices ?? []).map((c) => [c.id, c]));
    expect(byId["case-file"]?.params?.locationKey).toBe("location.office.name");
    expect(byId["torn-photograph"]?.params?.locationKey).toBe("setpiece.desk.name");
  });

  it("resolves an ambiguous carried item's label to the inventory placeholder", () => {
    const engine = makeAmbiguousState();
    engine.getState().player.inventory.push("torn-photograph");
    delete engine.getState().placement.containedIn["torn-photograph"];
    const result = engine.examine("case file");
    const byId = Object.fromEntries((result.choices ?? []).map((c) => [c.id, c]));
    expect(byId["torn-photograph"]?.params?.locationKey).toBe("ui.inventoryLabel");
  });

  it("examine/takeItem's id-based overload resolves a specific candidate directly, bypassing alias matching entirely", () => {
    const engine = makeAmbiguousState();
    const examined = engine.examine({ id: "torn-photograph" });
    expect(examined.ok).toBe(true);
    expect(examined.choices).toBeUndefined();

    const taken = engine.takeItem({ id: "torn-photograph" });
    expect(taken.ok).toBe(true);
    expect(engine.getState().player.inventory).toContain("torn-photograph");
  });

  it("takeItem also reports ambiguity rather than taking the wrong one", () => {
    const engine = makeAmbiguousState();
    const result = engine.takeItem("case file");
    expect(result.ok).toBe(true);
    expect(result.choices).toHaveLength(2);
    expect(engine.getState().player.inventory).toEqual([]);
  });

  describe("notebooks", () => {
    it("buyNotebook charges the price and creates a blank, unnamed notebook", () => {
      const engine = new GameEngine(createInitialState());
      const startingMoney = engine.getMoney();
      const result = engine.buyNotebook("notebook");
      expect(result.ok).toBe(true);
      expect(engine.getMoney()).toBeLessThan(startingMoney);
      expect(engine.getNotebooks()).toHaveLength(1);
      expect(engine.getNotebooks()[0]?.name).toBe("");
      expect(engine.getNotebooks()[0]?.pages.length).toBeGreaterThan(0);
    });

    it("buyNotebook fails cleanly on an unknown product, without charging", () => {
      const engine = new GameEngine(createInitialState());
      const startingMoney = engine.getMoney();
      const result = engine.buyNotebook("nonexistent thing");
      expect(result.ok).toBe(false);
      expect(engine.getMoney()).toBe(startingMoney);
    });

    it("setActiveNotebook/clearActiveNotebook toggle GameEngine.getActiveNotebookId", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      expect(engine.getActiveNotebookId()).toBeNull();

      expect(engine.setActiveNotebook(id).ok).toBe(true);
      expect(engine.getActiveNotebookId()).toBe(id);

      expect(engine.clearActiveNotebook().ok).toBe(true);
      expect(engine.getActiveNotebookId()).toBeNull();
    });

    it("renameNotebook sets free player-authored text", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      engine.renameNotebook(id, "My Casebook");
      expect(engine.getNotebooks()[0]?.name).toBe("My Casebook");
    });

    it("jotNote writes a new, stamped block into the notebook's first page", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      const result = engine.jotNote(id, "The desk drawer was locked.");
      expect(result.ok).toBe(true);
      const block = engine.getNotebooks()[0]!.pages[0]!.blocks[0]!;
      expect(block.spans).toEqual([{ id: expect.any(String), text: "The desk drawer was locked.", struck: false }]);
      expect(block.locationId).toBe(engine.getState().player.locationId);
    });

    it("jotNote fails with nothing written when no page has room", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      const notebook = engine.getNotebooks()[0]!;
      // Shrink to one page with no room at all, to exercise "notebook full" without writing a huge fixture string.
      notebook.pages.length = 1;
      notebook.pages[0]!.charCapacity = 0;

      const result = engine.jotNote(id, "anything");
      expect(result.ok).toBe(false);
      expect(notebook.pages[0]!.blocks).toHaveLength(0);
    });

    it("jotNote refuses a note longer than an entire page's capacity, even on a totally empty notebook", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      const page = engine.getNotebooks()[0]!.pages[0]!;
      const tooLong = "x".repeat(page.charCapacity + 1);

      const result = engine.jotNote(id, tooLong);
      expect(result.ok).toBe(false);
      expect(result.events[0]?.type).toBe("note_too_long");
      expect(engine.getNotebooks()[0]!.pages.every((p) => p.blocks.length === 0)).toBe(true);
    });

    it("jotNote lets a single entry span well beyond what any per-entry line cap used to allow, as long as the page has room", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      const page = engine.getNotebooks()[0]!.pages[0]!;
      const longButFits = "x".repeat(page.charCapacity - 10);

      const result = engine.jotNote(id, longButFits);
      expect(result.ok).toBe(true);
      expect(page.blocks[0]!.spans[0]?.text).toBe(longButFits);
    });

    it("amendNote refuses an edit that would exceed the page's total capacity, leaving the block unchanged", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      engine.jotNote(id, "short note");
      const page = engine.getNotebooks()[0]!.pages[0]!;
      const blockId = page.blocks[0]!.id;
      const tooLong = "x".repeat(page.charCapacity + 1);

      const result = engine.amendNote(id, blockId, tooLong);
      expect(result.ok).toBe(false);
      expect(result.events[0]?.type).toBe("note_too_long");
      expect(page.blocks[0]!.spans).toEqual([{ id: expect.any(String), text: "short note", struck: false }]);
    });

    it("amendNote diffs the new text against the block's committed spans, striking removed text", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      engine.jotNote(id, "hello cruel world");
      const blockId = engine.getNotebooks()[0]!.pages[0]!.blocks[0]!.id;

      const result = engine.amendNote(id, blockId, "hello world");
      expect(result.ok).toBe(true);
      const block = engine.getNotebooks()[0]!.pages[0]!.blocks[0]!;
      expect(block.spans.some((s) => s.struck && s.text === "cruel ")).toBe(true);
    });

    it("disposeNotebook removes the notebook and clears activeNotebookId if it was active", () => {
      const engine = new GameEngine(createInitialState());
      engine.buyNotebook("notebook");
      const id = engine.getNotebooks()[0]!.id;
      engine.setActiveNotebook(id);

      const result = engine.disposeNotebook(id);
      expect(result.ok).toBe(true);
      expect(engine.getNotebooks()).toHaveLength(0);
      expect(engine.getActiveNotebookId()).toBeNull();
    });
  });

  describe("case board", () => {
    it("addBoardNode adds a node and getBoard reflects it", () => {
      const engine = new GameEngine(createInitialState());
      const result = engine.addBoardNode("note", null, "a hunch", 10, 20);
      expect(result.ok).toBe(true);
      expect(engine.getBoard().nodes).toEqual([{ id: expect.any(String), refKind: "note", refId: null, text: "a hunch", x: 10, y: 20 }]);
    });

    it("moveBoardNode repositions a node and produces no printable event", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "a hunch", 0, 0);
      const id = engine.getBoard().nodes[0]!.id;

      const result = engine.moveBoardNode(id, 50, 60);
      expect(result.ok).toBe(true);
      expect(result.events).toEqual([]);
      expect(engine.getBoard().nodes[0]).toMatchObject({ x: 50, y: 60 });
    });

    it("removeBoardNode removes the node and cascades to its connections", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "a", 0, 0);
      engine.addBoardNode("note", null, "b", 0, 0);
      const [a, b] = engine.getBoard().nodes;
      engine.addBoardConnection(a!.id, b!.id, "red");

      const result = engine.removeBoardNode(a!.id);
      expect(result.ok).toBe(true);
      expect(engine.getBoard().nodes).toHaveLength(1);
      expect(engine.getBoard().connections).toHaveLength(0);
    });

    it("editBoardNoteText updates a note node's text", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "old", 0, 0);
      const id = engine.getBoard().nodes[0]!.id;

      const result = engine.editBoardNoteText(id, "new");
      expect(result.ok).toBe(true);
      expect(engine.getBoard().nodes[0]!.text).toBe("new");
    });

    it("addBoardConnection succeeds between two existing nodes with a color", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "a", 0, 0);
      engine.addBoardNode("note", null, "b", 0, 0);
      const [a, b] = engine.getBoard().nodes;

      const result = engine.addBoardConnection(a!.id, b!.id, "blue");
      expect(result.ok).toBe(true);
      expect(engine.getBoard().connections[0]).toMatchObject({ fromNodeId: a!.id, toNodeId: b!.id, color: "blue" });
    });

    it("addBoardConnection fails on a self-connection, without mutating the board", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "a", 0, 0);
      const id = engine.getBoard().nodes[0]!.id;

      const result = engine.addBoardConnection(id, id, "red");
      expect(result.ok).toBe(false);
      expect(engine.getBoard().connections).toHaveLength(0);
    });

    it("removeBoardConnection removes the string", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "a", 0, 0);
      engine.addBoardNode("note", null, "b", 0, 0);
      const [a, b] = engine.getBoard().nodes;
      engine.addBoardConnection(a!.id, b!.id, "red");
      const connectionId = engine.getBoard().connections[0]!.id;

      const result = engine.removeBoardConnection(connectionId);
      expect(result.ok).toBe(true);
      expect(engine.getBoard().connections).toHaveLength(0);
    });

    it("recolorBoardConnection changes an existing string's color", () => {
      const engine = new GameEngine(createInitialState());
      engine.addBoardNode("note", null, "a", 0, 0);
      engine.addBoardNode("note", null, "b", 0, 0);
      const [a, b] = engine.getBoard().nodes;
      engine.addBoardConnection(a!.id, b!.id, "red");
      const connectionId = engine.getBoard().connections[0]!.id;

      const result = engine.recolorBoardConnection(connectionId, "green");
      expect(result.ok).toBe(true);
      expect(engine.getBoard().connections[0]!.color).toBe("green");
    });

    it("listAddableBoardEntities reflects known facts/NPCs/locations/items", () => {
      const engine = new GameEngine(createInitialState());
      engine.takeItem("case file");
      const entities = engine.listAddableBoardEntities();
      expect(entities.some((e) => e.refKind === "item")).toBe(true);
      expect(entities.some((e) => e.refKind === "location")).toBe(true);
    });
  });
});

/**
 * `getSceneImage` — which image the scene pane shows: the examined thing's
 * (object, part state, NPC) while examining, else the location's. Images are
 * injected onto the loaded content here so the tests don't depend on art.
 */
describe("scene image", () => {
  const img = (src: string) => ({ src, altKey: `test.${src}`, hotspots: [] });

  function setUp(locationId = "office") {
    const state = createInitialState();
    state.player.locationId = locationId;
    state.locations[locationId]!.image = img("room.svg");
    // Start from a clean slate: real content ships placeholder object images too.
    for (const object of Object.values(state.worldObjects)) {
      delete object.image;
      for (const part of object.parts ?? []) for (const partState of part.states) delete partState.image;
    }
    for (const npc of Object.values(state.npcs)) delete npc.image;
    return { state, engine: new GameEngine(state) };
  }

  it("shows the location image until something with its own image is examined", () => {
    const { state, engine } = setUp();
    state.worldObjects.desk!.image = img("desk.svg");
    expect(engine.getSceneImage()?.src).toBe("room.svg");
    engine.examine("desk");
    expect(engine.getSceneImage()?.src).toBe("desk.svg");
  });

  it("reverts to the location image on back, and on travel", () => {
    const { state, engine } = setUp();
    state.worldObjects.desk!.image = img("desk.svg");
    engine.examine("desk");
    engine.unfocus();
    expect(engine.getSceneImage()?.src).toBe("room.svg");

    engine.examine("desk");
    engine.travelTo("out");
    expect(engine.getSceneImage()?.src).not.toBe("desk.svg");
  });

  it("falls through to the location image when the examined thing has none, and covers plain items", () => {
    const { state, engine } = setUp();
    engine.examine("desk");
    expect(engine.getSceneImage()?.src).toBe("room.svg");

    const plain = Object.values(state.worldObjects).find((o) => !o.parts?.length && o.aliases.includes("case file"))!;
    plain.image = img("file.svg");
    engine.examine("case file");
    expect(engine.getSceneImage()?.src).toBe("file.svg");
  });

  it("shows an NPC's image while examining them", () => {
    const { state, engine } = setUp("alley");
    state.npcs.informant!.image = img("informant.svg");
    engine.examine("informant");
    expect(engine.getSceneImage()?.src).toBe("informant.svg");
    engine.unfocus();
    expect(engine.getSceneImage()?.src).toBe("room.svg");
  });

  it("swaps to a part state's image when interact changes state, overriding the object's own", () => {
    const { state, engine } = setUp();
    const desk = state.worldObjects.desk!;
    desk.image = img("desk.svg");
    const drawer = desk.parts!.find((p) => p.id === "right-drawer")!;
    drawer.states.find((s) => s.id === "closed")!.image = img("drawer-closed.svg");
    drawer.states.find((s) => s.id === "open")!.image = img("drawer-open.svg");

    engine.examine("desk");
    expect(engine.getSceneImage()?.src).toBe("drawer-open.svg");
    engine.interact("close", "right drawer");
    expect(engine.getSceneImage()?.src).toBe("drawer-closed.svg");
  });
});

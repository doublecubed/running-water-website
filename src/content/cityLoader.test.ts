import { describe, expect, it } from "vitest";
import { parseCity } from "./cityLoader";
import type { CitySourceFiles } from "./cityLoader";

/** Builds a `CitySourceFiles` with sensible defaults, so each test only has to specify what it actually cares about. */
function files(overrides: Partial<CitySourceFiles> = {}): CitySourceFiles {
  return { world: "", objectFiles: {}, locationFiles: {}, ...overrides };
}

const MINIMAL_LOCATION = `
- id: a
  kind: exterior
  aliases: [a]
  text:
    en: { name: A, description: Location A. }
  connections:
    - toId: b
- id: b
  kind: exterior
  aliases: [b]
  text:
    en: { name: B, description: Location B. }
`;

describe("parseCity", () => {
  it("parses locations/objects into typed, id-keyed records, from a single file each", () => {
    const city = parseCity(files({ locationFiles: { "locations/a.yaml": MINIMAL_LOCATION } }));
    expect(Object.keys(city.locations)).toEqual(["a", "b"]);
    expect(city.locations.a).toMatchObject({
      id: "a",
      kind: "exterior",
      nameKey: "location.a.name",
      descriptionKey: "location.a.description",
      connections: [{ toId: "b" }],
    });
    expect(city.worldObjects).toEqual({});
    expect(city.npcs).toEqual({});
  });

  it("merges locations/objects split across MULTIPLE files into one collection", () => {
    const city = parseCity(
      files({
        locationFiles: {
          "locations/a.yaml": `
- id: a
  kind: exterior
  text: { en: { name: A, description: Location A. } }
`,
          "locations/b.yaml": `
- id: b
  kind: exterior
  text: { en: { name: B, description: Location B. } }
`,
        },
        objectFiles: {
          "objects/desk.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text: { en: { name: the desk, description: A desk. } }
`,
          "objects/lighter.yaml": `
- id: lighter
  kind: item
  portable: true
  text: { en: { name: the lighter, description: A lighter. } }
`,
        },
      }),
    );
    expect(Object.keys(city.locations).sort()).toEqual(["a", "b"]);
    expect(Object.keys(city.worldObjects).sort()).toEqual(["desk", "lighter"]);
  });

  it("accepts several complete entries grouped in one file — a 'furniture.yaml' with multiple objects", () => {
    const city = parseCity(
      files({
        objectFiles: {
          "objects/furniture.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text: { en: { name: the desk, description: A desk. } }
- id: chair
  kind: setpiece
  portable: false
  text: { en: { name: the chair, description: A chair. } }
`,
        },
      }),
    );
    expect(Object.keys(city.worldObjects).sort()).toEqual(["chair", "desk"]);
  });

  it("derives location/world-object/npc keys from id, never requiring an author-typed key", () => {
    const city = parseCity(
      files({
        locationFiles: { "locations/a.yaml": MINIMAL_LOCATION },
        objectFiles: {
          "objects/desk.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text: { en: { name: the desk, description: A desk. } }
`,
        },
        world: `
npcs:
  - id: clerk
    locationId: a
    text: { en: { name: the clerk, description: A clerk., dialogue: Hello. } }
`,
      }),
    );
    expect(city.locations.a).toMatchObject({ nameKey: "location.a.name", descriptionKey: "location.a.description" });
    expect(city.worldObjects.desk).toMatchObject({ nameKey: "setpiece.desk.name", descriptionKey: "setpiece.desk.description" });
    expect(city.npcs.clerk).toMatchObject({ nameKey: "npc.clerk.name", descriptionKey: "npc.clerk.description", dialogueKey: "npc.clerk.dialogue" });
  });

  it("emits every text field, for every language present, into derivedLocale under the same derived keys", () => {
    const city = parseCity(
      files({
        objectFiles: {
          "objects/desk.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text:
    en: { name: the desk, description: A desk. }
    es: { name: el escritorio }
`,
        },
      }),
    );
    expect(city.derivedLocale.en).toMatchObject({ "setpiece.desk.name": "the desk", "setpiece.desk.description": "A desk." });
    expect(city.derivedLocale.es).toEqual({ "setpiece.desk.name": "el escritorio" });
  });

  it("requires text.en, but accepts any other language partially or not at all", () => {
    expect(() =>
      parseCity(
        files({
          objectFiles: {
            "objects/desk.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text:
    es: { name: el escritorio, description: Un escritorio. }
`,
          },
        }),
      ),
    ).toThrow(/text\.en" is required and must be a mapping/);
  });

  it("rejects text.en missing a required field, naming exactly which one", () => {
    expect(() =>
      parseCity(
        files({
          objectFiles: {
            "objects/desk.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text:
    en: { name: the desk }
`,
          },
        }),
      ),
    ).toThrow(/text\.en\.description" is required/);
  });

  it("derives per-part and per-part-state keys, fully namespaced under the parent object", () => {
    const city = parseCity(
      files({
        objectFiles: {
          "objects/desk.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text: { en: { name: the desk, description: A desk. } }
  parts:
    - id: drawer
      defaultStateId: closed
      text: { en: { name: the drawer, description: A drawer. } }
      states:
        - id: closed
          enterAliases: [close]
          text: { en: { name: closed, description: The drawer is closed. } }
        - id: open
          enterAliases: [open]
          important: true
          text:
            en:
              name: open
              description: The drawer is open, revealing something inside.
              summary: The drawer is open.
`,
        },
      }),
    );
    const part = city.worldObjects.desk?.parts?.[0];
    expect(part).toMatchObject({ id: "drawer", nameKey: "setpiece.desk.drawer.name", descriptionKey: "setpiece.desk.drawer.description" });
    const closed = part?.states.find((s) => s.id === "closed");
    const open = part?.states.find((s) => s.id === "open");
    expect(closed).toMatchObject({ descriptionKey: "setpiece.desk.drawer.closed.description" });
    expect(closed).not.toHaveProperty("summaryKey"); // no `summary` authored — omitted, not defaulted
    expect(open).toMatchObject({ descriptionKey: "setpiece.desk.drawer.open.description", summaryKey: "setpiece.desk.drawer.open.summary" });
    expect(city.derivedLocale.en?.["setpiece.desk.drawer.open.summary"]).toBe("The drawer is open.");
  });

  it("tags every error with its source file, collecting problems from MULTIPLE files into one error", () => {
    let message = "";
    try {
      parseCity(
        files({
          locationFiles: {
            "locations/broken.yaml": `
- id: a
  kind: bogus
  text: { en: { name: A, description: A. } }
`,
          },
          objectFiles: {
            "objects/broken.yaml": `
- id: desk
  kind: setpiece
  portable: not-a-boolean
  text: { en: { name: the desk, description: A desk. } }
`,
          },
        }),
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("locations/broken.yaml[0].kind");
    expect(message).toContain("objects/broken.yaml[0].portable");
  });

  it("rejects a file whose document root isn't a bare list", () => {
    expect(() =>
      parseCity(files({ objectFiles: { "objects/desk.yaml": "id: desk\nkind: item\n" } })),
    ).toThrow(/objects\/desk\.yaml: must be a YAML list of items/);
  });

  it("rejects a duplicate id across two DIFFERENT files, naming the duplicate's file", () => {
    expect(() =>
      parseCity(
        files({
          objectFiles: {
            "objects/a.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text: { en: { name: the desk, description: A desk. } }
`,
            "objects/b.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text: { en: { name: another desk, description: Another desk. } }
`,
          },
        }),
      ),
    ).toThrow(/more than one entry with id "desk"/);
  });

  it("rejects a location listing itemIds/npcIds that don't exist", () => {
    expect(() =>
      parseCity(
        files({
          locationFiles: {
            "locations/a.yaml": `
- id: a
  kind: exterior
  itemIds: [ghost]
  text: { en: { name: A, description: A. } }
`,
          },
        }),
      ),
    ).toThrow(/lists itemIds "ghost", which has no entry in items/);
  });

  it("parses an authored baseVisibility tier on any location", () => {
    const city = parseCity(
      files({
        locationFiles: {
          "locations/a.yaml": `
- id: a
  kind: exterior
  baseVisibility: dark
  text: { en: { name: A, description: A. } }
`,
        },
      }),
    );
    expect(city.locations.a).toMatchObject({ baseVisibility: "dark" });
  });

  it("leaves baseVisibility absent (not defaulted) when not authored", () => {
    const city = parseCity(files({ locationFiles: { "locations/a.yaml": MINIMAL_LOCATION } }));
    expect(city.locations.a?.baseVisibility).toBeUndefined();
  });

  it("rejects an unknown baseVisibility value", () => {
    expect(() =>
      parseCity(
        files({
          locationFiles: {
            "locations/a.yaml": `
- id: a
  kind: exterior
  baseVisibility: pitch-black
  text: { en: { name: A, description: A. } }
`,
          },
        }),
      ),
    ).toThrow(/baseVisibility is "pitch-black" — must be one of/);
  });

  it("parses affectedByDaylight: false on an interior", () => {
    const city = parseCity(
      files({
        locationFiles: {
          "locations/a.yaml": `
- id: street
  kind: exterior
  text: { en: { name: Street, description: A street. } }
- id: basement
  kind: interior
  exteriorId: street
  affectedByDaylight: false
  text: { en: { name: Basement, description: A basement. } }
`,
        },
      }),
    );
    expect(city.locations.basement).toMatchObject({ affectedByDaylight: false });
  });

  it("rejects affectedByDaylight authored on an exterior location", () => {
    expect(() =>
      parseCity(
        files({
          locationFiles: {
            "locations/a.yaml": `
- id: a
  kind: exterior
  affectedByDaylight: false
  text: { en: { name: A, description: A. } }
`,
          },
        }),
      ),
    ).toThrow(/affectedByDaylight is only valid on an interior location/);
  });

  it("parses an authored stats block on an NPC", () => {
    const city = parseCity(
      files({
        locationFiles: { "locations/a.yaml": MINIMAL_LOCATION },
        world: `
npcs:
  - id: bouncer
    locationId: a
    stats: { intimidation: 90, stealth: 5 }
    text: { en: { name: the bouncer, description: A bouncer., dialogue: Hey. } }
`,
      }),
    );
    expect(city.npcs.bouncer).toMatchObject({ stats: { intimidation: 90, stealth: 5 } });
  });

  it("leaves an NPC's stats absent (not defaulted) when not authored", () => {
    const city = parseCity(
      files({
        locationFiles: { "locations/a.yaml": MINIMAL_LOCATION },
        world: `
npcs:
  - id: clerk
    locationId: a
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
`,
      }),
    );
    expect(city.npcs.clerk?.stats).toBeUndefined();
  });

  it("rejects an unknown stat key on an NPC", () => {
    expect(() =>
      parseCity(
        files({
          locationFiles: { "locations/a.yaml": MINIMAL_LOCATION },
          world: `
npcs:
  - id: clerk
    locationId: a
    stats: { charisma: 50 }
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
`,
        }),
      ),
    ).toThrow(/stats has unknown key "charisma" — must be one of/);
  });

  it("rejects an out-of-range stat value on an NPC", () => {
    expect(() =>
      parseCity(
        files({
          locationFiles: { "locations/a.yaml": MINIMAL_LOCATION },
          world: `
npcs:
  - id: clerk
    locationId: a
    stats: { stealth: 500 }
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
`,
        }),
      ),
    ).toThrow(/stats.stealth is 500 — must be between 0 and 100/);
  });

  it("parses an authored dialogueRules list on an NPC, registering each entry's derived key and text", () => {
    const city = parseCity(
      files({
        locationFiles: { "locations/a.yaml": MINIMAL_LOCATION },
        world: `
npcs:
  - id: clerk
    locationId: a
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
    dialogueRules:
      - requires: [talkedTo.clerk]
        text: { en: Back again? }
`,
      }),
    );
    expect(city.npcs.clerk?.dialogueRules).toEqual([{ requires: ["talkedTo.clerk"], textKey: "npc.clerk.dialogue.0" }]);
    expect(city.derivedLocale.en?.["npc.clerk.dialogue.0"]).toBe("Back again?");
  });

  it("leaves an NPC's dialogueRules empty (not defaulted otherwise) when not authored", () => {
    const city = parseCity(
      files({
        locationFiles: { "locations/a.yaml": MINIMAL_LOCATION },
        world: `
npcs:
  - id: clerk
    locationId: a
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
`,
      }),
    );
    expect(city.npcs.clerk?.dialogueRules).toEqual([]);
  });

  describe("NPC labels, schedule, memories, and structured conditions", () => {
    const WORLD = `
labels:
  - id: worker
    text: { en: { name: Worker } }
    trustOffset: 1
    labelOpinions: { official: -1 }
  - id: official
    text: { en: { name: Official } }
npcs:
  - id: clerk
    locationId: a
    labels: [worker]
    trust: 2
    knowledge: { alibi: conceals }
    memories: ["player entered @a"]
    schedule:
      - { fromHour: 20, toHour: 6, locationId: a }
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
    dialogueRules:
      - when: { all: [{ hasLabel: worker }, { npcStat: trust, op: ">=", value: 2 }, { memory: { verb: entered, subject: player } }] }
        text: { en: Welcome back. }
`;
    const parse = (world: string) => parseCity(files({ locationFiles: { "locations/a.yaml": MINIMAL_LOCATION }, world }));

    it("parses labels, schedule, seeds initial NPC state, and keeps a `when`-only rule", () => {
      const city = parse(WORLD);
      expect(city.labels.worker).toEqual({ id: "worker", nameKey: "label.worker.name", trustOffset: 1, labelOpinions: { official: -1 } });
      expect(city.npcs.clerk?.labels).toEqual(["worker"]);
      expect(city.npcs.clerk?.schedule).toEqual([{ fromHour: 20, toHour: 6, locationId: "a" }]);
      expect(city.initialNpcStates.clerk).toMatchObject({ trust: 2, suspicion: 0, knowledge: { alibi: "conceals" } });
      expect(city.initialNpcStates.clerk?.memories).toEqual([
        { verb: "entered", subject: { kind: "player" }, locationId: "a", atMinutes: 0, source: "inferred", valence: 0 },
      ]);
      expect(city.npcs.clerk?.dialogueRules[0]?.requires).toEqual([]);
      expect(city.npcs.clerk?.dialogueRules[0]?.when).toHaveProperty("all");
    });

    it("defaults an NPC with nothing authored to no labels, no schedule, and a blank initial state", () => {
      const city = parse(`
npcs:
  - id: clerk
    locationId: a
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
`);
      expect(city.npcs.clerk?.labels).toEqual([]);
      expect(city.npcs.clerk?.schedule).toBeUndefined();
      expect(city.initialNpcStates.clerk).toEqual({ trust: 0, suspicion: 0, memories: [], opinions: {}, knowledge: {} });
    });

    it.each([
      ["an unknown label on an NPC", WORLD.replace("labels: [worker]", "labels: [ghost]"), /label "ghost", which has no entry in labels/],
      ["a schedule slot at an unknown location", WORLD.replace("locationId: a }", "locationId: nowhere }"), /schedule slot at locationId "nowhere"/],
      ["an out-of-range schedule hour", WORLD.replace("fromHour: 20", "fromHour: 30"), /fromHour must be an integer 0-23/],
      ["a malformed memory", WORLD.replace('"player entered @a"', '"player frobnicated"'), /unknown verb "frobnicated"/],
      ["an unknown knowledge disposition", WORLD.replace("conceals", "shrugs"), /knowledge\.alibi must be one of/],
      ["an unknown label in labelOpinions", WORLD.replace("official: -1", "ghost: -1"), /labelOpinions for "ghost"/],
      ["a bad condition operator", WORLD.replace('op: ">="', 'op: "~"'), /\.op must be one of/],
      ["a hasLabel condition naming an unknown label", WORLD.replace("hasLabel: worker", "hasLabel: ghost"), /references label "ghost"/],
    ])("rejects %s", (_name, world, message) => {
      expect(() => parse(world)).toThrow(message);
    });

    const WITH_EFFECTS = WORLD.replace(
      "        text: { en: Welcome back. }",
      `        effects:
          - trust: 1
          - suspicion: -1
          - opinion: { subject: "npc:x", delta: 2 }
          - reputation: { scope: worker, delta: 1 }
          - setFlag: greeted
          - knowledge: { fact: alibi, disposition: knows }
          - memory: "player entered @a"
        text: { en: Welcome back. }`,
    );

    it("parses every dialogue effect kind", () => {
      const effects = parse(WITH_EFFECTS).npcs.clerk?.dialogueRules[0]?.effects;
      expect(effects).toEqual([
        { trust: 1 },
        { suspicion: -1 },
        { opinion: { subject: "npc:x", delta: 2 } },
        { reputation: { scope: "worker", delta: 1 } },
        { setFlag: "greeted" },
        { knowledge: { fact: "alibi", disposition: "knows" } },
        { memory: { verb: "entered", subject: { kind: "player" }, locationId: "a" } },
      ]);
    });

    it.each([
      ["an unknown effect", WITH_EFFECTS.replace("- setFlag: greeted", "- teleport: a"), /unknown effect "teleport"/],
      ["an effect with two keys", WITH_EFFECTS.replace("- trust: 1", "- { trust: 1, suspicion: 1 }"), /exactly one of/],
      ["a reputation effect on an unknown scope", WITH_EFFECTS.replace("scope: worker", "scope: ghost"), /reputation scope "ghost"/],
      ["a malformed memory effect", WITH_EFFECTS.replace('memory: "player entered @a"', 'memory: "player frobnicated"'), /unknown verb "frobnicated"/],
      ["a memory effect at an unknown location", WITH_EFFECTS.replace('memory: "player entered @a"', 'memory: "player entered @nowhere"'), /memory at locationId "nowhere"/],
      ["a bad knowledge disposition", WITH_EFFECTS.replace("disposition: knows", "disposition: shrugs"), /knowledge\.disposition must be one of/],
    ])("rejects %s", (_name, world, message) => {
      expect(() => parse(world)).toThrow(message);
    });
  });

  describe("NPC topics", () => {
    const WORLD_WITH_TOPICS = `
labels:
  - id: worker
    text: { en: { name: Worker } }
npcs:
  - id: clerk
    locationId: a
    labels: [worker]
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
    topics:
      - id: rumor
        text: { en: { label: the rumor, dialogue: Nothing to say yet. } }
        when: { hasLabel: worker }
        responses:
          - when: { npcStat: trust, op: ">=", value: 2 }
            effects:
              - setFlag: heardRumor
              - reputation: { scope: worker, delta: 1 }
              - memory: "player entered @a"
            text: { en: "Fine, I'll tell you." }
      - id: herself
        text: { en: { label: the clerk, dialogue: Just a clerk. } }
`;
    const parse = (world: string) => parseCity(files({ locationFiles: { "locations/a.yaml": MINIMAL_LOCATION }, world }));

    it("parses a topics list on an NPC, registering label/dialogue keys and nested response keys", () => {
      const city = parse(WORLD_WITH_TOPICS);
      const topics = city.npcs.clerk?.topics;
      expect(topics).toHaveLength(2);

      const rumor = topics?.find((t) => t.id === "rumor");
      expect(rumor).toMatchObject({ id: "rumor", labelKey: "npc.clerk.topic.rumor.label", textKey: "npc.clerk.topic.rumor.dialogue", requires: [] });
      expect(rumor?.when).toEqual({ hasLabel: "worker" });
      expect(rumor?.responses).toEqual([
        {
          requires: [],
          when: { npcStat: "trust", op: ">=", value: 2 },
          textKey: "npc.clerk.topic.rumor.response.0",
          effects: [{ setFlag: "heardRumor" }, { reputation: { scope: "worker", delta: 1 } }, { memory: { verb: "entered", subject: { kind: "player" }, locationId: "a" } }],
        },
      ]);

      const herself = topics?.find((t) => t.id === "herself");
      expect(herself).toMatchObject({ id: "herself", labelKey: "npc.clerk.topic.herself.label", textKey: "npc.clerk.topic.herself.dialogue", requires: [], responses: [] });
      expect(herself?.when).toBeUndefined();

      expect(city.derivedLocale.en?.["npc.clerk.topic.rumor.label"]).toBe("the rumor");
      expect(city.derivedLocale.en?.["npc.clerk.topic.rumor.dialogue"]).toBe("Nothing to say yet.");
      expect(city.derivedLocale.en?.["npc.clerk.topic.rumor.response.0"]).toBe("Fine, I'll tell you.");
    });

    it("leaves an NPC's topics undefined (not defaulted to an empty list) when not authored", () => {
      const city = parse(`
npcs:
  - id: clerk
    locationId: a
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
`);
      expect(city.npcs.clerk?.topics).toBeUndefined();
    });

    it.each([
      ["a topic when referencing an unknown label", WORLD_WITH_TOPICS.replace("hasLabel: worker", "hasLabel: ghost"), /topic "rumor" references label "ghost"/],
      [
        "a topic response effect on an unknown reputation scope",
        WORLD_WITH_TOPICS.replace("scope: worker, delta: 1", "scope: ghost, delta: 1"),
        /topic "rumor" response effect references reputation scope "ghost"/,
      ],
      [
        "a topic response memory effect at an unknown location",
        WORLD_WITH_TOPICS.replace('memory: "player entered @a"', 'memory: "player entered @nowhere"'),
        /topic "rumor" response effect has a memory at locationId "nowhere"/,
      ],
      ["a topic missing its text block", WORLD_WITH_TOPICS.replace("text: { en: { label: the rumor, dialogue: Nothing to say yet. } }", ""), /topics\[0\].text" is required/],
      [
        "a topic response missing its text block",
        WORLD_WITH_TOPICS.replace('text: { en: "Fine, I\'ll tell you." }', ""),
        /topics\[0\]\.responses\[0\]\.text is not a mapping/,
      ],
    ])("rejects %s", (_name, world, message) => {
      expect(() => parse(world)).toThrow(message);
    });
  });

  describe("facts", () => {
    const WORLD_WITH_FACTS = `
facts:
  - id: courier
    text: { en: A courier in a grey coat dropped the ledger. }
npcs:
  - id: clerk
    locationId: a
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
    dialogueRules:
      - when: { playerKnows: courier }
        effects:
          - learnFact: courier
        text: { en: You already know. }
`;
    const parse = (world: string) => parseCity(files({ locationFiles: { "locations/a.yaml": MINIMAL_LOCATION }, world }));

    it("parses a facts: list, registering fact.<id> keys and a playerKnows/learnFact reference", () => {
      const city = parse(WORLD_WITH_FACTS);
      expect(city.facts.courier).toEqual({ id: "courier", textKey: "fact.courier" });
      expect(city.derivedLocale.en?.["fact.courier"]).toBe("A courier in a grey coat dropped the ledger.");
      expect(city.npcs.clerk?.dialogueRules[0]?.when).toEqual({ playerKnows: "courier" });
      expect(city.npcs.clerk?.dialogueRules[0]?.effects).toEqual([{ learnFact: "courier" }]);
    });

    it("leaves facts empty (not defaulted otherwise) when not authored", () => {
      const city = parse(`
npcs:
  - id: clerk
    locationId: a
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
`);
      expect(city.facts).toEqual({});
    });

    it.each([
      [
        "a learnFact effect referencing an undeclared fact",
        WORLD_WITH_FACTS.replace("learnFact: courier", "learnFact: ghost"),
        /dialogue effect references fact "ghost", which has no entry in facts/,
      ],
      [
        "a playerKnows condition referencing an undeclared fact",
        WORLD_WITH_FACTS.replace("playerKnows: courier", "playerKnows: ghost"),
        /dialogue rule references fact "ghost", which has no entry in facts/,
      ],
    ])("rejects %s", (_name, world, message) => {
      expect(() => parse(world)).toThrow(message);
    });
  });

  it("rejects a dialogueRules entry with an empty requires list", () => {
    expect(() =>
      parseCity(
        files({
          locationFiles: { "locations/a.yaml": MINIMAL_LOCATION },
          world: `
npcs:
  - id: clerk
    locationId: a
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
    dialogueRules:
      - requires: []
        text: { en: Hello again. }
`,
        }),
      ),
    ).toThrow(/dialogueRules\[0\]\.requires must be a non-empty list/);
  });

  it("rejects a dialogueRules entry missing its text block", () => {
    expect(() =>
      parseCity(
        files({
          locationFiles: { "locations/a.yaml": MINIMAL_LOCATION },
          world: `
npcs:
  - id: clerk
    locationId: a
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
    dialogueRules:
      - requires: [someFlag]
`,
        }),
      ),
    ).toThrow(/dialogueRules\[0\]\.text is not a mapping/);
  });

  it("rejects an object listed in a location's itemIds AND given a containerId — mutually exclusive placement", () => {
    expect(() =>
      parseCity(
        files({
          locationFiles: {
            "locations/a.yaml": `
- id: a
  kind: exterior
  itemIds: [photo]
  text: { en: { name: A, description: A. } }
`,
          },
          objectFiles: {
            "objects/desk.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text: { en: { name: the desk, description: A desk. } }
  parts:
    - id: drawer
      defaultStateId: closed
      text: { en: { name: the drawer, description: A drawer. } }
      states:
        - id: closed
          text: { en: { name: closed, description: Closed. } }
- id: photo
  kind: item
  portable: true
  containerId: desk
  containerPartId: drawer
  text: { en: { name: a photo, description: A photo. } }
`,
          },
        }),
      ),
    ).toThrow(/an object must be placed at a location OR inside a container, not both/);
  });

  it("rejects a circular containment chain", () => {
    expect(() =>
      parseCity(
        files({
          objectFiles: {
            "objects/boxes.yaml": `
- id: box-a
  kind: item
  portable: false
  containerId: box-b
  containerPartId: slot
  text: { en: { name: box A, description: Box A. } }
  parts:
    - id: slot
      defaultStateId: idle
      text: { en: { name: the slot, description: A slot. } }
      states:
        - id: idle
          text: { en: { name: idle, description: Idle. } }
- id: box-b
  kind: item
  portable: false
  containerId: box-a
  containerPartId: slot
  text: { en: { name: box B, description: Box B. } }
  parts:
    - id: slot
      defaultStateId: idle
      text: { en: { name: the slot, description: A slot. } }
      states:
        - id: idle
          text: { en: { name: idle, description: Idle. } }
`,
          },
        }),
      ),
    ).toThrow(/circular containment/);
  });

  it("parses npcs from world.yaml, still validating their referential integrity", () => {
    expect(() =>
      parseCity(
        files({
          world: `
npcs:
  - id: clerk
    locationId: nonexistent
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
`,
        }),
      ),
    ).toThrow(/npc "clerk" has locationId "nonexistent", which doesn't exist/);
  });

  it("treats an empty file, and a wholly absent world.yaml section, as simply nothing to add", () => {
    const city = parseCity(files({ objectFiles: { "objects/empty.yaml": "" }, world: "" }));
    expect(city.worldObjects).toEqual({});
    expect(city.npcs).toEqual({});
  });
});

describe("location image", () => {
  const withImage = (image: string) =>
    files({
      locationFiles: {
        "locations/a.yaml": `
- id: a
  kind: exterior
  text: { en: { name: A, description: Location A. } }
  image:
${image}
`,
      },
    });

  it("parses an image block, deriving alt/label locale keys", () => {
    const city = parseCity(
      withImage(`    src: a.webp
    text: { en: { alt: A picture of A. } }
    hotspots:
      - text: { en: { label: Look around } }
        command: look
        rect: [10, 20, 30, 40]`),
    );
    expect(city.locations.a!.image).toEqual({
      src: "a.webp",
      altKey: "location.a.image.alt",
      hotspots: [{ labelKey: "location.a.image.hotspot0.label", command: "look", x: 10, y: 20, w: 30, h: 40 }],
    });
    expect(city.derivedLocale.en!["location.a.image.alt"]).toBe("A picture of A.");
    expect(city.derivedLocale.en!["location.a.image.hotspot0.label"]).toBe("Look around");
  });

  it("allows an image with no hotspots, and locations without an image", () => {
    const city = parseCity(withImage(`    src: a.webp\n    text: { en: { alt: Alt. } }`));
    expect(city.locations.a!.image!.hotspots).toEqual([]);
    const plain = parseCity(files({ locationFiles: { "locations/a.yaml": MINIMAL_LOCATION } }));
    expect(plain.locations.a!.image).toBeUndefined();
  });

  it("rejects missing alt text, a rect outside 0-100, a wrong-length rect, and an empty command", () => {
    expect(() => parseCity(withImage(`    src: a.webp`))).toThrow(/image\.text/);
    const bad = (rect: string, command = "look") =>
      withImage(`    src: a.webp
    text: { en: { alt: Alt. } }
    hotspots:
      - text: { en: { label: L } }
        command: "${command}"
        rect: ${rect}`);
    expect(() => parseCity(bad("[90, 0, 20, 10]"))).toThrow(/within 0-100/);
    expect(() => parseCity(bad("[10, 10, 0, 10]"))).toThrow(/within 0-100/);
    expect(() => parseCity(bad("[1, 2, 3]"))).toThrow(/four numbers/);
    expect(() => parseCity(bad("[1, 1, 5, 5]", " "))).toThrow(/command/);
  });
});

describe("object / part-state / NPC images", () => {
  // Single-line flow mapping, so it slots in at any indentation.
  const IMG = (src: string, alt: string) =>
    `image: { src: ${src}, text: { en: { alt: ${alt} } }, hotspots: [{ text: { en: { label: Open it } }, command: open drawer, rect: [10, 10, 20, 20] }] }`;

  it("parses images on an object, one of its part states, and an NPC, deriving prefixed locale keys", () => {
    const city = parseCity(
      files({
        locationFiles: { "locations/a.yaml": MINIMAL_LOCATION },
        objectFiles: {
          "objects/desk.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text: { en: { name: the desk, description: A desk. } }
  ${IMG("desk.webp", "A desk.")}
  parts:
    - id: drawer
      defaultStateId: closed
      text: { en: { name: the drawer, description: A drawer. } }
      states:
        - id: closed
          text: { en: { name: closed, description: Closed. } }
          ${IMG("drawer-closed.webp", "Closed drawer.")}
`,
        },
        world: `
npcs:
  - id: clerk
    locationId: a
    text: { en: { name: the clerk, description: A clerk., dialogue: Hi. } }
    ${IMG("clerk.webp", "A clerk.")}
`,
      }),
    );
    expect(city.worldObjects.desk!.image).toMatchObject({ src: "desk.webp", altKey: "setpiece.desk.image.alt" });
    expect(city.worldObjects.desk!.parts![0]!.states[0]!.image).toMatchObject({
      src: "drawer-closed.webp",
      altKey: "setpiece.desk.drawer.closed.image.alt",
    });
    expect(city.npcs.clerk!.image).toMatchObject({ src: "clerk.webp", altKey: "npc.clerk.image.alt" });
    expect(city.derivedLocale.en!["setpiece.desk.drawer.closed.image.hotspot0.label"]).toBe("Open it");
    expect(city.derivedLocale.en!["npc.clerk.image.alt"]).toBe("A clerk.");
  });

  it("rejects an object image missing alt text", () => {
    expect(() =>
      parseCity(
        files({
          objectFiles: {
            "objects/desk.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text: { en: { name: the desk, description: A desk. } }
  image: { src: desk.webp }
`,
          },
        }),
      ),
    ).toThrow(/image\.text/);
  });
});

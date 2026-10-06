import { describe, expect, it } from "vitest";
import { parsePrefabs } from "./prefabLoader";
import type { PrefabSourceFiles } from "./prefabLoader";

function files(overrides: Partial<PrefabSourceFiles> = {}): PrefabSourceFiles {
  return { prefabFiles: {}, ...overrides };
}

const MINIMAL_PREFAB = `
- id: generic-alley
  kind: exterior
  aliases: [alley]
  text:
    en:
      name: a narrow alley
      description: A narrow, rain-slicked alley.
  worldObjectIds: [crate]
  npcIds: [dock-worker]
`;

describe("parsePrefabs", () => {
  it("parses prefabs into typed, id-keyed records when their references exist in the known catalog", () => {
    const content = parsePrefabs(files({ prefabFiles: { "alley.yaml": MINIMAL_PREFAB } }), new Set(["crate"]), new Set(["dock-worker"]));
    expect(Object.keys(content.prefabs)).toEqual(["generic-alley"]);
    expect(content.prefabs["generic-alley"]).toMatchObject({
      id: "generic-alley",
      kind: "exterior",
      aliases: ["alley"],
      nameKey: "prefab.generic-alley.name",
      descriptionKey: "prefab.generic-alley.description",
      worldObjectIds: ["crate"],
      npcIds: ["dock-worker"],
    });
    expect(content.derivedLocale.en?.["prefab.generic-alley.name"]).toBe("a narrow alley");
  });

  it("merges prefabs split across multiple files", () => {
    const content = parsePrefabs(
      files({
        prefabFiles: {
          "a.yaml": `
- id: a
  kind: exterior
  text: { en: { name: A, description: Prefab A. } }
`,
          "b.yaml": `
- id: b
  kind: interior
  text: { en: { name: B, description: Prefab B. } }
`,
        },
      }),
      new Set(),
      new Set(),
    );
    expect(Object.keys(content.prefabs).sort()).toEqual(["a", "b"]);
  });

  it("defaults worldObjectIds/npcIds/aliases to empty arrays when omitted", () => {
    const content = parsePrefabs(
      files({ prefabFiles: { "a.yaml": "- id: a\n  kind: exterior\n  text: { en: { name: A, description: A prefab. } }\n" } }),
      new Set(),
      new Set(),
    );
    expect(content.prefabs.a).toMatchObject({ aliases: [], worldObjectIds: [], npcIds: [] });
  });

  it("rejects a worldObjectIds reference that isn't in the known catalog", () => {
    expect(() => parsePrefabs(files({ prefabFiles: { "a.yaml": MINIMAL_PREFAB } }), new Set(), new Set(["dock-worker"]))).toThrow(
      /worldObjectIds references "crate", which has no entry/,
    );
  });

  it("rejects an npcIds reference that isn't in the known catalog", () => {
    expect(() => parsePrefabs(files({ prefabFiles: { "a.yaml": MINIMAL_PREFAB } }), new Set(["crate"]), new Set())).toThrow(
      /npcIds references "dock-worker", which has no entry/,
    );
  });

  it("rejects an invalid kind", () => {
    expect(() =>
      parsePrefabs(
        files({ prefabFiles: { "a.yaml": "- id: a\n  kind: bogus\n  text: { en: { name: A, description: A prefab. } }\n" } }),
        new Set(),
        new Set(),
      ),
    ).toThrow(/kind is "bogus"/);
  });

  it("rejects missing required text", () => {
    expect(() => parsePrefabs(files({ prefabFiles: { "a.yaml": "- id: a\n  kind: exterior\n" } }), new Set(), new Set())).toThrow(
      /"a\.yaml\[0\]\.text" is required/,
    );
  });

  it("reports a duplicate id across files as one aggregated error, tagged by source file", () => {
    expect(() =>
      parsePrefabs(
        files({
          prefabFiles: {
            "a.yaml": "- id: dup\n  kind: exterior\n  text: { en: { name: A, description: A. } }\n",
            "b.yaml": "- id: dup\n  kind: exterior\n  text: { en: { name: B, description: B. } }\n",
          },
        }),
        new Set(),
        new Set(),
      ),
    ).toThrow(/more than one entry with id "dup"/);
  });
});

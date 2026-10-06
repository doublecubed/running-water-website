import { describe, expect, it, vi } from "vitest";

/**
 * Exercises the editor's Connect, Move, and Add-location flows end-to-end
 * against the real module (not a re-implementation of its logic), with
 * File System Access and window.prompt mocked out — the only two browser
 * APIs the editor needs beyond plain DOM. Guards the bugs found while
 * diagnosing "Connect does nothing": node dragging competing with node
 * clicks in every other mode (fixed by moving dragging behind its own
 * explicit "Move" mode, off by default — see setMoveMode in main.ts), and
 * MapView's click-vs-drag pointer-movement threshold being too tight for
 * a real mouse (fixed by raising CLICK_MOVEMENT_THRESHOLD_PX — see
 * MapView.ts). Also covers the directory-based project open (world.yaml +
 * locations/objects directories together), the sidebar Add-location form,
 * and the per-file dirty-write Save behavior — see docs/content-schema.md
 * and this module's own doc comment.
 */

const WORLD_YAML = "npcs: []\ntransitLines: []\npasses: []\n";

const LOCATIONS_A_YAML = `
- id: a
  kind: exterior
  aliases: [a]
  connections: []
  x: 0
  'y': 0
  text:
    en:
      name: A
      description: Location A.
`;

const LOCATIONS_B_YAML = `
- id: b
  kind: exterior
  aliases: [b]
  connections: []
  x: 100
  'y': 0
  text:
    en:
      name: B
      description: Location B.
`;

const LOCATIONS_WITH_CONNECTION_YAML = `
- id: a
  kind: exterior
  aliases: [a]
  connections:
    - toId: b
      distanceKm: 1
      modes: [foot]
  x: 0
  'y': 0
  text:
    en:
      name: A
      description: Location A.
- id: b
  kind: exterior
  aliases: [b]
  connections: []
  x: 100
  'y': 0
  text:
    en:
      name: B
      description: Location B.
`;

const LOCATIONS_WITH_TWO_CONNECTIONS_YAML = `
- id: a
  kind: exterior
  aliases: [a]
  connections:
    - toId: b
      distanceKm: 1
      modes: [foot]
    - toId: b
      distanceKm: 1
      modes: [taxi]
  x: 0
  'y': 0
  text:
    en:
      name: A
      description: Location A.
- id: b
  kind: exterior
  aliases: [b]
  connections: []
  x: 100
  'y': 0
  text:
    en:
      name: B
      description: Location B.
`;

const LOCATIONS_WITH_TWO_WAY_CONNECTION_YAML = `
- id: a
  kind: exterior
  aliases: [a]
  connections:
    - toId: b
      distanceKm: 1
      modes: [foot]
  x: 0
  'y': 0
  text:
    en:
      name: A
      description: Location A.
- id: b
  kind: exterior
  aliases: [b]
  connections:
    - toId: a
      distanceKm: 1
      modes: [foot]
  x: 100
  'y': 0
  text:
    en:
      name: B
      description: Location B.
`;

const LOCATIONS_WITH_INTERIOR_YAML = `
- id: a
  kind: exterior
  aliases: [a]
  connections: []
  x: 0
  'y': 0
  text:
    en:
      name: A
      description: Location A.
- id: b
  kind: exterior
  aliases: [b]
  connections: []
  x: 100
  'y': 0
  text:
    en:
      name: B
      description: Location B.
- id: lobby
  kind: interior
  exteriorId: a
  aliases: [lobby]
  connections: []
  x: 0
  'y': 50
  text:
    en:
      name: Lobby
      description: A small lobby.
`;

function pointer(type: string, opts: { clientX: number; clientY: number }): Event {
  return new MouseEvent(type, { clientX: opts.clientX, clientY: opts.clientY, bubbles: true });
}

function findButton(label: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === label);
  if (!btn) throw new Error(`no button labeled "${label}"`);
  return btn as HTMLButtonElement;
}

/** A fake FileSystemFileHandle backed by an in-memory string — good enough for main.ts, which only ever calls getFile().text() and createWritable().write(...). Not `new File(...)`: jsdom's File has no `.text()`. */
function makeFileHandle(name: string, initialText: string): FileSystemFileHandle & { writtenText: string | null } {
  const state = { text: initialText, writtenText: null as string | null };
  const handle = {
    kind: "file" as const,
    name,
    getFile: async () => ({ name, text: async () => state.text }) as unknown as File,
    createWritable: async () => ({
      write: async (data: string | BufferSource | Blob) => {
        state.writtenText = data as string;
      },
      close: async () => {},
    }),
    get writtenText() {
      return state.writtenText;
    },
  };
  return handle as unknown as FileSystemFileHandle & { writtenText: string | null };
}

function makeDirHandle(name: string, children: Record<string, FileSystemFileHandle | FileSystemDirectoryHandle>): FileSystemDirectoryHandle {
  return {
    kind: "directory" as const,
    name,
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      const child = children[fileName];
      if (!child || child.kind !== "file") {
        if (options?.create) {
          const created = makeFileHandle(fileName, "");
          children[fileName] = created;
          return created;
        }
        throw new Error(`no such file: ${fileName}`);
      }
      return child;
    },
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      const child = children[dirName];
      if (!child || child.kind !== "directory") {
        if (options?.create) {
          const created = makeDirHandle(dirName, {});
          children[dirName] = created;
          return created;
        }
        throw new Error(`no such directory: ${dirName}`);
      }
      return child;
    },
    entries: () => {
      const iterator = Object.entries(children)[Symbol.iterator]();
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next: async () => iterator.next(),
      };
    },
  } as unknown as FileSystemDirectoryHandle;
}

function makeProjectRoot(
  opts: {
    worldYaml?: string;
    locationFiles?: Record<string, string>;
    objectFiles?: Record<string, string>;
    prefabFiles?: Record<string, string>;
  } = {},
) {
  const worldFile = makeFileHandle("world.yaml", opts.worldYaml ?? WORLD_YAML);
  const locationFiles = opts.locationFiles ?? { "a.yaml": LOCATIONS_A_YAML, "b.yaml": LOCATIONS_B_YAML };
  const locationFileHandles: Record<string, FileSystemFileHandle> = {};
  for (const [name, text] of Object.entries(locationFiles)) locationFileHandles[name] = makeFileHandle(name, text);
  const objectFiles = opts.objectFiles ?? {};
  const objectFileHandles: Record<string, FileSystemFileHandle> = {};
  for (const [name, text] of Object.entries(objectFiles)) objectFileHandles[name] = makeFileHandle(name, text);
  const prefabFiles = opts.prefabFiles ?? {};
  const prefabFileHandles: Record<string, FileSystemFileHandle> = {};
  for (const [name, text] of Object.entries(prefabFiles)) prefabFileHandles[name] = makeFileHandle(name, text);

  const cityDir = makeDirHandle("city", {
    "world.yaml": worldFile,
    locations: makeDirHandle("locations", locationFileHandles),
    objects: makeDirHandle("objects", objectFileHandles),
  });
  // `prefabs/` is a sibling of `city/`, not nested under it — see
  // `content/prefabLoader.ts`'s doc comment — and (like the real editor's
  // auto-create-if-missing behavior) is included here even when no test
  // passes `prefabFiles`, so the "no such directory: prefabs" case is
  // never exercised by a fixture that didn't explicitly opt into it.
  const contentDir = makeDirHandle("content", { city: cityDir, prefabs: makeDirHandle("prefabs", prefabFileHandles) });
  const srcDir = makeDirHandle("src", { content: contentDir });
  const root = makeDirHandle("project", { src: srcDir });
  return { root, worldFile, locationFileHandles, objectFileHandles, prefabFileHandles };
}

async function openEditorWithFixture(
  opts: {
    worldYaml?: string;
    locationFiles?: Record<string, string>;
    objectFiles?: Record<string, string>;
    prefabFiles?: Record<string, string>;
  } = {},
) {
  document.body.innerHTML = '<div id="editor-app"></div>';

  const project = makeProjectRoot(opts);
  (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = vi
    .fn()
    .mockResolvedValue(project.root);

  vi.resetModules();
  await import("./main");

  findButton("Open folder").click();
  // openProject is async (several nested directory/file reads); flush its microtasks.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  return project;
}

/** Clicks the node currently at `data-node-id="{id}"`, re-querying the DOM fresh (a real browser hit-tests whatever is live at the time, not a stale element handle — and `setSelectedNode` re-renders every node element on the first click of a connect gesture). `jitterPx` simulates the small pointer movement a real mouse produces even for a "stationary" click. */
function clickNode(svg: SVGSVGElement, id: string, baseX: number, baseY: number, jitterPx = 0): void {
  const el = svg.querySelector(`[data-node-id="${id}"]`)!;
  el.dispatchEvent(pointer("pointerdown", { clientX: baseX, clientY: baseY }));
  el.dispatchEvent(pointer("pointerup", { clientX: baseX + jitterPx, clientY: baseY }));
}

function stubRect(svg: SVGSVGElement): void {
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
}

describe("editor — opening a project", () => {
  it("loads every location file and world.yaml, and enables the mode buttons", async () => {
    await openEditorWithFixture();
    expect(findButton("Add location").disabled).toBe(false);
    expect(findButton("Save world").disabled).toBe(false);
    expect(document.querySelector("svg")!.querySelectorAll(".mapview__node")).toHaveLength(2);
  });

  it("refuses to open (with a clear notice) when a location's content is invalid", async () => {
    await openEditorWithFixture({ locationFiles: { "a.yaml": "- id: a\n  kind: exterior\n" } });
    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/Invalid city content/);
    expect(findButton("Add location").disabled).toBe(true);
    expect(findButton("Save world").disabled).toBe(true);
  });
});

describe("editor — Connect flow", () => {
  it("adds a rendered connection when clicking Connect, then two nodes, with zero pointer movement", async () => {
    await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    vi.spyOn(window, "prompt").mockImplementation((message?: string) => {
      if (message?.includes("distanceKm")) return "1";
      if (message?.includes("modes")) return "foot";
      return null;
    });

    findButton("Connect").click();
    clickNode(svg, "a", 10, 10);
    clickNode(svg, "b", 110, 10);

    expect(svg.querySelectorAll(".mapview__edge")).toHaveLength(1);
  });

  it("still registers the connect clicks despite a few pixels of pointer jitter between press and release", async () => {
    await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    vi.spyOn(window, "prompt").mockImplementation((message?: string) => {
      if (message?.includes("distanceKm")) return "1";
      if (message?.includes("modes")) return "foot";
      return null;
    });

    findButton("Connect").click();
    clickNode(svg, "a", 10, 10, 3);
    clickNode(svg, "b", 110, 10, 3);

    expect(svg.querySelectorAll(".mapview__edge")).toHaveLength(1);
  });

  it("skips the distanceKm/modes prompts entirely for a real interior hop, adding a flat 0.1km/foot connection", async () => {
    await openEditorWithFixture({ locationFiles: { "all.yaml": LOCATIONS_WITH_INTERIOR_YAML } });
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    const prompt = vi.spyOn(window, "prompt");

    findButton("Connect").click();
    clickNode(svg, "a", 0, 0);
    clickNode(svg, "lobby", 0, 50);

    expect(prompt).not.toHaveBeenCalled();
    expect(svg.querySelectorAll(".mapview__edge")).toHaveLength(1);
  });

  it("still prompts for distanceKm/modes for an exterior-exterior connection, even though one side has interiors", async () => {
    await openEditorWithFixture({ locationFiles: { "all.yaml": LOCATIONS_WITH_INTERIOR_YAML } });
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    const prompt = vi.spyOn(window, "prompt").mockImplementation((_message?: string, defaultText?: string) => defaultText ?? null);

    findButton("Connect").click();
    clickNode(svg, "a", 0, 0);
    clickNode(svg, "b", 100, 0);

    expect(prompt).toHaveBeenCalledWith("distanceKm:", "1");
  });

  it("still prompts for distanceKm/modes for an interior connecting to an unrelated (non-owning) exterior", async () => {
    await openEditorWithFixture({ locationFiles: { "all.yaml": LOCATIONS_WITH_INTERIOR_YAML } });
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    const prompt = vi.spyOn(window, "prompt").mockImplementation((_message?: string, defaultText?: string) => defaultText ?? null);

    findButton("Connect").click();
    clickNode(svg, "lobby", 0, 50);
    clickNode(svg, "b", 100, 0);

    expect(prompt).toHaveBeenCalledWith("distanceKm:", "1");
  });
});

describe("editor — two-way connections & grouped map lines", () => {
  it("Two-way (checked by default) authors the reverse Connection too", async () => {
    const project = await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    vi.spyOn(window, "prompt").mockImplementation((message?: string) => {
      if (message?.includes("distanceKm")) return "1";
      if (message?.includes("modes")) return "foot";
      return null;
    });

    findButton("Connect").click();
    clickNode(svg, "a", 10, 10);
    clickNode(svg, "b", 110, 10);

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect((project.locationFileHandles["a.yaml"] as unknown as { writtenText: string | null }).writtenText).toContain("toId: b");
    expect((project.locationFileHandles["b.yaml"] as unknown as { writtenText: string | null }).writtenText).toContain("toId: a");
  });

  it("unchecking Two-way authors only the forward Connection", async () => {
    const project = await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    vi.spyOn(window, "prompt").mockImplementation((message?: string) => {
      if (message?.includes("distanceKm")) return "1";
      if (message?.includes("modes")) return "foot";
      return null;
    });

    (document.querySelector("#editor-two-way-checkbox") as HTMLInputElement).click();
    findButton("Connect").click();
    clickNode(svg, "a", 10, 10);
    clickNode(svg, "b", 110, 10);

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect((project.locationFileHandles["a.yaml"] as unknown as { writtenText: string | null }).writtenText).toContain("toId: b");
    expect((project.locationFileHandles["b.yaml"] as unknown as { writtenText: string | null }).writtenText).toBeNull();
  });

  it("renders multiple Connections between the same pair (different modes) as a single edge", async () => {
    await openEditorWithFixture({ locationFiles: { "all.yaml": LOCATIONS_WITH_TWO_CONNECTIONS_YAML } });
    const svg = document.querySelector("svg")!;

    expect(svg.querySelectorAll(".mapview__edge")).toHaveLength(1);
  });

  it("curve-edit writes the dragged curve to every Connection in the pair's group", async () => {
    const project = await openEditorWithFixture({ locationFiles: { "all.yaml": LOCATIONS_WITH_TWO_WAY_CONNECTION_YAML } });
    const svg = document.querySelector("svg")!;
    stubRect(svg);

    findButton("Edit curve").click();
    const edge = svg.querySelector(".mapview__edge")!;
    edge.dispatchEvent(pointer("pointerdown", { clientX: 50, clientY: 0 }));
    edge.dispatchEvent(pointer("pointerup", { clientX: 50, clientY: 0 }));

    const handle = svg.querySelector(".mapview__curve-handle circle")!;
    handle.dispatchEvent(pointer("pointerdown", { clientX: 50, clientY: 0 }));
    svg.dispatchEvent(pointer("pointermove", { clientX: 50, clientY: 40 }));
    svg.dispatchEvent(pointer("pointerup", { clientX: 50, clientY: 40 }));

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const writtenA = (project.locationFileHandles["all.yaml"] as unknown as { writtenText: string | null }).writtenText;
    expect(writtenA).toContain("curve:");
    // Both directions' Connections live in the same file here, so one write covers both — the
    // point is that the SAME {cx,cy} landed on both, not just the one whose edge was clicked.
    const curveMatches = writtenA?.match(/cx: -?[\d.]+/g) ?? [];
    expect(curveMatches.length).toBe(2);
    expect(new Set(curveMatches).size).toBe(1);
  });
});

describe("editor — Move mode", () => {
  it("does not move a node when dragged with Move off", async () => {
    await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);

    const nodeA = svg.querySelector('[data-node-id="a"]')!;
    nodeA.dispatchEvent(pointer("pointerdown", { clientX: 10, clientY: 10 }));
    svg.dispatchEvent(pointer("pointermove", { clientX: 60, clientY: 10 }));
    svg.dispatchEvent(pointer("pointerup", { clientX: 60, clientY: 10 }));

    expect(svg.querySelector('[data-node-id="a"] circle')!.getAttribute("cx")).toBe("0");
  });

  it("moves a node when dragged with Move on", async () => {
    await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);

    findButton("Move").click();
    const nodeA = svg.querySelector('[data-node-id="a"]')!;
    nodeA.dispatchEvent(pointer("pointerdown", { clientX: 10, clientY: 10 }));
    svg.dispatchEvent(pointer("pointermove", { clientX: 60, clientY: 10 }));
    svg.dispatchEvent(pointer("pointerup", { clientX: 60, clientY: 10 }));

    expect(svg.querySelector('[data-node-id="a"] circle')!.getAttribute("cx")).not.toBe("0");
  });
});

describe("editor — Add location sidebar", () => {
  it("spawns a draft node and opens the sidebar when Add location is pressed", async () => {
    await openEditorWithFixture();
    findButton("Add location").click();

    expect(document.querySelector(".editor__sidebar")!.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector('[data-node-id="__draft__"]')).not.toBeNull();
  });

  it("commits the new location (with name text) into the map and clears the draft on Save location", async () => {
    await openEditorWithFixture();
    findButton("Add location").click();

    (document.querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "c";
    (document.querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "Charlie";
    findButtonIn(draftActions(), "Save").click();

    expect(document.querySelector('[data-node-id="c"]')).not.toBeNull();
    expect(document.querySelector('[data-node-id="__draft__"]')).toBeNull();
    expect(document.querySelector(".editor__sidebar")!.hasAttribute("hidden")).toBe(true);
  });

  it("discards the draft node and closes the sidebar on Cancel", async () => {
    await openEditorWithFixture();
    findButton("Add location").click();
    findButtonIn(draftActions(), "Cancel").click();

    expect(document.querySelector('[data-node-id="__draft__"]')).toBeNull();
    expect(document.querySelector(".editor__sidebar")!.hasAttribute("hidden")).toBe(true);
  });

  it("refuses to commit a duplicate id", async () => {
    await openEditorWithFixture();
    findButton("Add location").click();
    (document.querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "a";
    findButtonIn(draftActions(), "Save").click();

    // Still open — the draft node is still there, not committed as a second "a".
    expect(document.querySelector(".editor__sidebar")!.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector('[data-node-id="__draft__"]')).not.toBeNull();
  });
});

describe("editor — Edit location sidebar", () => {
  it("opens the sidebar pre-filled when clicking an existing node outside Connect mode", async () => {
    await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);

    clickNode(svg, "a", 10, 10);

    expect(document.querySelector(".editor__sidebar")!.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector(".editor__sidebar h2")!.textContent).toBe("Edit location");
    const idInput = document.querySelector('input[placeholder^="id"]') as HTMLInputElement;
    expect(idInput.value).toBe("a");
    expect(idInput.disabled).toBe(true);
    expect((document.querySelector('input[placeholder="Display name"]') as HTMLInputElement).value).toBe("A");
  });

  it("updates the location's name text and does not add a new node on Save location", async () => {
    await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);

    clickNode(svg, "a", 10, 10);
    (document.querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "Alleyway";
    findButtonIn(draftActions(), "Save").click();

    expect(svg.querySelectorAll(".mapview__node")).toHaveLength(2);
    expect(svg.querySelector('[data-node-id="a"] text')!.textContent).toBe("Alleyway");
    expect(document.querySelector(".editor__sidebar")!.hasAttribute("hidden")).toBe(true);
  });

  it("discards an in-progress edit (including a drag) on Cancel", async () => {
    await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);

    clickNode(svg, "a", 10, 10);
    const nodeA = svg.querySelector('[data-node-id="a"]')!;
    nodeA.dispatchEvent(pointer("pointerdown", { clientX: 10, clientY: 10 }));
    svg.dispatchEvent(pointer("pointermove", { clientX: 60, clientY: 10 }));
    svg.dispatchEvent(pointer("pointerup", { clientX: 60, clientY: 10 }));
    (document.querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "Alleyway";

    findButtonIn(draftActions(), "Cancel").click();

    expect(svg.querySelector('[data-node-id="a"] circle')!.getAttribute("cx")).toBe("0");
    expect(svg.querySelector('[data-node-id="a"] text')!.textContent).toBe("A");
  });

  it("does not open the edit sidebar for a node clicked while Connect mode is active", async () => {
    await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    vi.spyOn(window, "prompt").mockImplementation((message?: string) => {
      if (message?.includes("distanceKm")) return "1";
      if (message?.includes("modes")) return "foot";
      return null;
    });

    findButton("Connect").click();
    clickNode(svg, "a", 10, 10);

    expect(document.querySelector(".editor__sidebar")!.hasAttribute("hidden")).toBe(true);
  });
});

describe("editor — Remove location", () => {
  it("hides the Remove location button while adding a not-yet-committed location", async () => {
    await openEditorWithFixture();
    findButton("Add location").click();

    expect(findButton("Remove location").hidden).toBe(true);
  });

  it("shows the Remove location button when editing an existing location", async () => {
    await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    clickNode(svg, "a", 10, 10);

    expect(findButton("Remove location").hidden).toBe(false);
  });

  it("does nothing when the confirm dialog is dismissed", async () => {
    await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    clickNode(svg, "a", 10, 10);
    findButton("Remove location").click();

    expect(svg.querySelectorAll(".mapview__node")).toHaveLength(2);
    expect(document.querySelector(".editor__sidebar")!.hasAttribute("hidden")).toBe(false);
  });

  it("removes the location and strips incoming connections from other locations", async () => {
    await openEditorWithFixture({ locationFiles: { "all.yaml": LOCATIONS_WITH_CONNECTION_YAML } });
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    expect(svg.querySelectorAll(".mapview__edge")).toHaveLength(1);
    clickNode(svg, "b", 110, 10);
    findButton("Remove location").click();

    expect(document.querySelector('[data-node-id="b"]')).toBeNull();
    expect(svg.querySelectorAll(".mapview__edge")).toHaveLength(0);
    expect(document.querySelector(".editor__sidebar")!.hasAttribute("hidden")).toBe(true);
  });

  it("cascade-deletes interiors when removing their owning exterior", async () => {
    await openEditorWithFixture({ locationFiles: { "all.yaml": LOCATIONS_WITH_INTERIOR_YAML } });
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    clickNode(svg, "a", 0, 0);
    findButton("Remove location").click();

    expect(document.querySelector('[data-node-id="a"]')).toBeNull();
    expect(document.querySelector('[data-node-id="lobby"]')).toBeNull();
    expect(document.querySelector('[data-node-id="b"]')).not.toBeNull();
  });

  it("does not touch disk until the top-level Save button is clicked", async () => {
    const project = await openEditorWithFixture({ locationFiles: { "all.yaml": LOCATIONS_WITH_CONNECTION_YAML } });
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    clickNode(svg, "b", 110, 10);
    findButton("Remove location").click();

    expect((project.locationFileHandles["all.yaml"] as unknown as { writtenText: string | null }).writtenText).toBeNull();

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.locationFileHandles["all.yaml"] as unknown as { writtenText: string | null }).writtenText;
    expect(written).not.toContain("id: b");
    expect(written).not.toContain("toId: b");
  });
});

const OBJECTS_A_YAML = `
- id: case-file
  kind: item
  portable: true
  aliases: [case file]
  text:
    en:
      name: case file
      description: A thin folder of notes.
`;

/** Finds the `.editor__field` INSIDE `scope` whose `<label>` text is exactly `labelText`, and returns the label's sibling input/select/textarea — how every part/state field in the object editor is located, since (unlike the top-level object fields) they carry no distinguishing placeholder. */
function fieldByLabel(scope: ParentNode, labelText: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const label = Array.from(scope.querySelectorAll(".editor__field label")).find((l) => l.textContent === labelText);
  if (!label) throw new Error(`no field labeled "${labelText}" in scope`);
  return label.nextElementSibling as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}

function objectSidebar(): HTMLElement {
  return document.querySelector(".editor__sidebar--object")!;
}

/** Sets an input/textarea's value AND dispatches "input", the way a real keystroke would — needed for every part/state field, which (unlike the top-level object fields, re-read from the DOM directly at Save-click time) are only kept in sync with the draft via their own "input" listener. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Same as `findButton`, but scoped to `scope` — needed for "Cancel", which both sidebars use verbatim (only one is ever actually visible, but both exist in the DOM at once, so an unscoped `findButton` would always hit the location sidebar's copy first). */
function findButtonIn(scope: ParentNode, label: string): HTMLButtonElement {
  const btn = Array.from(scope.querySelectorAll("button")).find((b) => b.textContent === label);
  if (!btn) throw new Error(`no button labeled "${label}" in scope`);
  return btn as HTMLButtonElement;
}

describe("editor — Objects tab", () => {
  it("switches panels and enables Add object once a project is loaded", async () => {
    await openEditorWithFixture();
    expect(findButton("Add object").hidden).toBe(true);

    findButton("Objects").click();

    expect(findButton("Add object").hidden).toBe(false);
    expect(findButton("Add object").disabled).toBe(false);
    expect(document.querySelector(".editor__object-list")!.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector(".editor__map")!.hasAttribute("hidden")).toBe(true);
  });

  it("lists an existing world object loaded from an objects file", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML } });
    findButton("Objects").click();

    const row = document.querySelector(".editor__object-list-item")!;
    expect(row.textContent).toContain("case-file");
    expect(row.textContent).toContain("case file");
  });

  it("hides the object list panel and inspector again after switching back to Locations", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML } });
    findButton("Objects").click();
    expect(objectSidebar().hasAttribute("hidden")).toBe(false);

    findButton("Locations").click();

    expect(document.querySelector(".editor__object-list-panel")!.hasAttribute("hidden")).toBe(true);
    expect(objectSidebar().hasAttribute("hidden")).toBe(true);
    expect(document.querySelector(".editor__map")!.hasAttribute("hidden")).toBe(false);
  });

  it("shows the inspector's empty-state placeholder, not the form, until an object is picked", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML } });
    findButton("Objects").click();

    expect(objectSidebar().hasAttribute("hidden")).toBe(false);
    expect(objectSidebar().querySelector(".editor__inspector-placeholder")!.hasAttribute("hidden")).toBe(false);
    expect(objectSidebar().querySelector(".editor__inspector-form")!.hasAttribute("hidden")).toBe(true);
  });

  it("filters the object list by id or display name as you type in the search box", async () => {
    await openEditorWithFixture({
      objectFiles: {
        "case.yaml": OBJECTS_A_YAML,
        "lighter.yaml": `
- id: lighter
  kind: item
  portable: true
  aliases: [lighter]
  text:
    en:
      name: brass lighter
      description: An engraved lighter.
`,
      },
    });
    findButton("Objects").click();
    expect(document.querySelectorAll(".editor__object-list-item")).toHaveLength(2);

    const search = document.querySelector(".editor__object-search") as HTMLInputElement;
    setValue(search, "brass");
    expect(document.querySelectorAll(".editor__object-list-item")).toHaveLength(1);
    expect(document.querySelector(".editor__object-list-item")!.textContent).toContain("lighter");

    setValue(search, "case-file");
    expect(document.querySelectorAll(".editor__object-list-item")).toHaveLength(1);
    expect(document.querySelector(".editor__object-list-item")!.textContent).toContain("case-file");

    setValue(search, "nothing matches this");
    expect(document.querySelectorAll(".editor__object-list-item")).toHaveLength(0);
    expect(document.querySelector(".editor__object-list")!.textContent).toMatch(/no objects match/i);
  });

  it("badges a placed object and filters the list by placement status", async () => {
    await openEditorWithFixture({
      locationFiles: {
        "a.yaml": `
- id: a
  kind: exterior
  aliases: [a]
  connections: []
  x: 0
  'y': 0
  itemIds: [case-file]
  text:
    en:
      name: A
      description: Location A.
`,
      },
      objectFiles: {
        "case.yaml": OBJECTS_A_YAML,
        "lighter.yaml": `
- id: lighter
  kind: item
  portable: true
  aliases: [lighter]
  text:
    en:
      name: brass lighter
      description: An engraved lighter.
`,
      },
    });
    findButton("Objects").click();

    const rows = () => Array.from(document.querySelectorAll<HTMLButtonElement>(".editor__object-list-item"));
    expect(rows()).toHaveLength(2);
    const placedRow = rows().find((r) => r.textContent?.includes("case-file"))!;
    const storageRow = rows().find((r) => r.textContent?.includes("lighter"))!;
    expect(placedRow.querySelector(".editor__object-placed-badge")).not.toBeNull();
    expect(storageRow.querySelector(".editor__object-placed-badge")).toBeNull();

    const filter = document.querySelector(".editor__object-placement-filter") as HTMLSelectElement;
    const setFilter = (value: string) => {
      filter.value = value;
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    };

    setFilter("placed");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain("case-file");

    setFilter("storage");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain("lighter");

    setFilter("all");
    expect(rows()).toHaveLength(2);
  });
});

describe("editor — Add object sidebar", () => {
  it("opens the object sidebar on Add object", async () => {
    await openEditorWithFixture();
    findButton("Objects").click();
    findButton("Add object").click();

    expect(objectSidebar().hasAttribute("hidden")).toBe(false);
    expect(objectSidebar().querySelector("h2")!.textContent).toBe("Add object");
  });

  it("commits a new item into the object list on Save object", async () => {
    await openEditorWithFixture();
    findButton("Objects").click();
    findButton("Add object").click();

    (objectSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "lighter";
    (objectSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "brass lighter";
    (objectSidebar().querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value = "An engraved lighter.";
    findButtonIn(draftActions(), "Save").click();

    expect(objectSidebar().querySelector(".editor__inspector-form")!.hasAttribute("hidden")).toBe(true);
    const row = document.querySelector(".editor__object-list-item")!;
    expect(row.textContent).toContain("lighter");
    expect(row.textContent).toContain("brass lighter");
  });

  it("refuses to commit a duplicate id", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML } });
    findButton("Objects").click();
    findButton("Add object").click();

    (objectSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "case-file";
    findButtonIn(draftActions(), "Save").click();

    expect(objectSidebar().hasAttribute("hidden")).toBe(false);
    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/already exists/);
  });

  it("discards the draft and closes the sidebar on Cancel", async () => {
    await openEditorWithFixture();
    findButton("Objects").click();
    findButton("Add object").click();
    findButtonIn(draftActions(), "Cancel").click();

    expect(objectSidebar().querySelector(".editor__inspector-form")!.hasAttribute("hidden")).toBe(true);
    expect(document.querySelectorAll(".editor__object-list-item")).toHaveLength(0);
  });
});

describe("editor — object parts/states and verb flagging", () => {
  it("adds a part with a state, and does not warn for a known interact verb", async () => {
    await openEditorWithFixture();
    findButton("Objects").click();
    findButton("Add object").click();
    (objectSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "desk";
    (objectSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "the desk";
    (objectSidebar().querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value = "A battered desk.";

    findButton("+ Add part").click();
    const partBlock = objectSidebar().querySelector(".editor__part")!;
    setValue(fieldByLabel(partBlock, "part id") as HTMLInputElement, "drawer");
    setValue(fieldByLabel(partBlock, "name") as HTMLInputElement, "the drawer");
    setValue(fieldByLabel(partBlock, "description") as HTMLTextAreaElement, "A small drawer.");

    findButton("+ Add state").click();
    const stateBlock = objectSidebar().querySelector(".editor__state")!;
    setValue(fieldByLabel(stateBlock, "state id") as HTMLInputElement, "open");
    setValue(fieldByLabel(stateBlock, "name") as HTMLInputElement, "open");
    setValue(fieldByLabel(stateBlock, "description") as HTMLTextAreaElement, "The drawer is open.");
    const enterAliasesInput = fieldByLabel(stateBlock, "enterAliases (comma-separated verb words)") as HTMLInputElement;
    setValue(enterAliasesInput, "open");

    expect(stateBlock.querySelector(".editor__warning")!.hasAttribute("hidden")).toBe(true);

    findButtonIn(draftActions(), "Save").click();
    expect(document.querySelector(".editor__notice")!.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector(".editor__object-list-item")!.textContent).toContain("1 part(s)");
  });

  it("warns (without blocking save) when enterAliases uses a verb word the parser doesn't know", async () => {
    await openEditorWithFixture();
    findButton("Objects").click();
    findButton("Add object").click();
    (objectSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "safe";
    (objectSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "the safe";
    (objectSidebar().querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value = "A heavy safe.";

    findButton("+ Add part").click();
    const partBlock = objectSidebar().querySelector(".editor__part")!;
    setValue(fieldByLabel(partBlock, "part id") as HTMLInputElement, "door");
    setValue(fieldByLabel(partBlock, "name") as HTMLInputElement, "the safe door");
    setValue(fieldByLabel(partBlock, "description") as HTMLTextAreaElement, "A thick steel door.");

    findButton("+ Add state").click();
    const stateBlock = objectSidebar().querySelector(".editor__state")!;
    setValue(fieldByLabel(stateBlock, "state id") as HTMLInputElement, "unlocked");
    setValue(fieldByLabel(stateBlock, "name") as HTMLInputElement, "unlocked");
    setValue(fieldByLabel(stateBlock, "description") as HTMLTextAreaElement, "The safe is unlocked.");
    const enterAliasesInput = fieldByLabel(stateBlock, "enterAliases (comma-separated verb words)") as HTMLInputElement;
    setValue(enterAliasesInput, "unlock");

    const warning = stateBlock.querySelector(".editor__warning")!;
    expect(warning.hasAttribute("hidden")).toBe(false);
    expect(warning.textContent).toContain("unlock");

    findButtonIn(draftActions(), "Save").click();
    expect(document.querySelector(".editor__notice")!.hasAttribute("hidden")).toBe(true); // never blocks, per the project's decision
    expect(document.querySelector(".editor__status")!.textContent).toMatch(/flagged for engine work/);
  });
});

const OBJECTS_STRUCTURE_YAML = `
- id: desk
  kind: setpiece
  portable: false
  aliases: [desk]
  text:
    en:
      name: the writing desk
      description: A battered oak desk.
  parts:
    - id: drawer
      aliases: [drawer]
      defaultStateId: closed
      text:
        en: { name: the drawer, description: A small drawer. }
      states:
        - id: closed
          text:
            en: { name: closed, description: The drawer is closed. }
          enterAliases: [close]
        - id: open
          text:
            en: { name: open, description: The drawer is open. }
          enterAliases: [open]
          exposesContents: true
          important: true
- id: torn-photograph
  kind: item
  portable: true
  aliases: [photograph]
  containerId: desk
  containerPartId: drawer
  text:
    en:
      name: the torn photograph
      description: Half of a photograph.
`;

describe("editor — Structure view", () => {
  it("shows a note instead of a tree for a brand-new unsaved object", async () => {
    await openEditorWithFixture();
    findButton("Objects").click();
    findButton("Add object").click();

    const details = objectSidebar().querySelector(".editor__structure")!;
    expect(details.querySelector(".editor__status")!.hasAttribute("hidden")).toBe(false);
    expect(details.querySelector(".editor__structure-tree")).toBeNull();
  });

  it("renders the parts/states tree, with flags, for a saved object", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_STRUCTURE_YAML } });
    findButton("Objects").click();
    Array.from(document.querySelectorAll<HTMLButtonElement>(".editor__object-list-item")).find((r) => r.textContent?.includes("desk"))!.click();

    const details = objectSidebar().querySelector(".editor__structure")!;
    (details.querySelector("summary") as HTMLElement).click();

    const text = details.querySelector(".editor__structure-tree")!.textContent!;
    expect(text).toContain("drawer");
    expect(text).toContain("closed");
    expect(text).toContain("[default]");
    expect(text).toContain("open");
    expect(text).toMatch(/\[.*important.*exposesContents.*\]|\[.*exposesContents.*important.*\]/);
  });

  it("nests a contained object under the part it's placed in, and jumps the inspector to it on click", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_STRUCTURE_YAML } });
    findButton("Objects").click();
    Array.from(document.querySelectorAll<HTMLButtonElement>(".editor__object-list-item")).find((r) => r.textContent?.includes("desk"))!.click();

    const details = objectSidebar().querySelector(".editor__structure")!;
    (details.querySelector("summary") as HTMLElement).click();

    const link = Array.from(details.querySelectorAll<HTMLButtonElement>(".editor__structure-link")).find((b) =>
      b.textContent?.includes("torn-photograph"),
    )!;
    link.click();

    expect(objectSidebar().querySelector("h2")!.textContent).toBe("Edit object");
    expect((objectSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value).toBe("torn-photograph");
  });
});

describe("editor — object Remove/Save", () => {
  it("does nothing when the confirm dialog is dismissed", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML } });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    findButton("Objects").click();
    document.querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButton("Remove object").click();

    expect(document.querySelectorAll(".editor__object-list-item")).toHaveLength(1);
  });

  it("removes the object on confirm", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    findButton("Objects").click();
    document.querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButton("Remove object").click();

    expect(document.querySelectorAll(".editor__object-list-item")).toHaveLength(0);
    expect(objectSidebar().querySelector(".editor__inspector-form")!.hasAttribute("hidden")).toBe(true);
  });

  it("writes a new object into a fresh editor-additions.yaml, leaving existing object files untouched", async () => {
    const project = await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML } });
    findButton("Objects").click();
    findButton("Add object").click();
    (objectSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "lighter";
    (objectSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "brass lighter";
    (objectSidebar().querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value = "An engraved lighter.";
    findButtonIn(draftActions(), "Save").click();

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const additionsFile = project.objectFileHandles["editor-additions.yaml"] as unknown as { writtenText: string | null };
    expect(additionsFile.writtenText).toContain("id: lighter");
    expect(additionsFile.writtenText).toContain("brass lighter");
    expect((project.objectFileHandles["case.yaml"] as unknown as { writtenText: string | null }).writtenText).toBeNull();
  });
});

describe("editor — object images survive a save", () => {
  it("re-emits an object's image and a part state's image after editing the object (the form has no image UI)", async () => {
    const img = (src: string, alt: string) => `image: { src: ${src}, text: { en: { alt: ${alt} } }, hotspots: [{ text: { en: { label: Pull it } }, command: open drawer, rect: [10, 10, 20, 20] }] }`;
    const project = await openEditorWithFixture({
      objectFiles: {
        "case.yaml": `
- id: desk
  kind: setpiece
  portable: false
  text: { en: { name: the desk, description: A desk. } }
  ${img("desk.webp", "A desk close-up.")}
  parts:
    - id: drawer
      defaultStateId: closed
      text: { en: { name: the drawer, description: A drawer. } }
      states:
        - id: closed
          text: { en: { name: closed, description: Closed. } }
          ${img("drawer-closed.webp", "A shut drawer.")}
`,
      },
    });
    findButton("Objects").click();
    document.querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();
    (objectSidebar().querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value = "A sturdy desk.";
    findButtonIn(draftActions(), "Save").click();

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.objectFileHandles["case.yaml"] as unknown as { writtenText: string | null }).writtenText!;
    expect(written).toContain("A sturdy desk.");
    expect(written).toContain("desk.webp");
    expect(written).toContain("A desk close-up.");
    expect(written).toContain("drawer-closed.webp");
    expect(written).toContain("A shut drawer.");
    expect(written).toContain("open drawer");
  });
});

/** The single reused `<dialog class="editor__image-dialog">` opened by `openImageEditor` — see `imageEditor.ts`. */
function imageDialog(): HTMLElement {
  return document.querySelector(".editor__image-dialog")!;
}

const DESK_OBJECT_YAML = `
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
`;

describe("editor — image editor popup", () => {
  it("draws a new location image with a hotspot, and Save location + Save world regenerate the YAML", async () => {
    const project = await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    clickNode(svg, "a", 10, 10);

    findButtonIn(document.querySelector(".editor__sidebar")!, "Edit image…").click();
    setValue(fieldByLabel(imageDialog(), "image filename (under public/images/)") as HTMLInputElement, "alley.svg");
    setValue(fieldByLabel(imageDialog(), "alt text") as HTMLInputElement, "A rain-slicked alley.");
    // jsdom never actually fetches the preview image — fire the "load" it
    // would produce, which is what enables drawing zones (see imageEditor.ts).
    imageDialog().querySelector(".editor__image-dialog__img")!.dispatchEvent(new Event("load"));

    const surface = imageDialog().querySelector(".editor__image-dialog__draw-surface")!;
    const preview = imageDialog().querySelector(".editor__image-dialog__preview")!;
    preview.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 20, clientY: 10, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 60, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 100, clientY: 60, bubbles: true }));

    const hotspotRow = imageDialog().querySelector(".editor__image-dialog__hotspot-row")!;
    setValue(fieldByLabel(hotspotRow, "label") as HTMLInputElement, "Talk to the stranger");
    setValue(fieldByLabel(hotspotRow, "command") as HTMLInputElement, "talk stranger");

    findButtonIn(imageDialog(), "Save").click();
    expect(imageDialog().hasAttribute("open")).toBe(false);

    findButtonIn(draftActions(), "Save").click();
    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.locationFileHandles["a.yaml"] as unknown as { writtenText: string | null }).writtenText!;
    expect(written).toContain("alley.svg");
    expect(written).toContain("A rain-slicked alley.");
    expect(written).toContain("Talk to the stranger");
    expect(written).toContain("talk stranger");
  });

  it("adds a new object-level image (no zone) and Save regenerates the object file", async () => {
    const project = await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML } });
    findButton("Objects").click();
    document.querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButtonIn(objectSidebar(), "Edit image…").click();
    setValue(fieldByLabel(imageDialog(), "image filename (under public/images/)") as HTMLInputElement, "case-file.svg");
    setValue(fieldByLabel(imageDialog(), "alt text") as HTMLInputElement, "A thin folder of notes.");
    findButtonIn(imageDialog(), "Save").click();

    findButtonIn(draftActions(), "Save").click();
    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.objectFileHandles["case.yaml"] as unknown as { writtenText: string | null }).writtenText!;
    expect(written).toContain("case-file.svg");
    expect(written).toContain("A thin folder of notes.");
  });

  it("adds a new part-state image (no zone) and Save regenerates the object file", async () => {
    const project = await openEditorWithFixture({ objectFiles: { "case.yaml": DESK_OBJECT_YAML } });
    findButton("Objects").click();
    document.querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    const stateBlock = objectSidebar().querySelector(".editor__state")!;
    findButtonIn(stateBlock, "Edit image…").click();
    setValue(fieldByLabel(imageDialog(), "image filename (under public/images/)") as HTMLInputElement, "desk-drawer-closed.svg");
    setValue(fieldByLabel(imageDialog(), "alt text") as HTMLInputElement, "The drawer, shut.");
    findButtonIn(imageDialog(), "Save").click();

    findButtonIn(draftActions(), "Save").click();
    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.objectFileHandles["case.yaml"] as unknown as { writtenText: string | null }).writtenText!;
    expect(written).toContain("desk-drawer-closed.svg");
    expect(written).toContain("The drawer, shut.");
  });

  it("adds a new NPC image (no zone) and Save world regenerates world.yaml", async () => {
    const project = await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButtonIn(npcSidebar(), "Edit image…").click();
    setValue(fieldByLabel(imageDialog(), "image filename (under public/images/)") as HTMLInputElement, "hale.svg");
    setValue(fieldByLabel(imageDialog(), "alt text") as HTMLInputElement, "Officer Hale, in uniform.");
    findButtonIn(imageDialog(), "Save").click();

    findButtonIn(draftActions(), "Save").click();
    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.worldFile as unknown as { writtenText: string | null }).writtenText!;
    expect(written).toContain("hale.svg");
    expect(written).toContain("Officer Hale, in uniform.");
    // Untouched by this form — must survive upsertNpcRaw's merge onto the existing raw entry.
    expect(written).toContain("talkedTo.hale");
  });

  it("edits an existing NPC image's alt text via the popup", async () => {
    const project = await openEditorWithFixture({
      worldYaml: NPC_WORLD_WITH_HALE_YAML.replace(
        "dialogue: \"Evening.\"",
        'dialogue: "Evening."\n    image: { src: hale.svg, text: { en: { alt: Officer Hale. } }, hotspots: [] }',
      ),
    });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButtonIn(npcSidebar(), "Edit image…").click();
    expect((fieldByLabel(imageDialog(), "image filename (under public/images/)") as HTMLInputElement).value).toBe("hale.svg");
    setValue(fieldByLabel(imageDialog(), "alt text") as HTMLInputElement, "Officer Hale, off duty.");
    findButtonIn(imageDialog(), "Save").click();

    findButtonIn(draftActions(), "Save").click();
    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.worldFile as unknown as { writtenText: string | null }).writtenText!;
    expect(written).toContain("hale.svg");
    expect(written).toContain("Officer Hale, off duty.");
    expect(written).not.toContain("Officer Hale.\n");
  });

  it("removes an existing NPC image via Remove image, dropping it from the regenerated YAML", async () => {
    const project = await openEditorWithFixture({
      worldYaml: NPC_WORLD_WITH_HALE_YAML.replace(
        "dialogue: \"Evening.\"",
        'dialogue: "Evening."\n    image: { src: hale.svg, text: { en: { alt: Officer Hale. } }, hotspots: [] }',
      ),
    });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButtonIn(npcSidebar(), "Edit image…").click();
    findButtonIn(imageDialog(), "Remove image").click();

    findButtonIn(draftActions(), "Save").click();
    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.worldFile as unknown as { writtenText: string | null }).writtenText!;
    expect(written).not.toContain("hale.svg");
    expect(written).not.toMatch(/image:/);
  });
});

const PREFABS_A_YAML = `
- id: generic-alley
  kind: exterior
  aliases: [alley]
  text:
    en:
      name: a narrow alley
      description: A rain-slicked alley.
  worldObjectIds: [case-file]
`;

function prefabSidebar(): HTMLElement {
  return document.querySelector(".editor__sidebar--prefab")!;
}

/** The toolbar's contextual draft Save/Cancel group — scoped separately from the whole-project "Save world" disk-save button, since both this group's Save and that one were literally "Save" before "Save world" was named to disambiguate; kept scoped regardless, since a bare `findButton("Save")` would still be one keystroke away from re-colliding. See `draftSaveButton`/`draftCancelButton` in main.ts. */
function draftActions(): HTMLElement {
  return document.querySelector(".editor__toolbar-group--trailing")!;
}

/** The prefab list panel, scoped separately from the object list panel — both share ".editor__object-list-item" for their rows and coexist in the DOM at once (only `hidden` toggles which is showing), so an unscoped query can pick up the wrong list's row when a test loads both objects and prefabs. */
function prefabList(): HTMLElement {
  return document.querySelector(".editor__object-list--prefab")!;
}

describe("editor — Prefabs tab", () => {
  it("switches panels and enables Add prefab once a project is loaded", async () => {
    await openEditorWithFixture();
    expect(findButton("Add prefab").hidden).toBe(true);

    findButton("Prefabs").click();

    expect(findButton("Add prefab").hidden).toBe(false);
    expect(findButton("Add prefab").disabled).toBe(false);
    expect(document.querySelectorAll(".editor__object-list")[1]!.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector(".editor__map")!.hasAttribute("hidden")).toBe(true);
  });

  it("lists an existing prefab loaded from a prefabs file, decoration counts included", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML }, prefabFiles: { "alley.yaml": PREFABS_A_YAML } });
    findButton("Prefabs").click();

    const row = prefabList().querySelector(".editor__object-list-item")!;
    expect(row.textContent).toContain("generic-alley");
    expect(row.textContent).toContain("1 object(s)");
  });

  it("refuses to open (with a clear notice) when a prefab references a world object that doesn't exist", async () => {
    await openEditorWithFixture({ prefabFiles: { "alley.yaml": PREFABS_A_YAML } });
    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/worldObjectIds references "case-file"/);
    expect(findButton("Add prefab").disabled).toBe(true);
  });
});

describe("editor — Add/Edit prefab sidebar", () => {
  it("opens the prefab sidebar on Add prefab", async () => {
    await openEditorWithFixture();
    findButton("Prefabs").click();
    findButton("Add prefab").click();

    expect(prefabSidebar().hasAttribute("hidden")).toBe(false);
    expect(prefabSidebar().querySelector("h2")!.textContent).toBe("Add prefab");
  });

  it("commits a new prefab, decorated with an existing world object, into the list on Save prefab", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML } });
    findButton("Prefabs").click();
    findButton("Add prefab").click();

    (prefabSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "generic-alley";
    (prefabSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "a narrow alley";
    (prefabSidebar().querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value = "A rain-slicked alley.";
    const checkbox = prefabSidebar().querySelector(".editor__checklist-item input") as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    findButtonIn(draftActions(), "Save").click();

    expect(prefabSidebar().hasAttribute("hidden")).toBe(true);
    const row = prefabList().querySelector(".editor__object-list-item")!;
    expect(row.textContent).toContain("generic-alley");
    expect(row.textContent).toContain("1 object(s)");
  });

  it("refuses to commit a duplicate id", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML }, prefabFiles: { "alley.yaml": PREFABS_A_YAML } });
    findButton("Prefabs").click();
    findButton("Add prefab").click();

    (prefabSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "generic-alley";
    findButtonIn(draftActions(), "Save").click();

    expect(prefabSidebar().hasAttribute("hidden")).toBe(false);
    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/already exists/);
  });

  it("discards the draft and closes the sidebar on Cancel", async () => {
    await openEditorWithFixture();
    findButton("Prefabs").click();
    findButton("Add prefab").click();
    findButtonIn(draftActions(), "Cancel").click();

    expect(prefabSidebar().hasAttribute("hidden")).toBe(true);
    expect(prefabList().querySelectorAll(".editor__object-list-item")).toHaveLength(0);
  });
});

describe("editor — prefab Remove/Save", () => {
  it("does nothing when the confirm dialog is dismissed", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML }, prefabFiles: { "alley.yaml": PREFABS_A_YAML } });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    findButton("Prefabs").click();
    prefabList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButton("Remove prefab").click();

    expect(prefabList().querySelectorAll(".editor__object-list-item")).toHaveLength(1);
  });

  it("removes the prefab on confirm", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML }, prefabFiles: { "alley.yaml": PREFABS_A_YAML } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    findButton("Prefabs").click();
    prefabList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButton("Remove prefab").click();

    expect(prefabList().querySelectorAll(".editor__object-list-item")).toHaveLength(0);
    expect(prefabSidebar().hasAttribute("hidden")).toBe(true);
  });

  it("writes a new prefab into a fresh editor-additions.yaml, leaving existing prefab files untouched", async () => {
    const project = await openEditorWithFixture({
      objectFiles: { "case.yaml": OBJECTS_A_YAML },
      prefabFiles: { "alley.yaml": PREFABS_A_YAML },
    });
    findButton("Prefabs").click();
    findButton("Add prefab").click();
    (prefabSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "generic-office";
    (prefabSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "a small office";
    (prefabSidebar().querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value = "A cramped office.";
    findButtonIn(draftActions(), "Save").click();

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const additionsFile = project.prefabFileHandles["editor-additions.yaml"] as unknown as { writtenText: string | null };
    expect(additionsFile.writtenText).toContain("id: generic-office");
    expect(additionsFile.writtenText).toContain("a small office");
    expect((project.prefabFileHandles["alley.yaml"] as unknown as { writtenText: string | null }).writtenText).toBeNull();
  });

  it("blocks the WHOLE save when a prefab's decoration reference goes stale (its object was removed this session)", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML }, prefabFiles: { "alley.yaml": PREFABS_A_YAML } });
    findButton("Objects").click();
    document.querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    findButton("Remove object").click();

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/Not saved.*worldObjectIds references "case-file"/s);
  });
});

const WORLD_WITH_NPC_YAML = `
npcs:
  - id: witness
    locationId: a
    text:
      en:
        name: a witness
        description: A nervous witness.
        dialogue: I didn't see anything.
transitLines: []
passes: []
`;

const PREFABS_WITH_NPC_YAML = `
- id: crowd-alley
  kind: exterior
  text:
    en:
      name: a crowded alley
      description: An alley full of onlookers.
  npcIds: [witness]
`;

/** The location (not object/prefab) sidebar's "Start from prefab" picker row. */
function prefabPickerRow(): HTMLElement {
  return document.querySelector(".editor__field--prefab-picker")!;
}

describe("editor — Stamp prefab into a new location", () => {
  it("shows the prefab picker only when adding a location, not when editing one", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML }, prefabFiles: { "alley.yaml": PREFABS_A_YAML } });
    findButton("Add location").click();

    expect(prefabPickerRow().hidden).toBe(false);
    expect(prefabPickerRow().querySelectorAll("option").length).toBe(2); // "(blank location)" + generic-alley

    findButtonIn(draftActions(), "Cancel").click();

    const svg = document.querySelector("svg")!;
    stubRect(svg);
    clickNode(svg, "a", 10, 10);

    expect(prefabPickerRow().hidden).toBe(true);
  });

  it("selecting a prefab pre-fills name/description, and clears them back out on '(blank location)'", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML }, prefabFiles: { "alley.yaml": PREFABS_A_YAML } });
    findButton("Add location").click();

    const select = prefabPickerRow().querySelector("select") as HTMLSelectElement;
    select.value = "generic-alley";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect((document.querySelector('input[placeholder="Display name"]') as HTMLInputElement).value).toBe("a narrow alley");
    expect((document.querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value).toBe("A rain-slicked alley.");

    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect((document.querySelector('input[placeholder="Display name"]') as HTMLInputElement).value).toBe("");
  });

  it("shows (without blocking) a note when the prefab also lists NPCs, since NPC instantiation isn't built yet", async () => {
    await openEditorWithFixture({ worldYaml: WORLD_WITH_NPC_YAML, prefabFiles: { "crowd.yaml": PREFABS_WITH_NPC_YAML } });
    findButton("Add location").click();

    const select = prefabPickerRow().querySelector("select") as HTMLSelectElement;
    select.value = "crowd-alley";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    const note = document.querySelector(".editor__sidebar .editor__warning")!;
    expect(note.hasAttribute("hidden")).toBe(false);
    expect(note.textContent).toMatch(/1 NPC\(s\)/);
  });

  it("stamps the prefab's world objects into fresh clones placed at the new location, and carries over its aliases", async () => {
    const project = await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML }, prefabFiles: { "alley.yaml": PREFABS_A_YAML } });
    findButton("Add location").click();

    const select = prefabPickerRow().querySelector("select") as HTMLSelectElement;
    select.value = "generic-alley";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    (document.querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "back-alley";
    findButtonIn(draftActions(), "Save").click();

    expect(document.querySelector(".editor__status")!.textContent).toMatch(/Stamped prefab "generic-alley", cloning 1 world object\(s\)/);

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const locationAdditions = (project.locationFileHandles["editor-additions.yaml"] as unknown as { writtenText: string | null }).writtenText;
    expect(locationAdditions).toContain("id: back-alley");
    expect(locationAdditions).toContain("itemIds:");
    expect(locationAdditions).toContain("case-file-back-alley");
    expect(locationAdditions).toContain("- alley"); // the prefab's own aliases, carried onto the new location

    const objectAdditions = (project.objectFileHandles["editor-additions.yaml"] as unknown as { writtenText: string | null }).writtenText;
    expect(objectAdditions).toContain("id: case-file-back-alley");
    expect(objectAdditions).toContain("A thin folder of notes"); // cloned text, not just a bare reference
  });

  it("stamping the same prefab twice produces two independently-cloned objects, not a shared/moved one", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML }, prefabFiles: { "alley.yaml": PREFABS_A_YAML } });

    findButton("Add location").click();
    let select = prefabPickerRow().querySelector("select") as HTMLSelectElement;
    select.value = "generic-alley";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    (document.querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "alley-1";
    findButtonIn(draftActions(), "Save").click();

    findButton("Add location").click();
    select = prefabPickerRow().querySelector("select") as HTMLSelectElement;
    select.value = "generic-alley";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    (document.querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "alley-2";
    findButtonIn(draftActions(), "Save").click();

    findButton("Objects").click();
    const ids = Array.from(document.querySelectorAll(".editor__object-list-item")).map((el) => el.textContent);
    expect(ids.some((t) => t?.includes("case-file-alley-1"))).toBe(true);
    expect(ids.some((t) => t?.includes("case-file-alley-2"))).toBe(true);
  });

  it("skips (with a status note, not an error) a decoration whose source object no longer exists in the catalog", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML }, prefabFiles: { "alley.yaml": PREFABS_A_YAML } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    findButton("Objects").click();
    document.querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();
    findButton("Remove object").click();

    findButton("Locations").click();
    findButton("Add location").click();
    const select = prefabPickerRow().querySelector("select") as HTMLSelectElement;
    select.value = "generic-alley";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    (document.querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "back-alley";
    findButtonIn(draftActions(), "Save").click();

    expect(document.querySelector(".editor__status")!.textContent).toMatch(/1 referenced object\(s\) no longer exist.*case-file/);
  });
});

const NPC_WORLD_WITH_HALE_YAML = `
labels:
  - id: worker
    text:
      en:
        name: the working folk
npcs:
  - id: hale
    aliases: [officer]
    locationId: a
    labels: [worker]
    dialogueRules:
      - requires: [talkedTo.hale]
        text:
          en: "Back again."
    text:
      en:
        name: Officer Hale
        description: A patrolman.
        dialogue: "Evening."
transitLines: []
passes: []
`;

const NPC_WORLD_WITH_SCHEDULE_YAML = `
npcs:
  - id: hale
    locationId: a
    schedule:
      - fromHour: 8
        toHour: 16
        locationId: a
      - fromHour: 20
        toHour: 6
        locationId: b
        weekdays: [1, 2, 3, 4, 5]
    text:
      en:
        name: Officer Hale
        description: A patrolman.
        dialogue: "Evening."
transitLines: []
passes: []
`;

function npcSidebar(): HTMLElement {
  return document.querySelector(".editor__sidebar--npc")!;
}

/** The NPC list panel, scoped separately from the object/prefab list panels — see `prefabList`'s doc comment for why an unscoped query is unsafe once more than one list coexists in the DOM. */
function npcList(): HTMLElement {
  return document.querySelector(".editor__object-list--npc")!;
}

describe("editor — NPCs tab", () => {
  it("switches panels and enables Add NPC once a project is loaded", async () => {
    await openEditorWithFixture();
    expect(findButton("Add NPC").hidden).toBe(true);

    findButton("NPCs").click();

    expect(findButton("Add NPC").hidden).toBe(false);
    expect(findButton("Add NPC").disabled).toBe(false);
    expect(document.querySelector(".editor__object-list-panel--npc")!.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector(".editor__map")!.hasAttribute("hidden")).toBe(true);
  });

  it("lists an existing NPC loaded from world.yaml", async () => {
    await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();

    const row = npcList().querySelector(".editor__object-list-item")!;
    expect(row.textContent).toContain("hale");
    expect(row.textContent).toContain("Officer Hale");
    expect(row.textContent).toContain("a");
  });

  it("hides the NPC list panel and inspector again after switching back to Locations", async () => {
    await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();
    expect(npcSidebar().hasAttribute("hidden")).toBe(false);

    findButton("Locations").click();

    expect(document.querySelector(".editor__object-list-panel--npc")!.hasAttribute("hidden")).toBe(true);
    expect(npcSidebar().hasAttribute("hidden")).toBe(true);
    expect(document.querySelector(".editor__map")!.hasAttribute("hidden")).toBe(false);
  });

  it("shows the inspector's empty-state placeholder, not the form, until an NPC is picked", async () => {
    await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();

    expect(npcSidebar().hasAttribute("hidden")).toBe(false);
    expect(npcSidebar().querySelector(".editor__inspector-placeholder")!.hasAttribute("hidden")).toBe(false);
    expect(npcSidebar().querySelector(".editor__inspector-form")!.hasAttribute("hidden")).toBe(true);
  });

  it("filters the NPC list by id or display name as you type in the search box", async () => {
    await openEditorWithFixture({
      worldYaml: `
npcs:
  - id: hale
    locationId: a
    text:
      en:
        name: Officer Hale
        description: A patrolman.
        dialogue: "Evening."
  - id: rosa
    locationId: b
    text:
      en:
        name: Rosa
        description: A cook.
        dialogue: "Don't know you."
transitLines: []
passes: []
`,
    });
    findButton("NPCs").click();
    expect(npcList().querySelectorAll(".editor__object-list-item")).toHaveLength(2);

    const search = npcList().parentElement!.querySelector(".editor__object-search") as HTMLInputElement;
    setValue(search, "rosa");
    expect(npcList().querySelectorAll(".editor__object-list-item")).toHaveLength(1);
    expect(npcList().querySelector(".editor__object-list-item")!.textContent).toContain("rosa");

    setValue(search, "hale");
    expect(npcList().querySelectorAll(".editor__object-list-item")).toHaveLength(1);
    expect(npcList().querySelector(".editor__object-list-item")!.textContent).toContain("hale");

    setValue(search, "nothing matches this");
    expect(npcList().querySelectorAll(".editor__object-list-item")).toHaveLength(0);
    expect(npcList().textContent).toMatch(/no npcs match/i);
  });
});

describe("editor — Add/Edit NPC sidebar", () => {
  it("opens the NPC sidebar on Add NPC", async () => {
    await openEditorWithFixture();
    findButton("NPCs").click();
    findButton("Add NPC").click();

    expect(npcSidebar().hasAttribute("hidden")).toBe(false);
    expect(npcSidebar().querySelector("h2")!.textContent).toBe("Add NPC");
  });

  it("commits a new NPC, with a chosen starting location, into the list on Save", async () => {
    await openEditorWithFixture();
    findButton("NPCs").click();
    findButton("Add NPC").click();

    (npcSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "hale";
    (npcSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "Officer Hale";
    (npcSidebar().querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value = "A patrolman.";
    (npcSidebar().querySelector('textarea[placeholder^="Fallback dialogue"]') as HTMLTextAreaElement).value = "Evening.";
    const locationSelect = fieldByLabel(npcSidebar(), "starting location") as HTMLSelectElement;
    locationSelect.value = "b";
    locationSelect.dispatchEvent(new Event("change", { bubbles: true }));

    findButtonIn(draftActions(), "Save").click();

    expect(npcSidebar().querySelector(".editor__inspector-form")!.hasAttribute("hidden")).toBe(true);
    const row = npcList().querySelector(".editor__object-list-item")!;
    expect(row.textContent).toContain("hale");
    expect(row.textContent).toContain("Officer Hale");
    expect(row.textContent).toContain("b");
  });

  it("refuses to commit a duplicate id", async () => {
    await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();
    findButton("Add NPC").click();

    (npcSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "hale";
    findButtonIn(draftActions(), "Save").click();

    expect(npcSidebar().hasAttribute("hidden")).toBe(false);
    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/already exists/);
  });

  it("refuses to commit without a valid starting location, and without required text fields", async () => {
    await openEditorWithFixture();
    findButton("NPCs").click();
    findButton("Add NPC").click();

    (npcSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "hale";
    // No name/description/dialogue authored yet — required text fields are missing.
    findButtonIn(draftActions(), "Save").click();
    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/name is required/i);

    (npcSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "Officer Hale";
    findButtonIn(draftActions(), "Save").click();
    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/description is required/i);
  });

  it("editing an existing NPC does not lose fields this form has no UI for (dialogueRules, labels)", async () => {
    const project = await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    expect(npcSidebar().querySelector("h2")!.textContent).toBe("Edit NPC");
    (npcSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "Officer Hale Jr.";
    findButtonIn(draftActions(), "Save").click();

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.worldFile as unknown as { writtenText: string | null }).writtenText!;
    expect(written).toContain("Officer Hale Jr.");
    // Untouched by this form — must survive the merge onto the existing raw entry.
    expect(written).toContain("dialogueRules");
    expect(written).toContain("talkedTo.hale");
    expect(written).toContain("worker");
  });

  it("discards the draft and closes the sidebar on Cancel", async () => {
    await openEditorWithFixture();
    findButton("NPCs").click();
    findButton("Add NPC").click();
    findButtonIn(draftActions(), "Cancel").click();

    expect(npcSidebar().querySelector(".editor__inspector-form")!.hasAttribute("hidden")).toBe(true);
    expect(npcList().querySelectorAll(".editor__object-list-item")).toHaveLength(0);
  });
});

describe("editor — NPC schedule", () => {
  function scheduleSlots(): HTMLElement[] {
    return Array.from(npcSidebar().querySelectorAll(".editor__schedule-slot"));
  }

  it("shows the 'no schedule' hint and no slots for a brand-new NPC", async () => {
    await openEditorWithFixture();
    findButton("NPCs").click();
    findButton("Add NPC").click();

    expect(scheduleSlots()).toHaveLength(0);
    expect(npcSidebar().textContent).toMatch(/no schedule.*stays at its starting location/i);
  });

  it("loads an existing NPC's schedule slots, including hours and specific weekdays", async () => {
    await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_SCHEDULE_YAML });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    const slots = scheduleSlots();
    expect(slots).toHaveLength(2);

    expect((fieldByLabel(slots[0]!, "from hour (0-23)") as HTMLInputElement).value).toBe("8");
    expect((fieldByLabel(slots[0]!, "to hour (0-24)") as HTMLInputElement).value).toBe("16");
    expect((fieldByLabel(slots[0]!, "location") as HTMLSelectElement).value).toBe("a");
    const everyDayLabel = Array.from(slots[0]!.querySelectorAll(".editor__field--checkbox label")).find((l) => l.textContent?.includes("Every day"))!;
    expect((everyDayLabel.querySelector("input") as HTMLInputElement).checked).toBe(true);

    // Second slot wraps past midnight (20 -> 6) and is restricted to Mon-Fri.
    expect((fieldByLabel(slots[1]!, "from hour (0-23)") as HTMLInputElement).value).toBe("20");
    expect((fieldByLabel(slots[1]!, "to hour (0-24)") as HTMLInputElement).value).toBe("6");
    expect((fieldByLabel(slots[1]!, "location") as HTMLSelectElement).value).toBe("b");
    const dayCheckboxes = slots[1]!.querySelectorAll(".editor__weekday-checkboxes input[type=checkbox]");
    expect(Array.from(dayCheckboxes).filter((c) => (c as HTMLInputElement).checked)).toHaveLength(5);
  });

  it("adds a slot, saves, and round-trips it correctly into world.yaml (schedule key present, correct shape)", async () => {
    const project = await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButtonIn(npcSidebar(), "+ Add schedule slot").click();
    const slot = scheduleSlots()[0]!;
    setValue(fieldByLabel(slot, "from hour (0-23)") as HTMLInputElement, "9");
    setValue(fieldByLabel(slot, "to hour (0-24)") as HTMLInputElement, "17");

    findButtonIn(draftActions(), "Save").click();
    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.worldFile as unknown as { writtenText: string | null }).writtenText!;
    expect(written).toContain("schedule");
    expect(written).toMatch(/fromHour:\s*9/);
    expect(written).toMatch(/toHour:\s*17/);
  });

  it("omits the schedule key entirely from world.yaml when no slots are authored", async () => {
    const project = await openEditorWithFixture({ worldYaml: WORLD_YAML });
    findButton("NPCs").click();
    findButton("Add NPC").click();

    (npcSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "hale";
    (npcSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "Officer Hale";
    (npcSidebar().querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value = "A patrolman.";
    (npcSidebar().querySelector('textarea[placeholder^="Fallback dialogue"]') as HTMLTextAreaElement).value = "Evening.";

    findButtonIn(draftActions(), "Save").click();
    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.worldFile as unknown as { writtenText: string | null }).writtenText!;
    expect(written).not.toContain("schedule");
  });

  it("removing every schedule slot from a previously-scheduled NPC clears the schedule key on save", async () => {
    const project = await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_SCHEDULE_YAML });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    expect(scheduleSlots()).toHaveLength(2);
    findButtonIn(scheduleSlots()[1]!, "Remove slot").click();
    findButtonIn(scheduleSlots()[0]!, "Remove slot").click();
    expect(scheduleSlots()).toHaveLength(0);

    findButtonIn(draftActions(), "Save").click();
    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.worldFile as unknown as { writtenText: string | null }).writtenText!;
    expect(written).not.toContain("schedule");
  });

  it("blocks saving a slot with fromHour === toHour (zero duration)", async () => {
    await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButtonIn(npcSidebar(), "+ Add schedule slot").click();
    const slot = scheduleSlots()[0]!;
    setValue(fieldByLabel(slot, "from hour (0-23)") as HTMLInputElement, "10");
    setValue(fieldByLabel(slot, "to hour (0-24)") as HTMLInputElement, "10");

    findButtonIn(draftActions(), "Save").click();

    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/zero duration/i);
    expect(npcSidebar().hasAttribute("hidden")).toBe(false);
  });

  it("accepts a slot that wraps past midnight (fromHour > toHour) without blocking", async () => {
    const project = await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButtonIn(npcSidebar(), "+ Add schedule slot").click();
    const slot = scheduleSlots()[0]!;
    setValue(fieldByLabel(slot, "from hour (0-23)") as HTMLInputElement, "22");
    setValue(fieldByLabel(slot, "to hour (0-24)") as HTMLInputElement, "6");

    findButtonIn(draftActions(), "Save").click();
    expect(document.querySelector(".editor__notice")?.hasAttribute("hidden")).toBe(true);

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.worldFile as unknown as { writtenText: string | null }).writtenText!;
    expect(written).toMatch(/fromHour:\s*22/);
    expect(written).toMatch(/toHour:\s*6/);
  });

  it("blocks saving a slot with an invalid location", async () => {
    await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButtonIn(npcSidebar(), "+ Add schedule slot").click();
    const slot = scheduleSlots()[0]!;
    const locationSelect = fieldByLabel(slot, "location") as HTMLSelectElement;
    locationSelect.value = "";
    locationSelect.dispatchEvent(new Event("change", { bubbles: true }));

    findButtonIn(draftActions(), "Save").click();
    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/valid location/i);
  });
});

describe("editor — NPC trust/suspicion/stats", () => {
  it("defaults trust/suspicion to 0 and leaves stat fields blank for a brand-new NPC", async () => {
    await openEditorWithFixture();
    findButton("NPCs").click();
    findButton("Add NPC").click();

    expect((fieldByLabel(npcSidebar(), "trust") as HTMLInputElement).value).toBe("0");
    expect((fieldByLabel(npcSidebar(), "suspicion") as HTMLInputElement).value).toBe("0");
    expect((fieldByLabel(npcSidebar(), "stealth (0-100)") as HTMLInputElement).value).toBe("");
    expect((fieldByLabel(npcSidebar(), "stealth (0-100)") as HTMLInputElement).placeholder).toMatch(/default: 30/);
  });

  it("saves trust/suspicion/stats and round-trips them into world.yaml", async () => {
    const project = await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    setValue(fieldByLabel(npcSidebar(), "trust") as HTMLInputElement, "5");
    setValue(fieldByLabel(npcSidebar(), "suspicion") as HTMLInputElement, "-2");
    setValue(fieldByLabel(npcSidebar(), "intimidation (0-100)") as HTMLInputElement, "70");

    findButtonIn(draftActions(), "Save").click();
    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.worldFile as unknown as { writtenText: string | null }).writtenText!;
    expect(written).toMatch(/trust:\s*5/);
    expect(written).toMatch(/suspicion:\s*-2/);
    expect(written).toContain("stats");
    expect(written).toMatch(/intimidation:\s*70/);
  });

  it("omits trust/suspicion/stats from world.yaml when left at defaults", async () => {
    const project = await openEditorWithFixture({ worldYaml: WORLD_YAML });
    findButton("NPCs").click();
    findButton("Add NPC").click();

    (npcSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "hale";
    (npcSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "Officer Hale";
    (npcSidebar().querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value = "A patrolman.";
    (npcSidebar().querySelector('textarea[placeholder^="Fallback dialogue"]') as HTMLTextAreaElement).value = "Evening.";

    findButtonIn(draftActions(), "Save").click();
    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.worldFile as unknown as { writtenText: string | null }).writtenText!;
    expect(written).not.toContain("trust");
    expect(written).not.toContain("suspicion");
    expect(written).not.toContain("stats");
  });

  it("re-clearing a previously-authored stat back to blank removes it from world.yaml on the next save", async () => {
    const project = await openEditorWithFixture({
      worldYaml: `
npcs:
  - id: hale
    locationId: a
    stats:
      intimidation: 80
    text:
      en:
        name: Officer Hale
        description: A patrolman.
        dialogue: "Evening."
transitLines: []
passes: []
`,
    });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();
    expect((fieldByLabel(npcSidebar(), "intimidation (0-100)") as HTMLInputElement).value).toBe("80");

    setValue(fieldByLabel(npcSidebar(), "intimidation (0-100)") as HTMLInputElement, "");
    findButtonIn(draftActions(), "Save").click();
    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.worldFile as unknown as { writtenText: string | null }).writtenText!;
    expect(written).not.toContain("stats");
  });

  it("blocks saving a stat value outside its registry range", async () => {
    await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    setValue(fieldByLabel(npcSidebar(), "handguns (0-100)") as HTMLInputElement, "150");
    findButtonIn(draftActions(), "Save").click();

    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/handguns must be.*between 0 and 100/i);
    expect(npcSidebar().hasAttribute("hidden")).toBe(false);
  });

  it("blocks saving a non-numeric trust value", async () => {
    await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    setValue(fieldByLabel(npcSidebar(), "trust") as HTMLInputElement, "not a number");
    findButtonIn(draftActions(), "Save").click();

    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/trust must be a number/i);
  });
});

describe("editor — NPC Remove/Save", () => {
  it("does nothing when the confirm dialog is dismissed", async () => {
    await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButton("Remove NPC").click();

    expect(npcList().querySelectorAll(".editor__object-list-item")).toHaveLength(1);
  });

  it("removes the NPC on confirm", async () => {
    await openEditorWithFixture({ worldYaml: NPC_WORLD_WITH_HALE_YAML });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    findButton("NPCs").click();
    npcList().querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    findButton("Remove NPC").click();

    expect(npcList().querySelectorAll(".editor__object-list-item")).toHaveLength(0);
    expect(npcSidebar().querySelector(".editor__inspector-form")!.hasAttribute("hidden")).toBe(true);
  });

  it("writes a new NPC into world.yaml on Save world, leaving location/object files untouched", async () => {
    const project = await openEditorWithFixture();
    findButton("NPCs").click();
    findButton("Add NPC").click();
    (npcSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "hale";
    (npcSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "Officer Hale";
    (npcSidebar().querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value = "A patrolman.";
    (npcSidebar().querySelector('textarea[placeholder^="Fallback dialogue"]') as HTMLTextAreaElement).value = "Evening.";
    findButtonIn(draftActions(), "Save").click();

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const written = (project.worldFile as unknown as { writtenText: string | null }).writtenText!;
    expect(written).toContain("id: hale");
    expect(written).toContain("Officer Hale");
    expect((project.locationFileHandles["a.yaml"] as unknown as { writtenText: string | null }).writtenText).toBeNull();
  });
});

describe("editor — Save", () => {
  it("writes a new location into a fresh editor-additions.yaml, leaving existing location files and world.yaml untouched", async () => {
    const project = await openEditorWithFixture();
    findButton("Add location").click();
    (document.querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "c";
    (document.querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "Charlie";
    (document.querySelector('textarea[placeholder="Description"]') as HTMLTextAreaElement).value = "A new spot.";
    findButtonIn(draftActions(), "Save").click();

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const additionsFile = project.locationFileHandles["editor-additions.yaml"] as unknown as { writtenText: string | null };
    expect(additionsFile.writtenText).toContain("id: c");
    expect(additionsFile.writtenText).toContain("Charlie");

    expect((project.locationFileHandles["a.yaml"] as unknown as { writtenText: string | null }).writtenText).toBeNull();
    expect((project.locationFileHandles["b.yaml"] as unknown as { writtenText: string | null }).writtenText).toBeNull();
    expect((project.worldFile as unknown as { writtenText: string | null }).writtenText).toBeNull();
  });

  it("rewrites only the origin file of an edited location", async () => {
    const project = await openEditorWithFixture();
    const svg = document.querySelector("svg")!;
    stubRect(svg);

    clickNode(svg, "a", 10, 10);
    (document.querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "Alleyway";
    findButtonIn(draftActions(), "Save").click();

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect((project.locationFileHandles["a.yaml"] as unknown as { writtenText: string | null }).writtenText).toContain("Alleyway");
    expect((project.locationFileHandles["b.yaml"] as unknown as { writtenText: string | null }).writtenText).toBeNull();
  });

  it("refuses to save (with a clear notice) when the resulting content would be invalid", async () => {
    const project = await openEditorWithFixture();
    findButton("Add location").click();
    (document.querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "c";
    // No name/description text authored — required text.en fields are missing, so the re-validation before writing should reject this.
    findButtonIn(draftActions(), "Save").click();

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".editor__notice")?.textContent).toMatch(/Not saved/);
    expect((project.locationFileHandles["a.yaml"] as unknown as { writtenText: string | null } | undefined)?.writtenText ?? null).toBeNull();
  });
});

describe("editor — contextual draft Save/Cancel toolbar group", () => {
  it("is hidden until a draft is open, in any of the four editors", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML }, prefabFiles: { "alley.yaml": PREFABS_A_YAML } });
    expect(draftActions().hasAttribute("hidden")).toBe(true);

    findButton("Add location").click();
    expect(draftActions().hasAttribute("hidden")).toBe(false);
    findButtonIn(draftActions(), "Cancel").click();
    expect(draftActions().hasAttribute("hidden")).toBe(true);

    findButton("Objects").click();
    findButton("Add object").click();
    expect(draftActions().hasAttribute("hidden")).toBe(false);
    findButtonIn(draftActions(), "Cancel").click();
    expect(draftActions().hasAttribute("hidden")).toBe(true);

    findButton("NPCs").click();
    findButton("Add NPC").click();
    expect(draftActions().hasAttribute("hidden")).toBe(false);
    findButtonIn(draftActions(), "Cancel").click();
    expect(draftActions().hasAttribute("hidden")).toBe(true);

    findButton("Prefabs").click();
    findButton("Add prefab").click();
    expect(draftActions().hasAttribute("hidden")).toBe(false);
    findButtonIn(draftActions(), "Cancel").click();
    expect(draftActions().hasAttribute("hidden")).toBe(true);
  });

  it("no longer renders per-panel Save/Cancel buttons — only the toolbar's and each panel's own Remove button remain", async () => {
    await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML } });
    findButton("Objects").click();
    document.querySelector<HTMLButtonElement>(".editor__object-list-item")!.click();

    expect(objectSidebar().querySelectorAll(".editor__sidebar-actions")).toHaveLength(0);
    expect(objectSidebar().querySelector(".editor__remove-button")).not.toBeNull();
  });

  it("Save from the toolbar commits whichever editor's draft is currently open — an object here, not the location sidebar", async () => {
    await openEditorWithFixture();
    findButton("Objects").click();
    findButton("Add object").click();
    (objectSidebar().querySelector('input[placeholder^="id"]') as HTMLInputElement).value = "lighter";
    (objectSidebar().querySelector('input[placeholder="Display name"]') as HTMLInputElement).value = "brass lighter";

    findButtonIn(draftActions(), "Save").click();

    expect(draftActions().hasAttribute("hidden")).toBe(true);
    expect(document.querySelector(".editor__object-list-item")!.textContent).toContain("lighter");
  });
});

/** The location (not object) edit sidebar — scoped away from `.editor__sidebar--object`, which shares the base "editor__sidebar" class and coexists in the DOM at all times. */
function locationSidebar(): HTMLElement {
  return document.querySelector(".editor__sidebar:not(.editor__sidebar--object)")!;
}

/** Sets a placement picker's object <select> to `id` and clicks its "Place" button — `scope` is either `locationSidebar()`'s "Objects here" section or a part block's "Contents" section, each of which has exactly one `.editor__placement-picker`. */
function placeVia(scope: ParentNode, id: string, { clone }: { clone: boolean }): void {
  const picker = scope.querySelector(".editor__placement-picker")!;
  (picker.querySelector("select") as HTMLSelectElement).value = id;
  const checkbox = picker.querySelector('input[type="checkbox"]') as HTMLInputElement;
  if (checkbox.checked !== clone) {
    checkbox.checked = clone;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }
  findButtonIn(picker, "Place").click();
}

const LOCATION_A_WITH_CASE_FILE_YAML = `
- id: a
  kind: exterior
  aliases: [a]
  connections: []
  x: 0
  'y': 0
  itemIds: [case-file]
  text:
    en:
      name: A
      description: Location A.
`;

describe("editor — placing a clone of an existing object", () => {
  it("Location 'Objects here': placing WITH clone checked adds an independent new object, leaving the source untouched", async () => {
    const project = await openEditorWithFixture({ objectFiles: { "case.yaml": OBJECTS_A_YAML } });
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    clickNode(svg, "a", 10, 10);

    const section = locationSidebar().querySelector(".editor__placement-section")!;
    expect(section.textContent).toMatch(/nothing placed here yet/i);

    placeVia(section, "case-file", { clone: true });

    expect(document.querySelector(".editor__status")!.textContent).toMatch(/Placed a clone of "case-file" as "case-file-a"/);
    expect(section.textContent).toContain("case-file-a");

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const locationText = (project.locationFileHandles["a.yaml"] as unknown as { writtenText: string | null }).writtenText;
    expect(locationText).toContain("itemIds:");
    expect(locationText).toContain("case-file-a");
    expect(locationText).not.toContain("- case-file\n"); // the SOURCE was never placed at "a"

    const objectAdditions = (project.objectFileHandles["editor-additions.yaml"] as unknown as { writtenText: string | null }).writtenText;
    expect(objectAdditions).toContain("id: case-file-a");
  });

  it("Location 'Objects here': placing WITH clone UNCHECKED moves the actual source object here, clearing its previous location", async () => {
    const project = await openEditorWithFixture({
      locationFiles: { "a.yaml": LOCATIONS_A_YAML, "b.yaml": LOCATION_A_WITH_CASE_FILE_YAML.replace(/id: a/, "id: b") },
      objectFiles: { "case.yaml": OBJECTS_A_YAML },
    });
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    clickNode(svg, "a", 10, 10);

    const section = locationSidebar().querySelector(".editor__placement-section")!;
    placeVia(section, "case-file", { clone: false });

    expect(document.querySelector(".editor__status")!.textContent).toMatch(/Moved "case-file" here from location "b"/);
    expect(section.textContent).toContain("case-file");
    expect(section.textContent).not.toMatch(/nothing placed here yet/i);

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const aText = (project.locationFileHandles["a.yaml"] as unknown as { writtenText: string | null }).writtenText;
    expect(aText).toContain("itemIds:");
    expect(aText).toContain("case-file");
    const bText = (project.locationFileHandles["b.yaml"] as unknown as { writtenText: string | null }).writtenText;
    expect(bText).not.toContain("itemIds");
  });

  it("Object part 'Contents': placing WITH clone checked adds an independent clone contained in that part", async () => {
    const project = await openEditorWithFixture({
      objectFiles: { "structure.yaml": OBJECTS_STRUCTURE_YAML, "case.yaml": OBJECTS_A_YAML },
    });
    findButton("Objects").click();
    Array.from(document.querySelectorAll<HTMLButtonElement>(".editor__object-list-item")).find((r) => r.textContent?.includes("desk"))!.click();

    const section = objectSidebar().querySelector(".editor__placement-section")!;
    expect(section.querySelector("h4")!.textContent).toBe("Contents");
    expect(section.textContent).toContain("torn-photograph"); // pre-existing containment from the fixture

    placeVia(section, "case-file", { clone: true });

    expect(document.querySelector(".editor__status")!.textContent).toMatch(/Placed a clone of "case-file" as "case-file-desk-drawer"/);
    expect(section.textContent).toContain("case-file-desk-drawer");

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const objectAdditions = (project.objectFileHandles["editor-additions.yaml"] as unknown as { writtenText: string | null }).writtenText;
    expect(objectAdditions).toContain("id: case-file-desk-drawer");
    expect(objectAdditions).toContain("containerId: desk");
    expect(objectAdditions).toContain("containerPartId: drawer");
  });

  it("Object part 'Contents': placing WITH clone UNCHECKED moves the source object in, clearing its previous location", async () => {
    const project = await openEditorWithFixture({
      locationFiles: { "a.yaml": LOCATION_A_WITH_CASE_FILE_YAML },
      objectFiles: { "structure.yaml": OBJECTS_STRUCTURE_YAML, "case.yaml": OBJECTS_A_YAML },
    });
    findButton("Objects").click();
    Array.from(document.querySelectorAll<HTMLButtonElement>(".editor__object-list-item")).find((r) => r.textContent?.includes("desk"))!.click();

    const section = objectSidebar().querySelector(".editor__placement-section")!;
    placeVia(section, "case-file", { clone: false });

    expect(document.querySelector(".editor__status")!.textContent).toMatch(/Moved "case-file" here from location "a"/);

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const caseFileText = (project.objectFileHandles["case.yaml"] as unknown as { writtenText: string | null }).writtenText;
    expect(caseFileText).toContain("containerId: desk");
    expect(caseFileText).toContain("containerPartId: drawer");

    const aText = (project.locationFileHandles["a.yaml"] as unknown as { writtenText: string | null }).writtenText;
    expect(aText).not.toContain("itemIds");
  });

  it("'Remove' from a placement list unplaces the object (back to storage) without deleting it", async () => {
    const project = await openEditorWithFixture({
      locationFiles: { "a.yaml": LOCATION_A_WITH_CASE_FILE_YAML },
      objectFiles: { "case.yaml": OBJECTS_A_YAML },
    });
    const svg = document.querySelector("svg")!;
    stubRect(svg);
    clickNode(svg, "a", 10, 10);

    const section = locationSidebar().querySelector(".editor__placement-section")!;
    findButtonIn(section, "Remove").click();

    expect(document.querySelector(".editor__status")!.textContent).toMatch(/Unplaced "case-file" — now in storage/);
    expect(section.textContent).toMatch(/nothing placed here yet/i);

    findButton("Locations").click();
    findButton("Objects").click();
    (document.querySelector(".editor__object-placement-filter") as HTMLSelectElement).value = "storage";
    (document.querySelector(".editor__object-placement-filter") as HTMLSelectElement).dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelectorAll(".editor__object-list-item")).toHaveLength(1);
    expect(document.querySelector(".editor__object-list-item")!.textContent).toContain("case-file");

    findButton("Save world").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const aText = (project.locationFileHandles["a.yaml"] as unknown as { writtenText: string | null }).writtenText;
    expect(aText).not.toContain("itemIds");
  });

  it("excludes a container from its own part's placement picker, so self-containment can't be selected in the first place", async () => {
    await openEditorWithFixture({ objectFiles: { "structure.yaml": OBJECTS_STRUCTURE_YAML } });
    findButton("Objects").click();
    Array.from(document.querySelectorAll<HTMLButtonElement>(".editor__object-list-item")).find((r) => r.textContent?.includes("desk"))!.click();

    const section = objectSidebar().querySelector(".editor__placement-section")!;
    const options = Array.from(section.querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value);
    expect(options).not.toContain("desk");
    expect(options).toContain("torn-photograph");
  });
});

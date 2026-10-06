# NPC Builder for the content editor

> Status: **All three stages implemented** (2026-09-23). See
> `docs/context.md` for the session handoff and `docs/architecture.md`'s
> "The NPC editor" for the as-built writeup of all three. Kept here as
> the original design record; the as-built Stage 2/3 sections deviate
> slightly from this original sketch in field names/validation details
> (see `docs/architecture.md` for exactly what shipped) — the general
> shape matches throughout. Knowledge/memories, mentioned as optional/
> stretch goals within Stage 3 below, were NOT included in what shipped —
> see `docs/open-issues.md`'s NPC-editor gap entry for that remaining
> scope.

## Context

The content editor (`src/editor/main.ts`) can create/edit Locations, WorldObjects, and Prefabs, but NPCs are entirely absent from authoring — `docs/editor_guide.md` says outright: "No UI for NPCs, transit lines, or passes — still hand-edit `world.yaml` directly for those." Every NPC (currently three: `officer-hale`, `cook-rosa`, `informant`, in the Ledger mini-case) exists only as hand-typed YAML. As the project moves toward building a more complex case with more NPCs, this becomes the bottleneck: authoring a new NPC today means hand-writing a nested YAML block, manually deriving locale keys, and getting no feedback until `npx tsc`/the dev server/a full editor "Save" surfaces a validation error days later.

This plan adds NPC creation/editing to the editor, matching its established conventions (mode tabs, draft/Save-Cancel-in-toolbar pattern, single shared validation banner, id-permanence, full-width red Remove button). Per the user's explicit decision, **this plan covers core NPC fields, schedule, and flat stat/trust/suspicion fields only** — `dialogueRules`/`topics` (which require authoring the deeply recursive `Condition`/`DialogueEffect` unions) are out of scope for this plan and remain hand-edited YAML, to be revisited separately once there's a clearer sense of how much dialogue-authoring volume actually needs a builder for them.

Three stages, each independently shippable (compiles, passes `npx tsc --noEmit && npx vitest run && npm run build`, editor fully usable at the end of each one):

- **Stage 1** — the `world.yaml` write-back infrastructure (currently doesn't exist at all) + minimal NPC CRUD (id, aliases, name, description, fallback dialogue, labels, starting location).
- **Stage 2** — the schedule editor (`ScheduleSlot[]`, optional — blank means "always in one place," the user's specific ask).
- **Stage 3** — trust/suspicion/stats (flat scalar extras).

## Key facts driving the design (verified against the actual code, not assumed)

- **Placement is not a field on `Npc`.** In YAML, `locationId` is a sibling key on the same npc mapping (like a location's `itemIds`), stripped by `cityLoader.ts`'s `validateNpc` into a separate `Placement.npcLocationId: Record<NpcId, LocationId>` map (part of `CityContent.initialPlacement`, `src/engine/types.ts`). The editor must handle an NPC's starting location as placement data, not a literal `Npc` property — same pattern already used for `city.initialPlacement.containedIn` (world-object containment).
- **`world.yaml` is entirely outside the editor's save pipeline today.** Locations/Objects/Prefabs each have their own `*FileHandles`/`*FileTexts`/`*Origin`/`dirty*Files` module-level maps (`src/editor/main.ts:71-103`) and a `regenerate*File(path)` that re-dumps (js-yaml `dump()`) every entity whose origin matches that file. `world.yaml`'s text (`worldYamlText`, `main.ts:89`) is read once in `openProject` (`main.ts:546-657`, specifically `newWorldText`/`worldHandle` at lines 555-578, 647) purely as validation context fed into `parseCity`; the handle (`worldHandle`, a local variable) is never stored, and `save()` (`main.ts:3136-3213`) never writes it back — its own comment (lines 3171-3175) explicitly says `world.yaml` is "left completely alone." This is the first, largest piece of new infrastructure Stage 1 needs, and everything else depends on it.
- **`parseCondition`/`parseDialogueEffects` are out of scope** since dialogueRules/topics aren't part of this plan — no changes needed to `cityLoader.ts`'s exports for that.
- **`parseMemoryShorthand` and `STAT_DEFINITIONS` are already independently exported** (`src/engine/npc/memory.ts`, `src/engine/stats/stats.ts` respectively) — reusable directly by the editor without touching `cityLoader.ts` at all, if Stage 3 ends up wanting them.
- **The only existing nested-repeatable-list UI precedent** is the WorldObject editor's Parts→States hierarchy (`buildPartBlock`/`buildStateBlock`, `main.ts:2531-2701`): each item is a bordered card (`.editor__part`/`.editor__state`) with a heading row (item label + inline "Remove" button) and stacked `fieldRow`-wrapped fields below; structural changes (add/remove) trigger a full re-render of the list via a `renderX()` closure (`renderParts`/`renderStates`), not incremental DOM patching. This is the template for Stage 2's schedule-slot list.
- **Reusable widgets to lean on directly**, all in `main.ts`: `fieldRow(labelText, fieldEl)` (~2797), `textInput(value, onInput)`/`textArea(value, onInput)` (~2806/2814), `fieldCheckbox`/`fieldCheckboxRow` (~2822-2837), `renderChecklist(container, ids, selectedSet, onToggle)` (~3009-3032, already used for the prefab editor's NPC/world-object decoration checklists — exact reuse for an NPC's `labels` multi-select), `button(label, onClick, opts)` (~471).
- **Validation is a single shared banner**, not per-field: `notice` (`<p class="editor__notice">`, amber) — every check across all three existing editors does `notice.hidden=false; notice.textContent="..."; return` and bails on first failure. A separate `status` banner (blue) shows non-error confirmations. No inline red-outline convention exists anywhere in this file — Stage 1-3 must not invent one.
- **Delete confirmation** uses a plain `window.confirm(multiLineMessage)` (not a custom modal), built from a `computeRemovalImpact`-style reference count (see `main.ts:1397-1420` for the location version) — some references block/cascade, NPC/item references today are informational-only warnings (no fixup path exists), and this plan keeps that posture.
- **Ids are permanent once created**, for every existing entity type — locked input after first Save, an explicit `docs/editor_guide.md` convention NPCs must follow too.
- **NPC text is required, not optional.** Unlike some WorldObject fields (soft-written to locale only `if (...trim())`), `validateNpc`/`validateText` in `cityLoader.ts` hard-require non-empty `text.en.{name,description,dialogue}`. Stage 1's validation must block (not silently skip) on blank name/description/dialogue.

## Stage 1 — `world.yaml` write-back infrastructure + minimal NPC CRUD (IMPLEMENTED)

### World.yaml write-back mechanism

Rather than reconstructing `labels:`/`facts:`/`transitLines:`/`passes:`/`notebookProducts:` from their already-parsed, locale-stripped `city.*` typed records (which would need new "toRaw" reversal logic for content this feature never edits — pure risk, no payoff), parse `worldYamlText` **once at project-open** into a plain raw object via js-yaml's `load()`, and keep that raw object as the living source of truth for `world.yaml`'s on-disk shape. Mutate only its `npcs` array in place; leave every other top-level key (`labels`, `facts`, `transitLines`, `passes`, `notebookProducts`) untouched and opaque.

- New module state (near the other `*Handle`/`*Texts` declarations, `main.ts:71-103`):
  ```ts
  let worldYamlHandle: FileSystemFileHandle | null = null;
  let worldRaw: Record<string, unknown> | null = null; // load(worldYamlText) at open time; worldRaw.npcs is mutated directly
  let dirtyWorldFile = false; // one file, so a boolean suffices (unlike the per-file dirty Sets)
  ```
- In `openProject` (`main.ts:546-657`): store `worldYamlHandle = worldHandle;` and `worldRaw = load(newWorldText) as Record<string, unknown>;` alongside the existing `worldYamlText = newWorldText;` (line 647). Guard with `isRecord(worldRaw)` (already exported from `cityLoader.ts`), same notice-banner-and-bail pattern as the existing `parseCity`/`parsePrefabs` failure handling a few lines up. Reset `dirtyWorldFile = false;` alongside the other dirty-set resets (line 646 area).
- New function, modeled directly on `regenerateObjectFile` (`main.ts:1959-1966`):
  ```ts
  function regenerateWorldFile(): void {
    if (!worldRaw) return;
    worldYamlText = dump(worldRaw);
    dirtyWorldFile = true;
  }
  ```
- **As-built deviation**: instead of a standalone `npcToRaw` that fully reconstructs an NPC's raw YAML mapping, the implementation uses `upsertNpcRaw(npc: Npc)`, which MERGES the Stage-1-editable fields (`id`, `aliases`, `locationId`, `labels`, `text`) onto whatever raw entry already exists for that id in `worldRaw.npcs`, rather than replacing it — this is what lets fields with no Stage-1 UI (`dialogueRules`/`topics`/`schedule`/`stats`, and initial trust/suspicion/knowledge/memories) survive an edit untouched. This is a correctness fix over the original sketch below, which would have silently dropped those fields on any edit of an existing NPC (e.g. Officer Hale, who already has `dialogueRules` and a `schedule` authored). See `commitNpcDraft`'s doc comment in `main.ts` for the full rationale.
- `save()` (`main.ts:3136-3213`): extend the top guard (line 3137) to also require `worldYamlHandle`, and add a fourth write branch after the prefab-files loop (mirroring the existing per-category loops, but for the single boolean instead of a `Set`):
  ```ts
  if (dirtyWorldFile && worldYamlHandle) {
    const writable = await worldYamlHandle.createWritable();
    await writable.write(worldYamlText);
    await writable.close();
    dirtyWorldFile = false;
  }
  ```
  The existing pre-save `parseCity(...)` revalidation (lines 3143-3153) already feeds it the current `worldYamlText`, so an invalid NPC edit blocks the whole save exactly like an invalid location/object edit does today — no new validation call site needed.
- Update `save()`'s comment at lines 3171-3175 ("world.yaml... left completely alone") — no longer fully true; note that `world.yaml` is now rewritten in full (comment/formatting loss, same known limitation as location/object files) whenever an NPC was touched this session, but left alone otherwise.
- Update the file's top-of-file doc comment (`main.ts:1-49`) — it says NPCs have no editor UI; narrow that to "core fields, schedule (Stage 2), and stats/trust/suspicion (Stage 3) are editable; `dialogueRules`/`topics` remain hand-edit-only."

### Mode/tab and layout

- Extend `editorMode` to `"locations" | "objects" | "prefabs" | "npcs"`. Add `npcsTabButton = button("NPCs", () => setEditorMode("npcs"))` alongside the other three tab buttons (`main.ts:223-225`), append to the tab group (line 308) and to `tabButtons()` (line 496).
- Extend `setEditorMode` (`main.ts:435-470`): close `npcDraft` on mode-leave (mirror `if (prefabDraft) endPrefabForm();`), toggle `.hidden` on `npcListPanel`/`npcSidebar.root`/an "Add NPC" toolbar button, call `populateNpcList()` when entering `"npcs"`.
- **Layout: follow the Objects-mode pattern** (fixed-width searchable list panel + an always-visible sidebar showing a placeholder when nothing's selected), not the Prefabs-mode hide/show pattern — an NPC catalog is small but authors will want to jump between NPCs to compare fields, and an always-visible sidebar avoids an extra click. Concretely: `npcListPanel` (search input + scrolling list, mirroring `objectListPanel`) and `npcSidebar` (mirroring `objectSidebar`'s always-mounted-in-DOM structure). No placement-filter dropdown needed at this catalog size.
- New CSS in `editor.css`: `.editor__sidebar--npc` (mirrors `.editor__sidebar--object`'s always-visible width:auto/flex:1 rule); the list panel/mount reuse the existing `.editor__object-list-panel`/`.editor__object-list` classes with `--npc` suffix variants for test/CSS targeting (mirroring how the prefab list already does this), rather than inventing new base classes.

### Draft state and functions

```ts
let npcDraft: {
  editingId: string | null;
  aliasesCsv: string;
  name: string;
  description: string;
  dialogue: string;    // fallback dialogueKey text
  locationId: string;  // starting placement — sibling data, not an Npc field
  labels: Set<string>;
} | null = null;
```

- `startAddNpc()` / `startEditNpc(id)` — mirror `startAddObject`/`startEditObject` (`main.ts:~2027-2050`): build the draft (edit case reads from `city.npcs[id]`, `city.derivedLocale[selectedLanguage]`, and `city.initialPlacement.npcLocationId[id]`), disable tab-switch buttons for the duration, `npcSidebar.open(npcDraft)`, `populateNpcList()`.
- `commitNpcDraft(id)` — validation checks (single `notice` banner, first-failure-wins, mirroring `commitObjectDraft`'s granularity at `main.ts:2092-2135`):
  1. New NPC + blank id → "NPC id is required."
  2. New NPC + id already in `city.npcs` → `"${id}" already exists — choose a different id.`
  3. `locationId` blank or not in `city.locations` → "Pick a valid starting location."
  4. Blank name/description/dialogue → block each (NPC text is required, unlike some optional WorldObject text fields — see Key Facts above).
  5. Any label in `npcDraft.labels` not in `city.labels` → block (shouldn't normally happen since it's driven by `renderChecklist` off the known catalog, but guards against a stale draft).

  On success: build the `Npc` object (spreading the PREVIOUS typed `Npc` forward first, for edits, so `dialogueRules`/`schedule`/`stats`/`topics` survive in memory too — see the as-built deviation note above), `city.npcs[finalId] = npc`; write `name`/`description`/`dialogueKey` into `city.derivedLocale[selectedLanguage]`; set `city.initialPlacement.npcLocationId[finalId] = npcDraft.locationId`; call `upsertNpcRaw(npc)` (merges onto `worldRaw.npcs`, calls `regenerateWorldFile()`); `endNpcForm()`; `populateNpcList()`.
- `endNpcForm()` — mirror `endObjectForm()`: clear `npcDraft`, re-enable buttons, close sidebar, repopulate list.
- `removeNpc()` — mirror `removeLocation`'s warn-then-delete shape: check whether any prefab's NPC-decoration list (`city.npcs` keys backing `renderChecklist(npcsChecklist, ...)`, `main.ts:3121`) references this id — informational-only warning via `window.confirm` (same posture as today's location-delete NPC/item warnings, since there's no fixup path). On confirm: delete `city.npcs[id]`, delete `city.initialPlacement.npcLocationId[id]`, delete `city.initialNpcStates[id]`, splice out of `worldRaw.npcs`, `regenerateWorldFile()`.
- `populateNpcList()` — mirror `populateObjectList()` (`main.ts:1975-2015`): id-sorted rows (`id — name (starting location)`), filtered by a search box on id/name substring, click → `startEditNpc(id)`.
- `buildNpcSidebar()` — mirror `buildObjectSidebar`/`buildPrefabSidebar` structure: `<h2>` title ("Add NPC"/"Edit NPC"), locked-once-set id input, `fieldRow`-wrapped aliases (CSV)/name/description/dialogue (`textArea`)/starting-location (`<select>` from `Object.keys(city.locations)`), a "Labels" `<h3>` + `renderChecklist` (exact reuse of the prefab-editor widget), and — last, per the editor's established convention — one full-width `.editor__remove-button` "Remove NPC" wired to `removeNpc()`.

### Delete-impact note

`computeRemovalImpact` (`main.ts:1397-1420`) already warns about `npcIds` referencing a deleted location via `npcsAtLocation` — this already covers an NPC's starting placement once `city.initialPlacement.npcLocationId` is populated (it already is, today, read-only). No change needed here in Stage 1.

## Stage 2 — Schedule editor (NOT YET IMPLEMENTED)

Ships right after Stage 1 (not deferred to the end) since it's flat/non-recursive and is the feature the user specifically asked for.

- Draft field: `npcDraft.schedule: { fromHour: string; toHour: string; locationId: string; weekdays: Set<number> | null }[]` — `weekdays: null` means "every day" (field omitted in YAML); an empty array (`npcDraft.schedule.length === 0`) means no schedule authored at all (field omitted entirely — this realizes "blank = NPC always stays at its starting location").
- UI, following the Parts→States card pattern (`main.ts:2531-2701`): a "Schedule" section, a stack of `.editor__schedule-slot` cards each with a heading row (`Slot N` + inline "Remove" button) and fields: `fromHour`/`toHour` as `<input type="number" min="0" max="24">` (matches this editor's plain-forms style — no need for a dropdown over a 0-24 range), `locationId` as a `<select>` (same options list as the starting-location field), and weekdays as an "Every day" checkbox that, when checked, hides a row of 7 day checkboxes (Sun..Sat, via `fieldCheckboxRow`). A "+ Add schedule slot" button pushes a new blank slot (defaults: fromHour 8, toHour 18, locationId = the NPC's own starting location, every day) and calls a `renderScheduleSlots()` full-re-render closure, exactly mirroring `renderParts()`/`renderStates()`. When the list is empty, show a one-line hint ("No schedule — NPC stays at its starting location") so the "blank" semantics are visible in the UI, not just an absence.
- Validation (appended to `commitNpcDraft`'s check chain):
  - Each slot's `fromHour`/`toHour` must parse as integers, `fromHour` in `[0,23]`, `toHour` in `[0,24]` — block if invalid.
  - `locationId` must exist in `city.locations` — block if not.
  - `fromHour === toHour` → block ("Slot N has zero duration.") — a degenerate always-false window, certainly an authoring mistake even though it'd parse fine.
  - `fromHour > toHour` (wraps past midnight) → **do not block** — this is explicitly valid per `ScheduleSlot`'s own doc comment in `types.ts`. No special UI needed; it should just save.
- `upsertNpcRaw`/text-building extension: emit `schedule: [{fromHour, toHour, locationId, ...(weekdays !== null ? {weekdays: [...weekdays].sort()} : {})}]` only if `npcDraft.schedule.length > 0`; omit the key entirely otherwise. Since `upsertNpcRaw` already merges onto the existing raw entry, this is an additional field it explicitly overwrites (like `labels`/`aliases` today), not a new merge concern.

## Stage 3 — trust / suspicion / stats (NOT YET IMPLEMENTED)

- `trust`/`suspicion`: two plain number `fieldRow`s, default 0, written into the raw entry only if non-zero (mirrors the loader's own default-0 and this editor's "only write non-default optional fields" convention elsewhere).
- `stats`: import `STAT_DEFINITIONS`/`StatKey` directly from `src/engine/stats/stats.ts` (already exported — no `cityLoader.ts` change needed) for the three keys (`stealth`/`intimidation`/`handguns`) and their min/max; three number `fieldRow`s with the min/max shown as a hint (e.g. placeholder or adjacent text) and enforced as a blocking validation check on commit.
- `knowledge`/`memories` are lower priority (no NPC in `world.yaml` currently authors either) — treat as optional/stretch within this stage; if included, `memories` can reuse `parseMemoryShorthand` (already exported from `src/engine/npc/memory.ts`) directly for commit-time validation of a one-shorthand-string-per-line textarea, avoiding a duplicate parser. If time-constrained, leave these two as a documented remaining gap rather than blocking the stage.

## Testing (per `src/editor/main.test.ts`'s existing `describe("editor — ...")` pattern)

- **Stage 1 (done)**: `describe("editor — NPCs tab")` (list rendering, search, empty state, mode-switching); `describe("editor — Add/Edit NPC sidebar")` (commit, duplicate-id validation, required-field validation, Cancel, and — the critical regression test — editing an existing NPC preserves `dialogueRules`/labels it has no UI for); `describe("editor — NPC Remove/Save")` (confirm dismiss/confirm, `world.yaml` write verified via the fake `FileSystemFileHandle`'s `writtenText`); the "contextual draft Save/Cancel toolbar group" describe block extended to cover the NPC draft case. 14 new tests, 88/88 passing.
- **Stage 2**: schedule slot add/remove/edit tests; validation tests for `fromHour === toHour` (blocked) and an explicit "wraps past midnight is accepted, not blocked" test (an easy regression to accidentally "fix" into a false rejection later); locationId-must-exist test.
- **Stage 3**: trust/suspicion/stat value round-trip tests, stat min/max blocking test.
- Any stage needing a richer test fixture: extend the test project's fixture `world.yaml` with additional NPCs as needed to exercise edit/delete flows realistically.

## Docs to update (same change, per CLAUDE.md)

- **Stage 1 (done)**: `docs/editor_guide.md` (new "The NPCs tab" section, toolbar/draft-kind lists, "What's not here yet", writing-to-disk section), `docs/architecture.md` (new "The NPC editor" subsection plus several corrected stale-claim paragraphs), `docs/open-issues.md` (rewrote the NPC/transit-lines/passes gap entry), `docs/systems/npcs.md` ("Known gaps"), `docs/systems/stats.md`, `docs/content-schema.md`, `docs/README.md`, `main.ts`'s own doc comments.
- **Stage 2**: `docs/systems/npcs.md`/`docs/editor_guide.md`/`docs/open-issues.md` — remove the schedule-specific "known gap" lines once Stage 2 lands.
- **Stage 3**: same treatment for trust/suspicion/stats(/knowledge/memories if included).
- Throughout: keep `docs/systems/npcs.md`'s "Known gaps" section stating that `dialogueRules`/`topics` remain hand-edit-only by deliberate scope decision (not an oversight), so a future session doesn't assume it's an accidental gap.

## Critical files

- `src/editor/main.ts` — all new editor logic (mode/tab wiring, draft state, sidebar builder, world.yaml write-back).
- `src/editor/editor.css` — new NPC list/panel styling, reusing existing class patterns.
- `src/editor/main.test.ts` — new test coverage per stage.
- `src/content/cityLoader.ts` — read-only reference for validation rules to mirror (`validateNpc`, `validateText`, `isRecord`); no changes needed unless Stage 3 pulls in `parseMemoryShorthand`/`STAT_DEFINITIONS`, both already exported elsewhere.
- `src/engine/types.ts` — read-only reference for `Npc`/`ScheduleSlot`/`Placement` shapes.
- `docs/editor_guide.md`, `docs/architecture.md`, `docs/systems/npcs.md`, `docs/open-issues.md` — doc updates per stage.

## Verification

After each stage: `npx tsc --noEmit && npx vitest run && npm run build`. Since `world.yaml` write access uses the File System Access API (same as existing location/object/prefab saves), it can't be exercised by a real browser file picker in an automated test — follow the existing pattern in `main.test.ts` for mocking `FileSystemDirectoryHandle`/`FileSystemFileHandle`/`showDirectoryPicker` (already used to test Save for locations/objects/prefabs) rather than inventing a new mocking approach. After Stage 1 lands, ask the user to manually open a real project folder, add an NPC through the UI, hit Save, and confirm `world.yaml` on disk gained a correctly-shaped `npcs:` entry with correct locale keys (a File System Access API flow genuinely needs eyes-on browser confirmation per CLAUDE.md's working agreement, same as any other editor save path). **Especially test editing Officer Hale** (the one real NPC with `dialogueRules`+`schedule` already authored) — that's the real-world version of the field-preservation regression test.

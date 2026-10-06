# NPC editor — manual test plan

Automated tests (`src/editor/main.test.ts`) mock the File System Access API
and cover logic thoroughly, but nobody has exercised the NPC editor through
a real browser with a real project folder yet. This doc tracks the manual
checks to run per stage — check items off as you verify them by hand.

## Stage 1 — core fields + world.yaml write-back

- [ ] Open the real `text-detective` project folder via the editor's "Open
      project" button.
- [ ] Click the **NPCs** tab — confirm the existing three NPCs
      (`officer-hale`, `cook-rosa`, `informant`) list correctly (id, name,
      starting location).
- [ ] Click `officer-hale` in the list — confirm the sidebar populates with
      his current name, description, dialogue, aliases, starting location,
      and labels.
- [ ] Edit his display name only (e.g. append " Jr." temporarily, or just
      confirm the field accepts an edit), click **Save** (draft), then
      click **Save world** in the toolbar.
- [ ] Open `src/content/city/world.yaml` on disk and confirm:
  - The name changed as expected.
  - `dialogueRules` for `officer-hale` is still present and unchanged.
  - `schedule` for `officer-hale` (if authored) is still present and
    unchanged.
  - No other NPCs' entries changed.
  - `labels:`, `facts:`, `transitLines:`, `passes:` top-level sections are
    byte-for-byte unchanged (aside from expected re-serialization
    formatting differences from js-yaml's `dump()` — comments will be
    stripped, which is the known/accepted limitation already true of
    Location/Object/Prefab saves).
- [ ] Click **Add NPC**, fill in a new throwaway id/name/description/
      dialogue/starting location, Save draft, Save world — confirm the new
      NPC appears correctly in `world.yaml` and the game still loads
      (`npm run dev`, walk to the NPC's location, `talk` to them).
- [ ] Delete the throwaway NPC via the Remove button, confirm the
      `window.confirm` warning text is sensible, confirm it's gone from
      `world.yaml` after Save world.
- [ ] Revert the temporary edits to `officer-hale` (`git checkout --
      src/content/city/world.yaml` or manually undo) before continuing,
      unless the edits are intentionally being kept.

## Stage 2 — schedule editor

- [ ] Edit `officer-hale` (who has an authored `schedule` in `world.yaml`)
      — confirm his existing schedule slots load correctly into the
      Schedule section (correct fromHour/toHour/locationId/weekdays per
      slot).
- [ ] Add a new schedule slot, set a valid time range and location, Save
      draft + Save world — confirm the new slot appears correctly shaped
      in `world.yaml` (including that `weekdays` is omitted when "Every
      day" is checked, and included/sorted when specific days are picked).
- [ ] Remove a schedule slot, Save — confirm it's gone from `world.yaml`
      and no other slots were reordered/mutated.
- [ ] Try to Save a slot with `fromHour === toHour` — confirm the shared
      notice banner blocks the save with a clear message.
- [ ] Try a slot with `fromHour > toHour` (e.g. 22 → 6, an overnight
      shift) — confirm this is accepted, not blocked, and round-trips
      correctly through `world.yaml`.
- [ ] Create an NPC with **no** schedule slots at all — confirm `schedule`
      key is omitted entirely from that NPC's YAML (not written as `[]`),
      and confirm in-game the NPC stays at its starting location at all
      times.
- [ ] In-game: walk an NPC through a full schedule day boundary (if the
      dev clock can be advanced/inspected) and confirm they actually move
      per the authored schedule — this exercises the schedule *consumer*,
      not just the editor, but is the real end-to-end confirmation the
      editor's output is correct.

## Stage 3 — trust / suspicion / stats

- [ ] Edit an NPC's trust/suspicion to non-zero values, Save world, confirm
      they appear in `world.yaml`'s `initialNpcStates` (or wherever they're
      written) and are 0/omitted when left at default.
- [ ] Edit stat values within range — confirm they save correctly.
- [ ] Try a stat value outside its registry min/max — confirm the notice
      banner blocks the save.
- [ ] (If knowledge/memories shipped) author a memory shorthand line,
      confirm it parses and round-trips correctly.

## General regression checks (run once after all stages land)

- [ ] `npx tsc --noEmit`, `npx vitest run`, `npm run build` all clean
      (aside from the pre-existing unrelated `diner-upper-floor` failure).
- [ ] Full editor smoke test: Locations, Objects, and Prefabs tabs still
      work exactly as before — nothing in the NPC/world.yaml work
      regressed the other three tabs' save paths.

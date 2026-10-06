# Text Detective — Project Guide

An open-world, text-based detective game. The player walks around locations,
talks to NPCs, collects items/clues, and reasons toward solving cases. This is
a **systems simulation** (NPC state, inventory, navigation graph, event log,
deduction) — not a linear or branching narrative like Twine/Ink content.

## Architecture — non-negotiable boundaries

These decisions were made deliberately after weighing alternatives (Phaser,
Ink, Twine, native TUI). Do not casually revisit them; if a change seems
needed, flag it explicitly and explain what new constraint forced it.

1. **Engine is headless and synchronous.** Core simulation logic (movement,
   inventory, NPC state, dialogue resolution, case/deduction state) lives in
   plain TypeScript with zero DOM/rendering/animation/timing awareness. Engine
   calls (`movePlayer`, `takeItem`, `askNPC`, etc.) return a result plus a
   list of structured **events** immediately — never a Promise, never a wait.
   This keeps the simulation trivially testable (call a function, assert
   state) and reusable under any future view layer, including headless (e.g.
   in Node for tests) or a native app shell.

2. **View layer owns time and rendering.** Anything that needs to wait —
   animations, timed reveals, typewriter effects — is the view layer walking
   the engine's event list and choosing to `await` between events. The engine
   itself never knows this waiting happens. The current view is a
   browser-based styled-`<div>` terminal (scrollback + input line), but the
   architecture assumes future views (different layout, panels, images,
   eventually a fully custom UI) will be swapped in against the same engine
   output without touching engine code.

3. **Content is data, not code.** Rooms, NPCs, items, dialogue, and cases are
   defined as data (JSON/TS objects), not hardcoded control flow. Adding a
   room or suspect should not require touching engine logic.

4. **No player-facing string is ever inline.** All UI chrome and game content
   text is referenced by a translation **key**
   (e.g. `room.docks.description`, `ui.inventory.title`,
   `npc.barkeep.greeting`) and resolved through a per-language table at
   render time, with `{placeholder}` interpolation for dynamic text. This is
   built in from the start for localization, not retrofitted later.

5. **Packaging is a later, non-architectural step.** The app is a standard
   web bundle; wrapping it into a desktop `.exe` (Tauri preferred, Electron
   as fallback) happens without changes to engine or view code.

6. **Save/load only persists the mutable-state slice of `GameState`, never
   content.** `GameState` splits into authored content (`locations`, `items`,
   `npcs`, `transitLines`, `passes` — loaded fresh from
   `src/content/city/world.yaml` via `cityLoader.ts` every launch, never
   written to a save) and mutable progress (`player`, `clock`, and any future
   sibling — case/deduction state, dialogue flags, NPC relationship/schedule
   state). A save file captures only the mutable slice; loading reloads
   content from disk and merges the saved slice on top. This means:
   - Any new system's persistent state (a case-progress tracker, an NPC
     schedule, a dialogue-flag set, ...) must live in the mutable slice
     (`Player` or a new sibling struct next to it), not mixed into a content
     record — otherwise it silently won't survive save/load.
   - Every field added to the mutable slice must be JSON-safe (plain
     records/arrays/primitives — no `Map`/`Set`, no class instances with
     methods, no circular references), since it round-trips through
     serialization.
   - Any change to the mutable slice's shape needs a save-schema version
     bump and a migration path — assume existing saves must keep loading.
   - No save/load system exists yet (see `docs/architecture.md`); this rule
     applies from the first implementation onward, and to every system added
     before or after it.

## Tech stack

- **Language:** TypeScript
- **Runtime target:** Browser (instantly playable, no install), packageable
  later via Tauri/Electron
- **No game framework** (Phaser, etc.) — this is a systems/data simulation,
  not a rendering-heavy game; a framework would add overhead without benefit.

## Documentation requirements (always in effect)

Documentation is a first-class deliverable of this project, not an
afterthought. For every system or non-trivial change:

- **Inline documentation:** every module, class, and public function gets a
  short doc comment explaining *what it does and why*, not a restatement of
  the code. Non-obvious invariants, constraints, or "why this shape and not a
  simpler one" belong here.
- **External documentation:** the `/docs/` folder is the source of truth for
  how the systems work and how they interact. When you add or change a
  system (a new engine module, a new event type, a new content schema),
  update the relevant doc in `/docs/` in the same change — not as a
  follow-up.
- Docs should describe: what each system does, what its public
  capabilities/API are, and — critically — **how systems interact with each
  other** (e.g. "taking an item can trigger an NPC reaction event," "moving
  rooms can advance case state"). This cross-system interaction map is the
  most valuable and most easily lost documentation, so keep it current.
- See `/docs/README.md` for the current documentation index.

## Working agreement

- Confirm architecture-level decisions with the user before implementing;
  implementation details within an agreed architecture don't need sign-off.
- Keep the engine/view boundary strict even under time pressure — this is
  the one thing that's expensive to fix retroactively.
- The user has declined to install the Claude in Chrome extension — do not
  suggest it. Verify frontend/browser behavior via headless tests (Vitest
  against the engine), build/dev-server checks, or other non-browser means.
  If something genuinely needs eyes-on browser verification (visual
  layout, DOM interaction, rendering), ask the user to check it manually
  rather than reaching for a browser tool.

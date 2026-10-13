# System: Engine Core (`src/engine/`)

## What it does

Owns and mutates all game world state: the player's location and
inventory, location contents, NPC placement, and the simulated clock.
Exposes it only through discrete, synchronous action methods on
`GameEngine`. Navigation/pathfinding is substantial enough to have its own
doc — see `docs/systems/navigation.md` — as does time — see
`docs/systems/time.md` — as do skill checks — see
`docs/systems/checks.md`.

`GameEngine`'s constructor takes an optional second parameter,
`rng: () => number = Math.random` — a `[0, 1)` random source, still
synchronous, injectable by tests for deterministic skill-check
assertions. This is the first and only place the engine needs
randomness at all; every existing `new GameEngine(state)` call site is
unaffected since the parameter is optional and defaults to real
randomness.

## Public capabilities

| Method | Effect | Failure mode |
|---|---|---|
| `look()` | Returns a description event for the current location | never fails |
| `travelTo(query)` | Compass hop or pathfound multi-hop travel; advances the clock — see `docs/systems/navigation.md` | `move_blocked`, `location_not_found`, `route_not_found`, `already_there` |
| `checkTime()` | Returns the current simulated day/time | never fails |
| `takeItem(query)` | Moves a matched, portable item from location to inventory | `item_not_found` / `item_not_portable` |
| `listInventory()` | Describes current inventory | never fails (empty case has its own event) |
| `talkTo(query)` | Returns the matched NPC's dialogue event (a flag-gated `dialogueRules` override if one matches, else `dialogueKey`); clears focus, sets `flags["talkedTo.<npcId>"]`, and records a `spoke-to` memory on success; `when` conditions are evaluated too — see `docs/systems/dialogue.md` and `docs/systems/npcs.md`. `takeItem` and successful travel likewise emit witnessed observations, and `syncClock` syncs scheduled NPC locations | `npc_not_found` |
| `examine(query)` | World object/NPC (unchanged, now including reachable contained objects — see `docs/systems/parts.md`'s "Containment"), falling back to a `Part` of some object in scope. Focuses an object with parts; clears focus for a plain object/NPC. Also sets the transient, unsaved `examinedTarget` (objects, NPCs and parts alike), which `getSceneImage` reads; `clearFocus` clears both. | `event.partNotFocused`, `examine_not_found` |
| `interact(verb, query)` | Transitions a focused (or `important`-surfaced) part's state — the engine side of `open`/`close` — see `docs/systems/parts.md` | `event.itemNotFound`, `event.partNotFocused`, `event.partVerbNotApplicable` |
| `unfocus()` | The `back`/`stop` command — clears focus explicitly | never fails |
| `getFocusedWorldObject()` | Read-only getter for the currently-focused world object, if any | never fails |
| `getSceneImage()` | Which image the scene pane should show: the examined object's (part-state image, else its own), the examined NPC's, else the location's. Pure function of `examinedTarget` + `partStates`; see `docs/systems/image-pane.md` | never fails |
| `getStealthConcealment(locationId?)` | Player stealth vs. a location's visibility, resolved as a `CheckResult` — see `docs/systems/checks.md` | never fails |
| `toggleStealth()` | The `sneak` verb — flips `Player.stealthMode`, rolling concealment immediately for the current location when turning on — see `docs/systems/checks.md` | never fails |

All methods return `ActionResult = { ok, events }`. `events` is the
authoritative record of what happened; `ok` is a convenience flag.

`ICommandParser.parse(raw: string) → Command` (see
`docs/systems/parsing.md`) turns free text into a `Command` union the view
dispatches against `GameEngine`. Parsers have no dependency on
`GameEngine` or world state — purely lexical.

## How it interacts with other systems

- **Content (`src/content/`)** supplies the `GameState` the engine
  operates on (`createInitialState()`). The engine has no hardcoded
  knowledge of any specific location/item/NPC — everything is data lookup
  by ID.
- **Localization (`src/i18n/`)** is never called by the engine directly.
  The engine only ever emits `textKey`s; resolving them to display text is
  entirely the view's responsibility, via `t()`.
- **View (`src/view/`)** is the only caller of engine action methods.
  Today that's `TerminalView`; the engine has no knowledge of what calls
  it, which is the point.

## Known gaps (expected to grow)

- Fixed, content-authored skill-like stats (`stealth`/`intimidation`/
  `handguns`) exist for both Player and NPC — see `docs/systems/stats.md`.
  Dynamic NPC internal state (mood, suspicion, knowledge that changes
  during play) mostly does NOT — `GameState.flags` plus `Npc.dialogueRules`
  (see `docs/systems/dialogue.md`) now let an NPC's line vary by a global
  flag, but there's no per-NPC mood/suspicion, and no other system yet
  writes a flag besides `talkTo`'s own `talkedTo.<npcId>`. When richer
  dynamic state lands, document it here and cross-reference how dialogue
  selection reads it — and how it might read the game clock (see
  `docs/systems/time.md`) for schedules.
- A first, deliberately minimal case/deduction slice exists — see
  `docs/systems/case-system.md`: the player can learn `Fact`s and see them
  in a facts panel, but there is still no event log and no cross-
  referencing/contradiction detection (and, deliberately, never will be
  from the engine side). A case board (`docs/systems/case-board.md`, all
  three stages built) now gives the player their OWN spatial view — a
  full-screen corkboard of draggable cards and player-drawn colored
  strings — but it's purely player-authored; nothing here infers a
  connection or a conclusion on the player's behalf.
- Basic part-interaction (`open`/`close`, focus-based targeting, and a
  containment mechanic — see `docs/systems/parts.md`) now exists, but no
  item-combination or use-item-on-target verbs.

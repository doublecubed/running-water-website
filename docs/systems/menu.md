# System: Menu Flow (`src/view/menu/`)

## What it does

A domain-agnostic, multi-screen menu system for `TerminalView` — built for
the bare `travel` command, but deliberately knowing nothing about travel.
Two files:

- **`MenuFlow.ts`** — the mechanism: `MenuScreen` (a `ChoiceMenuScreen`
  numbered-list or a `PromptMenuScreen` free-text prompt), `MenuOutcome`
  (what happens after a selection/submission: `goto` push, `restart`
  clear-and-push, `back` pop, or `exit` close-with-optional-events), and
  `MenuFlow` (the screen stack itself — `start`/`push`/`back`/`clear`).
  A `ChoiceMenuScreen` option (`MenuOption`) can also carry `aliases` —
  extra lowercase words (a mode/category name, `"fastest"`/`"cheapest"`
  when earned — see `docs/systems/economy.md`) that select it directly;
  `MenuFlow` itself never inspects them, matching is
  `TerminalView.handleMenuInput`'s job, same as the numbered-position
  fallback. Zero DOM, zero `GameEngine` dependency — pure state,
  unit-tested headlessly (`MenuFlow.test.ts`) exactly like engine code,
  even though it lives under `src/view/` (it owns interaction-mode state,
  which is a view concern per CLAUDE.md's engine/view boundary —
  `GameState` never has a "current menu").
- **`travelMenus.ts`** — the first domain built on top of it:
  `buildDirectConnectionsScreen(engine)` is the screen behind bare
  `travel`, plus two private screen-builders for the "ask about
  somewhere else" sub-flow. This file is where `GameEngine` calls
  (`listDirectConnections`, `inquireTravel`, `travelToConnection`,
  `travelTo`) get turned into `MenuOption`/`MenuScreen` objects — the
  engine itself returns plain `ActionResult`s and knows nothing about
  screens or menus.
- **`disambiguationMenus.ts`** — the second domain, proving the
  abstraction generalizes: `buildDisambiguationScreen(header, choices,
  resolve)` turns a `ResolutionChoice[]` (an ambiguous `examine`/
  `takeItem` target — see `docs/systems/parts.md`'s "Ambiguous targets")
  into a one-shot choices screen. Unlike `travelMenus.ts`, it's
  verb-agnostic — the caller (`TerminalView`'s `WORLD_OBJECT_RESOLVERS`
  table) supplies `resolve`, so this file has no idea whether it's
  backing `examine` or `takeItem`, only that picking an option should
  call `resolve(id)` and exit.
- More domains have been added since (`buyMenu.ts` for bare `buy`,
  `notebookMenus.ts` for notebook selection/actions, `npcMenus.ts` for
  the NPC topic menu — see `docs/systems/notebooks.md`/`dialogue.md`),
  each following the same shape: a plain function building a
  `MenuScreen` from `GameEngine`/content state, no changes to
  `MenuFlow` itself. **`panelMenus.ts`** (added 2026-09-23) is the first
  domain with NO `GameEngine` dependency at all — bare `panel <slot>`
  (see `docs/systems/parsing.md`'s "Side panels") is purely a
  `TerminalView`-owned choice (which content a slot shows isn't engine
  state), so `buildPanelMenuScreen(slot, setContent)` takes a plain
  callback instead of an `engine` argument.
- **Not every choice list uses `MenuFlow`.** The case board's "+ Add
  node" dropdown (`src/view/boardView.ts`'s `renderAddNodeMenu`, see
  `docs/systems/case-board.md`) is plain DOM instead, because `MenuFlow`
  screens render into the terminal scrollback — which sits entirely
  BEHIND a full-screen overlay like the board or the notebook page view,
  so it has no way to be shown while one is open. The notebook overlay's
  own "+ New note" affordance (`TerminalView.renderNewNoteDraft`) is the
  same case, predating the board. `MenuFlow` is for choices reachable
  from the plain terminal view, not from inside another overlay.

## Why this replaced Stage 4's `PendingChoice`

Stage 4 (see `docs/systems/economy.md`) built a narrower mechanism:
`ActionResult.choices`, remembered by `TerminalView` for exactly one
following input. That worked for a single flat list, but the travel-menu
flow needs to persist across several turns and mix two input modes
(numeric selection vs. free-text destination entry) — `PendingChoice`'s
"exactly one more input" assumption doesn't hold. Rather than build a
second, travel-only mechanism for this, `MenuFlow` generalizes and
subsumes it: the old `inquire` command's one-shot behavior is now just a
particular path through this same flow (see below), so there is exactly
one interaction mechanism in the codebase, not two. `ActionResult.choices`
itself is unchanged and still exists — `travelMenus.ts` is simply where
it now gets consumed, instead of `TerminalView` doing it directly.

## The `travel` menu flow

```
bare "travel"
  → buildDirectConnectionsScreen: "Pick a custom destination" FIRST
    (always position 1, regardless of how many connections follow —
    deliberate, so the player can rely on muscle memory rather than
    reading the list each time to find it), then one option per direct
    connection (immediate travel via travelToConnection — no further
    mode breakdown)
      → free-text prompt: "Where do you want to inquire about?"
        → submit calls engine.inquireTravel(input)
          → no choices (not found / already there / blocked):
            print the failure and exit
          → choices exist: detailed foot/transit/taxi (or per-mode, for a
            compass answer) breakdown, preferred category listed first
            and annotated, fastest/cheapest labeled as earned (see
            docs/systems/economy.md), plus
            "Go back to direct connections" (→ restart at a FRESH root
            screen, not just pop one level — see MenuOutcome's doc
            comment on why `restart` exists separately from `back`)
```

`exit`/`cancel` and `back` are universal keywords, intercepted by
`TerminalView.handleMenuInput` before reaching the current screen's own
options — they work from any screen, not just ones that happen to list
them as a numbered item. `back` past the root screen behaves like `exit`.

`travel to <place>` (with an explicit destination) is unaffected by any
of this — it still executes immediately via `travelTo`, same as before.
Only bare `travel` opens the menu.

## Why "inquire" was retired as a standalone verb

`inquire` is deliberately NOT a command anymore — see
`docs/systems/parsing.md`. It's too general a word to keep permanently
bound to travel in a detective game that will eventually want it (or
something like it) for interrogation/investigation. `GameEngine.inquireTravel`
still exists and is still exercised — just only reachable through the
`travel` menu's "Pick a custom destination" prompt now, not as its own
top-level verb.

## The tint

`TerminalView.renderMenuScreen` wraps a whole screen (header + numbered
options) in one `<div class="terminal__menu" data-menu-kind="...">`
block, rather than printing each line loose — see `terminal.css`. The
tint is keyed off `data-menu-kind`, a plain string tag on `MenuScreen`
(`travelMenus.ts`'s `MENU_KIND = "travel"`) that `MenuFlow` itself never
inspects — purely cosmetic. A future menu domain (dialogue, say) sets its
own `menuKind` and gets its own CSS rule; no change to menu logic.

## Known gaps

- Several domains now exist (`travel`, `disambiguation`, `buy`,
  `notebook`, NPC topics, `panel`) — none needed a change to
  `MenuFlow`/`MenuOutcome`/`MenuScreen` itself, just their own
  screen-builder file, which is a real confirmation the abstraction
  generalizes.
- No visual distinction yet between a `ChoiceMenuScreen` and a
  `PromptMenuScreen` beyond the presence/absence of numbered lines — both
  get the same tint. Not a problem yet with only one flow to look at.
- A menu **fully captures input** while active — there's no way to run an
  unrelated command (`look`, `inventory`, ...) mid-flow without exiting
  first. Deliberate for now (see the design discussion this system came
  from); may want revisiting if it feels wrong in practice.

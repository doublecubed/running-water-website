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
- **`disambiguationMenus.ts`** — the first domain, proving the
  abstraction generalizes: `buildDisambiguationScreen(header, choices,
  resolve)` turns a `ResolutionChoice[]` (an ambiguous `examine`/
  `takeItem` target — see `docs/systems/parts.md`'s "Ambiguous targets")
  into a one-shot choices screen. It's verb-agnostic — the caller (`TerminalView`'s `WORLD_OBJECT_RESOLVERS`
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

## Clicking an option

Every choices screen renders its options as `button.terminal__menu-option`
elements (`TerminalView.renderMenuScreen`). A click is exactly the player
typing the option's number: a delegated listener on the log (`handleLogClick`)
calls `runInput(String(n))`. Buttons of any menu block that is no longer the
live screen are disabled (`retireStaleMenus`) so a stale click can't index into
a different screen. Hover/focus show an inverse-video row highlight
(`terminal.css`). View-only; the menu logic is unchanged.

## The travel menu is gone

The bare-`travel` menu (`view/menu/travelMenus.ts`, direct connections plus a
free-text "inquire" prompt with foot/transit/taxi breakdowns) was removed with
the fare and transport-mode system. `travel` and `go` now always need a
destination. `ActionResult.choices` survives only for disambiguation
(`ResolutionChoice`). `exit`/`cancel` and `back` stay universal keywords,
intercepted by `TerminalView.handleMenuInput` before reaching a screen's own
options; `back` past the root screen behaves like `exit`.

## The tint

`TerminalView.renderMenuScreen` wraps a whole screen (header + numbered
options) in one `<div class="terminal__menu" data-menu-kind="...">`
block, rather than printing each line loose — see `terminal.css`. The
tint is keyed off `data-menu-kind`, a plain string tag on `MenuScreen`
(e.g. `buyMenu.ts`'s `MENU_KIND = "buy"`) that `MenuFlow` itself never
inspects — purely cosmetic. A future menu domain (dialogue, say) sets its
own `menuKind` and gets its own CSS rule; no change to menu logic.

## Known gaps

- Several domains now exist (`disambiguation`, `buy`,
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

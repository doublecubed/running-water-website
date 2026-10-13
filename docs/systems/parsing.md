# System: Command Parsing (`src/engine/parsing/`)

## What it does

Turns raw player text into a `Command` — a typed, language-agnostic
description of intent (`{ kind: "travel", query: "north" }`,
`{ kind: "take", query: "case file" }`, etc.). This is a deterministic
string-matching parser with a small fixed verb vocabulary — **no LLM, no
network call, no fuzzy/statistical matching**. Everything resolves
offline, instantly, for free. Notably, the parser does NOT know what a
valid direction or location is — `travel`'s `query` is passed through
verbatim (a compass word or a place name/alias) and resolved entirely by
`GameEngine.travelTo` against real map data. See
`docs/systems/navigation.md`.

## Why it's an interface

Different languages don't just need different vocabulary — they can need
different *grammar* entirely (word order, particles, agglutination, verb
placement). Rather than one parser trying to special-case every language's
rules, parsing is behind `ICommandParser`:

```ts
interface ICommandParser {
  parse(raw: string): Command;
}
```

`EnglishCommandParser` is the one implementation today. Adding a language
means writing a new class implementing `ICommandParser` with that
language's own rules — it does not touch `EnglishCommandParser`, the
`Command` type, `GameEngine`, or any view.

## Public capabilities

- `Command.ts` — the shared output contract. Currently: `look`, `travel`,
  `take`, `buy`, `buyMenu`, `inventory`, `talk`, `examine`, `help`,
  `setPanel` (which fixed side-panel slot shows which content —
  `"locations" | "verbs" | "inventory" | "facts" | "closed"`, see "Side
  panels" below and `TerminalView`'s `SIDE_PANELS` registry), `panelMenu`
  (bare `panel <slot>` — opens a menu of that content list instead of
  failing as unknown), `time`, `devAddMoney`,
  `devToggleAllLocations`, `board` (opens the case board overlay — see
  docs/systems/case-board.md), `unknown`.
  **`inquire` was
  retired as a standalone verb**, freeing the word for future investigation use
  (interrogation, etc.). The bare-`travel` menu, `prefer` / `travelPreference`,
  and `save` / `load` were removed along with the fare and save systems: bare
  `travel` and bare `go` are now unknown. This is modeled as verb (+ object, and
  room for a future subject — e.g. "give letter to informant" or a
  typed-dialogue topic like "ask barkeep about murder") — extend this
  union when a new action needs representing, not any one parser's
  internals.
- `ICommandParser.ts` — the interface every parser implements: `parse()`
  plus `listVerbs(): VerbHelp[]`, its full static verb catalog for
  debug/help display.
- `EnglishCommandParser.ts` — reference implementation. Internally
  data-driven: a single `VERB_RULES` table (words → usage key → build
  function) that both `parse()` and `listVerbs()` read from, so the
  displayed verb list can never drift out of sync with what the parser
  actually accepts. Covered by `EnglishCommandParser.test.ts`, including a
  test that pins the exact `listVerbs()` output. A `VerbRule` can be
  marked `dev: true` (currently `devmoney`/`devlocations`) — the
  constructor takes a `devMode: boolean` (default `false`) that excludes
  those rules from BOTH `parse()` and `listVerbs()` when off, so a
  dev-only verb typed in a production build is genuinely unrecognized
  input, not merely hidden from the help panel. See "Dev-only commands"
  below.
- `registry.ts` — `getCommandParser(languageCode, devMode?)` maps a
  language code to its parser, mirroring `src/i18n/resolver.ts`'s
  `TABLES` map. Parsing and translation are separate concerns keyed the
  same way: a language's input grammar need not match its display-text
  formatting rules. `devMode` is threaded through to the constructed
  parser — decided once, by the caller (`src/main.ts`), never read here.

## Side panels (verbs, locations, inventory, facts — switchable content)

**Website layout (2026-10-13):** the left and right slots are fixed-height boxes
(`.side-panel--fixed`, sized for `--side-panel-rows` = 10 list rows) so they
never resize with their contents; the inventory slot matches the locations slot.
Under the left slot sits a separate, always-on verb guide (`data-role="panel-verbs"`,
`VERB_HINT_KEYS` in `TerminalView.ts`): go to, examine, talk to, open, close. It
is not part of the switchable registry and is distinct from the `verbs` content
below, which lists the parser's whole vocabulary as a debug aid.


`TerminalView` has two fixed-side panel slots — LEFT and RIGHT — whose
CONTENT is player-selectable, not tied to the slot itself (sides are
fixed for now; see the "Why sides are fixed" note below). Each slot
defaults to a distinct content: LEFT starts on `locations`, RIGHT on
`inventory`. A `TerminalView.SIDE_PANELS` registry (keyed by the full
`PanelContentId` union from `Command.ts`: `"locations" | "verbs" |
"inventory" | "facts" | "closed"`) holds every content's `render(ctx) =>
string` — `verbs`, `locations`, `inventory`, and `facts` each build a
title+list box via the shared `renderSidePanel` helper (`verbs` from
`listVerbs()`'s output; `locations` from location names, discovered-only
by default — see `docs/systems/navigation.md` for the dev-only
`devlocations` toggle; `inventory` from the player's carried items, read
live off `GameState.player.inventory`; `facts` from
`GameEngine.getPlayerFacts()`, oldest-first — see
`docs/systems/case-system.md`), while `closed` renders `CLOSED_PANEL_ART`
— a small ascii placeholder — inside a plain `<pre class="side-panel__art">`
instead, no title or list. A closed slot is NOT hidden/collapsed: it's a
real, visible box like any other content, just decorative rather than
informational — the deliberate point of modeling `"closed"` as a real
content rather than a boolean, so today's placeholder art can later
become a real illustration (a location sketch, a case-relevant image, …)
without any mechanism change, only editing `SIDE_PANELS.closed.render`.

The verbs content is intentionally **unfiltered by context**: it shows
the parser's entire vocabulary, not what's usable at the player's
current location (e.g. it lists `go <place>` even though only specific
connections exist from here) — except for `dev: true` verbs, which are
excluded outside dev builds (see "Dev-only commands" below), a DIFFERENT
kind of filtering than context-awareness. If context-aware filtering is
wanted later (only show valid exits/visible item verbs), it belongs as a
separate, explicitly-opt-in view feature — querying `GameState` for
what's actually reachable — not a change to `listVerbs()` itself, which
must stay a static, parser-only catalog.

**Choosing what a slot shows:** `panel <left|right> <verbs|locations|
inventory|facts|close>` (see `EnglishCommandParser`'s
`PANEL_SLOT_ALIASES`/`PANEL_CONTENT_ALIASES`) parses to `{ kind:
"setPanel", slot, content }`. The legacy bare words `verbs`/`commands`
and `locations`/`map` are sugar for the same command on their historical
home slot (right and left, respectively). `TerminalView` TOGGLES on
`setPanel`: re-requesting a slot's current content closes it (sets it to
`"closed"`); requesting anything else switches to it. The parser itself
is stateless (it doesn't know a slot's current content), so the toggle
decision is made in `TerminalView.handleSubmit`, not the parser.

**Bare `panel <left|right>` (no content word) opens a menu instead of
failing as unknown** — `{ kind: "panelMenu", slot }`
(`EnglishCommandParser`'s `panel` rule), built into a `MenuScreen` by
`view/menu/panelMenus.ts`'s `buildPanelMenuScreen`, one option per
`PanelContentId` (`"closed"` offered as "None", with a `"none"` alias),
same `MenuFlow` mechanism as `buyMenu`/the NPC topic menu.
Selecting an option calls `TerminalView.setPanelContent` — the same
write path `setPanel` uses — directly (not the toggle logic; picking
from the menu always sets to what was picked, there's nothing to toggle
against). This is purely view-side: `GameEngine` has no concept of
panels, so `buildPanelMenuScreen` takes a plain `setContent` callback
rather than an engine reference, unlike every other menu builder in
`view/menu/`.

**Why sides are fixed:** letting a panel's content move between LEFT and
RIGHT was considered and deliberately deferred — players don't need that
degree of freedom, and it would need a settings surface to be discoverable
at all. If it's ever wanted it'd be a v2, player-facing settings toggle,
layered on top of this mechanism (which already keeps `slot` and
`content` as independent concepts) rather than a rework of it.

## Dev-only commands

`devmoney <amount>` (credits/debits the player directly, dollars in,
converted to minor units — negative allowed, unlike any normal in-fiction
way to change the balance) and `devlocations` (toggles the locations
panel between discovered-only and every location) exist purely for
development/QA convenience — see docs/systems/economy.md and
docs/systems/navigation.md. They are NOT a general "developer mode" with
persisted state; each is a plain `VerbRule` marked `dev: true`, gated
once at construction (`EnglishCommandParser(devMode)`), decided by
`src/main.ts` from Vite's build-time `import.meta.env.DEV` flag — true
under `npm run dev`, statically `false` (and dead-code-eliminated) in a
production build. This keeps the gate entirely out of `src/engine/`
(which stays environment-agnostic, per CLAUDE.md's engine/view boundary)
while guaranteeing a shipped build never recognizes these words at all,
not merely hides them from the verbs panel. `devToggleAllLocations` is
handled entirely in `TerminalView` (pure view state, no `GameEngine`
call); `devAddMoney` just calls the existing, already-tested
`GameEngine.addMoney`.

## How it interacts with other systems

- **View (`TerminalView`)** takes an `ICommandParser` via constructor
  injection (see `src/main.ts`) rather than importing one directly. The
  view has no opinion on which language's grammar is active.
- **Engine (`GameEngine`)** never sees raw player text at all — only the
  `Command` a parser already produced. Parsing and simulation are fully
  decoupled; `GameEngine.test.ts` calls engine actions directly and never
  exercises the parser.
- **Localization (`src/i18n/`)** is a related but independent axis: the
  active *display* language (translation table) and the active *input*
  grammar (parser) are selected separately and don't have to match, though
  in practice they'll usually be switched together.

## Adding a language's parser

1. Create `src/engine/parsing/<Lang>CommandParser.ts` implementing
   `ICommandParser`, returning the same `Command` union.
2. Register it in `PARSERS` in `registry.ts`.
3. No changes needed to `Command.ts`, `GameEngine`, or `TerminalView`
   unless the language needs a genuinely new command shape (e.g. topic-based
   dialogue) — in which case extend `Command.ts` and every parser
   implementation gains that case (TypeScript's exhaustiveness checking on
   the `switch` in `TerminalView.dispatch` will flag any parser-consuming
   code that doesn't handle it).

## Multiple-choice input

Now a real, reusable mechanism — see `docs/systems/menu.md` for the full
design (`MenuFlow`/`MenuScreen`/`MenuOutcome` in `src/view/menu/`). In
short: a menu screen is either a numbered choice list or a free-text
prompt; `TerminalView` intercepts input while a menu is active (a bare
number, or the universal `back`/`exit`/`cancel` keywords) BEFORE it ever
reaches `ICommandParser.parse()` — so no `Command` kind or parser rule is
needed for navigating a menu itself. Only entering one needs a `Command`
(`buyMenu` for bare `buy`, `panelMenu` for bare `panel <slot>`).

`ActionResult.choices?: ResolutionChoice[]` (`types.ts`) is how `GameEngine` reports
labeled options: `ResolutionChoice` (`examine`, `takeItem`) for "which one do you
mean?" ambiguous-target disambiguation, see `docs/systems/parts.md`'s "Ambiguous
targets." (A travel-specific `TravelChoice` used to sit beside it and was removed
with the travel menu.) `src/view/menu/disambiguationMenus.ts` turns it into a `MenuScreen`; `MenuFlow`
itself has no idea the type exists. A further domain (accusation, ...) should
likewise get its own choice type and screen-builder file.

# Notebooks

**Status: built end to end (v1), through three rounds of playtesting
fixes, a round 4 pass of small overlay polish, and round 5's click-to-jot
picking mode (all below).** The data shape, `GameEngine` mutation calls, content wiring
(`NotebookProduct`), save-schema bump, the generalized `buy` menu, the
`notebook`/`jotDown` commands, and the notebook page-view overlay are all
implemented and tested. See "What's built" below for the file map. Known
v1 simplifications (not gaps to close blindly — see each section):
`commitBlockEdit`'s prefix/suffix diff instead of a full LCS, and a plain
textarea (native browser undo) instead of a hand-rolled insert-anywhere
buffer.

**Round 1** fixed: entries had no cap independent of the page total (one
jot could fill a whole page), the page-view overlay was sized like a
fullscreen window instead of a small object, and `jot down` was
essentially undiscoverable with no way to jot something already on
screen without retyping it.

**Round 2** fixed the fallout from round 1's OWN fix: capping BOTH the
page (`lineCapacity`, in ruled lines) AND each entry (`maxBlockLines`) in
terms of lines — converted via `lineCharCap` characters-per-line —
hard-stopped a note mid-thought the instant it hit its own line cap,
with no way to keep writing except starting a whole new entry. Fixed by
replacing `lineCapacity` + `maxBlockLines` with a single flat
`charCapacity` (total characters, page-wide, no per-entry cap at all).
To keep the ruled background visually aligned under this new model,
round 2 ALSO introduced a fixed-character-width (`Nch`), hard-wrapped
(`word-break: break-all`) column for entry text — which round 3 (below)
then had to undo.

**Round 3** (this pass) fixed round 2's OWN fix, again: the
fixed-character-width column reintroduced exactly the "line has a
character limit" feeling the flat `charCapacity` change was meant to get
away from, and the `{used}/{capacity}` meter never updated while
actively typing (only on commit), so the hard character-per-line wrap
and the silent `maxLength` stop together meant "typing in the dark."
Fixed by:
- Dropping `lineCharCap` ENTIRELY — from `Page`, `NotebookProduct`,
  `world.yaml`, and `cityLoader.ts`'s validation. There is no
  character-per-line concept anywhere in the system anymore.
  `SAVE_SCHEMA_VERSION` bumped to 7.
- Entry text is now full page-width with NATURAL word-wrap
  (`overflow-wrap: break-word` purely as an overflow safety net, not a
  fixed line width). The ruled grid stays aligned anyway, because a
  uniform `line-height` (`--notebook-row`, shared by the header, read
  text, and the editor) is all vertical alignment ever needed — the
  ruled lines only care about row HEIGHT, never where a row wraps
  horizontally. See "The notebook page interface" below for why round
  2's character-width approach was solving a problem `line-height` alone
  already solved.
- The editing/draft textarea's height is now a standard
  reset-to-`auto`-then-read-`scrollHeight` autosize (recalculated on
  every keystroke), replacing the old `rows = length / lineCharCap` math
  that no longer has a `lineCharCap` to divide by.
- The `{used}/{capacity}` meter now updates on every keystroke
  (`TerminalView.updateNotebookMeter`), computed from the live,
  uncommitted textarea value — not just after a block is committed.

**Round 4** was pure overlay/copy polish, no data or engine changes,
`SAVE_SCHEMA_VERSION` untouched:
- The overlay is now NARROWER than `.terminal` (600px vs. 760px max-width),
  reversing round 1's "match the terminal column" choice — playtesting
  wanted the terminal's own edges visibly bleeding out from behind the
  notebook on both sides, reading as a small object laid on top of the log
  rather than a same-width panel swapped in for it.
- The ruled-line background's row height grew (`--notebook-row` 1.5rem →
  1.75rem) and its tint dropped (`color-mix` 30% → 15% of `--dim`) — the
  lines were still catching the eye as a texture instead of receding into
  the page, an unresolved side effect of round 3's line-height-only ruling
  approach (see "The notebook page interface" below).
- The toolbar's page indicator is now two lines (`"Page\n{page} /
  {pageCount}"`, `white-space: pre-line`) instead of one long string that
  wrapped awkwardly on its own; the chars-used meter dropped the trailing
  "characters" word (`"{used} / {capacity} used"`) — redundant once you're
  looking at a notebook.
- The toolbar's exit button is relabeled "Save note" (`ui.notebookSaveNote`,
  no longer sharing `ui.worldMapClose`'s "Close" string with the world-map
  overlay) — purely a copy change. No new save path was added: exiting
  already commits any open edit via the textarea's `blur` handler (see
  "Editing" below), so the button was always saving on exit, just not
  saying so.

**Round 5** built the fuller "click to jot" affordance the design
originally imagined and round 1–4 left open (see the `jotDown` section
below for the implementation): a bare `jot down` now puts the terminal
into a picking mode where hovering the scrollback highlights each
jottable line and clicking one jots it, restricted to actual game-output
lines (not the player's own echoed input or menu chrome). Pure
view/command work — no engine, data, or save-schema changes.

## What's built

- **Engine/data**: `src/engine/types.ts` (all the shapes below),
  `src/engine/notebooks.ts` + `notebooks.test.ts` (pure helpers, the
  commit-time diff, `charsUsed`/`charsRemaining`), `GameEngine`'s
  notebook methods + `GameEngine.test.ts`'s "notebooks" describe block,
  `NotebookProduct` content wired through `cityLoader.ts` exactly like
  `Pass`, `SAVE_SCHEMA_VERSION` 7.
- **Commands**: `Command.ts`'s `buy`/`buyMenu`/`notebook`/`jotDown` kinds,
  parsed by `EnglishCommandParser.ts`.
- **Menus**: `src/view/menu/buyMenu.ts` (+ `.test.ts`) — the generalized
  buy menu and `buyByQuery`'s pass-then-notebook-catalog fallback;
  `src/view/menu/notebookMenus.ts` (+ `.test.ts`) — notebook selection,
  the actions screen (open/rename/set-active/dispose-with-confirm), and
  the `jotDown`-with-no-active-notebook picker.
- **View**: `TerminalView`'s notebook page-view overlay — a fixed
  overlay, width-capped/centered like a small object rather than
  fullscreen, with a ruled-paper grid whose alignment comes ENTIRELY
  from a shared `line-height` (see "The notebook page interface") — page
  navigation, a LIVE chars-used/capacity meter, per-block read/edit-mode
  rendering (struck spans as `<s>`), autosizing textareas, the
  "+ New note" draft flow, and `jot down last`/`that` (see "`jotDown`"
  below).

## What it is

The player carries one or more physical notebooks (inventory items, sold
in-world) they can jot notes into: things NPCs say, things they examine,
or free-standing thoughts. Notes are timestamped and location-stamped
automatically, can be amended later (old text survives struck-through,
never deleted), and each notebook has a hard page/line budget — it's
meant to feel like a depleting resource, not an infinite log.

## Data shape (mutable slice)

Persistent, per `CLAUDE.md` boundary #6 — notebooks are player progress,
not content, so this is a new sibling struct next to `Player`/`clock`/
`placement` in `GameState`, JSON-safe (plain arrays/records only):

```ts
interface NotebookState {
  notebooks: Notebook[];
  activeNotebookId: string | null;
}

interface Notebook {
  id: string;
  name: string; // player-chosen, free text — not a translation key, see below
  pages: Page[];
}

interface Page {
  charCapacity: number;   // total characters of ink this page can hold — a flat budget, no per-line/per-entry concept at all (see "Page overflow" below for why this took three rounds to settle on)
  blocks: NoteBlock[];
}

interface NoteBlock {
  id: string;
  timestamp: { day: string; time: string }; // via the existing calendar/clock formatting, see systems/time.md
  locationId: LocationId;
  spans: Span[];
}

interface Span {
  id: string;
  text: string;
  struck: boolean; // true once removed by an edit — never actually deleted
  // Set only when struck: true — when/where the removal actually happened,
  // stamped at BLOCK-COMMIT time (see "Editing" below). Never shown in the
  // notebook UI; exists for potential future review tooling.
  struckAt?: { timestamp: NoteTimestamp; locationId: LocationId };
}
```

`NoteBlock` also carries an optional `sourceRef?: string` (e.g.
`"examine:item.desk"`, `"dialogue:npc.barkeep.line3"`) — provenance for a
block created by `jotDown`, absent for a free-standing thought. See
`jotDown`'s section below.

`charsUsed(page)` is **derived at read time**, never stored, so it can't
drift out of sync with the spans it's computed from:

```
charsUsed(page) = sum over blocks of blockTextLength
```

Only non-struck span text counts toward `blockTextLength` — a struck
span still exists in the data (for the strikethrough render and, later,
for review) but its characters are already "spent," not double-charged.
The auto-inserted header (`timestamp`/`locationId`) does **not** count
against `charCapacity` — it's the notebook's own bookkeeping, not ink the
player spent — but it still occupies a visual row when the page is
rendered, so page layout in the view must reserve space for it (see
"The notebook page interface"'s `--notebook-row`-locked header height).
This is a deliberate split: the engine's budget is about content only;
the view's layout is about what fits on a drawn page, including the free
header row.

## Why blocks, not one flat span list per page

A **block** is one note — created either by `jotDown` or by the player
manually starting a new note while editing (an explicit "new note"
action, not just pressing enter inside existing text). Each block gets
its own auto-stamped header the moment it's created. This keeps
edit/undo scoped to the block being worked on rather than the whole
page, and matches the "new line = new dated entry" mental model directly
— the player never has to wonder when a given note was written, because
the notebook always shows it.

## Editing: insert-anywhere, strikethrough on delete, reversible until exit

The player can insert text anywhere inside a block being edited (scribble
between existing lines, same as a real notebook), and deleting text never
removes it from the data — it flags the affected span(s) `struck: true`
instead. Undo is allowed freely while the block is open; once the player
exits the notebook UI, the edit is committed and undo is gone (matches
"feels like a limited resource," not an infinite text editor).

This is implemented **without any per-keystroke engine calls**, to keep
the engine synchronous and free of interaction-timing concerns (`CLAUDE.md`
boundary #2):

- While a block is open for editing, the view owns a local text buffer
  and its own undo/redo stack — pure browser/view state, never touches
  `GameState` or the save file. **Implemented as a plain `<textarea>`**
  (`TerminalView.renderNotebookBlock`) rather than a hand-rolled buffer +
  undo stack: a native textarea already supports inserting anywhere and
  already gives free undo/redo (Ctrl+Z) for exactly as long as it's
  focused/mounted — satisfying "reversible until exit" with zero custom
  code, since removing it from the DOM (closing the block, turning the
  page, closing the notebook) discards that history the same way a
  hand-rolled stack scoped to the open block would have.
- On exit — implemented as the textarea's `blur` event, which also fires
  naturally when the element is removed from the DOM (turning the page,
  closing the overlay), so there's no separate "did they forget to
  click Done" case to handle — the view hands the engine the final plain
  text for that block. The engine diffs it against the block's last **committed** span
  list: unchanged runs stay as they are, removed runs are marked
  `struck` (stamped with the current time/location, since that's when
  the removal actually happened), and inserted runs become new active
  spans.
- Strikethrough timestamps are stored but **never shown in the
  notebook UI** — they exist for potential future tooling (e.g. a "review
  your edits" screen), not as player-facing text.

Tradeoff accepted knowingly: because the diff happens at commit time
(on exit), a strikethrough's timestamp reflects when the *block* was
closed, not the exact keystroke that deleted it. Getting per-keystroke
timestamps would mean either engine calls on every backspace or pushing
diff logic into the view — both rejected as unnecessary API surface for
this feature.

## `jotDown`

`jotDown` always creates a **new block** (never appends to an existing
one), stamped with the current time/location, containing the jotted
text as its initial span. The player can go back into the notebook
afterward and edit/amend that block like any other.

The engine's mutation call takes an explicit `notebookId` — it does not
resolve "the active notebook" internally, since deciding whether to
prompt the player requires blocking on input, which a synchronous engine
call cannot do. That resolution lives in the `jotDown` command handler,
which:

1. Reads `activeNotebookId` from `NotebookState`.
2. If set, calls the engine's jot mutation immediately with that id —
   no prompt, no interruption.
3. If `null` (`TerminalView.submitJotDown`):
   - owns zero notebooks → fails cleanly with `event.noNotebooksOwned`
     (same message the bare `notebook` command uses) — no menu opens,
     since there'd be nothing in it to pick.
   - owns exactly one → jots straight into it, silently, without asking
     "which one?" for a question with only one possible answer (mirrors
     `openNotebookCommand`'s identical skip-the-picker behavior).
   - owns two or more → opens a selection menu (see
     `docs/systems/menu.md`'s `MenuFlow`, via
     `buildJotDownPickerScreen`) listing the player's notebooks by name,
     and calls the jot mutation with whichever one the player picks.

Selecting the source text to jot down (a line from examine output, an
NPC's dialogue line) is also entirely a view/command concern — the
engine's jot mutation just accepts whatever text string it's given plus
a `sourceRef` for provenance (e.g. `examine:item.desk`,
`dialogue:npc.barkeep.line3`). The engine never inspects scrollback or
decides what "the last line" was.

**Implemented.** `jot down <text>` jots exactly the typed text
(free-standing thought, no `sourceRef`). The command was initially
undiscoverable in practice — nothing in `ui.help`'s onboarding line
mentioned it, so the only way to find it was scanning the always-on
verbs side panel — fixed by adding it there. `jot down last` (or `jot
down that`) is a "select a source line" shortcut:
`TerminalView.resolveJotDownText` special-cases those two words to mean
"whatever was most recently printed" (`lastPrintedLine`, updated in
`presentEvent` for every event except the note-commit confirmations
themselves, to avoid a jot-the-confirmation loop), jots it with
`sourceRef: "scrollback:last"`, and fails cleanly
(`event.jotNothingToJot`) if nothing has been printed yet.

A bare `jot down` (no text) is the fuller "click to jot" affordance —
parsed as its own `Command` kind, `jotDownPick` (distinct from
`jotDown`, since it doesn't jot anything itself), it puts `TerminalView`
into a picking mode rather than immediately doing anything:

- `TerminalView.enterJotPickMode` prints an instruction line and adds
  `terminal__log--jot-picking` to the log element. The highlight-on-hover
  itself is pure CSS (`.terminal__log--jot-picking .terminal__line:hover`
  in `terminal.css`) — no per-line mouseover/mouseout JS needed, since
  the class toggle is all the CSS selector needs to key off.
- A single delegated `click` listener on the log (registered once in the
  constructor, a no-op outside picking mode) resolves the clicked
  `.terminal__line` and, if it's a jottable one, calls the same
  `submitJotDown` helper the keyboard path uses — the active-notebook
  resolution (jot straight in, or open the "which notebook?" picker via
  `buildJotDownPickerScreen`) lives in exactly one place either way.
- Only actual game OUTPUT lines are jottable: the player's own echoed
  input (`.terminal__line--input`), rendered menu text (inside
  `.terminal__menu`), and the picking-mode instruction line itself
  (`data-role="jot-prompt"`) are excluded from both the hover highlight
  and the click handler — jotting your own typed command or UI chrome
  into a detective's notebook isn't what this feature is for. Clicking
  one of those excluded lines prints a rejection line
  (`event.jotDownPickInvalidLine`) and stays in picking mode, rather
  than silently doing nothing — playtesting found silence read as
  broken, not "not applicable." Clicking a game-output line jots it with
  `sourceRef: "scrollback:click"`.
- While picking, typed input is restricted to "cancel"/"exit" (mirrors
  how an active `MenuFlow` restricts input) — anything else reprints the
  instruction rather than being parsed as a normal command, so the
  player can't accidentally act on the world mid-pick.
- Owning zero notebooks is checked BEFORE picking mode is even entered
  (`handleSubmit`'s `jotDownPick` branch), not only after a click
  discovers it — a bare `jot down` with nothing to jot into fails
  immediately with `event.noNotebooksOwned`, the same check
  `submitJotDown` also makes for the keyboard path (`jot down <text>`
  with no notebooks owned fails the same way, before ever opening a
  picker).

See `TerminalView.test.ts` for DOM-level coverage (click a line, click an
excluded line, click with no active notebook, cancel by typing) — this
is one of the few genuinely view/mouse-interaction behaviors in the
codebase that a headless `GameEngine.test.ts` case can't exercise.

## Notebook selection and the `notebook` command

`notebook` opens the notebook interface:

- No notebooks owned: nothing to open (should fail cleanly, same as any
  other empty-inventory case).
- One notebook: opens it directly.
- Multiple notebooks: prompts "which one do you want to open?", listed
  by name (`MenuFlow`, same mechanism as travel/disambiguation menus).

From that same interface the player can mark a notebook as the
**active** one, or clear the active flag entirely (back to "ask me every
time on `jotDown`"). Only one notebook can be active at a time —
`activeNotebookId` is a single nullable field, not a per-notebook flag,
so there's no way for the data to represent "two notebooks both active."

## The notebook page interface

A separate full-screen view mode (same category as the inventory screen
or the `worldmap` overlay — non-architectural, pure view), showing the
notebook's name at the top, current page number, and its ruled lines with
blocks rendered as header + text. The auto-inserted header renders
**visually distinct** from the player's own writing — smaller font size,
different (muted) color — so it reads as the notebook's bookkeeping
rather than something the player wrote, while still sitting directly
above the line(s) it stamps.

The engine needs to expose enough to render this without the view
reaching into `GameState` internals directly:

- Notebook name, page list.
- Per-page: `blocks` (already timestamp/location/spans-shaped) and
  `charsUsed`/`charCapacity` for the resource-meter display.

**Implemented** as `TerminalView`'s `.notebook-overlay` (a fixed overlay
containing a width-capped `.notebook-overlay__book`) — see
`openNotebookPageView`/`renderNotebookPage`/`renderNotebookBlock` in
`src/view/TerminalView.ts`. Reads `GameEngine.getNotebooks()` (a
read-only getter, same posture as `getState().locations` elsewhere)
rather than needing bespoke per-field getters. The "start a new note"
manual action (see "Why blocks" above) is the overlay's "+ New note"
button — `startNewNoteDraft`/`renderNewNoteDraft` — which reveals a blank
textarea and only calls `jotNote` once it's blurred with non-empty text;
an empty/whitespace-only draft is discarded without writing anything.
Live-typing hard-stop on page overflow (see "Page overflow" below) is
implemented via the textarea's native `maxLength`, set from the page's
remaining FLAT character budget (`page.charCapacity` minus every OTHER
block's committed size) — the same arithmetic `jotNote`/`amendNote`
check engine-side, so typing stops exactly where the engine would
refuse. The browser itself enforces it — no manual key-event
interception needed.

**Deliberately NOT a fullscreen panel.** An early v1 pass sized this
overlay like the world-map overlay (`inset: 2rem`, i.e. nearly the whole
viewport) — playtesting flagged that this reads as "another desktop
window," which fights the "small, cramped, finite object" feeling a
pocket notebook should have. Fixed by capping `.notebook-overlay__book`
at a `max-width` NARROWER than `.terminal` (600px vs. 760px) and
centering it — round 1 first matched `.terminal`'s own width exactly, but
that read as a same-size panel swapped in for the log rather than an
object placed on top of it; round 4 narrowed it specifically so the
terminal's edges stay visible bleeding out from behind it on both sides.

**The ruled background is FUNCTIONAL, via `line-height` alone — NOT via
a fixed character width (round 3, reversing round 2's approach).**
`.notebook-overlay__page` defines one CSS custom property,
`--notebook-row` (1.75rem as of round 4, up from round 3's 1.5rem —
playtesting still found the lines visually busy at the tighter spacing),
reused as: the ruled background's `repeating-linear-gradient` step size
(tinted at 15% of `--dim` as of round 4, down from round 3's 30%, again
to recede further into the background), every content row's
`line-height`, and the auto-stamped header's fixed `height`/`line-height`
(so it occupies exactly one row regardless of its smaller font-size,
keeping the grid aligned for whatever comes after it). Round 2 also
constrained entry text to a fixed-character-width monospace column with
a hard per-character wrap, reasoning that the browser needed to be
FORCED to break at the same column the ruled grid expected — round 3
found that unnecessary and reverted it, once it was clear the ruled
grid only cares about row HEIGHT (governed entirely by `line-height`),
never about WHERE within a row the text wraps horizontally. So entry
text (`.notebook-block__text`/`.notebook-block__editor`) is now simply
`width: 100%` of the page column with natural word-wrap
(`overflow-wrap: break-word` only as an overflow safety net, not a line
width), and the ruled lines still land exactly right regardless. The
editing/draft textarea's height is a standard autosize
(`TerminalView.autosizeNotebookTextarea`: reset to `height: auto`, then
read `scrollHeight`), recalculated on every keystroke, since there's no
longer a `lineCharCap` to compute a row count from analytically. That
same keystroke handler also redraws the toolbar's `{used}/{capacity}`
meter from the textarea's LIVE (uncommitted) length
(`TerminalView.updateNotebookMeter`) — an earlier version only updated
it after a block was committed, so the player typed blind right up
until the silent `maxLength` stop.

**Toolbar copy (round 4).** The page indicator renders as two lines —
`ui.notebookPageIndicator` is now `"Page\n{page} / {pageCount}"`, with
`.notebook-overlay__page-indicator` set to `white-space: pre-line` so the
literal `\n` breaks the line — since it wrapped to two lines on its own
whenever the toolbar got tight anyway; this just makes that wrap
intentional and centered instead of accidental. The chars-used meter
dropped its trailing "characters" word (`ui.notebookCharsMeter` is now
`"{used} / {capacity} used"`) as redundant in context. The exit button no
longer reads "Close" (`ui.worldMapClose`, shared with the world-map
overlay) — it has its own key, `ui.notebookSaveNote` ("Save note"), since
"Close" didn't signal that the open edit gets committed on the way out;
no new save path was added, exiting already committed via the textarea's
`blur` handler (see "Editing" above), the button just says so now.

## Localization note

Notebook names and note text are **player-authored free text**, not
translation keys — `CLAUDE.md` boundary #4 governs UI chrome and
authored game content, not player input. Only the notebook UI's own
chrome (page-number labels, "which notebook?" prompts, the "buy a
notebook" flow's messaging) goes through the translation table.

## Decisions

- **Economy integration.** No dedicated shop system for v1 — the existing
  `buy` verb is generalized to open a small menu (`MenuFlow`) of
  purchasable goods, which for now lists just notebooks and `Pass`es. No
  vendor NPC/location content needed yet. A real shop system (vendor
  content, per-location catalogs, stock) is deferred — see
  `docs/future_work.md`'s "Shop system (generalized `buy`)". Implemented as
  a `NotebookProduct` content type (`engine/types.ts`), validated/loaded by
  `cityLoader.ts` exactly like `Pass` (`world.yaml`'s `notebookProducts:`
  list) — `id`/`nameKey`/`aliases`/`priceMinor` plus `pageCount`/
  `charCapacity`, which seed a freshly-bought `Notebook`'s blank pages. `GameEngine.buyNotebook` alias-matches,
  charge, create. A bought notebook starts with `name: ""` (unnamed) —
  `GameEngine` never produces player-facing display text to default it to,
  so naming it is left to `renameNotebook`, which the `buy`-menu flow (or
  the notebook interface, later) should prompt for.
- **Page overflow.**
  - **A flat per-page character budget, no separate per-entry cap
    (round 2 — revised from round 1's per-entry line cap).** Round 1
    fixed "one jot can fill a whole page" by capping both the page
    (`lineCapacity`, ruled lines) and each entry (`maxBlockLines`) in
    LINES, derived from `lineCharCap` characters-per-line. That
    introduced a worse problem: the line-count math and the textarea's
    own pixel-width word-wrap never lined up exactly, so wrapped text
    visibly clashed with the ruled background, AND hitting the per-entry
    line cap hard-stopped a note mid-thought with no way to continue
    except starting an entirely new entry. Fixed by dropping BOTH
    `lineCapacity` and `maxBlockLines` for a single flat
    `Page.charCapacity`/`NotebookProduct.charCapacity` (total characters,
    whole page, no per-entry limit at all) — a block is bounded only by
    how much of the PAGE is actually left (`engine/notebooks.ts`'s
    `charsUsed`/`charsRemaining`), however many visual rows that happens
    to wrap to. The visual-mismatch half of the problem is fixed
    separately, by making the ruled grid functional instead of decorative
    — see "The notebook page interface" above. Content re-tuned
    accordingly (see `world.yaml`'s `pocket-notebook`: 8 pages, 400
    characters/page, 28-char ruled rows) — still small enough to feel
    like a pocket notebook, just without an artificial per-entry
    ceiling. `SAVE_SCHEMA_VERSION` bumped to 6 (5 was the now-abandoned
    per-entry-line-cap shape).
  - `jotDown` (writes a complete block in one shot, non-interactively):
    if the block doesn't fit in the current page's remaining characters,
    it moves automatically to the next page with room. If no page has
    room, the jot fails with a "notebook full" notification — no
    fallback notebook, nothing partially written. If the text is longer
    than an ENTIRE page's capacity (would never fit even on a totally
    empty page), that's reported as a distinct "note too long" failure
    instead of a generic "full" one, since the fix there is "write a
    shorter note," not "find room."
  - Live editing (the player actively typing a block open in the
    notebook UI): **v1 hard-stops input** the moment the block would
    exceed the current page's remaining characters — no live cross-page
    splitting. The player has to finish elsewhere: delete some of the
    note, turn to a page with room, and start a new block there.
    Splitting a block live across a page boundary while typing (with a
    small header-less "continued" marker on the next page) is a real,
    buildable feature but the heaviest single piece of this system —
    deferred, see `docs/future_work.md`'s "Live cross-page note
    splitting".
- **Notebook disposal.** Dropping/selling the active notebook requires an
  explicit confirmation step first ("this is your active notebook —
  really get rid of it?"). Once confirmed, `activeNotebookId` clears to
  `null` — no automatic fallback to another notebook; the next `jotDown`
  just prompts again, same as if no notebook had ever been made active.

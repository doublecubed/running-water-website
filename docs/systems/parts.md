# System: Parts, states, focus-based interaction, and containment (`src/engine/`)

## What it does

Lets a `WorldObject` (item or setpiece — see `docs/content-schema.md`'s
"World object" section) carry named **sub-parts**, each with its own
**states** — a desk's drawers (open/closed), a lighter's engraved symbol
(a single, purely descriptive state). A part needs no interactivity to
justify existing: a part with no `enterAliases` on any state simply can't
be changed via `interact`, only revealed via `examine` — exactly the
"symbol on a lighter" case.

Interacting with a part (`open`/`close`/...) requires **focus** — modeled
on point-and-click adventure games: `examine <object>` "zooms in," and
while focused, that object's parts become addressable by name ("open
drawer") without ambiguity from some other object elsewhere with a
similarly-named part. Two escape hatches keep this from feeling rigid:

1. A part whose CURRENT state is flagged `important` is immediately
   actionable even without focusing first — it was already surfaced in
   the object's general `examine` ("One of its drawers is open"), so the
   player already knows it's there.
2. A small set of "universal" actions — `travel`, `talk`, opening the
   travel menu — clear focus as a side effect, since they obviously move
   the player's attention elsewhere. Otherwise focus persists indefinitely
   (no timeout); the explicit `back`/`stop` command clears it.

A part's exposing state can also **contain** other world objects (a torn
photograph in a drawer) — see "Containment" below.

## Data model

```ts
interface Part {
  id: PartId;
  nameKey: string;
  descriptionKey: string;   // shown when the part is examined directly
  aliases: string[];
  states: PartState[];
  defaultStateId: string;   // must reference one of `states`
}

interface PartState {
  id: string;
  nameKey: string;           // short label, e.g. "open" — used in "already X" messages
  descriptionKey: string;    // full text on a DIRECT examine, AND the "you just did it" feedback line
  summaryKey?: string;       // SHORT ambient bubble text (see "important" below); defaults to descriptionKey
  important?: boolean;       // surfaces summaryKey ?? descriptionKey in the PARENT object's general examine
  enterAliases?: string[];   // verb words that transition INTO this state; absent = not reachable via interact
  exposesContents?: boolean; // world objects containedIn this part become reachable — see "Containment"
  revealInAmbientListing?: boolean; // a revealed DIRECT child also joins the location's ambient line — see "Containment"
}
```

`WorldObject.parts?: Part[]` — optional, most objects have none.
`kind`/`portable`/`announceOnRevisit` (the item/setpiece presentation
split — see `docs/content-schema.md`) are unaffected and orthogonal:
`kind`/`announceOnRevisit` govern the location's "present" lines, `parts`
govern what `examine`/`interact` reveal once the player is looking
directly at the object.

**`descriptionKey` vs. `summaryKey`** exist as two separate fields
specifically so a state's ambient hint can be vaguer than what a direct
examine reveals — e.g. the desk's right-drawer `open` state:
`descriptionKey` ("The right drawer is open, revealing a torn photograph
tucked under some old receipts.") is shown when the player examines the
drawer directly; `summaryKey` ("One of its drawers is open.") is the
short line bubbled into the desk's own general `examine` via `important`.
Omitting `summaryKey` reuses `descriptionKey` for both, which is fine for
a state whose full text is already short enough to serve both purposes.

`GameState` carries two new fields:
- `partStates: Record<WorldObjectId, Record<PartId, string>>` — current
  state id per object/part. **Persisted** (see `docs/systems/save.md`) —
  mirrors `Placement` exactly: seeded from every part's `defaultStateId`
  by `cityLoader.ts` (`CityContent.initialPartStates`), restored verbatim
  on load. A part added to content after a save was made simply falls
  back to its `defaultStateId` at read time (`GameEngine`'s private
  `currentPartStateId` does the `?? part.defaultStateId` lookup) — no
  migration step needed for that specific case.
- `focusedWorldObjectId: WorldObjectId | null` — which object is
  currently focused. **NOT persisted** — always `null` on load, the same
  posture `MenuFlow`'s screen stack already has (transient interaction
  mode, not simulation state). It lives on `GameState` rather than the
  view because the resolution rules that read it are core simulation
  logic, not rendering.

## Containment

A world object can be placed INSIDE another world object's part instead
of directly at a `Location` — `Placement.containedIn: Record<WorldObjectId,
{ containerId: WorldObjectId; partId: PartId }>`, alongside the existing
`worldObjectLocationId`. Every world object not in `player.inventory` has
an entry in exactly one of the two — never both (`cityLoader.ts` rejects
an object listed in a location's `itemIds` that also declares a
`containerId`).

**Authoring** mirrors `Npc.locationId` — the CONTAINED object declares its
own placement, rather than being listed anywhere in a location's
`itemIds`:

```yaml
items:
  - id: torn-photograph
    nameKey: item.tornPhotograph.name
    descriptionKey: item.tornPhotograph.description
    kind: item
    portable: true
    containerId: desk
    containerPartId: right-drawer
```

`containerId`/`containerPartId` must appear together; `cityLoader.ts`
validates `containerId` resolves to a real world object that actually has
a part with that id, and rejects a containment cycle (an object
eventually containing itself through a chain) via a bounded walk.

**Exposure** is per-`PartState`, not per-`Part`: while a part's CURRENT
state has `exposesContents: true`, world objects `containedIn` that part
become reachable via `examine`/`interact`/`takeItem` — see
`GameEngine.worldObjectIdsInScope()`'s fixpoint expansion below. Closing
the part (transitioning to a state without `exposesContents`) makes them
unreachable again; nothing about the contained object itself changes.

**Ambient listing stays direct-only by default.** A revealed object does
NOT join the location's "items you see"/"you notice" line just because
it's now reachable — that would spoil "something's in here" before the
player has actually looked. It joins those lines ONLY when the exposing
state ALSO sets `revealInAmbientListing: true` (and even then, only a
DIRECT child — one hop, so a nested container's grandchildren don't
ambient-reveal even if flagged). The default (examine-only discovery)
matches the point-and-click framing: you open the drawer, then look
inside it, rather than the room description doing the finding for you.

**Taking** a contained object (`takeItem`) clears its `containedIn` entry
the same way taking a directly-placed object clears its
`worldObjectLocationId` entry.

## Resolution: `GameEngine`'s scope and `resolvePart` tiers

`worldObjectIdsInScope()` is the shared basis for `examine`'s object
lookup, `interact`, and `takeItem`: starting from direct location +
inventory objects, it repeatedly folds in any object's `containedIn`
children through a part whose CURRENT state has `exposesContents: true`,
until nothing new is added (`Set`-backed, so a cycle can't loop — though
`cityLoader.ts` already rejects those at content-load time). A revealed
object is therefore directly `examine`/`take`-able with NO focus
requirement — focus only ever disambiguates PART targeting, never gates
whether a revealed ITEM is reachable.

`resolvePart` (used by `examine`'s part fallback and by `interact`)
resolves a typed alias against parts specifically, in order:

1. **Focused.** If an object is focused (and still in scope), search only
   ITS parts.
2. **Important-surfaced.** Otherwise, search only parts whose CURRENT
   state is `important`, across every object in scope.
3. **Unreachable.** If the alias matches a part somewhere in scope that
   neither tier reached, return a distinct signal — drives "You'd need to
   take a closer look first" rather than a flat not-found, since the part
   genuinely exists, just isn't addressable yet.
4. **Not found.** No part anywhere in scope matches at all.

## Ambiguous targets

`examine`/`takeItem` resolve a typed alias against `worldObjectIdsInScope()`
via `GameEngine`'s private `resolveWorldObjectQuery` — and, unlike the
location-then-inventory-then-contained scope ORDER the fixpoint expansion
above builds, this resolver never uses that order to break a tie. If a
string query matches more than one object in scope (e.g. an inventory
item happens to share an alias with something at the current location, or
with something inside an open container), it returns EVERY match as a
`ResolutionChoice[]` on `ActionResult.choices` (`ok: true`,
`event.targetAmbiguous`) instead of silently picking the first one —
first-match-wins was a real, silent bug waiting to happen once inventory
items and location items could legitimately share names.

Each `ResolutionChoice.id` is the candidate's real `WorldObjectId`, and
its `params.locationKey` names the candidate's *immediate parent* — the
containing object's own `nameKey` if it's `containedIn` one, the fixed
`"ui.inventoryLabel"` placeholder if it's carried, otherwise the current
location's `nameKey` — rendered via `"ui.disambiguationOption"`
(`"{itemKey} ({locationKey})"`, e.g. "letter (writing desk)" vs. "letter
(carried)"). `src/view/menu/disambiguationMenus.ts`'s
`buildDisambiguationScreen` turns these into a one-shot `MenuFlow`
"choices" screen (see `docs/systems/menu.md`), the same pattern
`travelMenus.ts` uses for `TravelChoice` — `TerminalView`'s
`WORLD_OBJECT_RESOLVERS` table decides, per `Command.kind`, how to
re-issue the verb that produced the ambiguity once a choice is made.

**Resolving by id is the actual fix, not just nicer UX.** Both `examine`
and `takeItem` have an `{ id: WorldObjectId }` overload alongside their
usual string-query form — selecting choice #2 calls e.g.
`examine({ id: "torn-photograph" })`, which looks the object up directly
(still gated on being in scope) rather than re-running alias matching on
the same ambiguous text, which would just hit the identical collision
again (or silently re-pick one). Any future verb that targets a
`WorldObject` through this same scope/alias lookup should grow the
matching id-based overload and register in
`TerminalView.WORLD_OBJECT_RESOLVERS`, not invent a second resolution
path. The id-based route is the more robust one long-term — a UI element
that already knows an object's id (a future inventory sidebar, a
world-map click) should always resolve that way rather than reusing
alias text, per the same reasoning.

`interact`'s part-alias resolution (below) is NOT covered by this — it
targets a `Part` of the focused/important-surfaced object specifically,
which is a narrower, already-disambiguated-by-focus lookup, not a raw
scope-wide alias search.

## Public capabilities

| Method | Effect | Failure mode |
|---|---|---|
| `examine(query \| { id })` | Object/NPC lookup (now including reachable contained objects) unchanged in priority; falls back to `resolvePart` for a string query. An object WITH parts focuses it and bubbles any `important`-state parts (`summaryKey ?? descriptionKey`) into the result; a plain object or NPC clears focus. A direct part match shows the part's own description + its current state's full `descriptionKey`, regardless of importance, and sets focus on the parent. A string query matching more than one object returns `ResolutionChoice[]` instead — see "Ambiguous targets." | `event.partNotFocused` (tier 3), `examine_not_found` (tier 4) |
| `takeItem(query \| { id })` | Same scope/alias resolution as `examine`, minus the NPC/part fallback — takes a portable object into inventory. A string query matching more than one object returns `ResolutionChoice[]` instead of guessing — see "Ambiguous targets." | `event.itemNotFound`, `event.itemNotPortable` |
| `interact(verb, query)` | Resolves via the same tiers, then looks for a state on the matched part whose `enterAliases` includes `verb`; on a real transition, mutates `partStates` and focuses the parent. | `event.itemNotFound` (nothing matches), `event.partNotFocused` (tier 3), `event.partVerbNotApplicable` (verb doesn't apply to this part), `event.partAlreadyInState` (ok:true — no-op) |
| `unfocus()` | The `back`/`stop` command — explicitly clears focus, reporting what (if anything) was focused | never fails |
| `clearFocus()` | Event-less, unconditional focus break for callers where losing focus is a side effect (successful `travelTo`/`executeHop`, successful `talkTo`, `TerminalView` opening the travel menu) | n/a |
| `getFocusedWorldObject()` | Read-only getter (mirrors `getMoney()`) — the view's "You are examining X" status reminder reads this | never fails |

`look()` is deliberately unaffected by focus — it always shows the full
room description regardless of mode.

## Parsing

`open`/`close`/`shut` are one `VERB_RULES` entry in
`EnglishCommandParser.ts` (all three words), canonicalized via
`INTERACT_VERB_ALIASES` (`shut` → `"close"`) before building
`{ kind: "interact", verb, query }`. `back`/`stop` build
`{ kind: "unfocus" }`. Adding a new interaction verb WORD (e.g. `light`
for a cigarette) means one more `VERB_RULES` entry the same way — which
part/state it actually affects is entirely content-driven via
`enterAliases`, so no `GameEngine` change is needed.

`back`/`stop` were chosen over the more idiomatic "get back" specifically
because `get` is already a `take` synonym — "get back" would parse as
`take "back"` and fail as an unknown item. `MenuFlow`'s own "back"/"exit"
words are a separate input path (only active while a menu is open), so
there's no collision there.

## View

`TerminalView` prints "You are examining {itemKey}." after every
command's output, whenever `getFocusedWorldObject()` is non-null — this
is status chrome (like the money/clock/location status bar), not an
engine event, since it's a reminder about interaction mode rather than
something that happened. It also calls `engine.clearFocus()` before
opening the travel menu, since that path never reaches `GameEngine` as an
`ActionResult` at all (see `docs/systems/menu.md`).

## Images

A part state may carry an `image` (see `docs/systems/image-pane.md`): while
its object is examined, the scene pane shows the image of the current state,
so `interact` (`open`/`close`) swaps the picture. `examine` also sets the
transient `examinedTarget` alongside focus; both clear together.

## Known gaps

- No verbs beyond `open`/`close` exist yet (e.g. `light`/`extinguish`).
  Adding them is a parser-only change (one `VERB_RULES` entry each) plus
  content — see "Parsing" above.
- A part's `nameKey`/`descriptionKey` don't currently distinguish "never
  examined" from "examined but its state changed" — an author who wants
  different flavor text per visit needs a state per visit, not richer
  part-level text.
- The map editor doesn't manage world objects, parts, or containment at
  all (it only edits `Location`s), and its `save()` reconstructs each
  location's `itemIds` from `initialPlacement` without reconstructing
  `containerId`/`containerPartId` for anything in `containedIn` — so
  **saving from the editor silently drops a contained object's placement
  entirely** (the object's own record survives in the `items:` catalog,
  but it ends up placed nowhere: not in any location's `itemIds`, not
  `containedIn` anything). Don't use the editor's save on content that
  has any contained objects until this is fixed.

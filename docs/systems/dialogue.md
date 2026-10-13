# System: Dialogue Flags (`src/engine/GameEngine.ts`'s `talkTo`, `src/engine/types.ts`)

## What it does

The first system that lets what an NPC says depend on world/case state,
rather than every NPC having exactly one fixed line forever. It's
deliberately the smallest useful layer, not a full branching dialogue
engine — see "Known gaps" for what's explicitly deferred, and why.

Two pieces:

- **`GameState.flags: Record<string, boolean>`** — a single flat, global
  key-value store. Not nested per-NPC: a flag like `foundMurderWeapon`
  isn't owned by any one NPC, so one namespace avoids inventing a second
  scoping scheme later. Content and engine code both just pick string
  names.
- **`Npc.dialogueRules: DialogueRule[]`** — an ordered list of
  `{ requires: string[]; textKey: string }`. `talkTo` walks it in order
  and picks the first rule whose `requires` are ALL `true` in
  `state.flags`; if none match, it falls back to `Npc.dialogueKey` (the
  original, always-present single line every NPC still has). `requires`
  is **AND-of-true only** — no negation, no OR — deliberately minimal;
  see "Known gaps".

## `GameEngine.talkTo`

```ts
talkTo(query: string): ActionResult {
  const npc = this.findNpcByAlias(npcsAtLocation(this.state.placement, location.id), query);
  if (!npc) return { ok: false, events: [...] };

  const matchedRule = npc.dialogueRules.find((rule) => rule.requires.every((flag) => this.state.flags[flag] === true));
  const textKey = matchedRule?.textKey ?? npc.dialogueKey;

  this.clearFocus();
  this.state.flags[`talkedTo.${npc.id}`] = true;
  return { ok: true, events: [{ type: "npc_talked", textKey, params: { npcKey: npc.nameKey } }] };
}
```

`talkTo` is also the **only place anything writes a flag** this round: it
always sets `talkedTo.<npcId>` to `true` after picking which line to show.
Matching happens against `state.flags` as it stood BEFORE that write, so
"have I talked to them before" means prior conversations only — a rule
requiring `talkedTo.informant` matches starting on the player's SECOND
`talkTo("informant")` call, not the first. Nothing else in the engine
writes a flag yet; tests set `state.flags` directly before constructing/
calling the engine, the same pattern already used for `player.stats`/
`player.stealthMode`. Future systems (case progress, giving an item, a
future dialogue engine) add their own flag-writes when they're built —
this round doesn't invent speculative triggers for them.

## Content authoring

`Npc.dialogueKey` (the fallback) is unchanged — still one required
`text.en.dialogue` string per NPC. `dialogueRules` is a new, optional,
sibling YAML field (not nested inside `text`, since it carries logic plus
one string per entry, not `validateText`'s multi-field text-block shape):

```yaml
npcs:
  - id: informant
    text:
      en:
        dialogue: '"{npcKey}" mutters something about the docks, then falls silent.'
    dialogueRules:
      - requires: [talkedTo.informant]
        text:
          en: "\"Back again? I already told you what I know.\""
```

Each rule's `text.<lang>` registers into the locale table under
`npc.<id>.dialogue.<ruleIndex>` (`cityLoader.ts`'s `validateNpc`) —
`0`-indexed, matching authored order. `requires` must be a non-empty list
(a rule with no conditions should just be authored as `dialogueKey`
itself); every rule must have a `text` mapping.

## Structured conditions (added 2026-09-21)

`DialogueRule` also has an optional `when: Condition` (see
`docs/systems/npcs.md`): a rule now matches when every `requires` flag is
`true` AND `when` (if present) evaluates true for the NPC being talked to.
`requires` stays as-is — existing content is unchanged — and a rule needs a
non-empty `requires` OR a `when`. `when` supplies what `requires` cannot:
negation (`not`), OR (`any`), trust/suspicion/opinion thresholds, what the NPC
knows or remembers, labels, and reputation. `talkTo` also records a
`spoke-to` memory (after rule selection, so a `memory` condition means "before
this conversation").

## Rule effects (added 2026-09-21)

`DialogueRule.effects` is an optional list of `DialogueEffect`s (`trust`,
`suspicion`, `opinion`, `reputation`, `setFlag`, `knowledge`, `memory`,
`learnFact`; see `docs/content-schema.md` for the YAML). `talkTo` applies them via
`applyDialogueEffects` (`src/engine/npc/effects.ts`) when the rule is the one
selected, right after the `talkedTo` flag write and before the `spoke-to`
memory. This makes conversation the first place the NPC mutators are called
from play. Effects act on the NPC spoken to, except `reputation` and
`setFlag`, which are global. Nothing in an effect is persisted as content:
only the mutated `npcStates`, `reputation` and `flags` are saved, so there is
no save-schema impact.

Effects have no built-in once-only guard. Author each effect rule so it stops
matching after it lands, e.g. `when: {not: {flag: talkedTo.<npc>}}` (the flag
is written after selection, so the first conversation still matches) or a
threshold that the effect itself crosses (`suspicion < 2` with effect
`suspicion: +2`). The "Ledger" mini-case in `world.yaml` uses both.

`setFlag` used to double as the only "player learned a fact" record —
that's now `learnFact`/`playerKnows` (added 2026-09-22, see
`docs/systems/case-system.md`), typed siblings of `setFlag`/`flag` for
specifically "the player has learned fact X," with a player-visible facts
panel to show for it. `setFlag`/`flag` remain the right tool for case
PROGRESS bookkeeping that isn't itself a fact (e.g. `case.ledger.solved`).

## Topic menus (added 2026-09-22)

`Npc.topics?: DialogueTopic[]` — selectable conversation topics, one level
deeper than `dialogueRules` but reusing the exact same pattern:

```ts
interface DialogueTopic {
  id: TopicId;
  labelKey: string;   // npc.<id>.topic.<topicId>.label — the menu option text
  textKey: string;    // npc.<id>.topic.<topicId>.dialogue — fallback answer
  requires: string[]; // gates whether the topic is OFFERED at all
  when?: Condition;
  responses: DialogueRule[]; // same shape/matching as dialogueRules — picks the answer
}
```

**`talk <npc>` opens the topic menu whenever that NPC has any topic
currently offered** (gate holds); an NPC with no `topics`, or none
currently unlocked, behaves exactly as before — one line, no menu. This
was a deliberate choice over a separate `ask <npc>` verb: `talk` is the
single entry point, and content decides whether there's anything to
choose from.

Opening the topic menu still calls `talkTo` for the header line — it does
NOT bypass `dialogueRules` (fixed 2026-09-22; an earlier version built the
header straight from `Npc.dialogueKey`, which skipped any matching
`dialogueRules` entry AND its effects entirely — so an NPC whose first-talk
rule adjusts trust, e.g. Rosa's, never got that bump through real play once
they had any always-offered topic, only via a direct `engine.talkTo` call
like the headless playthrough test used). The topic menu is layered ON TOP
of the ordinary greeting, not a replacement for it.

`GameEngine` exposes three pieces, all reusing existing machinery — no new
state, no new mutation mechanism:

- A private `gateHolds(npcId, {requires, when})` — the same check
  `dialogueRules` always did, now shared by `dialogueRules`, topic
  availability, and topic `responses`.
- `listTopics(query)` / `topicsForNpcId(npcId)` — which topics are
  currently offered (empty covers BOTH "none authored" and "authored but
  none unlocked yet" — the view treats both as "fall back to plain talk").
- `askAbout(npcId, topicId)` — mirrors `talkTo` exactly, one level deeper:
  picks the first matching `responses` entry (else the topic's `textKey`),
  applies `effects` via `applyDialogueEffects`, sets `talkedTo.<npc>` (the
  same flag `talkTo` writes — existing `not: {flag: talkedTo.<npc>}`
  first-talk guards stay meaningful whichever path is used), and records
  the same `spoke-to` witness observation.

The view (`src/view/menu/npcMenus.ts`'s `buildTopicsScreen`, wired into
`TerminalView`'s pre-dispatch special-case block alongside travel/notebook
menus) drives this through the existing `MenuFlow` — the domain-agnostic
menu controller `MenuFlow.ts` already named "interrogation" as an expected
future consumer. Selecting a topic re-derives the WHOLE screen (`goto` a
freshly-built `buildTopicsScreen`) rather than mutating one in place: a
`MenuOutcome.goto` carries no separate printable events, so the answer
becomes the new screen's `header`, and rebuilding the option list from
`topicsForNpcId` on every turn picks up any availability change the
answer itself just caused (e.g. an opinion-gated topic's answer changing
once a threshold is crossed within the same conversation).

### Clicking instead of typing (added 2026-10-13)

Every choices screen renders its options as `button.terminal__menu-option`
elements (`TerminalView.renderMenuScreen`), so topic menus (and travel, buy,
disambiguation and panel menus, which share `MenuFlow`) can be clicked. A click
is exactly the player typing the option's number: a delegated listener in
`handleLogClick` calls `runInput(String(n))`. Buttons of any menu block that
is no longer the live screen are disabled (`retireStaleMenus`) so a stale
click cannot index into a different screen. View-only; no engine change.

## How it interacts with other systems

- **NPCs** (`docs/systems/npcs.md`): supplies the `Condition` evaluator and
  the memory/trust/knowledge state that `when` reads.
- **Engine core** (`docs/systems/engine-core.md`): `GameState.flags` joins
  `player`/`clock`/`placement`/`partStates`/`notebooks` as a mutable-slice
  field, saved and restored like the rest.
- **Save** (`docs/systems/save.md`): `flags` is why `SAVE_SCHEMA_VERSION`
  bumped from 9 to 10; a pre-existing save backfills `flags: {}` (nobody
  had talked to anyone before this system existed).
- **Content schema** (`docs/content-schema.md`): the Npc locale-key table
  gains `npc.<id>.dialogue.<n>` alongside the existing `.dialogue`.

## Known gaps

- **Only Rosa (in the "Ledger" mini-case) has `topics` authored** — see
  "Topic menus" above; `src/engine/npc/slice.test.ts` and
  `src/view/TerminalView.test.ts` exercise it both headlessly and through
  the DOM. Most NPCs still have zero topics and behave exactly as before.
- **`askAbout` has no once-only guard beyond what a `responses` entry's own
  `when` provides** — same farming caveat as `dialogueRules.effects`.
- **`requires` itself has no negation.** Use a `when` condition
  (`{not: {flag: x}}`, `{any: [...]}`) for anything beyond AND-of-true.
- **`talkTo` is the only flag writer.** Case progress, giving an item,
  discovering a clue — none of those exist yet, so nothing else sets a
  flag. When they're built, they'll write into the same `state.flags`
  map rather than inventing a separate mechanism.
- **No player-facing verb to inspect flags.** Debugging a flag's value
  today means reading `engine.getState().flags` directly (fine for tests,
  not for play).

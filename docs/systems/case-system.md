# System: Fact Tracking (`src/engine/npc/state.ts`'s `learnFact`, `GameEngine.getPlayerFacts`)

## What it does

The first slice of a "deduction system" — a persistent, player-visible
record of what the player has learned, replacing the previous approach of
closing a case via a bare, invisible `flags['learned.<x>']` boolean (see
`docs/systems/dialogue.md`'s "Rule effects" section, which used to describe
`setFlag` as doing double duty for this).

**Explicit non-goal, by design:** this system surfaces what the player has
gathered and **never concludes anything for them**. No confidence meter, no
"you've learned enough, accuse now" prompt, no engine-computed notion of
guilt. It's an Outer-Wilds-style log, not a solver. Solving a case stays
entirely content-authored — a flag an NPC's rule sets, exactly as
`case.ledger.solved` already does — and making sense of what the facts mean
stays entirely the player's job.

## Data model

- **`Fact` (`src/engine/types.ts`)** — authored content, like `NpcLabel`:
  `{ id: FactId; textKey: string }`, one-line player-facing text. Lives on
  `GameState.facts: Record<FactId, Fact>`, loaded from `world.yaml`'s
  `facts:` list, never saved (content, not progress — CLAUDE.md rule 6).
- **`GameState.playerFacts: Record<FactId, { atMinutes: number }>`** — the
  mutable counterpart: which facts the player has learned, and when. A
  typed record (not booleans, like `flags`) so ordering-by-learned-time
  comes for free. Part of the save's mutable slice.

`FactId` is the same string type `NpcState.knowledge` already used for what
an NPC knows about a fact — this system is the first PLAYER-side
counterpart to that NPC-side store; the two are read/written independently
(an NPC "knowing" something doesn't make the player know it, and vice
versa).

## Engine

- **`learnFact(state, factId)`** (`src/engine/npc/state.ts`) — sets
  `state.playerFacts[factId] = { atMinutes: state.clock.minutesElapsed }`
  only if not already present. First-learned time wins; a second call is a
  no-op, not an overwrite (unlike `setKnowledge`, which always overwrites) —
  "when did I first learn this" shouldn't move.
- **`DialogueEffect` gained `{ learnFact: FactId }`**, applied by
  `applyDialogueEffects` (`src/engine/npc/effects.ts`) the same way
  `setFlag`/`knowledge` are — conversation is still the only thing that
  writes player facts, for now.
- **`Condition` gained `{ playerKnows: FactId }`**, evaluated by
  `evaluateCondition` (`src/engine/npc/conditions.ts`) as
  `state.playerFacts[factId] !== undefined` — the typed successor to
  gating an NPC's line on a bare `flag` string for "has the player learned
  X." Unlike every other `Condition` variant (which read the NPC being
  talked to), `playerKnows` reads the player's own state — this is fine
  since `Condition` is evaluated with access to the whole `GameState`, not
  just the NPC's slice.
- **`GameEngine.getPlayerFacts()`** — the ONLY new read surface. Joins
  `state.playerFacts` (what/when) with `state.facts` (the authored text),
  sorted oldest-first. No grouping, no "case complete" inference — just
  "what has the player learned, and when."

## Content authoring

```yaml
facts:
  - id: courier
    text:
      en: A courier in a grey coat dropped the ledger in the alley Tuesday night.
```

Unlike most entities' `text` block (a mapping of named fields per
language — `{ en: { name: "...", description: "..." } }`), a fact's `text`
is a single string per language directly, since a fact has exactly one
player-facing field. `textKey` is the bare `fact.<id>` (no field suffix) as
a result — see `validateFact` in `cityLoader.ts`.

`learnFact`/`playerKnows` slot into the existing effect/condition lists
anywhere a `DialogueEffect`/`Condition` is accepted — a `dialogueRules`
entry, a topic's gate, or a topic response:

```yaml
npcs:
  - id: cook-rosa
    topics:
      - id: ledger
        responses:
          - when: { npcStat: opinionOfPlayer, op: ">=", value: 2 }
            effects:
              - learnFact: courier
            text:
              en: "..."
  - id: officer-hale
    dialogueRules:
      - when: { all: [{ playerKnows: courier }, { not: { flag: case.ledger.solved } }] }
        effects:
          - setFlag: case.ledger.solved
        text:
          en: "..."
```

`cityLoader.ts`'s referential-integrity pass rejects a `learnFact`/
`playerKnows` reference to a fact id with no entry in `facts:`, same as it
already does for label/reputation-scope references.

## View

A `"facts"` side-panel content (`src/view/TerminalView.ts`'s
`SIDE_PANELS`, alongside `inventory`/`locations`/`verbs`) renders
`getPlayerFacts()` as a plain list, oldest-first, under the
`ui.factsPanelTitle` heading. Opened the same way any panel content is —
`panel <slot> facts` — no new command. `"facts"` is also a new
`PanelContentId` union member (`src/engine/parsing/Command.ts`) and word
alias (`EnglishCommandParser.ts`'s `PANEL_CONTENT_ALIASES`).

## Save

`SaveData` gained `playerFacts`; `SAVE_SCHEMA_VERSION` bumped 11 → 12. A
pre-existing save backfills `playerFacts: {}` — nobody had learned anything
before this system existed. See `docs/systems/save.md`.

## How it interacts with other systems

- **Dialogue** (`docs/systems/dialogue.md`): `learnFact`/`playerKnows` are
  typed, fact-specific siblings of `setFlag`/`flag` — the same rule
  matching/effects machinery (`gateHolds`, `applyDialogueEffects`), one
  more variant each.
- **NPCs** (`docs/systems/npcs.md`): a third consumer of the shared
  `Condition`/`DialogueEffect` machinery, after `dialogueRules` and
  `topics`. `playerFacts` is the player-side counterpart to
  `NpcState.knowledge` — the two never overwrite each other.
- **Save** (`docs/systems/save.md`): schema version 11 → 12.
- **Content schema** (`docs/content-schema.md`): `facts:` top-level YAML
  list; `learnFact`/`playerKnows` in the effect/condition tables.

## Known gaps (deliberately deferred)

- **No grouping/tagging.** Facts render as one flat, chronological list.
  Once there's enough fact volume to need it, group/tag facts rather than
  reworking the flat list from scratch.
- **No cross-referencing or contradiction detection.** The player connects
  facts themselves — now including spatially, via the case board
  (`docs/systems/case-board.md`) — but the engine never compares two
  facts to each other.
- **The facts panel itself is still a plain list, not a graph/board** —
  the case board is a SEPARATE, alternate view (a full-screen overlay
  reading the same `getPlayerFacts()`), not a replacement for the panel.
- **No scoring, no auto-detected "case solved," no accusation/verdict
  mechanism.** Solving a case is still entirely content-authored (a flag a
  dialogue rule sets, as `case.ledger.solved` does) — this system has no
  opinion on when a case is "done."
- **Only the Ledger mini-case's `courier` fact exists.** Most case content
  still closes purely via flags; migrate a flag to a fact only when its
  value is genuinely meant to be player-visible.

# Fact tracking: the smallest real "deduction system" slice

> Status: **implemented** (2026-09-22). See `docs/context.md` for the
> session handoff and `docs/systems/case-system.md` for the as-built
> writeup. Kept here as the original design record.

## Context
The Ledger mini-case "closes" today purely via a `flags['learned.courier']` boolean — the
player has no visible record of what they've learned; only content authors and tests can see
it (`state.flags` directly). `docs/systems/engine-core.md`'s "Known gaps" explicitly says "No
case/deduction/event-log system yet — this doc will gain a cross-reference to
`case-system.md` once that exists," and `types.ts` already has a `FactId`/`KnowledgeDisposition`
pair used one-sidedly (only NPCs have `knowledge` — there is no player-side counterpart).

Per the user's explicit direction: this system's job is **surfacing what the player has
gathered, never concluding anything for them** — no confidence meter, no "you've deduced
enough, accuse now" prompt, no engine-computed notion of guilt. It's an Outer-Wilds-style log,
not a solver. So v1 is intentionally the smallest possible thing that gives the player a
persistent, inspectable record of facts they've learned — reusing every existing piece
(`FactId`, `Condition`/`DialogueEffect`/`gateHolds`, the side-panel content-type system) rather
than inventing a parallel mechanism. Grouping/cross-referencing (tags, "these facts relate") is
deliberately deferred until there's enough fact volume to need it — the flat list already
proves the mechanism and leaves room to grow it later without a rewrite.

## Data model
Add to `src/engine/types.ts`:
```ts
export interface Fact {
  id: FactId;
  textKey: string; // fact.<id> — one-line, player-facing summary
}
```
`Fact` is authored content (like `NpcLabel`/`NotebookProduct`) — `GameState.facts: Record<FactId, Fact>`,
loaded from `world.yaml`'s new top-level `facts:` list via `cityLoader.ts`, never saved (CLAUDE.md
rule 6 — content, not progress).

Mutable slice addition: `GameState.playerFacts: Record<FactId, { atMinutes: number }>` — parallel
to `flags`, but a typed record instead of booleans, so "learned" carries a timestamp for free
(ordering the panel by when it was learned) without inventing a second store.

## Engine (`src/engine/GameEngine.ts`, `src/engine/npc/state.ts`, `src/engine/npc/effects.ts`, `src/engine/npc/conditions.ts`)
- `DialogueEffect` gains `{ learnFact: FactId }`. New mutator in `state.ts`: `learnFact(state, factId)` —
  sets `state.playerFacts[factId] = { atMinutes: state.clock.minutesElapsed }` only if not already
  present (first-learned time wins; idempotent like the existing `setKnowledge` pattern). Wired into
  `applyDialogueEffects`'s existing `if/else if` chain, same shape as the `setFlag`/`knowledge` branches.
- `Condition` gains `{ playerKnows: FactId }`. New branch in `conditions.ts`'s `evaluateCondition`:
  `return state.playerFacts[condition.playerKnows] !== undefined;` — this is the precise, typed
  successor to gating on a bare `flag` string for "has the player learned X."
- `GameEngine.getPlayerFacts(): { id: FactId; textKey: string; atMinutes: number }[]` — joins
  `state.playerFacts` (what's learned) with `state.facts` (the authored text), sorted by
  `atMinutes` ascending. This is the ONLY new read surface: no grouping, no "case complete"
  inference, nothing beyond "what has the player learned, and when."

## Content loader (`src/content/cityLoader.ts`)
- Parse the new top-level `facts:` list into `CityContent.facts`/`GameState.facts`: each entry
  `{ id, text: { en: "..." } }` → `textKey: fact.<id>`, registered via the existing `validateText`
  helper (single-field variant, like `NpcLabel`'s text), mirroring how `labels:`/`notebookProducts:`
  are already parsed as sibling top-level lists.
- Extend the existing referential-check pass (already checks label ids, reputation scopes, memory
  locations for `dialogueRules`/`topics`) to also verify: every `learnFact` effect and every
  `playerKnows` condition references a declared fact id.

## Content: migrate the Ledger case to prove it
In `src/content/city/world.yaml`:
- Add `facts: [{ id: courier, text: { en: "A courier in a grey coat dropped the ledger in the alley Tuesday night." } }]`.
- Rosa's `ledger` topic response: replace `effects: [{ setFlag: learned.courier }]` with
  `effects: [{ learnFact: courier }]`.
- Officer Hale's `dialogueRules`: replace `requires: [learned.courier]` with
  `when: { playerKnows: courier }` on the case-closing rule (and its `not: { flag: case.ledger.solved }`
  guard stays as-is — `case.ledger.solved` is case-progress bookkeeping, not a "fact," so it correctly
  stays a flag; no need to conflate the two stores).

## View (`src/view/TerminalView.ts`, `src/engine/parsing/Command.ts`)
- Add `"facts"` to the `PanelContentId` union (`Command.ts`, alongside `verbs`/`locations`/`inventory`/`closed`).
- Add a `facts` entry to `SIDE_PANELS` in `TerminalView.ts`, same shape as the existing `inventory`
  entry: `render: (ctx) => renderSidePanel("ui.factsPanelTitle", ctx.engine.getPlayerFacts().map((f) => t(f.textKey)))`.
  No new command needed — `panel <slot> facts` already works through the existing `setPanel` dispatch.
- New i18n key `ui.factsPanelTitle` ("Facts" or similar) in `src/i18n/en.ts`.

## Save (`src/engine/save/save.ts`, `docs/systems/save.md`)
- `SaveData` gains `playerFacts: GameState["playerFacts"]`. `SAVE_SCHEMA_VERSION` bumps 11 → 12.
- Migration step `schemaVersion === 11` backfills `playerFacts: {}` (nobody had learned anything
  before this system existed), following the exact pattern of the 9→10 (`flags`) and 10→11
  (`npcStates`/`reputation`) steps already in `migrate()`.

## Docs (same change, per CLAUDE.md)
- New `docs/systems/case-system.md` — the doc `engine-core.md`'s "Known gaps" already promised.
  Documents the `Fact` model, `learnFact`/`playerKnows`, the facts panel, and — explicitly — the
  non-goals: no scoring, no auto-detected "case solved," no accusation/verdict mechanism; solving
  a case stays entirely content-authored (a flag an NPC's rule sets, as `case.ledger.solved`
  already does), and figuring out *what the facts mean* stays entirely the player's job.
- `docs/systems/engine-core.md`: update the "Known gaps" line to point at the new doc instead of
  saying it doesn't exist.
- `docs/systems/dialogue.md`: note `learnFact`/`playerKnows` alongside `setFlag`/`flag` as the
  typed, fact-specific sibling of the flag mechanism.
- `docs/systems/npcs.md`: note facts as a third consumer of the shared `Condition`/`DialogueEffect`
  machinery (after `dialogueRules` and `topics`).
- `docs/content-schema.md`: `facts:` top-level YAML shape, plus `learnFact`/`playerKnows` in the
  effect/condition tables.
- `docs/systems/save.md`: schema version bump entry.

## Verification
- New `src/engine/npc/facts.test.ts` (or fold into `effects.test.ts`/`conditions.test.ts` if those
  exist): `learnFact` sets `playerFacts` with a timestamp and is idempotent on a second call;
  `playerKnows` condition evaluates correctly before/after; `getPlayerFacts` joins state+content
  and sorts by `atMinutes`.
- `src/content/cityLoader.test.ts`: parses `facts:`, registers `fact.<id>` keys; rejects a
  `learnFact`/`playerKnows` reference to an undeclared fact id.
- `src/engine/npc/slice.test.ts`: update the Ledger playthrough to assert `engine.getPlayerFacts()`
  contains `courier` (with the right `textKey`) right after Rosa's reveal, and that Hale's
  case-closing rule still fires off `playerKnows` instead of the old flag.
- Small addition to `src/view/TerminalView.test.ts`: `panel left facts` before/after learning the
  courier fact shows it appear in the rendered list (mirrors the existing inventory-panel test).
- `npx tsc --noEmit`, `npx vitest run` (expect only the pre-existing `diner-upper-floor` alias
  failure), `npm run build`.
- Ask the user to play it manually (`talk rosa` through the ledger reveal, then `panel left facts`)
  to check the panel reads well in practice.

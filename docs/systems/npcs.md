# System: NPCs (`src/engine/npc/`)

## What it does

Turns an NPC from a thin static record (name, description, one dialogue line)
into a layered model that supports case-driven play now and an autonomous
"NPC engine" later. Everything here is data plus small pure functions — no
LLM, no timers, no per-tick loop, nothing asynchronous.

## The three layers

| Layer | Lives in | Saved? | Contents |
|---|---|---|---|
| Authored | `Npc` (from `world.yaml`) | No | identity, `labels`, `stats`, `schedule`, dialogue rules |
| Case-instance | `Placement.npcLocationId` (+ `CityContent.initialNpcStates`) | Yes (placement) | where the NPC starts; their starting trust, memories, knowledge |
| Mutable | `GameState.npcStates`, `GameState.reputation` | Yes | trust, suspicion, memories, opinions, knowledge, reputation |

Authored content is never saved (CLAUDE.md rule 6). An NPC's authored
STARTING values (`trust`, `suspicion`, `memories`, `knowledge` in YAML) are
setup data, like `initialPlacement`: `cityLoader.ts` splits them off into
`CityContent.initialNpcStates`, a new game copies them into
`GameState.npcStates`, and from then on they live (and save) only there.

## Labels

`Npc.labels: string[]` — several per NPC ("worker", "city-official",
"docks"). Definitions live in `world.yaml`'s top-level `labels:` list and are
pure data:

- `trustOffset` — flat opinion-of-the-player offset for every NPC carrying it.
- `labelOpinions` — how NPCs with THIS label feel toward NPCs carrying each
  listed label (`worker: { official: -1 }`).

One concept serves both roles and reputation scopes: "the docks know him" is
reputation under the `docks` label. Labels are static in v1; a case-driven
change (someone becomes a "suspect") should use a flag/condition instead.

## Mutable state

```
NpcState   { trust, suspicion, memories[], opinions{}, knowledge{} }   // per NPC
Reputation { global, byLabel{} }                                       // the player's
```

Accessors/mutators in `npc/state.ts` (`getNpcState` creates a blank state on
demand, so an NPC added to content after a save was made just starts blank).
Nothing in the game calls `adjustTrust`/`adjustOpinion`/`adjustReputation`
yet — they are the API future case/dialogue effects will use.

### Derived opinions (`npc/opinion.ts`)

Never stored; computed on demand.

- `getOpinionOfPlayer(state, npcId)` = personal trust + global reputation +
  reputation under each label the NPC carries + each label's `trustOffset`.
  Trust is private to the NPC; reputation is public — that is why both exist.
- `getOpinionOfNpc(state, from, to)` = stored `opinions["npc:<to>"]` + every
  (from-label → to-label) offset.

## Memories

A memory is structured data, not prose:

```
Memory { verb, subject: Ref, object?: Ref, locationId?, atMinutes,
         source: "witnessed"|"told"|"inferred", fromNpcId?, valence }
Ref    { kind: "player"|"npc"|"object"|"location"|"fact", id? }
```

- `verb` comes from the closed `MEMORY_VERBS` list in `types.ts`
  (`took, entered, left, spoke-to, gave, attacked, saw, learned`). Adding a
  verb is a code + i18n change on purpose. Testimony renders through
  `memory.verb.<verb>` keys in `en.ts`; the engine never produces text.
- Capped at `MAX_MEMORIES_PER_NPC` (50), oldest dropped, so saves stay bounded.
- Design deviation from the draft plan: memories carry no `id` (nothing
  needed to address one individually).

### Authoring shorthand

Parsed at load by `parseMemoryShorthand` (`npc/memory.ts`); malformed input
is a load-time content error like any other.

```
<subject> <verb> [<object>] [@<location>]
npc:barkeep saw player @docks
player took object:ledger @office
```

Refs are `player` or `kind:id`. Authored memories are pre-game history
(`atMinutes: 0`, `source: "inferred"`, neutral valence).

### Patterns

`MemoryPattern { verb?, subject?, object?, locationId?, withinMinutes? }` —
every present field must match, absent fields are wildcards (`memoryMatches`,
`npcRemembers`). In YAML it is a mapping with `subject`/`object` as ref tokens.

## The witness step

Display `GameEvent`s (`{type, textKey, params}`) are too loose to reason on,
so engine actions also emit a structured `Observation` (a `Memory` minus
`atMinutes`/`source`/`valence`) through `witnessObservation`:

- every NPC placed at the observation's location gets a `"witnessed"` memory;
- v1 concealment rule: a player-subject observation is hidden from
  bystanders while `Player.stealthMode` is on AND `Player.concealment` is
  `succeeded`/`succeededWell`/`succeededSpectacularly` (`playerIsConcealed`).
  No new roll happens. `participants` (e.g. the NPC being spoken to) always
  witness;
- an NPC never witnesses themselves as the subject.

Emitters today: `talkTo` (`spoke-to`, recorded AFTER rule selection and the
`talkedTo` flag write, so a `memory` condition means "before this
conversation"), `takeItem` (`took`), and travel (`left` before the move,
`entered` after the clock advance and concealment re-roll).

Later: an NPC `perception` stat contested against concealment (no such stat
exists in `STAT_DEFINITIONS` yet), and per-label valence rules turning
observations into opinion changes. Gossip (NPC-to-NPC `"told"`) is not built;
the `source`/`fromNpcId` fields exist so it needs no reshape.

## Knowledge

`Npc`'s authored `knowledge: { factId: knows|conceals|lies|unaware }` seeds
`NpcState.knowledge` (so a case can override it and it saves). `getKnowledge`
treats a missing fact as `"unaware"`. Data only — no UI consumes it yet; the
future case system should reuse fact ids as clue ids.

## Schedules (`npc/schedule.ts`)

- `NpcScheduleProvider.resolveLocation(npc, state) → LocationId | null` is the
  seam. `tableScheduleProvider` reads `Npc.schedule` (slots of
  `{ fromHour, toHour, locationId, weekdays? }`; `fromHour > toHour` wraps past
  midnight; first matching slot wins). A future NPC engine implements the same
  interface (and may add an "in transit" state) without touching callers.
- No schedule, or no matching slot → `null` → the NPC stays put.
- `syncNpcLocations(state)` writes results into `placement.npcLocationId`. It
  runs from `GameEngine.syncClock`, the only clock mutator — so still no
  tick loop. Placement stays the single stored truth (saves and every existing
  reader unchanged). Accepted cost: a big clock jump teleports an NPC to
  wherever their schedule says NOW, with no intermediate movement.
- Not called at new-game start: NPCs begin at their authored `locationId` until
  the first clock advance.

## Structured conditions (`npc/conditions.ts`)

`Condition` = `flag | not | all | any | npcStat | knows | memory | hasLabel |
reputation | playerKnows`, evaluated by `evaluateCondition(state, npcId,
cond)` in the context of ONE NPC (the one being talked to) — except
`playerKnows`, which reads the PLAYER's own `state.playerFacts` instead
(see docs/systems/case-system.md). `npcStat` is `trust`, `suspicion` or
`opinionOfPlayer`; ops are `< <= > >= == !=`. YAML examples are in
`docs/content-schema.md`.

`DialogueRule` gained an optional `when: Condition`; a rule matches when every
`requires` flag is true AND `when` holds. Design deviation from the draft
plan: `requires` was kept (not migrated to `all:[flag…]`) so existing content
and tests are unchanged and behaviour is identical. A rule needs `requires`
non-empty OR a `when`.

## How it interacts with other systems

- **Time**: `syncClock` → `syncNpcLocations`. Scheduled NPCs move only when
  time moves (travel is still the only source of elapsed time).
- **Stealth/Checks/Visibility**: `Player.stealthMode`/`concealment` decide who
  witnesses the player.
- **Dialogue**: `talkTo` evaluates `when` conditions, applies the selected
  rule's `effects` (the first caller of the trust/suspicion/opinion/
  reputation/knowledge mutators), and emits `spoke-to`. Reputation set by one
  NPC's rule raises another NPC's derived opinion through shared labels.
  `Npc.topics`/`askAbout` are the second consumer of the same `gateHolds`/
  `DialogueEffect` machinery, one level deeper — see docs/systems/dialogue.md's
  "Topic menus" section. Fact tracking (`learnFact`/`playerKnows`) is the
  third consumer, added directly to `Condition`/`DialogueEffect` rather than
  a new mechanism — see docs/systems/case-system.md.
- **Save**: `npcStates`/`reputation` are the mutable slice, schema 10 → 11; a
  pre-11 save migrates with empty NPC state (it loses authored initial
  trust/memories/knowledge, since only new games seed them).
- **Content/loader**: `cityLoader.ts` validates labels, schedules, memories,
  knowledge and conditions, including referential checks (labels, locations).
- **Case/deduction**: `FactId` is shared between `NpcState.knowledge` (what
  an NPC knows) and `GameState.playerFacts` (what the player has learned) —
  the two stores are independent. See docs/systems/case-system.md.

## Known gaps

- Only dialogue-rule `effects` call the mutators; no other engine action
  (taking an item, entering a room) adjusts trust or suspicion directly.
- The authored "Ledger" mini-case in `world.yaml` is the only content using
  labels, schedules and effects; `src/engine/npc/slice.test.ts` plays it
  headlessly. Rosa is the only NPC with `topics` authored so far.
- No gossip, no perception stat, no valence rules, no NPC-to-NPC observations.
- Labels are static; no runtime label changes.
- No player-facing view of NPC state or memories (no UI, no testimony verb).
- **The map editor (`src/editor/main.ts`'s NPCs tab, see `docs/editor_guide.md`)
  edits an NPC's core fields, schedule, and stats/trust/suspicion** — id,
  aliases, starting location, labels, name/description/fallback-dialogue
  text, a full schedule-slot editor (Stage 2, added 2026-09-23 — add/
  remove/edit slots, from/to hour, location, specific weekdays or "every
  day," with `fromHour > toHour` overnight wraps explicitly accepted, not
  blocked), and (Stage 3, also added 2026-09-23) trust/suspicion and the
  three `StatKey` values (blank = not authored, falls back to
  `STAT_DEFINITIONS`' default). `dialogueRules`/`topics`, and an NPC's
  starting knowledge/memories, still have no editor UI — a deliberate
  scope decision (the `Condition`/`DialogueEffect` unions `dialogueRules`/
  `topics` authoring needs are deeply recursive with no good small UI, and
  knowledge/memories were simply lower priority), not an oversight.
  Editing an NPC through this tab never drops any of those fields
  regardless — it merges its changes onto whatever's already authored
  rather than reconstructing the whole record, so anything without a form
  control survives untouched.

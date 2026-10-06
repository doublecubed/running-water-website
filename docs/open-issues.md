# Open Issues

Known gaps that are **consciously left open right now**, on purpose, with
a clear reason not to close them yet — distinct from `future_work.md`
(nice-to-have ideas with no pressing reason to build them) in that
everything here is a real, identified weak spot someone will eventually
need to act on, just not now. Move an entry out once it's closed (into
the relevant `systems/*.md`'s "Known gaps," or delete it if it's fully
resolved).

## The map editor's "Save" strips comments and reformats touched files

**The gap:** `src/editor/main.ts`'s `save()` re-serializes a location
file via `js-yaml`'s `dump()` whenever anything in it changed this
session (`regenerateLocationFile`) — `dump()` has no way to preserve the
original file's comments or formatting, since it only knows the parsed
data, not the text that produced it. `content/city/world.yaml` currently
carries a substantial hand-written top-of-file comment (the
order-independence explanation, interior/exterior notes, the
fare-system walkthrough); a location file with its own inline comments
would lose them the moment any location in that file is added, edited,
moved, or gets a new/curved connection.

**Mitigated (not fixed) since the editor's multi-file adaptation:** the
editor only rewrites a location/object/prefab file it actually TOUCHED
this session, and an untouched file keeps its exact on-disk text. This
shrinks the blast radius from "every save destroys every file's
comments" to "editing something in file X reformats file X" — real
content that's never opened for editing keeps its comments indefinitely.
It does not help the file that DOES get touched. `world.yaml` is a
partial exception now that the NPCs tab can write to it (added
2026-09-23 — see the entry below): touching any NPC rewrites the WHOLE
file (there's only one, so nothing more targeted is possible), same
comment/formatting loss as any other regenerated file, even though most
of that file's content (`labels`/`facts`/`transitLines`/`passes`) is
carried through untouched byte-for-byte at the parsed-value level (not
the text level — see `worldRaw`'s doc comment in `main.ts`).

**Why it's not built yet:** genuinely hard to fix well — YAML has no
first-class standard for round-tripping comments through a generic
parse/mutate/serialize cycle the way `js-yaml` uses it here. A real fix
needs either a comment-preserving YAML library (e.g. one that keeps a
CST/concrete syntax tree, not just the parsed value) or a hand-rolled
diff/patch approach that only rewrites the specific lines an edit
actually touched. Neither was justified yet — hand-editing the YAML
directly (as documented in `content-schema.md`'s "Authoring workflow")
remains comment-safe and is still the primary path for comment-heavy
files.

**What it should look like when built:** either (a) swap in a comment-
preserving YAML library for the editor's read/write path specifically
(the game's own `cityLoader.ts` parse path doesn't need this — it never
writes), or (b) have the editor refuse to overwrite a file that has
comments/formatting it can't reproduce, prompting a "save as" to a new
file instead of silently destroying the original's authoring notes.

**When to revisit:** before recommending the editor as a safe way to
touch a location file that already has hand-written comments worth
preserving.

## The map editor doesn't support NPC dialogue authoring, or transit lines/passes at all

**The gap:** the editor now has four sidebar-driven flows — locations
(the original "map editor"), world objects (the **Objects** tab, added
2026-09-08 — see `docs/architecture.md`'s "The world object editor" for
the full authoring surface: kind/portable/aliases/description, the
`parts`/`states` hierarchy with flagged-not-blocked `enterAliases`, and
containment), NPCs (the **NPCs** tab, added 2026-09-23 — see
`docs/editor_guide.md`'s "The NPCs tab"), and location prefabs (the
**Prefabs** tab, added 2026-09-08 — see "The location prefab editor").
The NPCs tab covers an NPC's core fields — id, aliases, starting
location, labels, name/description/fallback-dialogue text — its
schedule (Stage 2, also added 2026-09-23 — add/remove/edit
`ScheduleSlot`s, mirroring WorldObject's Parts→States card pattern), and
its trust/suspicion/stats (Stage 3, also added 2026-09-23 — plain number
fields, blank stat = falls back to `STAT_DEFINITIONS`' default rather
than 0), all writing back into `world.yaml` (see the mitigated-comment-
loss entry above for how). `dialogueRules`, `topics`, and an NPC's
starting knowledge/memories still have no UI: a deliberate scope
decision (`dialogueRules`/`topics` need authoring the deeply recursive
`Condition`/`DialogueEffect` unions, which has no good small-UI answer
yet; knowledge/memories were simply lower priority), not an oversight —
editing an NPC through the tab never drops these fields regardless,
since it merges its changes onto whatever's already authored rather than
reconstructing the whole record. `transitLines`/`passes` have no UI at
all, still read-only purely so `parseCity` can validate against them (a
pass's `lineIds`). World-object placement itself has a UI, direct and
otherwise: stamping a prefab (the Locations tab's "Start from prefab"
picker, built 2026-09-08) clones and places a prefab's decorated
`worldObjectIds`, and — built 2026-09-11 — a location's own "Objects
here" section and an object part's own "Contents" section let you clone
OR move any existing catalog object straight into a location or a
container's part. NPC PLACEMENT still has no clone/place UI beyond the
NPCs tab's own starting-location field — never instantiated by a prefab
stamp (see the entry below) and not reachable from either of the
direct-placement pickers, which only ever list world objects.

**Why the rest isn't built yet:** `dialogueRules`/`topics` need a real
answer for authoring `Condition`/`DialogueEffect` — recursive unions
with no existing UI precedent anywhere in this editor (the closest,
WorldObject's Parts→States hierarchy, is only two levels of flat
fields, nothing recursive) — building a good one is a substantial UI
project on its own, deliberately deferred until there's a clearer sense
of how much dialogue-authoring volume actually needs it, rather than
guessing at a design now. Initial knowledge/memories are flat and easy
by comparison (schedule and stats/trust/suspicion, similarly flat, are
now built — see above), just not yet prioritized. Transit lines/passes
remain a small, low-churn catalog where hand-editing YAML directly still
isn't a real bottleneck.

**What it should look like when built:** for initial knowledge/memories,
likely a `memories` textarea (one shorthand string per line, reusing
`parseMemoryShorthand` from `engine/npc/memory.ts` for commit-time
validation — already exported, no `cityLoader.ts` change needed) plus a
small `knowledge` checklist/dropdown pairing per fact. For
`dialogueRules`/`topics`, most likely a raw-YAML textarea per rule's
`when`/`effects`, validated at commit time by reusing `cityLoader.ts`'s
own `parseCondition`/`parseDialogueEffects` (would need exporting —
currently private) rather than a full structured recursive builder,
matching this editor's established "plain forms, shared single-banner
validation" style. For transit lines/passes, a simple form writing into
`worldRaw` the same way the NPCs tab does.

**When to revisit:** initial knowledge/memories whenever the next NPC
that needs one is being authored — low effort, worth doing
opportunistically. `dialogueRules`/`topics` once a case with
substantially more dialogue-authoring volume than the "Ledger" mini-case
makes hand-editing YAML a real bottleneck. Transit lines/passes: no
pressure, still a small catalog.

## Stamping a prefab doesn't instantiate its NPC decoration or nested containment

**The gap:** the Locations tab's "Start from prefab" picker (built
2026-09-08 — see `docs/architecture.md`'s "The location prefab editor")
stamps a prefab's `worldObjectIds` into fresh, independently-cloned
objects placed at the new location. It deliberately does NOT:
1. Instantiate `npcIds` decoration at all — a prefab with NPCs still
   shows a status note ("N NPC(s) ... place them manually"), but nothing
   is created or placed. This was a scoped decision, not an oversight
   (see "Why" below).
2. Clone anything CONTAINED inside a decorated object's parts (a torn
   photograph in a decorated desk's drawer, say) — only the prefab's own
   directly-listed `worldObjectIds` get cloned; a decorated object's own
   containment relationships aren't carried along.

**Why it's not built yet:** cloning an NPC means creating a brand-new
NPC record in `content/city/world.yaml`. That file gained write support
2026-09-23 (see the entry above — the NPCs tab's `world.yaml`
write-back), so the piece this section originally called the "hard
part" now exists, but prefab-stamp NPC instantiation itself is a
separate feature that hasn't been built on top of it yet — this entry
predates that write-support work and was written when NPCs were
entirely read-only; it's kept here (rather than folded into the entry
above) because the remaining gap is specifically about STAMPING/cloning,
not authoring. Nested-containment cloning is a smaller, more mechanical
gap — `cloneWorldObjectForStamp` (`src/editor/main.ts`) would need to
walk `city.initialPlacement.containedIn` for each decorated object's own
contained children and clone those too, updating their `containerId` to
point at the NEW cloned parent — straightforward in principle, just not
built yet since no case content has needed it.

**What it should look like when built:** for NPCs, `cloneWorldObjectForStamp`'s
NPC-decoration counterpart would build a fresh `Npc` (a new id, its own
name/description/dialogue text) and call the same `upsertNpcRaw`
merge-onto-`worldRaw` mechanism the NPCs tab's `commitNpcDraft` already
uses (`src/editor/main.ts`) — the write path itself doesn't need new
design, just a new caller. For nested containment, extend
`cloneWorldObjectForStamp` to recurse into `containedIn` the same way
`removeObject`'s cascade already walks it in the other direction.

**When to revisit:** when a real case actually wants a "crowd" prefab
(the original motivating use case for NPC decoration) stamped more than
once, or a decorated container object with meaningful contents inside
it — no pressure to build either speculatively.

**When to revisit:** whenever prefab authoring (Phase 2) has been used
enough to make "stamping" felt like the obvious next step — no pressure
to build this immediately after Phase 2 lands.

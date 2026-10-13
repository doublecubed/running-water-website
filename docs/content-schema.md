# Content Schema

Content (locations, world objects, NPCs) is
defined as plain data conforming to the types in `src/engine/types.ts`.
**Authored as YAML, split across many files** — see "Authoring workflow"
below for the layout — and parsed/validated by
`src/content/cityLoader.ts`'s `parseCity`. `src/content/world.ts` no
longer defines content itself; it only discovers every content file
(via Vite's `import.meta.glob`), calls `parseCity`, and sets up a NEW
GAME (starting location, money, clock epoch).

Every piece of player-facing text (what used to be a `nameKey`/
`descriptionKey`/`dialogueKey` string pointing into a separate
`i18n/content/<lang>.yaml` file) is now an inline `text: { en: {...},
... }` block on the entity itself — see "Inline localized text" below.
`cityLoader.ts` derives the lookup key from the entity's own `id`; an
author never types or invents one.

## Authoring workflow

- **File layout**: every location lives under
  `src/content/city/locations/*.yaml`, every world object under
  `src/content/city/objects/*.yaml`. Each file is a BARE YAML array at
  the document root — no wrapping `items:`/`locations:` key, since the
  FOLDER already establishes the category — holding one or several
  complete entries, however you want to group them (a `desk.yaml` with
  several desk variants, a `furniture.yaml` grouping ordinary house
  furniture, a `grandHotel.yaml` holding all 3 floors of one building).
  There's no manifest to maintain — `content/world.ts` discovers every
  file automatically via Vite's `import.meta.glob`, so dropping a new
  file into either folder is picked up on the next dev-server reload or
  build. `src/content/city/world.yaml` itself holds only `npcs`/
  `labels`/`facts`/`notebookProducts` — today's counts are small enough not to be
  worth splitting into their own directory yet; the exact same
  `import.meta.glob` mechanism extends to them trivially later if that
  changes.
- Edit any content file directly, then restart/reload the dev server
  (`npm run dev`) — every file is parsed and validated fresh every time
  `content/world.ts` loads, so a saved change shows up on the next
  reload with no separate build step.
- **Entries can be written in ANY order, across ANY files.** A
  connection's `toId`, an interior's `exteriorId`, an
  NPC's `locationId`, a `containerId` — these are all just string
  references, resolved after every file has been read into one merged,
  id-keyed lookup table. Nothing needs to be defined "above," or even in
  the same FILE as, the place that references it.
- **Validation is real and runs at every app startup**, not just in
  tests — a hardcoded TS array got its shape checked for free by the
  compiler (a typo'd field, a dangling `toId`, would simply fail to
  compile); external YAML data loses that entirely, so `cityLoader.ts`
  puts it back: required fields, correct types, valid enum values
  (`kind`, `compassLabel`), AND referential integrity (does
  this `toId`/`exteriorId`/`locationId`/`itemIds`/
  `npcIds`/`lineIds`/`containerId`/`containerPartId` actually point to
  something that exists, and is it free of containment cycles). A
  malformed file throws ONE `Error` listing EVERY problem found across
  EVERY file (not just the first), each tagged with its own source file
  — see `src/content/cityLoader.test.ts` for the exact set of checks and
  their exact error wording.
- Several fields are OPTIONAL in the YAML even though they're required,
  non-optional array fields on the TS types — `aliases`, `itemIds`,
  `npcIds`, and a location's `connections` all default to `[]` when
  omitted, so a location with no items or NPCs doesn't need to write out
  empty lists. Required fields (`toId` on a connection, for example)
  still have to be present, even if the list itself could be empty.
- **`itemIds`/`npcIds` (per location) and `locationId` (per NPC) author
  WHERE things start out, not a property of the location/NPC itself.**
  `cityLoader.ts` still parses and validates them exactly as described
  above, but pulls them off into a separate `initialPlacement` (an
  id -> id lookup, see `Placement` in `engine/types.ts`) rather than
  returning them on `Location`/`Npc` — a new game copies `initialPlacement`
  into its starting `GameState.placement`. This is why `Location`/`Npc` in
  `src/engine/types.ts` don't declare these fields even though content
  files still write them: world object/NPC placement is case-instance
  data (it's expected to change — an NPC moving, a case generator picking
  a different starting arrangement — see the project's
  procedural-case-content plan), not static city/catalog content, and
  it's exactly the slice a save file persists — see
  the (removed) save system.
- Content-QUALITY checks (e.g. "does every location's `aliases` include
  its own displayed name") are deliberately NOT part of `cityLoader.ts`
  — they still live in `src/content/world.test.ts`, running against
  whatever `createInitialState()` produces. Those are "would look wrong
  to a player" checks, not "would crash the engine" checks, and don't
  need to run on every app startup the way structural/referential
  validation does. Translation completeness across languages is its own
  separate, on-demand check — see `docs/localization.md`.
- **The map editor reads/writes this format directly**, via the same
  `cityLoader.ts`/`parseCity` the game uses — see
  `docs/architecture.md`'s "The map editor" section. Its Locations,
  Objects, and NPCs tabs edit locations/world objects/NPC core fields
  respectively (the NPCs tab covers id/aliases/starting location/labels/
  name-description-fallback-dialogue only — `dialogueRules`/`topics`/
  `schedule`/`stats` still have no UI); `world.yaml`'s `labels`/`facts`/
  `notebookProducts` are still read-only. Its
  separate Prefabs tab edits `content/prefabs/*.yaml` — see "Location
  prefab" below — a DIFFERENT content tree with its own loader
  (`prefabLoader.ts`), never touched by
  `cityLoader.ts`/`parseCity`/`content/world.ts` at all.

## Inline localized text

Every entity's `nameKey`/`descriptionKey`/`dialogueKey` is a STRING the
engine resolves via `t()` — that part is unchanged. What changed is where
the string, and its text, come from: instead of a hand-typed key pointing
into a separate `i18n/content/<lang>.yaml` file, every entity carries a
`text: { en: {...}, ... }` block, and `cityLoader.ts` derives the key
itself from the entity's own `id` (and its parent chain, for parts/
states). `en` (the baseline language) is REQUIRED; any other language is
entirely OPTIONAL per entity — completeness across languages is a
separate, non-blocking check (`i18n/translationCoverage.test.ts`), not a
load-time requirement, so starting a translation doesn't have to mean
finishing it before the app will even run — see `docs/localization.md`.

```yaml
- id: desk
  kind: setpiece
  portable: false
  text:
    en:
      name: the writing desk
      description: A battered oak desk, scarred with cigarette burns.
    es:                          # optional — omit entirely until you're ready to translate
      name: el escritorio
```

Derived keys follow the SAME convention content authors used to hand-type:

| Entity | Derived keys |
|---|---|
| Location | `location.<id>.name`, `.description` |
| WorldObject | `<kind>.<id>.name`, `.description` (kind = `item`\|`setpiece`) |
| Part | `<kind>.<objectId>.<partId>.name`, `.description` |
| PartState | `<kind>.<objectId>.<partId>.<stateId>.name`, `.description`, `.summary` (only if a `summary` field is authored) |
| Npc | `npc.<id>.name`, `.description`, `.dialogue` (the fallback line), `.dialogue.<n>` (one per authored `dialogueRules` entry, 0-indexed — see `docs/systems/dialogue.md`), `.topic.<topicId>.label`/`.dialogue`/`.response.<n>` (one per authored `topics` entry, see "NPC topics" below) |

Keys are fully namespaced per entity now (a part-state's `id` like
`"closed"` no longer resolves through a shared, hand-coordinated
`state.closed.name` convenience key the way it briefly did) — a little
repeated typing across similar objects, in exchange for zero cross-object
collision risk now that keys are generated, not hand-invented.

## Location

`Location` is a union: `ExteriorLocation` (`kind: "exterior"`) or
`InteriorLocation` (`kind: "interior"`, plus `exteriorId` and optional
`floorNumber`) — see `docs/systems/navigation.md`'s "Interiors" section
for the full design (why `exteriorId` always points to the real outdoor
location rather than an immediate interior parent, why there's no
separate "building facade" location, and the flat free interior-travel
rate).

```yaml
# content/city/locations/street.yaml — exterior:
- id: street
  kind: exterior
  text:
    en: { name: Main Street, description: A busy street lined with shuttered shops. }
  aliases: [street, main street]     # matched for "go to <name>"
  x: 200                             # optional — map canvas position, see below
  y: 320
  connections:
    - toId: alley
      compassLabel: north
    - toId: highway
      compassLabel: east
    - toId: docks              # no compassLabel: reachable only by naming it
    - toId: precinct

# content/city/locations/diner.yaml — interior; this location's own name
# IS its entry point (a lobby, for a multi-room building; the whole
# place, for a single-room one):
- id: diner
  kind: interior
  exteriorId: street              # which exterior "owns" this building
  # floorNumber:                  # optional, display-only — see navigation.md
  text:
    en: { name: Corner Diner, description: A narrow diner smelling of coffee and fry grease. }
  aliases: [diner, corner diner]
  connections:
    - toId: street
      compassLabel: east

# content/city/locations/warehouse.yaml — a windowless interior: darker
# baseline tier, and daylight through windows doesn't apply at all.
- id: warehouse-basement
  kind: interior
  exteriorId: docks
  baseVisibility: dark          # optional on ANY location — see below; default "normal"
  affectedByDaylight: false     # optional, interior-only; default true (most interiors have windows)
  text:
    en: { name: the warehouse basement, description: A dank concrete room lit by one bare bulb. }
  aliases: [warehouse basement, basement]
  connections: []
```

`baseVisibility` (optional, any location — one of `dark`/`dim`/`normal`/
`bright`, default `"normal"`) is the location's ambient visibility TIER
before time-of-day is applied — see `docs/systems/visibility.md`.
`affectedByDaylight` (optional, interior locations ONLY — `cityLoader.ts`
rejects it on an exterior entry — default `true`) turns off the
time-of-day contribution entirely for a windowless interior; exterior
locations have no such toggle since they're always time-of-day-affected.

### `image` (optional: locations, world objects, part states, NPCs) — scene image and hotspots

```yaml
- id: alley
  # ...
  image:
    src: alley.webp                        # file under public/images/
    text:
      en: { alt: A rain-slick alley behind the office. }   # required; alt text
    hotspots:                              # optional; may be empty/absent
      - text: { en: { label: Talk to the informant } }
        command: talk informant            # raw text, run exactly as if typed
        rect: [10, 40, 25, 50]             # [x, y, w, h], PERCENT of the image
```

Shown above the log (see `docs/systems/image-pane.md`): a location's image while the
player is there; a **world object's, part state's or NPC's** image while the
player is *examining* it, replacing the location's until `back`/travel/talk. The
same block shape is valid on all four, written under the entity (or, for a part
state, inside its entry in `states:`). A part state's image overrides the
object's own, so a stateful object (a drawer opening) can swap pictures as its
state changes; if several parts have images for their current state, the last
part in authored order wins. Locale keys: `location.<id>.image.*`,
`<kind>.<id>.image.*` (object), `<kind>.<id>.<part>.<state>.image.*`,
`npc.<id>.image.*`. `rect` must stay inside 0-100 on both axes
(`x,y >= 0`, `w,h > 0`, `x+w` and `y+h` <= 100). Alt text and hotspot labels
become locale keys (`<prefix>.alt`, `<prefix>.hotspot<n>.label`), like every other
authored string. Hotspot commands are not validated against
the parser at load time; a content test does that. The map editor can author
these directly — an "Edit image…" popup on each of the four entities lets a
designer pick a filename, drag out hotspot rectangles, and fill in their
labels/commands (see `docs/systems/image-pane.md`'s "Authoring in the
editor").

**Connections are directional.** A connection from A to B does not create
one from B to A — add the reverse connection on the destination Location
explicitly if travel should work both ways. This is deliberate: it makes
one-way streets or locked routes representable without a special case,
but it also means a typo'd or missing reverse connection silently makes a
location unreachable one way, so check both directions exist for anything
meant to be a normal two-way street. See `docs/systems/navigation.md`.

`x`/`y` are optional numbers giving a location's position on the visual
map canvas (`src/mapview/MapView.ts`) — plain SVG user units, unscaled,
with no fixed meaning beyond "position relative to other locations."
Purely presentational: nothing in the engine or pathfinding reads them
(routing is graph-based, via shortest hop count, not spatial). A location with no `x`/`y` simply can't be shown on the map yet
— not an error; see `docs/architecture.md`'s map-viewer section and
`docs/future_work.md`'s node-graph-editor entry for what's built so far.

`compassLabel` is optional — only add it when "go north" should sensibly
reach that specific connection. A connection with no `compassLabel` is
still fully reachable by naming the destination (`go to the docks`).
`Direction` includes `"in"`/`"out"` alongside the compass words — use
them ONLY when a location has exactly one door (nothing else to
disambiguate); a location with several buildings sharing one exterior
keeps each building's own distinguishing compass word instead. This is
purely a naming choice (see `docs/systems/navigation.md`).

`curve` is an optional single quadratic-bezier control point
(`{ cx, cy }`, same SVG user units as `x`/`y`) that bends a connection's
line on the map canvas instead of drawing it straight — purely
presentational, like `x`/`y`. Set by dragging the curve handle in the map
editor (`docs/architecture.md`'s "The map editor" section); rarely worth
hand-writing directly.

```yaml
- toId: docks
  curve: { cx: 450, cy: 250 }   # bends the line instead of drawing it straight
```

A connection has no distance, transport mode, fare or transit line: travel is
free and instant (see `docs/systems/navigation.md`). Those fields (and the
`transitLines`/`passes` tables in `world.yaml`) were removed; the loader no longer
reads them.

## World object

Authored under `content/city/objects/*.yaml` (bare arrays — see
"Authoring workflow" above), each entry models a `WorldObject` — the
umbrella covering both small portable **items** and fixed **setpieces**
(furniture/landmarks). "Object" is the casual umbrella word for either;
`kind` is what actually distinguishes them.

`kind` and `portable` are independent axes — see `WorldObject`'s doc
comment in `engine/types.ts`. `kind` decides which "present" line the
object is announced in (`event.itemsPresent` vs. `event.setpiecesPresent`
— see docs/systems/navigation.md's "Arrival description vs. `look()`");
`portable` decides whether `take` currently works on it, regardless of
`kind` — an "item" could in the future be temporarily non-portable for a
situational reason without becoming a "setpiece".

```yaml
# content/city/objects/office.yaml
- id: case-file
  text:
    en:
      name: case file
      description: A thin folder of notes on the Hollow Street disappearance.
  aliases: [case file, file, case-file]   # lowercase; what the parser matches
  kind: item        # "item" (small, inventory-able clutter) | "setpiece" (furniture/landmarks)
  portable: true

- id: desk
  text:
    en: { name: the writing desk, description: A battered oak desk, scarred with cigarette burns. }
  aliases: [desk, writing desk]
  kind: setpiece
  portable: false          # setpieces are conventionally never portable
  announceOnRevisit: true  # optional; default false — see below
```

`announceOnRevisit` only matters for `kind: setpiece`. Setpieces are
shown in full alongside the description on first-ever arrival or an
explicit `look`; on a plain revisit, only setpieces with
`announceOnRevisit: true` are re-announced — for a scene piece whose
state can change in a way worth noticing immediately (e.g. a drawer left
open), while ordinary set dressing (a desk) stays quiet until the player
looks again. Items (`kind: item`) ignore this field entirely — they're
always announced on every arrival.

### `parts` (optional) — sub-parts and states

See `docs/systems/parts.md` for the full design (focus-based targeting,
the `interact` verb, the `important`-state examine bubble-up, and
containment). A part doesn't need multiple states or any `enterAliases`
— a single, purely descriptive state (revealed only by examining the
part directly) is enough to justify one existing:

```yaml
- id: desk
  text:
    en: { name: the writing desk, description: A battered oak desk, scarred with cigarette burns. }
  kind: setpiece
  portable: false
  parts:
    - id: left-drawer
      text:
        en: { name: the left drawer, description: A small drawer, its brass handle tarnished green. }
      aliases: [left drawer]
      defaultStateId: closed
      states:
        - id: closed
          text:
            en: { name: closed, description: The left drawer is closed. }
          enterAliases: [close]
        - id: open
          text:
            en:
              name: open
              description: The left drawer is open — empty, save for a few paper clips.
              summary: One of its drawers is open.  # optional; falls back to `description` when absent
          important: true   # surfaces the `summary` (or `description`, if no summary) in the desk's general examine
          enterAliases: [open]
          exposesContents: true         # contained objects become reachable while this state is current
          revealInAmbientListing: false # optional; default false — see "Containment" below
```

`defaultStateId` must reference one of that part's own `states` (checked
at load, per-part — no cross-item references involved). `important`,
`enterAliases`, `exposesContents`, and `revealInAmbientListing` all
default to absent/empty/false when omitted; a `summary` text field
defaults to falling back to `description`.

### Containment — placing a world object inside another's part

An object can be placed inside another object's part instead of at a
location — a torn photograph in a desk drawer. The CONTAINED object
declares its own placement (mirroring how `Npc.locationId` works), and is
NOT listed in any location's `itemIds`:

```yaml
- id: torn-photograph
  text:
    en: { name: the torn photograph, description: Half of a photograph, the other half torn away. }
  kind: item
  portable: true
  containerId: desk           # must reference a real world object...
  containerPartId: right-drawer  # ...that has a part with this id
```

`containerId`/`containerPartId` must appear together; `cityLoader.ts`
rejects a dangling reference, a containment cycle, and an object that's
BOTH contained and listed in some location's `itemIds` (placement is
one or the other, never both). See `docs/systems/parts.md`'s
"Containment" for exposure (`exposesContents`) and ambient-listing
(`revealInAmbientListing`) rules.

## Location prefab

**Not part of the city — the game never loads this.** Authored under
`content/prefabs/*.yaml` (a tree entirely separate from `content/city/`,
bare arrays, same "Authoring workflow" conventions), each entry is a
`LocationPrefab` — a reusable location TEMPLATE, editor-only content
parsed by `content/prefabLoader.ts` (not `cityLoader.ts`) for the map
editor's **Prefabs** tab, see `docs/architecture.md`'s "The location
prefab editor". It exists to let a designer save a decorated "generic
alley" or "generic office" once and reuse it, rather than re-authoring
the same description/decoration by hand every time a similar location is
needed.

```yaml
# content/prefabs/alley.yaml
- id: generic-alley
  kind: exterior   # "exterior" | "interior" — same two kinds a real Location can be
  aliases: [alley]
  text:
    en:
      name: a narrow alley
      description: A narrow, rain-slicked alley between two brick buildings.
  worldObjectIds: [crate, rat]   # existing objects/*.yaml ids — see below
  npcIds: [dock-worker-1, dock-worker-2, dock-worker-3]  # a "crowd" prefab
```

A prefab has no `x`/`y`/`connections`/`exteriorId` — it isn't a node in
the location graph and never appears in `city.locations`. `worldObjectIds`/
`npcIds` reference EXISTING catalog entries (authored via the Objects tab
or hand-edited `world.yaml`) rather than embedding new object/NPC
definitions inline; `parsePrefabs` rejects a reference to an id that
doesn't exist in the currently loaded catalog. Both default to `[]` when
omitted — a prefab with no decoration at all is still valid, just an
undecorated description template.

**Instantiation:** the Locations tab's "Start from prefab" picker (Add
flow only) stamps a prefab into a real `Location` — its `kind`/
`aliases` copied onto the new location, its name/description pre-filled
into the form for the author to keep or edit, and every id in
`worldObjectIds` CLONED (fresh id, fresh `Placement` entry) and placed
there. `npcIds` decoration is NOT instantiated yet (surfaced as a status
note instead) — see `docs/open-issues.md` for why and what's still open
(NPC cloning, and cloning what's nested inside a decorated object's own
parts).

## NPC

Authored in `content/city/world.yaml` (not split into its own directory
yet — see "Authoring workflow" above).

```yaml
npcs:
  - id: informant
    text:
      en:
        name: the informant
        description: A nervous man in a long coat who keeps glancing over his shoulder.
        dialogue: '"{npcKey}" mutters something about the docks, then falls silent.'
    aliases: [informant, man, stranger]
    locationId: alley
  - id: bouncer
    text:
      en: { name: the bouncer, description: A wide man in a tight suit., dialogue: "Move along." }
    aliases: [bouncer]
    locationId: club-entrance
    stats: { intimidation: 90, stealth: 5 }   # optional — see below
    dialogueRules:                            # optional — see below
      - requires: [talkedTo.bouncer]
        text:
          en: "I already told you to move along."
```

`stats` (optional; omit entirely if the NPC needs none) is a mapping of
`StatKey` → number, one of `stealth`/`intimidation`/`handguns` (the set
`engine/stats/stats.ts`'s `STAT_DEFINITIONS` registers — see
`docs/systems/stats.md`). `cityLoader.ts` rejects an unknown key and a
value outside that stat's own registered `[min, max]` range. An absent
key, or an absent `stats` object entirely, isn't defaulted at PARSE
time — it falls back to that stat's registry default only when actually
read, via `getStatValue`/`GameEngine.getNpcStat`.

`dialogueRules` (optional; omit or leave empty for an NPC with only the
one fallback `dialogue` line) is an ordered list of `{ requires, text }`
— see `docs/systems/dialogue.md`. `requires` is a non-empty list of
flag names that must ALL be `true` in `GameState.flags` for that entry to
be selected; `talkTo` picks the first fully-matching entry, falling back
to the NPC's `dialogue` line if none match. A rule may instead (or also)
carry a structured `when:` condition — see "NPC labels, schedule, memory,
and conditions" below; a rule needs a non-empty `requires` OR a `when`.

### NPC labels, schedule, memory, and conditions

Full reference: `docs/systems/npcs.md`. All optional.

```yaml
labels:                                  # top-level list, sibling of npcs:
  - id: worker
    text: { en: { name: Worker } }       # -> label.worker.name
    trustOffset: 1                       # flat opinion-of-player offset
    labelOpinions: { official: -1 }      # how workers feel about officials
  - id: official
    text: { en: { name: City official } }
npcs:
  - id: clerk
    locationId: office
    labels: [worker]                     # several allowed; each must exist in labels:
    trust: 2                             # starting trust / suspicion (default 0)
    suspicion: 0
    knowledge: { alibi: conceals }       # knows | conceals | lies | unaware
    memories:                            # pre-game history, shorthand grammar below
      - "npc:clerk saw player @office"
    schedule:                            # lookup table; fromHour > toHour wraps midnight
      - { fromHour: 8, toHour: 18, locationId: office }
      - { fromHour: 18, toHour: 24, locationId: diner, weekdays: [1, 2, 3, 4, 5] }
    dialogueRules:
      - when: { all: [{ hasLabel: worker }, { npcStat: trust, op: ">=", value: 2 }] }
        text: { en: "Good to see you again." }
```

- **Memory shorthand**: `<subject> <verb> [<object>] [@<location>]`, refs are
  `player` or `kind:id` (`npc:`, `object:`, `location:`, `fact:`); verbs are
  `took, entered, left, spoke-to, gave, attacked, saw, learned`.
- **Conditions** (`when:`): `{flag: x}`, `{not: c}`, `{all: [c…]}`,
  `{any: [c…]}`, `{npcStat: trust|suspicion|opinionOfPlayer, op, value}`,
  `{knows: factId}`, `{memory: {verb?, subject?, object?, locationId?,
  withinMinutes?}}`, `{hasLabel: id}`, `{reputation: <"global"|label>, op,
  value}`, `{playerKnows: factId}` (has the PLAYER learned this fact — see
  "Fact" below and docs/systems/case-system.md). Ops: `< <= > >= == !=`.
- **Rule effects** (`effects:` on a `dialogueRules` entry): a list, each entry
  ONE of `{trust: n}`, `{suspicion: n}`, `{opinion: {subject, delta}}`,
  `{reputation: {scope, delta}}`, `{setFlag: name}`,
  `{knowledge: {fact, disposition}}`, `{memory: "<shorthand>"}` (recorded as a
  `told` memory), `{learnFact: factId}` (records this fact as learned by the
  PLAYER — must reference a declared `facts:` id). They fire when that rule
  is the one selected. Guard the rule
  so it stops matching once its effect has landed (a `not: {flag:
  talkedTo.<npc>}` first-talk rule, or a threshold the effect crosses), or
  repeated `talk` will farm it.
- `cityLoader.ts` rejects unknown labels/locations/verbs/dispositions/ops,
  unknown effect kinds, effects with a bad reputation scope or memory location,
  and out-of-range schedule hours. An NPC with no `schedule` stays where it is.
- `trust`/`suspicion`/`memories`/`knowledge` are STARTING values only: they
  seed `GameState.npcStates` for a new game and are never written back.

### NPC topics (`topics:`)

Full reference: `docs/systems/dialogue.md`'s "Topic menus" section.
Optional — an NPC with no `topics` behaves exactly as before they existed
(`talk` prints one line, no menu). When present, `talk <npc>` opens a
menu of currently-offered topics instead.

```yaml
npcs:
  - id: cook-rosa
    locationId: diner
    text:
      en: { name: Rosa, description: A cook., dialogue: "Don't know you." }
    topics:
      - id: ledger
        text:
          en:
            label: the ledger       # -> npc.cook-rosa.topic.ledger.label — the menu option text
            dialogue: "Not yet."    # -> npc.cook-rosa.topic.ledger.dialogue — fallback answer
        requires: []                # gates whether the TOPIC is offered at all
        when: { npcStat: opinionOfPlayer, op: '>=', value: 0 }  # optional, same Condition shapes as dialogueRules
        responses:                  # same shape/matching as dialogueRules — first match wins
          - when: { npcStat: opinionOfPlayer, op: '>=', value: 2 }
            effects:
              - learnFact: courier
            text:
              en: "Fine. A courier..."
      - id: herself
        text:
          en: { label: Rosa, dialogue: "Twenty years behind this counter." }
        # no requires/when at all — an always-offered topic is valid content,
        # unlike a dialogueRules entry (where always-true is just dialogueKey)
```

- A topic's own `requires`/`when` gate whether it's OFFERED in the menu at
  all — same `Condition` shapes as `dialogueRules`. Unlike a `dialogueRules`
  entry, a topic needs NEITHER a non-empty `requires` NOR a `when` — an
  always-visible topic is legitimate content.
- `responses` is an ordered `DialogueRule` list, identical in shape and
  matching to `dialogueRules` (`requires`/`when`/`text`/`effects`, first
  match wins), picking the answer once the topic is asked about; falls back
  to the topic's own `text.dialogue` when none matches (or `responses` is
  empty). A `responses` entry DOES need a non-empty `requires` OR a `when`,
  same rule as `dialogueRules` (an always-true response is just the
  topic's own fallback text).
- Derived keys: `npc.<id>.topic.<topicId>.label`, `.dialogue`, and
  `.response.<n>` (0-indexed) per `responses` entry.
- Referential checks (unknown label/reputation scope/memory location) walk
  into `topics` the same way they already do for `dialogueRules`.

## Fact (`facts:`)

Full reference: `docs/systems/case-system.md`. A top-level list, sibling of
`npcs:`/`labels:` — every fact the player could learn:

```yaml
facts:
  - id: courier
    text:
      en: A courier in a grey coat dropped the ledger in the alley Tuesday night.
```

Unlike most entities, a fact's `text` block is a single string per
language directly (not `{ en: { name: ..., description: ... } }`), since a
fact has exactly one player-facing field. `textKey` is derived as the bare
`fact.<id>` (no field suffix). Referenced from a `dialogueRules`/topic
`responses` entry via `{learnFact: <id>}` (effect) or `{playerKnows: <id>}`
(condition) — `cityLoader.ts` rejects either referencing an undeclared
fact id.

## Player starting state

Unlike the sections above, this is NOT part of `city/world.yaml` —
starting state is game SETUP, written directly in
`src/content/world.ts`'s `createInitialState`:

```ts
player: {
  locationId: "office",
  inventory: [],
  money: 15000,
  visitedLocationIds: ["office"],
  stats: {},
  stealthMode: false,
},
```

`money` is an integer count of minor units (see `docs/systems/economy.md`)
— never a float. `visitedLocationIds` should always
include the starting `locationId` — it's what the locations panel uses
to filter to "discovered" places (see `docs/systems/navigation.md`), and
a location the player starts standing in has, definitionally, already
been visited. `stats` is optional (an
absent key or the whole field falls back to that stat's registry
default via `getStatValue`/`GameEngine.getPlayerStat` — see
`docs/systems/stats.md`); seeded `{}` here for parity with
`activePasses`, not because it's required.

## Rules

- Every entity's `text.en` must have every field its type requires
  (`name`/`description`, plus `dialogue` for NPCs) — enforced by
  `cityLoader.ts` at every app startup, since the key is now DERIVED from
  this exact text rather than a hopeful reference to a separate file (see
  "Inline localized text" above). Any other language is optional, checked
  separately and non-blockingly — see `docs/localization.md`.
- `aliases` (on world objects, NPCs, Locations, AND Passes) are matched
  lowercase, trimmed — the parser lowercases input before matching.
- A Location's `aliases` MUST include its own displayed name, lowercased,
  as one entry — a player should always be able to type back the exact
  name the game just showed them. Enforced by `src/content/world.test.ts`
  (a content-QUALITY check — needs the active translation table to
  resolve the displayed text, so it stays a test rather than a
  `cityLoader.ts` startup check — see "Authoring workflow" above).
  This bit a real playtest: the pier's aliases had `"the pier"` and `"far
  pier"` separately, but not `"the far pier"` — the phrase its name ("The
  Far Pier") actually lowercases to — so `go to the far pier` failed even
  though that's literally what the game called it.
- Every dangling-ID reference — `Connection.toId`, `InteriorLocation.exteriorId`
  (and that it resolves to `kind: "exterior"`), 
  NPC `locationId`, location `itemIds`/`npcIds`,
  `containerId`/`containerPartId` (and freedom from containment cycles) —
  IS validated, at every app startup, across EVERY content file, by
  `src/content/cityLoader.ts`'s `parseCity`. A hardcoded TS array got this
  checking for free from the compiler; external YAML data doesn't, so
  this is real runtime validation now, not just a test-suite check — see
  "Authoring workflow" above and `src/content/cityLoader.test.ts`.

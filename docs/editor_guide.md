# Editor Guide

A practical, task-by-task guide to the map editor — what you can do in
it today and the exact clicks to do it. For WHY it's built this way
(architecture, data flow, save design), see `architecture.md`'s "The map
editor" section and its sub-sections; for the underlying YAML shapes,
see `content-schema.md`. For what's deliberately NOT here yet, see
`open-issues.md`.

## Starting the editor

```
npm run dev:editor
```

This opens `editor.html` in your browser. The editor only works in a
Chromium-based browser (Chrome, Edge, Brave, ...) — it uses the File
System Access API, which Firefox/Safari don't support.

## The toolbar

Left to right, the toolbar reads as four groups, separated by thin
vertical rules:

1. **Open folder** / **Save world** — project-level actions (see below).
2. **Locations** / **Objects** / **NPCs** / **Prefabs** — switches which
   editor is showing.
3. Whichever editor is active's own manipulation buttons — **Add
   location**/**Move**/**Connect**/**Edit curve** for Locations, **Add
   object** for Objects, **Add NPC** for NPCs, **Add prefab** for
   Prefabs.
4. **Save**/**Cancel** for whichever draft is currently open, plus the
   **Text language** selector — see "Saving or discarding a draft"
   below. This group is only visible while a draft is actually open.

## Opening a project

Click **Open folder** and pick the project's ROOT folder (the one
containing `src/`), not any subfolder. The editor needs to find:

- `src/content/city/world.yaml`
- `src/content/city/locations/`
- `src/content/city/objects/`
- `src/content/prefabs/` (created automatically if it doesn't exist yet)

Your browser will ask you to confirm read/write access once. If the
folder doesn't look right, you'll get an error message naming exactly
which piece it couldn't find.

Once loaded, the status line reports how many location/object/prefab
files were found, and the toolbar's **Locations** / **Objects** /
**NPCs** / **Prefabs** tabs become usable — these four tabs are four
separate editors sharing the same open project. **Save world** writes
back to disk; nothing you do below touches disk until you click it.

## Saving or discarding a draft

Adding or editing a location, object, NPC, or prefab opens a draft —
and while a draft is open, the Locations/Objects/NPCs/Prefabs tabs are
locked (switching would silently discard it) and a **Save**/**Cancel** button
pair appears at the toolbar's far right, next to the language selector.
This is the ONE place to commit or discard whichever draft is currently
open — Save there instead of hunting for a per-panel button, since an
object with several parts/states can otherwise scroll well past the
bottom of the screen. Each panel keeps only its own **Remove** button
(red, at the bottom) beyond that. This top Save/Cancel pair is distinct
from **Save world** in the first toolbar group, which writes the whole
project to disk and has nothing to do with whether a draft is open.

## The Locations tab

This is the map view — every location is a dot, every connection a
line between two dots. This is also the tab you land on when you first
open a project.

### Add a location

1. Click **Add location**. A new (unsaved) node appears at the center
   of your current view, and a form opens on the right.
2. Type an **id** — permanent and unique; you can't change it later.
3. Pick **kind**: `exterior` (a street, a dock — anything outdoors) or
   `interior` (inside a building). If `interior`, also pick which
   **exteriorId** owns it (the building it's inside).
4. Pick a **baseVisibility** tier (`dark`/`dim`/`normal`/`bright` —
   defaults to `normal`) — see `docs/systems/visibility.md`. If
   `interior`, you'll also see an **affected by daylight** checkbox
   (checked by default); uncheck it for a windowless room (a basement, a
   warehouse) so time of day never changes its visibility.
5. Type a **name** and **description** for the currently-selected
   language (see "Switching languages" below).
6. Optionally drag the node to reposition it, or type exact **x**/**y**.
7. Click the toolbar's **Save** (top right, next to the language
   selector — see "Saving or discarding a draft" above). Click
   **Cancel** instead to discard everything, including any dragging.

### Start a location from a prefab

Only available while adding (not editing) a location — a **Start from
prefab (optional)** dropdown sits at the top of the Add form.

1. Click **Add location**, then pick a prefab from the dropdown.
2. Its kind/name/description are filled in for you (you can still edit
   them). Pick "(blank location)" to clear the pre-fill and start over.
3. Type an id and click the toolbar's **Save** as usual.

On save, the new location gets the prefab's **aliases**, and every
world object the prefab decorates with is CLONED (a fresh copy, its own
id, its own description) and placed at the new location — the original
catalog object the prefab points at is untouched, so the same prefab
can be used again elsewhere. If the prefab also lists NPCs, you'll see
a note that they need to be placed by hand — NPC stamping isn't built
yet (see `open-issues.md`).

### Edit a location

Click any node (outside Connect mode). The same form opens, pre-filled.
The **id** field is locked — ids are permanent. Edit any other field and
click the toolbar's **Save**, or **Cancel** to discard the whole edit
(including any dragging you did while the form was open).

### Place objects at a location

Editing an EXISTING location (not while adding one — see above) shows an
**Objects here** section below the description field: every world
object currently placed at this location, each with its own **Remove**
button, plus a picker at the bottom to add another.

1. Pick an existing catalog object from the dropdown.
2. Leave **Place a clone** checked (the default) to drop an independent
   COPY here — a fresh id, its own text, editable separately from the
   source — the way you'd keep one "original" lighter in storage (see
   "In storage" objects, below) and clone it everywhere you need one.
   Uncheck it to instead genuinely MOVE the picked object here, clearing
   wherever it was placed before.
3. Click **Place**.

**Remove** on a row only un-places that object (it goes back to storage,
visible again under the Objects tab's "Storage only" filter) — it does
NOT delete it.

### Move a location

Click **Move** to arm dragging (off by default, so it doesn't interfere
with Connect/other clicks), then drag any node. Click **Move** again to
turn it off.

### Connect two locations

1. Click **Connect**. The **Two-way** checkbox next to it is on by
   default — leave it checked to author the return trip automatically.
2. Click the FROM location, then the TO location.
3. If this is a real cross-town hop, you'll be prompted for
   **distanceKm** and **modes** (comma-separated, e.g. `foot,taxi`).
   If it's just a door between a building's exterior and one of its own
   interiors, this is skipped automatically — it's always a free,
   1-minute hop, so there's nothing to ask. Either way, with Two-way
   checked the same values are used to add the reverse connection too.

Each underlying `Connection` is still one-way — that's what the engine
needs — but uncheck **Two-way** first if you only want the one direction
(e.g. a one-way alley). Either way, the map draws ONE line per pair of
locations: any connections between the same two locations (a foot path,
a bus line, one-way, two-way, however many modes) merge into a single
line with an arrowhead per direction that's actually reachable. Hover a
line to see which modes are available each way.

### Bend a connection's curve

1. Click **Edit curve**, then click the line you want to bend.
2. A yellow handle appears — drag it to bend the line. There's only one
   control point (a simple curve, not an S-shape). Since a line can
   represent several connections at once (see above), dragging bends all
   of them together — there's nothing to keep in sync separately.

### Remove a location

Click a node to open its Edit form, then click **Remove location** at
the bottom. You'll see a confirmation listing what else this affects:
any interiors it owns (deleted along with it), any incoming connections
from other locations (stripped automatically), and how many NPCs/world
objects currently placed there (informational only — not blocked, but
worth knowing before you confirm).

## The Objects tab

Click **Objects** in the toolbar. A fixed-width list sits on the left,
with a search box above it — type an id or display-name substring to
narrow the list (case-insensitive), handy once the catalog runs into
the hundreds/thousands. The rest of the width is a permanent inspector
panel: it shows an empty-state placeholder until you click a row (or
**Add object**), and then shows that object's full form in place —
unlike Locations/Prefabs, this panel never disappears while you're on
the Objects tab, so clicking around the list doesn't reflow anything.

A row whose object currently sits somewhere in the world (a location's
`itemIds`, or inside another object's part) gets a small **placed**
badge. An unbadged row is "in storage" — a catalog entry with nowhere
it's currently standing, e.g. an "original copy" you keep around purely
to clone from later. The dropdown next to the search box (**All
objects** / **Placed only** / **Storage only**) filters the list by
this same status.

### Add or edit an object

1. Click **Add object** (or click any row in the list to edit it).
2. Type an **id** (locked once created), pick **kind** (`item` — small,
   pickup-able clutter — or `setpiece` — furniture/landmarks), and
   toggle **portable** (can it go in the player's inventory?).
3. For a setpiece, you can also toggle **announce on every revisit** —
   otherwise setpieces are only called out on first arrival.
4. Fill in **aliases** (comma-separated — what the parser accepts as a
   name for this thing), **name**, and **description**.
5. Click the toolbar's **Save** (top right — see "Saving or discarding
   a draft" above).

### Add parts and states

An object can have named sub-parts (a desk's drawers, a lighter's
engraved symbol) that each have their own states.

1. In the object form, click **+ Add part**.
2. Give the part an **id**, **aliases**, **name**, and **description**.
3. Click **+ Add state** to add one of its states (e.g. "closed",
   "open"). Each state gets its own **name**/**description**, an
   optional **summary** (a shorter line used when this state's
   description bubbles up into the parent object's own examine text),
   and three checkboxes:
   - **important** — surface this state's summary automatically when
     the player examines the whole object, not just this part.
   - **exposesContents** — while this state is current, anything placed
     inside this part becomes reachable (a drawer that's open reveals
     what's in it).
   - **revealInAmbientListing** — also list a revealed item in the
     location's ambient item line, not just on direct examine.
4. Pick which state is the **default state** (what the part starts as).
5. Type **enterAliases** — the verb word(s) that switch INTO this state
   (e.g. `open`). If you type a word the parser doesn't actually know
   yet, a warning appears under the field — this is INFORMATIONAL, not
   a block: it still saves, flagged for someone to wire up the verb on
   the engine side later.

### Contained objects

There are two ways to place one object inside another object's part (a
torn photograph in a desk drawer, say) — pick whichever side of the
relationship you're already working in:

**From the contained object's own form** (the photograph, not the desk):

1. Open the CONTAINED object's own form.
2. Under **contained in — object**, pick the container (must already
   have at least one part). Under **contained in — part**, pick which
   of its parts.
3. Save (toolbar). Pick "(none...)" for the object dropdown to remove
   containment.

**From the container's own form** (the desk, not the photograph) — once
the desk itself is saved, each of its parts shows its own **Contents**
section, right below that part's states: every object currently placed
inside it, each with a **Remove** button, plus a picker to add another
(pick an existing catalog object, leave **Place a clone** checked to
drop an independent copy in here or uncheck it to move the actual picked
object in — same "Place a clone" choice as a location's "Objects here"
picker, see "Place objects at a location" above). **Remove** here only
un-places the object (back to storage) — it never deletes it.

### Structure view

Once an object is saved (not while adding a brand-new, still-unsaved one),
a collapsed **Structure view (read-only)** panel appears in its form,
between **contained in** and **Parts**. Expand it to see a tree of the
object's parts, each part's states (with `[default]`/`[important]`/
`[exposesContents]`/`[revealInAmbientListing]` flags shown next to any
that apply), and — nested under whichever part they're placed in — any
OTHER catalog object contained there (e.g. a torn photograph nested under
a desk's drawer part). Click a contained object's name to jump the
inspector straight to editing it, instead of hunting for it in the list.

This reflects the object's last-SAVED state, not an in-progress unsaved
edit to its parts — expand it again after Save to see a change reflected.
It's read-only: there's no drag-to-reparent or edit-from-the-tree yet (see
`future_work.md`'s "Interactive object structure graph" entry).

### Remove an object

Open the object's form and click **Remove object**. If other objects
are contained inside its parts, they're automatically un-contained
(not left pointing at a deleted object) rather than just warned about.

## The NPCs tab

Click **NPCs**. Like Objects, a fixed-width searchable list sits on the
left and a permanent inspector fills the rest of the width — it shows
an empty-state placeholder until you click a row or **Add NPC**.

This tab edits an NPC's CORE fields, schedule, and stats/trust/
suspicion — id, aliases, starting location, labels, name/description/
fallback-dialogue text, schedule slots, and trust/suspicion/stealth/
intimidation/handguns. `dialogueRules`, `topics`, and an NPC's starting
knowledge/memories have no UI here yet (a deliberate scope decision, not
an oversight — see `docs/systems/npcs.md`'s "Known gaps") and stay
hand-edit-only in `world.yaml`. **Editing an NPC here never drops those
fields** — saving only changes what the form actually shows; anything
else authored on that NPC survives exactly as it was.

### Add or edit an NPC

1. Click **Add NPC** (or click any row in the list to edit it).
2. Type an **id** (locked once created).
3. Fill in **aliases** (comma-separated), **name**, **description**, and
   **fallback dialogue** — the line shown when none of the NPC's
   `dialogueRules` (if any, hand-authored) match.
4. Pick a **starting location** — where the NPC stands at the start of a
   new game, and whenever its schedule (below) doesn't place it
   somewhere else.
5. Under **Labels**, check off any existing labels (from `world.yaml`'s
   `labels:` list) this NPC carries — see `docs/systems/npcs.md`.
6. Under **Schedule**, optionally click **+ Add schedule slot** for each
   time window the NPC should be somewhere other than its starting
   location — a `from hour` (0-23) and `to hour` (0-24), a location, and
   either "Every day" or specific weekdays. Leave the schedule empty (the
   default) for an NPC that's always in one place. A slot where the "to"
   hour is smaller than the "from" hour (e.g. 22 → 6) is a valid overnight
   shift, not an error. A slot with the same from/to hour IS rejected
   (zero-duration window) when you Save.
7. Optionally set **trust**/**suspicion** (whole numbers, default 0 — the
   NPC's starting values, not something that changes during play from
   here) and any of the three **stats** (stealth/intimidation/handguns,
   0-100). Leave a stat field blank to not author it at all — the game
   falls back to that stat's own default rather than treating a blank as
   0. An out-of-range stat value is rejected when you Save.
8. Click the toolbar's **Save**.

### Remove an NPC

Open the NPC's form and click **Remove NPC**. If any prefab decorates
with this NPC, you'll see a warning naming it — not blocked (this
editor has no fixup path for that reference yet), just worth knowing
before you confirm.

## The Prefabs tab

Click **Prefabs**. Like Objects, this is a plain list. A prefab is a
reusable location TEMPLATE you can later stamp into the world (see
"Start a location from a prefab" above) — it has no position of its own
and has no effect on the live map until you use it.

### Add or edit a prefab

1. Click **Add prefab** (or click an existing row to edit it).
2. Type an **id**, pick **kind** (`exterior`/`interior` — same meaning
   as for a real location), and fill in **aliases**/**name**/
   **description**.
3. Under **Decorate with world objects**, check off any existing
   objects (from the Objects tab) you want this prefab to place. Under
   **Decorate with NPCs**, check off any existing NPCs the same way —
   useful for a "crowd" prefab, though see the note above: NPCs aren't
   actually placed yet when the prefab is stamped, only remembered.
4. Click the toolbar's **Save**.

A prefab only lists EXISTING catalog objects/NPCs — it doesn't let you
define new ones inline. If you delete an object a prefab still
references, the prefab isn't fixed automatically; the next **Save
world** will refuse (with a clear error naming the missing id) until
you either restore the object or edit the prefab to drop the
reference.

### Remove a prefab

Open the prefab's form and click **Remove prefab**.

## Switching languages

The **Text language** dropdown in the toolbar controls which
language's text every form reads from and writes to. It only shows
languages that already have SOME content text; add a new language by
hand-editing a content file's `text:` block first (see
`content-schema.md`'s "Inline localized text"), then reopen the
project.

## Writing to disk

Click **Save world** (top-left toolbar group). This re-validates
everything — every location, every object, every NPC, every prefab —
before writing anything, so one bad edit can't half-write a broken
project; you'll get a clear notice explaining what to fix instead. Once
it passes, ONLY the files you actually touched this session are
rewritten — anything you didn't open/edit keeps its exact original text
(including hand-written comments). A file you DID touch loses its
comments/formatting, since the editor regenerates it from scratch (see
`open-issues.md` for why this isn't fixed yet). A brand-new
location/object/prefab always lands in that category's own
`editor-additions.yaml` — you can move it into a more sensible file
later by hand. A brand-new NPC, or any NPC edit, rewrites the WHOLE
`world.yaml` (there's only one file, so nothing more targeted is
possible) — its `labels`/`facts`/`transitLines`/`passes` content, which
this editor doesn't edit, is carried through untouched but still loses
its own comments/formatting whenever any NPC is touched, same
limitation as any other regenerated file.

## What's not here yet

- The NPCs tab covers core fields only — no UI yet for `dialogueRules`,
  `topics`, `schedule`, `stats`, or an NPC's starting
  trust/suspicion/knowledge/memories (a deliberate scope decision, not
  an oversight). Transit lines and passes have no UI at all — still
  hand-edit `world.yaml` directly for all of these.
- Stamping a prefab doesn't place its NPCs, and doesn't clone anything
  nested inside a decorated object's own parts.
- Connections still ask for distance/modes via plain browser prompts,
  not a proper form.
- No viewport culling — fine at the current map's size, would need
  attention on a much larger city.

See `open-issues.md` for the full detail and reasoning behind each of these.

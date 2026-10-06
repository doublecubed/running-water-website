# Website puzzle system (design sketch)

Status: **design only** — nothing here is built. It records the plan for
reusing this engine as a game studio's website, in a separate repo, with a
small breadcrumb puzzle instead of a full case.

## Goal

The studio website is a plain text adventure, not a detective simulation.
Visitors walk between a few rooms (the "pages"), talk to things (objects
modelled as NPCs), and follow a chain of leads — breadcrumb-following or a
classic adventure-game puzzle — to a small payoff. There is no deduction or
case-board experience.

## Mapping onto existing engine systems

| Site concept | Engine system |
|---|---|
| Pages (Lobby, Games, Team, Contact) | Locations and exits (`systems/navigation.md`) |
| Talkable things (a filing cabinet, a poster, a team member) | NPCs — plain data with a label and dialogue; an "object" is just an NPC with a different label. Whether the WorldObject/prefab system can speak directly is unverified; the NPC route is the safe choice |
| Puzzle gating | Facts/notebook plus NPC dialogue conditions and memories: talking to A teaches a fact, B's line only unlocks once it is known |
| "Find X, show it to Y" steps | Optional: inventory and items |

## What to keep vs. drop in the website repo

Keep: navigation, NPC dialogue with conditions/memories, facts/notebook,
localization keys, optionally inventory.

Drop: case board, deduction/accusation, NPC schedules (unless things should
move around), save/load (unless progress should persist between visits),
the map and NPC editors and their Vite entry.

## Puzzle design guidelines

- **Length:** five to seven steps. Longer feels like homework on a studio site.
- **Payoff:** the last step is a clear reward — a "case closed" line that
  reveals a contact link, newsletter sign-up, or game announcement.
- **Hints:** casual visitors will get stuck. The notebook (or a `hint`
  command) restates the next lead; clickable hotspots point at the right
  places.
- **Nothing valuable behind the puzzle.** The solution chain lives in the
  shipped bundle/data and is readable by anyone who opens it. Do not hide
  real discount codes or unreleased information behind it.
- **Plain links stay available.** Keep a conventional footer/"skip the game"
  link so visitors who just want the store page or contact email are not
  forced to play.

## Companion pieces (see also)

- **Image pane and hotspots:** a central image window plus clickable regions
  that auto-execute commands (for players unfamiliar with text adventures).
  Hotspots should be data on the location (region, label key, command), the
  click feeding the same input path as typed text. See the engine image
  displayer discussion in the project conversation; not yet documented as a
  system.
- **SEO / mobile / accessibility:** a JS-rendered terminal is invisible to
  crawlers — provide a static or prerendered fallback for key text; design
  mobile click-first; make the log an `aria-live` region and hotspots
  keyboard-focusable.
- **Code visibility:** everything shipped to the browser is downloadable.
  Minification (no source maps) and optional obfuscation only slow readers
  down; comments are stripped by the build, so any in-joke for snoopers
  belongs in `index.html` or a console message.

## Repo strategy

A separate repo (fork), because features will diverge heavily. Keep the
engine folder as close to unchanged as practical so upstream fixes can be
pulled; put site-specific work in separate files. Delete the clearly unused
parts (editors first) in small commits with tests passing; leave other
engine internals alone unless a test run proves removal is safe.

## Next step

Sketch the puzzle chain on paper — rooms, talking objects, and which fact
each hands to the next — then convert it into the YAML content.

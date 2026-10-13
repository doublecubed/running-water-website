# Website site map and first slice

Status: **first slice built** (2026-10-08). The studio's rooms exist as content;
only the Landing and Main Room have real objects. Puzzle chain not designed yet
(see `puzzle_system.md`).

## Rooms

All rooms are `kind: exterior` (the interior/exterior hop rules belong to the
old city sample). Content: `src/content/city/locations/studio.yaml`; objects:
`objects/studio.yaml`; the herald: `world.yaml`. Art lives in `public/images/`.

| Room (id) | Real page | Art | Exits |
|---|---|---|---|
| The Landing (`studio-landing`, **start**) | Entry, how the site works | `studio-entrance.jpg` | Corridor (door beside the desk) |
| Main Room (`studio-mainroom`) | Hub: computer = current project, whiteboard = other projects, workspace = blog posts | `studio-general.jpg` | Corridor (right bar and bottom strip) |
| Corridor (`studio-corridor`) | Navigation hub | `studio-corridor.jpg` | Landing (bottom strip), Main (left doorway), Meeting (left door), Press and Mail (right doors), Break (far-end door; broken-geometry graphic to be added) |
| Press Room | Press kit (empty on purpose, giant press) | `studio-pressroom.jpg` | Corridor |
| Meeting Room | About us (team as crayon drawings) | `studio-meetingroom.jpg` | Corridor |
| Mail Room | Contact + mailing list | `studio-mailroom.jpg` | Corridor |
| Break Room | Broken geometry, tentacles | `studio-breakroom.jpg` | Corridor, Archive |
| Archive | Flooded; the idea-vault cabinet lives here | `studio-archive.jpg` | Break Room |
| Waiting Room | Puzzle: ticket machine | placeholder svg | Corridor (**no way in yet**) |
| Bathroom | Easter egg | placeholder svg | Corridor (**no way in yet**) |

Every room image ends with a full-width bottom-strip hotspot (`rect: [0, 90, 100, 10]`) that backs out to the previous room; the Main Room also has a full-height right bar into the corridor. The drawing room was dropped in favour of the Meeting Room. `room-map.svg` is the design diagram.

The Waiting Room and Bathroom have no inbound connection on purpose: the engine
has no locked-door/gated-connection concept (a connection either exists or not;
see `Connection` in `engine/types.ts`). Reaching them must come from the puzzle
design, e.g. a state/flag that makes a connection appear, which needs engine work.

## The herald

NPC `herald` ("Landing Page") in the Landing. First talk: welcome and how the
site works; topics: the studio, how this works. Doubles as the intended hint
system later (news and hints in character).

## Navigation UX

- Each room's image has hotspots (doors, objects) that run commands.
- The Main Room image has no doors in the art, so its exits are named in the
  description only; add door hotspots when art exists.
- The left **locations panel** lists visited rooms as buttons. A click echoes and
  runs `go to <room>` through `TerminalView.runInput` (same path as typing and
  hotspots), so it follows existing connections and can never skip a lock.
  Only visited rooms are listed, so unexplored rooms stay hidden.

- Menu options (dialogue topics, disambiguation, etc.) are buttons; a click is the
  same as typing the option's number. Older menus go inert once replaced.

- Side panels are fixed size (locations and inventory share one height, sized for
  10 rows). A "Known verbs" guide (go to, examine, talk to, open, close) sits
  under the locations panel; add verbs to `VERB_HINT_KEYS` as the site needs them.

## Clock

The status bar shows the current room name at its right end (the money display
was removed from the page; the engine still tracks money) and the visitor's real
local date and time, ticking in real time. `TerminalView.startWallClock()` feeds
`GameEngine.syncClock(minutes)` from `view/wallClock.ts` every 15 s; the engine
never reads `Date` and no action advances its clock (travel takes no time).

## Travel

Moving between rooms is free and instant: no distance, transport modes, fares,
transit lines or passes (all removed 2026-10-13), and there is no save/load.
`Connection` is just `{ toId, compassLabel?, curve? }`. A named destination far
away (`go to archive`, or a locations-panel click) walks the shortest path in one
step (`findPath`, breadth-first). Compass words (`n`, `s`, `up`, ...) still work on
any connection that carries a `compassLabel`; the studio's don't yet. See
`../systems/navigation.md`.

## Not done / open

- Editors, case board and the "city" leftovers (stealth, stats, schedules, NPC
  labels) are not cut yet. Money, `buy` and notebooks stay on purpose (notebooks
  will carry blog posts and notes).
- Cabinet is a plain locked-looking setpiece; opening it is unbuilt.
- Mailing-list signup needs an external link; press kit needs a plain link.

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
| The Landing (`studio-landing`, **start**) | Entry, how the site works | `studio-entrance.jpg` | Main Room |
| Main Room (`studio-mainroom`) | Hub: computer = current project, whiteboard = other projects, workspace = blog posts, cabinet = idea vault (locked) | `studio-general.jpg` | Landing, Press, Drawing, Mail, Break |
| Press Room | Press kit (empty on purpose, giant press) | placeholder svg | Main |
| Drawing Room | About us (crayon, stick figures) | placeholder svg | Main |
| Mail Room | Contact + mailing list | `studio-mailroom.jpg` | Main |
| Break Room | Broken geometry, tentacles | `studio-breakroom.jpg` | Main, Archive |
| Archive | Flooded; idea vault key/clue | `studio-archive.jpg` | Break Room |
| Waiting Room | Puzzle: ticket machine | placeholder svg | Main (**no way in yet**) |
| Bathroom | Easter egg | placeholder svg | Main (**no way in yet**) |

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

## Clock

The status bar shows the visitor's real local date and time, ticking in real
time. `GameEngine` takes `{ externalClock: true }` (travel no longer advances
time); `TerminalView.startWallClock()` feeds `GameEngine.syncClock(minutes)` from
`view/wallClock.ts` every 15 s. The engine never reads `Date`.

## Not done / open

- ~80 tests in `GameEngine.test.ts` and other sample-based suites still fail.
- Editors, case board, money/fare UI and save/load are not cut yet.
- Cabinet is a plain locked-looking setpiece; opening it is unbuilt.
- Mailing-list signup needs an external link; press kit needs a plain link.

# System: Navigation (`src/engine/`, `src/engine/navigation/`)

## What it does

A graph of `Location`s joined by `Connection`s. Moving is **free and instant**:
there is no distance, speed, transport mode, fare, line, pass or travel time (all
removed; the website only needs "go from one room to another"). A `Connection`
is just:

```ts
interface Connection {
  toId: LocationId;
  compassLabel?: Direction; // optional alias: "go north" instead of naming the room
  curve?: { cx: number; cy: number }; // presentation only (map canvas)
}
```

Connections are **directional**: A->B does not imply B->A. Content adds both
when travel should work both ways; a one-way connection is a one-way door. A
room with no inbound connection is unreachable (the Waiting Room and Bathroom
are like that on purpose, until the puzzle gives them a way in).

## `GameEngine.travelTo(query)`

Two resolution paths:

1. **Compass word** (`north`, `up`, `in`, ... normalized by the parser): matches a
   `Connection.compassLabel` on the player's CURRENT location only, and takes
   exactly that connection (`executeHop`). Emits `player_moved`.
2. **Named destination**: anything else is matched against every
   `Location.aliases` across the whole map, then reached by the fewest-hops path
   (`findPath`, a breadth-first search in `navigation/pathfinding.ts`; pure, takes
   a `GameState`, returns `[fromId, ..., toId]` or `null`). The player ends up at
   the destination in ONE step; intermediate rooms are neither visited nor
   described. Emits `player_traveled` (param: `locationKey` only).

Failures: `location_not_found` (unmatched name), `move_blocked` (no connection with
that compass label), `route_not_found` (matched but unreachable), and
`already_there` (a success, with nothing moved).

On success, travel also: breaks examine focus (`clearFocus`), marks the
destination visited, resyncs scheduled NPCs (`syncNpcLocations`), re-rolls
stealth concealment if sneaking, and prints the room (`describeLocation`). It
does NOT charge money or advance the clock (`syncClock` is the clock's only
writer; see `time.md`).

The old `travelToConnection`, `listDirectConnections`, `inquireTravel`, travel
preference and all fare/pass/transit-line code are gone, along with the interior
hop rule (`interiorHops.ts`). `Location.kind` (`exterior`/`interior`) remains as
descriptive metadata the editor uses; nothing in navigation reads it.

## Discovered locations

`Player.visitedLocationIds` records every location the player has arrived at, in
first-visit order. It is seeded with the starting location by
`content/world.ts` and grown by `GameEngine`'s private `moveTo`, the single
choke point both travel paths use. `TerminalView`'s locations panel lists only
these (spoiler-safe); the dev-only `devlocations` verb shows all.

Each panel entry is a button that runs `go to <room name>` through the normal
input path, so a click can never do anything typing couldn't, and a room more
than one step away is reached by `findPath`.

## Arrival description vs. `look()`

`describeLocation(location, { includeDescription })` builds the event sequence for
arriving at or re-examining a room, in a fixed order: full description, a
visibility line, setpieces present, items present, NPCs present (each omitted
when empty). `includeDescription` is true for an explicit `look`, and for a
FIRST-ever arrival; a revisit prints only the present-lines. The first-visit
check happens BEFORE `moveTo`, which immediately marks the room visited.

Setpieces (`kind: "setpiece"`) follow the description's gating unless they set
`announceOnRevisit`; items (`kind: "item"`) are announced on every arrival. See
`parts.md` for contained objects.

## How it interacts with other systems

- **Parsing**: the parser only produces `{ kind: "travel", query }`. All
  resolution is engine-side, against real data.
- **Image pane**: hotspots on a room's image run `go to <room>`; the pane follows
  `getSceneImage()` (see `image-pane.md`).
- **Time**: travel doesn't touch the clock. Scheduled NPCs resync on arrival.
- **Content**: rooms live in `content/city/locations/*.yaml`; see
  `docs/website/site-map.md` for the studio's layout.

## Known gaps

- No locked or gated connection: a connection exists or it doesn't. The puzzle
  will need state that makes one appear (engine work).
- Multi-hop travel is atomic; there is no step-by-step walk.

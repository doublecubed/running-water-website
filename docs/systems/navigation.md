# System: Navigation (`src/engine/`, `src/engine/navigation/`)

## What it does

Replaces a fixed compass-exit room model with a weighted graph of
`Location`s connected by `Connection`s. Distance + transport mode
determine travel time, which is spent from the shared `GameClock` (see
`docs/systems/time.md`). Movement resolves two ways, both through
`GameEngine.travelTo(query)`:

1. **Compass fast path** — `query` is a direction word (`north`, `n`,
   ...). Matches a `Connection.compassLabel` on the player's CURRENT
   location only. Travels exactly that connection, at the mode
   `pickModeForCategory` selects for `Player.travelPreference`. This is
   the player's explicit choice of WHERE — it is never second-guessed by
   pathfinding, even if a faster/cheaper route to the same destination
   exists via another path — but WHICH MODE on that connection still
   follows the preference.
2. **Named destination** — anything else is matched against every
   `Location.aliases` across the whole map (not just neighbors), then
   reached via `findCategoryRoute` (Dijkstra,
   `src/engine/navigation/pathfinding.ts`), riding `Player.travelPreference`'s
   category wherever it's offered — shortest total TIME for `transit`/
   `taxi`, but shortest total COST for `foot` (foot itself is always
   free, so the real question there is which forced fallback costs least
   — see `CATEGORY_OPTIMIZES_FOR` and `docs/systems/economy.md`), never
   shortest distance or fewest hops. This is the "go to the docks" case
   and may involve several hops.

## Public capabilities

| Method | Effect | Failure mode |
|---|---|---|
| `travelTo(query, override?)` | Resolves and executes travel (compass or pathfound) per the player's `travelPreference`, unless `override` (`{ mode }`, `{ category }`, or the legacy `{ strategy }` — see `docs/systems/economy.md`) forces a specific one-trip choice; charges for the trip (see `chargeForTravel`) BEFORE moving the player or advancing the clock, so an unaffordable trip leaves everything untouched | `move_blocked` (bad compass word), `location_not_found` (unmatched name), `route_not_found` (matched but unreachable — disconnected graph), `already_there` (matched but it's where the player already is), `insufficient_funds` (can't afford the mode/route resolved) |
| `travelToConnection(toId, override?)` | Executes travel along a SPECIFIC connection from the current location, by destination id — bypasses `travelTo`'s alias/name matching entirely, for callers (the travel menu — see `docs/systems/menu.md`) that already know exactly which connection they mean | `route_not_found` (no such connection from here), `insufficient_funds` |
| `listDirectConnections()` | Every direct connection from the current location, summarized with the mode `travelPreference` would pick — the data behind the bare-`travel` menu's top-level screen | never fails (an empty list is valid) |
| `inquireTravel(query)` | Reports travel options to `query` WITHOUT executing any — read-only, same resolution paths as `travelTo` but reporting instead of acting; lists one option per natural travel category, preferred category first, annotated — see `docs/systems/economy.md` | same failure modes as `travelTo` |
| `look()` | Re-describes the current location: ALWAYS emits the full flavor-text event, then an items-present event and/or an NPCs-present event (each omitted entirely when empty) | never fails |
| `getTravelPreference()` / `setTravelPreference(category)` | Reads/changes `Player.travelPreference` (`"foot"`, `"transit"`, or `"taxi"` — see `docs/systems/economy.md`) | never fails |
| `getVisitedLocationIds()` | Every LocationId the player has actually arrived at, in first-visit order — see "Discovered locations" below | never fails |

`findCategoryRoute(state, fromId, toId, category)`
(`navigation/pathfinding.ts`) is the pathfinding function `inquireTravel`/
`travelTo` actually use — pure, takes a `GameState`, two ids, and a
required `TravelCategory`, returns a `Route` (`path`, per-hop
`RouteHop[]`, `totalMinutes`, `totalCostMinor`) or `null` if unreachable.
Directly unit-testable without `GameEngine` — see `pathfinding.test.ts`.
`findRoute(state, fromId, toId, strategy)` is the older mixed-mode
search — still fully implemented, kept for a future "navigator device"
item, reachable only via `TravelOverride.strategy` — see
`docs/systems/economy.md`. Both share one Dijkstra core (`runDijkstra`)
and track a secondary tie-break metric so tied primary weights (e.g. two
equally-fast routes) don't resolve to an arbitrary one — see the doc
comments above `runDijkstra`/`findRoute` and pathfinding.test.ts's tie-break
tests.

`fastestMode(connection)`, `cheapestMode(state, connection)`, and the
`pickMode(state, connection, strategy)` dispatcher between them (the
legacy strategy path) live alongside `pickModeForCategory(state,
connection, category)` and `resolveCategoryEdges` (the category path, which groups
PARALLEL connections to the same neighbor together rather than resolving
each in isolation — see its doc comment in `pathfinding.ts`) plus
`travelMinutes(distanceKm, mode)`/`costOfMode(state, connection, mode)`
in `navigation/transportModes.ts`/`navigation/pathfinding.ts`, computing
per-edge time/cost. Mode speeds are defined once, centrally
(`TRANSPORT_MODE_SPEED_KMH`) — a `Connection` only declares which modes
are usable on it, never how fast (or, per `docs/systems/economy.md`, how
expensive) they are, so there is one place to tune "how fast is a car"
for the whole game.

## Data model

- `Location` is a discriminated union — `ExteriorLocation` (`kind:
  "exterior"`) or `InteriorLocation` (`kind: "interior"`, with a required
  `exteriorId` and an optional `floorNumber`). See "Interiors" below.
- `Location.connections: Connection[]` — **directional**. A connection
  from A to B does not imply one from B to A; content authors add both
  explicitly if travel should work both ways (this is what makes one-way
  streets/locked routes representable without a special case — see
  `docs/content-schema.md`).
- `Connection.compassLabel` is optional flavor/convenience metadata, not a
  structural requirement — a connection with no compass label is only
  reachable by naming the destination. `Direction` now includes `"in"`
  and `"out"` alongside the compass words — see "Interiors" below for
  when using them (vs. an ordinary directional word) makes sense.
- `Connection.modes: TransportMode[]` lists which of `foot`/`car`/`ship`/
  `taxi`/`bus` are usable there. An edge with an empty list is a
  malformed/impassable connection; `findRoute` and the compass fast path
  both skip it rather than crashing.

## Interiors

`Location.kind` distinguishes outdoor/public locations (`"exterior"` —
streets, docks, highways) from locations inside a building
(`"interior"`). An `InteriorLocation.exteriorId` names which exterior
location "owns" it — the building's street-level anchor. This is a
**grouping/ownership reference, not a navigation edge** (`Connection`s
are still what you actually walk along) — critically, EVERY interior in a
multi-room/multi-floor building carries the SAME `exteriorId` (the street
outside), not the id of whichever room/floor it's physically entered
from. A future "leave the building" shortcut can resolve in one lookup
regardless of how deep the player is, rather than chaining through
intermediate interior parents.

**There is no separate "building facade" location.** The named entry
point of a building — what a player types to arrive there — IS an
`InteriorLocation`: the whole building, for a single-room one (a diner);
its lobby, for a multi-room one (a hotel). Reaching "the diner" means
being inside it; there's nothing that represents standing on the
sidewalk in front of it, because nothing narratively needs that.

**Multi-story buildings need no new mechanism** — a floor is just another
`InteriorLocation`, chained to the one below/above via an ordinary
`Connection` with `compassLabel: "up"`/`"down"` (already fully supported
for any location, not interior-specific). A floor can itself contain
several rooms via more ordinary connections. `floorNumber` is optional,
display-only metadata (e.g. "You're on floor 2") — nothing reads it for
navigation.

**`in`/`out` are just two more `Direction` values**, usable as a
`compassLabel` — but ONLY when unambiguous. A location with exactly one
door (the office, off the alley) is a good fit: `alley --"in"--> office`,
`office --"out"--> alley`. A location with several buildings sharing one
exterior (Main Street has the precinct, the diner, and the Grand Hotel)
keeps each building's own distinguishing compass word (`south`, `west`)
or no `compassLabel` at all (reachable only by name) — `"in"` on more
than one connection from the same location would be ambiguous about
which door is meant. Critically, **the flat interior travel rate (below)
does NOT depend on which word, if any, labels the connection** — entering
the precinct via `south` is exactly as fast/free as entering the office
via `in`.

**Entering, exiting, or moving between locations of the SAME building is
always exactly `INTERIOR_HOP_MINUTES` (1) minute and always free**,
regardless of the connection's authored `distanceKm`/`modes`/`costsMinor`
— see `engine/navigation/interiorHops.ts`'s `isInteriorHop` (derived
purely from the two locations' `kind`/`exteriorId`/`id` — no `Connection`
field involved) and `transportModes.ts`'s `hopMinutesAndCost`, the single
place every caller that computes a hop's time/cost goes through (`findRoute`'s
relaxation loop, `GameEngine.executeHop`, and the `inquire`/direct-connections
choice-builders), so the rule can't be applied in some places and
forgotten in others. Content still declares nominal
`distanceKm`/`modes` on such connections for schema consistency — they're
just not read for timing.

## Discovered locations

`Player.visitedLocationIds: LocationId[]` records every location the
player has actually arrived at, in first-visit order — seeded with the
starting location by `content/world.ts`'s `createInitialState`, grown by
`GameEngine`'s private `moveTo` helper. `moveTo` is the SINGLE choke
point both `travelTo` (named-destination branch) and `executeHop`
(compass branch, also used by `travelToConnection`) go through to change
`Player.locationId` — deliberately, so visited-tracking can never be
forgotten at one call site and remembered at another the way two
separate direct assignments could drift.

`TerminalView`'s locations panel (`renderLocationsPanel`) defaults to
showing only `getVisitedLocationIds()` — spoiler-safe, so the debug panel
stops doubling as a full map reveal. A dev-only `devlocations` command
flips it to show every location instead (pure `TerminalView` state, no
`GameEngine` involvement) — see `docs/systems/parsing.md`'s "Dev-only
commands" for why that command doesn't even exist outside a dev build.

## Arrival description vs. `look()`

`GameEngine`'s private `describeLocation(location, { includeDescription })`
builds the event sequence for both arriving at a location and re-examining
it, in a fixed order: full flavor-text description (conditional), then a
setpieces-present event, then an items-present event, then an NPCs-present
event — each of the latter three omitted entirely (not printed as
"nothing here") when there's nothing to report. A slot for NPC entry
reactions belongs after these once that system exists; nothing is
emitted for it today.

**Setpieces vs. items**: `WorldObject.kind` (see docs/content-schema.md)
splits placed world objects into two presentation buckets. `kind:
"setpiece"` (furniture, landmarks — conventionally non-portable) is
grouped with the description rather than a separate "present" line,
because setpieces are scene dressing, not something to re-announce on
every plain revisit; it follows the SAME `includeDescription` gating as
the description itself, except that an individual setpiece with
`announceOnRevisit: true` is re-announced on every arrival regardless
(for a piece whose state can change in a way worth noticing immediately,
e.g. a drawer left open — a desk without that flag stays quiet until the
player `look`s again). `kind: "item"` (small, inventory-able clutter) is
unaffected by any of this — it's always announced on every arrival,
exactly as before. A revealed CONTAINED object (see
docs/systems/parts.md's "Containment") can also join these same lines,
but only one hop deep and only when its exposing part's state opts in via
`revealInAmbientListing` — otherwise it's discoverable only by examining/
interacting with its container.

`includeDescription` is `true` only when:
- the caller is `look()` — an explicit look always re-reads the full
  description, regardless of visit history, or
- the caller is `travelTo`/`executeHop` arriving at a location NOT already
  in `visitedLocationIds` — i.e. this is the player's first-ever arrival.
  The first-visit check happens BEFORE `moveTo` runs (which immediately
  marks the destination visited), since checking after would always see
  the just-arrived destination as already visited.

A revisited location's arrival therefore prints only the items/NPCs
lines (or nothing at all, if both are empty) — the player has to type
`look` to get the flavor text again.

## How it interacts with other systems

- **Time (`src/engine/time/`)**: every successful travel action calls
  `advanceClock(minutes)`, the only writer of `GameClock.minutesElapsed`
  today. `look()` does not advance time; only travel does.
- **Content (`src/content/world.ts`)**: an 11-location sample map — 5
  exterior (alley, street, highway, docks, pier) and 6 interior (office,
  precinct, diner, and the 3-level Grand Hotel) — exists to exercise the
  system: `street` is a 6-connection hub, `office→docks` demonstrates
  pathfinding picking a multi-hop, mixed-mode route over a slower direct
  one (see `GameEngine.test.ts`'s "picks the fast taxi route" test),
  `docks↔pier` is the map's only `ship`-mode connection, and the Grand
  Hotel demonstrates multi-story interiors (see "Interiors" above). Also
  the fare system's test content (see `docs/systems/economy.md`): `taxi`
  is layered onto every exterior↔exterior connection except `docks↔pier`
  (kept boat-exclusive on purpose), and one bus line, `bus-1`, runs
  `alley↔street↔highway↔docks` as its own separate `Connection` objects
  (never merged into the free `foot`/`taxi` ones, since `transitLineId`'s
  fare applies to the whole connection it's set on).
- **Parsing**: the parser never resolves exits/locations itself — it only
  produces `{ kind: "travel", query }` (a compass word or a location
  name/alias verbatim). All resolution is engine-side, against real data,
  so parsers stay purely syntactic. See `docs/systems/parsing.md`.
- **NPCs/items**: unaffected in shape — `Npc.locationId` and
  `Location.itemIds`/`npcIds` work exactly as `roomId`/etc. did before
  the `Room` → `Location` rename.
- **View**: `TerminalView` renders a locations panel (left side, toggled
  with `locations`/`map`) listing every `Location`'s name — see
  `docs/systems/parsing.md`'s "Verb list panel" section, which documents
  both side panels together since they share one implementation pattern.

## Known gaps

- No vehicle ownership/inventory gating — there's no `"car"`
  `TravelCategory` yet, since the player doesn't own one; `content/world.ts`
  has no `car` mode on any connection either. Modeling "the player now
  owns a car" is a future extension — likely adding `"car"` to
  `TravelCategory` and gating it on player state, plus a running/gas cost
  (see `docs/systems/economy.md`'s "Known gaps").
- Cost model exists — flat per-connection fares, a metered taxi formula,
  and line-based fares with free transfers (`Connection.costsMinor`/
  `transitLineId`, `costOfMode`, `Route.totalCostMinor` — see
  `docs/systems/economy.md`) and IS a route-selection factor:
  `findCategoryRoute` resolves each hop's mode by the category's
  preference (own mode, else foot, else forced — see
  `resolveCategoryEdges`), and minimizes total TIME for `transit`/`taxi`
  but total COST for `foot` (`CATEGORY_OPTIMIZES_FOR` — foot itself is
  free, so the real optimization is which forced fallback costs least,
  not which is fastest). See `docs/systems/economy.md` for the one
  documented approximation this still carries: a category route doesn't
  yet actively seek out free-transfer opportunities on transit lines
  within its own search.
- Multi-hop travel is atomic: the player jumps straight to the
  destination and the clock jumps straight to the new total. There's no
  step-by-step walk that could be interrupted mid-route (e.g. an NPC
  encounter partway there). Flagged as a real future extension, not
  needed for the current scope.
- No coordinate/visual map yet — locations have no `{x, y}`. Discussed but
  intentionally deferred; see the "known gaps" note this doc's sibling
  `docs/architecture.md` will link to if a `MapView` is ever built. See
  also `docs/future_work.md`'s "waypoint-aware route planning" entry —
  a visual map is also what unlocks the player seeing detour/stopover
  opportunities on their own.
- Discovered tracking exists (see "Discovered locations" below) but only
  has one consumer today: the locations panel's filter. Nothing else
  reads `Player.visitedLocationIds`/`getVisitedLocationIds()` yet (e.g. a
  future visual map's fog-of-war, or dialogue that only makes sense once
  a place has been seen).

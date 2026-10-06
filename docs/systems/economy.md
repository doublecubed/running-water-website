# System: Economy (`src/engine/economy/`)

## What it does

Player money: a single integer, `GameState.player.money`, in **minor
units** (like cents — 100 minor units = $1.00). Always an integer, never a
float, so repeated add/spend can't accumulate floating-point rounding
error. Chosen as a scalar on `Player` rather than a stackable `WorldObject`
because the current inventory model (`Player.inventory: WorldObjectId[]`) has no
quantity concept — items are unique owned things, money is fundamentally
a number. See `types.ts`'s `Player.money` doc comment.

Built as the foundation for, and now actually wired into, paid
transportation (taxi/bus fares, and passes that make specific transit
lines free for a stretch of calendar days — see "Passes" below) — see
"Known gaps" for what's still unbuilt content vs. genuinely unfinished
feature work.

## Public capabilities

- `GameEngine.getMoney(): number` — current balance in minor units. A
  getter, not an action (no event needed to check a number) — mirrors
  `getCurrentLocation()`/`getCalendarDate()`. This is the "check
  beforehand" primitive: `travelTo`'s affordability check
  (`chargeForTravel`) and `inquireTravel`'s per-option affordability
  annotation (`affordabilityParams`) both compare a cost against the
  player's current balance directly, rather than attempting a charge and
  reacting to failure.
- `GameEngine.addMoney(amountMinor)` — credits the balance. Always
  succeeds; earning money has no failure mode today.
- `GameEngine.spendMoney(amountMinor)` — the dedicated charging
  primitive: debits the balance, refusing (`insufficient_funds` event,
  balance left untouched) if it would go negative — the check happens
  BEFORE any mutation, never a try-then-rollback. `travelTo` calls it
  (via `chargeForTravel`) to charge for paid travel; `buyPass` calls it
  directly for the same reason — the first non-travel use, validating
  that it really was general enough to reuse as-is.
- `GameEngine.buyPass(query)` — buys the Pass named by `query` (alias-
  matched, like `takeItem`) if affordable, adding an `ActivePass` with a
  day-aligned expiry — see "Passes" below.
- `formatMoneyParts(amountMinor): { sign, major, minor }`
  (`engine/economy/money.ts`) — pure numeric split, no currency symbol, no
  decimal-separator choice. Mirrors the clock/calendar split
  (`docs/systems/time.md`): the engine only ever produces numbers, never
  display strings. `src/i18n/en.ts`'s `ui.moneyDisplay` template
  (`"{sign}${major}.{minor}"`) is what actually renders a `$` — a
  different currency symbol/format is a translation-table change, not an
  engine change.

## How it interacts with other systems

- **View**: `TerminalView`'s status bar shows money top-right (alongside
  the clock top-left), refreshed every turn via
  `formatMoneyParts(engine.getMoney())` + `t("ui.moneyDisplay", ...)`.
- **Events**: `addMoney`/`spendMoney`/insufficient-funds events use a
  `{prefix}Sign`/`{prefix}Major`/`{prefix}Minor` param naming convention
  (see `GameEngine.moneyEventParams`) so one event can carry both an
  amount and a balance (`insufficient_funds` needs both) without key
  collisions.
- **Navigation — cost model built in two stages, not yet wired to route
  selection or spending.**

  **Stage 1** gave `TransportMode` `taxi` and `bus` (see
  `TRANSPORT_MODE_SPEED_KMH` in `navigation/transportModes.ts` — taxi =
  car speed, bus slower) and a flat, per-connection cost
  (`Connection.costsMinor`) for the simple case: a one-off fare with no
  further structure.

  **Stage 1b** split cost into the two shapes real fares actually take,
  since "per-connection flat number" wasn't right for either:
  - **Metered (taxi)**: `costOfMode` computes `TAXI_FARE.flagFeeMinor +
    TAXI_FARE.perKmMinor × distanceKm` as a formula (mirroring
    `TRANSPORT_MODE_SPEED_KMH`) rather than reading a number content
    would otherwise have to hand-compute and keep in sync per connection.
    `flagFeeMinor` is set to $3.00 — deliberately at, not below, bus-1's
    flat fare (see below), so a taxi is never cheaper than public transit
    even on the shortest possible ride; only the per-km rate pushes it
    further above that as distance grows. A real playtest showed the
    original $1.00 flag fee made a short taxi hop actually CHEAPER than
    the bus, which felt backwards for "the fast, expensive option."
  - **Line-based (bus/train/ferry)**: a fare paid once per **boarding**,
    not per edge — riding several consecutive stops on the same line is
    free after the first. Modeled as `Connection.transitLineId` (tags
    which named line a connection belongs to) + a `TransitLine` (its flat
    `fareMinor`, in the new `GameState.transitLines` table) +
    `Player.boardedLineId` (which line, if any, the player currently
    holds a fare for). `findRoute` computes each hop's fare fresh during
    Dijkstra (time-only route selection is completely unaffected), then
    a separate linear pass over the already-resolved path
    (`applyFreeTransfers`) zeroes out any hop whose `transitLineId`
    matches the immediately preceding hop's — see `pathfinding.ts`'s doc
    comment for why this doesn't require augmenting Dijkstra's state
    space (a resolved route's cost is just a linear walk; only searching
    across many alternative routes for the cheapest would need that).

  Through Stage 1b, both remained purely **observed data about the route
  `findRoute` picked by time** — cost was reported, never a factor in
  choosing.

  **Stage 2** made cost an actual optimization target:
  `Player.travelPreference: TravelStrategy` (`"fastest" | "cheapest"`)
  is a small player-controlled default, changed with the `prefer`
  command (`prefer fastest` / `prefer cheapest`, or bare `prefer` to
  check the current setting). `findRoute` now takes that strategy as a
  required argument: it decides which mode `pickMode` picks per
  connection (`fastestMode` vs the new `cheapestMode`, which prefers the
  lowest `costOfMode` result and breaks ties by speed) AND which value
  becomes Dijkstra's edge weight (minutes vs cost) — i.e. `"cheapest"`
  doesn't just avoid paid modes on individual edges, it genuinely
  searches for the lowest-total-cost path through the graph, exactly
  like `"fastest"` searches for lowest-total-time. Both `totalMinutes`
  and `totalCostMinor` are always computed and reported regardless of
  which one governed the search. The compass fast path
  (`GameEngine.executeHop`) also reads the preference via the same
  `pickMode` call, so `go south` picks a mode by preference too — only
  WHERE to go is fixed by the compass word, never WHICH mode gets used
  there.

  **Known, documented approximation carried over from Stage 1b:**
  `cheapestMode`/the `"cheapest"` Dijkstra weight both evaluate each
  edge's cost in isolation, via `costOfMode`'s "fresh boarding" price —
  they do NOT know a hop might turn out free because the search is
  already riding that line. `applyFreeTransfers` still runs after the
  route is resolved and still correctly zeroes out any hop that turns
  out to be a continuation, so `Route.totalCostMinor` is always accurate
  for the route chosen — but a "cheapest" search won't actively go out
  of its way to string together same-line hops it hasn't already
  committed to for other reasons. Fixing that fully needs Dijkstra's
  state space augmented with "which line am I currently on," which
  nothing has needed badly enough to justify yet — see `pickMode`'s and
  `findRoute`'s doc comments in `pathfinding.ts`.

  Fixing Stage 2 also surfaced (and fixed) a latent Dijkstra correctness
  gap: with tied primary weights (e.g. two entirely free routes under
  `"cheapest"`), the algorithm previously had no signal to prefer the
  faster of two equally-cheap paths — it could pop the destination
  through an arbitrary tied-cost route before a better one got explored.
  `findRoute` now tracks a **secondary metric** alongside the primary
  weight (cost under `"fastest"`, time under `"cheapest"`) and tie-breaks
  by it in BOTH node selection and edge relaxation — see `findRoute`'s
  doc comment in `pathfinding.ts` and its "prefers the faster of two
  equally-cheap routes" test. This isn't specific to zero-cost routes;
  it's the general fix for any tie.

  **Stage 3** added `GameEngine.inquireTravel(query)` — reports travel
  options WITHOUT executing any of them (location, clock, and money all
  stay untouched). Mirrors `travelTo`'s two resolution paths but reports
  instead of acting:
  - **Compass word**: the destination is already fixed (one connection),
    so options are per-**mode** — one per transport mode that connection
    lists (e.g. "on foot: 48 min, $0.00" / "by taxi: 6 min, $3.00"). Still
    true today, unchanged by Stage 7.
  - **Named destination**: originally, `findRoute` ran once for
    `"fastest"` and once for `"cheapest"`, merging them into one option
    when they coincided. **Superseded by Stage 7** — see below for the
    current behavior (one option per natural travel category).

  New display vocabulary this needed: mode display names
  (`mode.foot.name`, `mode.taxi.name`, etc. in `en.ts`) — transport modes
  had no player-facing name before this; they were purely internal ids.
  Each `strategyChoice` also reports `modesKey` — a `", "`-joined list of
  those same keys for the route's hops (`routeModesKey`), collapsing
  consecutive hops on the same mode into one entry, so a route through
  several interior/exterior boundary hops doesn't repeat "on foot" once
  per 1-minute hop. Rendered in parentheses after the hop count (e.g.
  "fastest: 8 min, $3.10, 4 hop(s) (on foot, by taxi, on foot)") — added
  after a playtest of the fare-system content asked what a multi-hop
  route's `fastest`/`cheapest` options were actually riding, since a
  single route can mix modes across its hops and the hop count alone
  doesn't say which.

  **Stage 4** made those options actually selectable, via a new
  `ActionResult.choices?: TravelChoice[]` field (`types.ts`) —
  `inquireTravel`'s options are now returned there instead of as extra
  display events (`event.routeOptionByMode`/`event.routeOptionByStrategy`
  are now `TravelChoice.textKey` values, not `GameEvent`s). `travelTo`
  gained an optional second parameter, `TravelOverride`, that executes one
  SPECIFIC option instead of the default resolution (player's standing
  `travelPreference`) — a one-trip override that does not change the
  standing preference. (`TravelChoice.kind`/`TravelOverride`'s exact
  shape changed again in Stage 7 — see below.)

  Deliberately kept engine-side stateless: there is no "pending choice"
  in `GameState`. The view owns remembering what was just offered — today
  that's `MenuFlow`'s screen stack (see `docs/systems/menu.md`), which
  replaced an earlier ad hoc `PendingChoice` mechanism. Selecting an
  option calls `travelTo(query, override)` with the override re-derived
  from the SAME query rather than any stored `Route` object —
  deterministic and immune to state having changed between inquiring and
  choosing (nothing currently can change it, but the design doesn't rely
  on that). See CLAUDE.md's engine/view boundary and
  `ActionResult.choices`'s doc comment in `types.ts` for why this lives
  in the view, not the engine.

  This is the first real (non-speculative) implementation of the
  multiple-choice input system sketched in `docs/systems/parsing.md` —
  `TravelChoice.kind` is deliberately travel-specific rather than a fully
  generic choice shape; generalizing it is real future work for whenever
  a second, non-travel use case (dialogue, etc.) actually exists.

  **Stage 5 (final)** wired `spendMoney` into travel execution — paid
  transportation now actually costs money:
  - `GameEngine.chargeForTravel(costMinor)` is the shared "check
    beforehand" gate both `travelTo` branches call BEFORE mutating
    anything: it calls `spendMoney`, which itself refuses (leaving the
    balance untouched) rather than deducting then rolling back if the
    trip is unaffordable. Only once that succeeds does `travelTo` move
    the player and advance the clock — an unaffordable trip fails
    cleanly with NOTHING partially applied (no partial move, no clock
    advance, no partial deduction). `chargeForTravel` returns `null` (not
    an `ActionResult`) for a free leg, specifically so a $0.00 walk
    doesn't print a redundant "you spend $0.00" line.
  - `inquireTravel` shows every option regardless of affordability —
    nothing is ever filtered out — but ANNOTATES each choice via
    `affordabilityParams`: an `{afford}` placeholder in
    `event.routeOptionByMode`/`event.routeOptionByStrategy` resolves to
    nothing when affordable, or to `ui.cannotAfford` (a note with the
    player's current balance) when not. This reuses the resolver's
    recursive key resolution (see `docs/localization.md`) — the nested
    key's own `{balanceSign}`/`{balanceMajor}`/`{balanceMinor}`
    placeholders resolve against the SAME params object the outer choice
    was built with.
  - Selecting an unaffordable option (via the `travel` menu, or directly
    via `travelTo(query, override)`) fails through the exact same
    `insufficient_funds` path as any other unaffordable trip — no
    special-casing needed, since `chargeForTravel` doesn't know or care
    whether the mode/strategy came from a preference default or an
    explicit override.

  Paid transportation (Stages 1 through 5) is feature-complete
  end-to-end: cost model → preference → inquire → selection → actually
  charged.

  **Stage 6** turned the flat `inquire` command into a guided,
  multi-screen menu (bare `travel`) and refined how the preference shows
  up in it — see `docs/systems/menu.md` for the menu mechanism itself
  (`MenuFlow`, domain-agnostic) and `docs/systems/parsing.md` for why
  `inquire` was retired as a standalone verb. What changed here,
  specifically:
  - `GameEngine.listDirectConnections()` — new: every connection from the
    current location, summarized with whichever mode
    `Player.travelPreference` would pick (same `destinationChoice`
    pattern as `modeChoice`/`strategyChoice`). This is the top-level
    "here's what you can reach right now" screen; selecting an option
    executes travel immediately via the new `travelToConnection(toId)`
    (travel by exact connection id, bypassing `travelTo`'s fuzzy alias
    matching entirely, since the menu already knows precisely which
    connection it means).
  - `inquireTravel`'s named-destination branch now lists the player's
    **preferred** strategy first (not always "fastest" then "cheapest")
    and annotates it — a `preferredNote` param resolving to
    `ui.preferredOption` (" (preferred)") when a choice's strategy
    matches `travelPreference`. When fastest and cheapest coincide, the
    single reported option is now labeled with whichever the player
    actually prefers, rather than always "fastest". (The
    "preferred-first" ordering carries forward into Stage 7's categories
    unchanged; the fastest/cheapest-coincide merging does not — see
    below.)

  **Stage 7** replaced the fastest/cheapest ABSTRACTION with the natural
  categories a person actually considers — foot, public transit, taxi
  (a future car category once the player can own one) — after real
  playtesting of the fare-system content surfaced that "fastest"/
  "cheapest" told the player two numbers but not what they'd actually be
  DOING (a route could silently mix modes hop-to-hop). This was
  confirmed as an explicit redesign before implementation, per CLAUDE.md's
  "confirm architecture-level decisions" policy — including the decision
  to keep the old mixed-mode search fully working, just not the default,
  reserved for a possible future "navigator device" item.
  - `TravelCategory` (`"foot" | "transit" | "taxi"`, `types.ts`) replaces
    `TravelStrategy` as `Player.travelPreference`'s type and the `prefer`
    command's vocabulary (`prefer taxi`/`prefer transit`/`prefer foot`,
    or their aliases — see `EnglishCommandParser.ts`'s
    `PREFERENCE_ALIASES`). `TravelStrategy` (`"fastest"|"cheapest"`)
    still exists, still fully implemented (`findRoute`, `pickMode`), but
    is reachable ONLY via `TravelOverride.strategy` — not through any
    current UI — reserved for a future "navigator device" item that
    would show the player the true mixed-mode fastest/cheapest routes,
    per an explicit user decision to keep it rather than delete it.
  - **Mode resolution per category** (`navigation/pathfinding.ts`):
    `pickModeForCategory` (single connection, used by the compass fast
    path) and `resolveCategoryEdges`/`findCategoryRoute` (multi-hop,
    grouping PARALLEL connections to the same neighbor together — e.g.
    alley's separate foot/taxi and bus-only connections to street) both
    apply the same preference order: the category's own mode if offered,
    else `foot` if offered, else whatever's forced (e.g. the ship-only
    crossing to the pier) — so every category can always reach anywhere
    reachable at all, it just isn't "pure" on legs with no real
    alternative. The GROUPED version matters specifically so a category
    doesn't opportunistically switch onto a faster PARALLEL edge that
    doesn't even offer its own mode — see `resolveCategoryEdges`'s doc
    comment.
  - **One route per category, not per optimization goal**:
    `findCategoryRoute` minimizes ONE metric per category — see Stage 8
    below for which — rather than running a separate fastest/cheapest
    search within one category. `findRoute` and `findCategoryRoute` share
    one Dijkstra core (`runDijkstra` in `pathfinding.ts`), parameterized
    by how edges resolve and what's being minimized, rather than
    duplicating the search loop.
  - **Labeling, not merging**: `inquireTravel`'s named-destination branch
    runs `findCategoryRoute` once per `TRAVEL_CATEGORIES` entry and lists
    EVERY category that reaches the destination — even when two
    categories happen to resolve to the identical underlying route (no
    more Stage 3-style coincide-merging). Whichever option(s) have the
    lowest total time/cost are labeled `(fastest)`/`(cheapest)` as a
    PREFIX at the start of the line (`ui.fastestOption`/
    `ui.cheapestOption`, via `fastestNote`/`cheapestNote` params on
    `event.routeOptionByCategory`) — a tie can label more than one
    option. The player's preferred category is still listed first and
    annotated `(preferred)` as a trailing suffix, same convention as
    before.
  - **Selection by word, not just number**: `TravelChoice` gained an
    `aliases?: string[]` field — a category choice's aliases are its own
    id plus `"fastest"`/`"cheapest"` when it earned those labels; a mode
    choice's alias is the mode name itself. `MenuOption` (`MenuFlow.ts`)
    carries the same field through; `TerminalView.handleMenuInput`
    matches a typed word against any current option's aliases before
    falling back to "invalid choice" — a bare number still works exactly
    as before, this is additive. Requested explicitly so a player can
    type `taxi` or `fastest` instead of counting list positions.

  What's NOT built: `Player.boardedLineId` cross-trip persistence (a
  lump-sum `route.totalCostMinor` is charged per `travelTo` call, already
  correctly accounting for free transfers WITHIN that one trip via
  `applyFreeTransfers`, but a separate LATER `travelTo` call doesn't know
  the player is still "on" a line from a previous trip), and the "car"
  category itself (no vehicle ownership yet — see "Known gaps"). A
  non-travel use of `spendMoney` exists now — see "Passes" below.

  **Stage 8** fixed a real playtest finding: a "foot" inquiry to the docks
  showed a route that included a taxi leg (`"foot: 26 min, $4.50, ...
  (on foot, by taxi)"`), which read as a bug — asked "why does 'foot'
  include taxi?" The `highway↔docks` connection genuinely has no `foot`
  mode at all (see `content/world.ts`), so under Stage 7's rule (own mode,
  else foot, else whatever's FASTEST forced), "foot" was taking that
  forced taxi leg because the resulting mixed route was quicker overall
  than the fully-walkable direct path — technically correct per Stage 7,
  but not what a player picking "foot" actually wants.
  - **`CATEGORY_OPTIMIZES_FOR`** (`pathfinding.ts`) makes explicit that
    each category has a real reason for existing: `transit`/`taxi` want
    to get there quickly on their mode (`"time"`), but `foot` is chosen
    specifically to spend nothing — since foot itself is always free,
    the only real decision left is which forced fallback costs LEAST, not
    fastest. `findCategoryRoute`'s Dijkstra weight (`runDijkstra`'s
    `primaryOf`/`secondaryOf`) and `resolveCategoryEdges`'/
    `pickModeForCategory`'s forced-fallback tie-break (`fallbackModeFor`/
    `isBetterFallback`) both switch on this per category, instead of
    every category minimizing time uniformly. With this, "foot" to the
    docks now correctly finds the free direct `street→docks` walk instead
    of the faster-but-paid highway route.
  - **The note itself**: when a hop genuinely has no foot alternative at
    all (nothing to optimize away — e.g. the ship-only `docks↔pier`
    crossing), the "foot" route still can't avoid it. Rather than let
    that read as a silent inconsistency, `inquireTravel` checks whether
    the "foot" category's resolved route used any non-foot hop and, if
    so, prepends an `event.footRouteNotFullyWalkable` event ("Getting
    there entirely on foot isn't possible — showing the cheapest route
    that walks where it can.") before the choice list. This only fires
    for genuinely unavoidable legs — a destination with a free all-foot
    path (like the docks) never triggers it, since that path is now what
    "foot" actually picks.

## Passes

**Stage 9** added `Pass` (`types.ts`) — a purchasable pass giving free
rides on one or more `TransitLine`s for a number of CALENDAR days:

- `Pass` (content data, `GameState.passes`): `id`, `nameKey`, `aliases`
  (alias-matched by `buyPass`, same pattern as items/NPCs/locations),
  `priceMinor`, `durationDays`, and `lineIds: string[]` — an ARRAY, not a
  single id, so a future pass can cover an entire network (all city bus
  lines, a train network, ...) without changing the shape; content just
  lists more ids. `content/world.ts` has one sample: a $15.00, 7-day pass
  covering `bus-1` only.
- `ActivePass` (player state, `Player.activePasses`): `{ passId,
  expiresAtMinutesElapsed }` — see docs/systems/time.md's "Time-sensitive
  state" section for why this stores an ABSOLUTE expiry minute rather
  than a "days remaining" counter that would need decrementing. Buying
  the same pass again while a valid one is still active is allowed and
  just adds a second `ActivePass`, extending coverage rather than being
  rejected — `costOfMode` only needs ANY currently-valid entry covering a
  line, so which one "wins" doesn't matter.
- **`GameEngine.buyPass(query)`**: alias-resolves `query` against
  `state.passes`, then `spendMoney`'s "check beforehand" pattern again —
  nothing is added if the charge fails. Expiry is
  `clock.minutesElapsed + minutesUntilDayAlignedExpiry(clock.minutesElapsed,
  pass.durationDays)` — see docs/systems/time.md for the exact
  day-alignment arithmetic and why `days * 1440` alone would be wrong (it
  would drift to whatever time-of-day the purchase happened at instead of
  landing on a clean midnight boundary).
- **`costOfMode`** (`navigation/transportModes.ts`) checks
  `hasValidPassFor(state, transitLineId)` before falling back to the
  line's normal `fareMinor` — a lazy `<` comparison against
  `state.clock.minutesElapsed`, consistent with everywhere else in this
  system that "is this still free" is decided at the moment it's asked,
  never precomputed or cached.
- **Display**: a purchase confirmation (`event.passPurchased`) always
  shows the expiry as a DATE (`"Expires: 25 September 1946."`), built
  from `calendarDisplayParams` — never a duration or countdown ("in 7
  days," "9600 minutes left") — a deliberate, explicit design decision:
  the player-facing side of any expiry should read the same way the
  game's clock already reads everywhere else, not invent a second
  "relative countdown" format. See docs/systems/time.md.
- **`buy <pass>` / `purchase <pass>`** (`EnglishCommandParser.ts`) is the
  parser verb — `rest.join(" ")` alias-matched the same way `take`/`talk`/
  `examine` already work.

What's NOT built: any purchase flow OTHER than the direct `buy` command
(an NPC vendor interaction, a location-specific ticket window, ...) —
`buyPass` itself doesn't know or care how it's invoked, so adding one
later is a parser/content change, not an engine change; a player-facing
way to LIST currently-held passes and their expiries (today the only
confirmation is the one-time purchase event; checking later would need a
new command/event, mirroring how there's still no `money`/`balance`
command either — see "Known gaps"); and any pass covering more than one
`TransitLine` in actual content (the shape supports it, `content/world.ts`
just doesn't have a multi-line pass yet).

## Known gaps

- No way to earn money from content yet (no NPC payments, no shop) —
  `addMoney` exists and is tested but nothing in `content/world.ts` calls
  it. `spendMoney` IS now called, by both travel and `buyPass`. The
  dev-only `devmoney` command (see `docs/systems/parsing.md`) calls
  `addMoney` directly for testing purposes, but that's explicitly a QA
  shortcut — not an in-fiction way to earn money, and unavailable outside
  a dev build.
- No `money`/`balance` player-facing command yet — the balance is only
  visible via the always-on status bar, not queryable on demand the way
  `time` queries the clock. Trivial to add (`verb.money.usage` + a
  `Command` case) once there's a reason to.
- `content/world.ts` now carries fare-system test content: `taxi` is
  available on every exterior↔exterior connection except `docks↔pier`
  (kept boat-exclusive on purpose — the far pier is reachable only by
  ship, at a flat $10.00 fare each way via `Connection.costsMinor`), and
  one bus line, `bus-1` (`GameState.transitLines`, $3.00 to board), runs
  `alley↔street↔highway↔docks` as its own separate `Connection` objects
  per leg (never merged into the free `foot`/`taxi` connection between the
  same two locations — `transitLineId`'s fare applies to the WHOLE
  connection it's set on, so mixing `bus` into an entry with free `foot`
  would incorrectly charge the fare for walking too). Because `foot` is
  free everywhere the bus runs, and `taxi` is always faster, the bus is
  naturally dominated by both `cheapest` and `fastest` under this content
  and won't get picked by ordinary `travelTo` calls —
  `GameEngine.test.ts`'s free-transfers test exercises it by stripping the
  competing modes off the corridor rather than relying on emergent route
  selection. Starting cash is $150.00 (`Player.money: 15000`) — enough to
  comfortably afford everyday taxi/bus fares while still feeling the
  $10.00 ship fare as a real cost. This is real, working sample content
  for manually exercising the fare system (`prefer cheapest`,
  `inquire`/`travel` by direction to see taxi pricing, etc.), not yet
  content someone would actually choose to ride in the current map.
- `Player.boardedLineId` is still never read or written — see the Stage 5
  paragraph above for exactly what cross-trip persistence would need.
- No `TravelCategory` for a personal car yet — the player doesn't own one.
  `TransportMode` still lists `"car"` (`transportModes.ts`) for when
  vehicle ownership, with a gas/running cost, is built; `content/world.ts`
  currently has no `car` mode on any connection.
- A category route doesn't actively seek out free-transfer opportunities
  on transit lines within its own search — see Stage 1b/2's "known,
  documented approximation" note above; `findCategoryRoute` inherits the
  same limitation `findRoute` had (it evaluates each edge's fresh cost in
  isolation, then applies `applyFreeTransfers` only after the route is
  resolved).

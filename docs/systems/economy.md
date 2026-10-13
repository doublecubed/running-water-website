# System: Economy (`src/engine/economy/`)

## What it does

Player money: a single integer, `GameState.player.money`, in **minor units**
(like cents; 100 minor units = $1.00). Always an integer, never a float, so
repeated add/spend can't accumulate floating-point rounding error. It is a
scalar on `Player` rather than a stackable `WorldObject` because the inventory
model (`Player.inventory: WorldObjectId[]`) has no quantity concept: items are
unique owned things, money is a number. See `types.ts`'s `Player.money`.

On the website money is small on purpose. **Travel is free**: there are no
fares, passes, transit lines or transport modes (all removed; see
`navigation.md`). The only thing that costs money is buying a notebook, and the
balance is deliberately not shown in the page chrome. It stays in the engine so
money can come back for small "just for fun" mechanics later.

## Public capabilities

- `GameEngine.getMoney(): number`: current balance in minor units. A getter,
  not an action, mirroring `getCurrentLocation()`/`getCalendarDate()`.
- `GameEngine.addMoney(amountMinor)`: credits the balance. Always succeeds.
  The dev-only `devmoney` verb calls it.
- `GameEngine.spendMoney(amountMinor)`: the charging primitive. Debits the
  balance, refusing (`insufficient_funds` event, balance untouched) if it would
  go negative. The check happens BEFORE any mutation, never try-then-rollback,
  so a failed purchase has nothing to undo.
- `GameEngine.buyNotebook(target)`: buys the `NotebookProduct` named by an alias
  (or by `{ id }`, which the buy menu uses) if the player can afford it. See
  `notebooks.md`'s "Economy integration".

`engine/economy/money.ts`'s `formatMoneyParts(amountMinor)` splits an amount
into `{ sign, major, minor }` strings, so the locale (`ui.buyNotebookOption`,
`event.moneyAdded`, ...) decides how a price is laid out. The engine never
produces display text itself.

## The buy flow

`buy <thing>` (`Command.buy`) goes to `view/menu/buyMenu.ts`'s `buyByQuery`,
which calls `buyNotebook`. A bare `buy` opens a menu with one option per
`notebookProducts` entry (clickable, like every menu; see `menu.md`). Products
are authored in `world.yaml` under `notebookProducts` (`priceMinor`, `aliases`,
`pageCount`, `charCapacity`).

## How it interacts with other systems

- **Notebooks** (`notebooks.md`): the only consumer of `spendMoney` today.
- **Parsing** (`parsing.md`): `buy` / bare `buy` and the dev-only `devmoney`.
- **View**: the buy menu formats prices with `formatMoneyParts`. The status bar
  no longer shows money.
- **Time**: nothing. Purchases don't depend on the clock.

## Known gaps

- Starting cash (`$150.00`) and the notebook price are placeholders. No income
  source exists yet; `addMoney` is only reachable via the dev verb.
- Anything else for sale would be another content catalog next to
  `notebookProducts`, plus a `buy` branch for it in `buyByQuery`.

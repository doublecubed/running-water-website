
/** Which fixed screen slot a side panel occupies — sides are fixed for now (see docs/systems/... side-panels note); only a slot's CONTENT is player-selectable. */
export type PanelSlot = "left" | "right";

/**
 * What a side panel is currently showing. `"closed"` is a real, renderable
 * content id (not a separate boolean) — it's the hook a future ascii/art
 * placeholder content will occupy without changing how slots work. Extend
 * this union (and TerminalView's `SIDE_PANELS` registry) when a new panel
 * content is added — e.g. `"inventory"`.
 */
export type PanelContentId = "locations" | "verbs" | "inventory" | "facts" | "closed";

/**
 * Parsed player intent — the language-agnostic contract between "what the
 * player typed" and "what the simulation does." Every ICommandParser
 * implementation, regardless of language or syntax rules, must produce one
 * of these. GameEngine and every view depend only on this shape, never on
 * how it was derived.
 *
 * Modeled loosely as verb + object (+ a future subject, e.g. for
 * "give letter to informant" or typed dialogue topics like
 * "ask barkeep about murder"). Extend this union, not any one parser's
 * internals, when a new kind of action needs representing.
 */
export type Command =
  | { kind: "look" }
  /**
   * `query` is either a compass word ("north") or a location name/alias
   * ("the docks") — GameEngine.travelTo resolves which, and whether it's
   * a direct connection or a multi-hop pathfound route. See
   * docs/systems/navigation.md. Parsers never resolve this themselves;
   * exits/locations are data, not parser-known structure.
   */
  | { kind: "travel"; query: string }
  | { kind: "take"; query: string }
  /**
   * `query` is alias-matched against `GameState.notebookProducts` —
   * the generalized `buy` verb, see
   * docs/systems/notebooks.md's "Economy integration" decision and
   * `view/menu/buyMenu.ts`'s `buyByQuery`. Bare "buy" (no query) is
   * `buyMenu` instead, below.
   */
  | { kind: "buy"; query: string }
  /**
   * Bare "buy" with nothing named — opens a menu (`view/menu/buyMenu.ts`)
   * listing every purchasable good (notebooks). `GameEngine` knows nothing
   * about menus; the view builds one from static content.
   */
  | { kind: "buyMenu" }
  | { kind: "inventory" }
  | { kind: "talk"; query: string }
  | { kind: "examine"; query: string }
  /**
   * `verb` is a canonicalized interaction word (e.g. "open"/"close" — see
   * EnglishCommandParser's `INTERACT_VERB_ALIASES`), `query` a part alias
   * ("drawer"). Resolved by GameEngine.interact against whichever part's
   * `PartState.enterAliases` matches `verb` — see docs/systems/parts.md.
   * Which parts/states exist is entirely content-driven; adding a new verb
   * WORD still means one new VERB_RULES entry here, same as any verb.
   */
  | { kind: "interact"; verb: string; query: string }
  /** The `back`/`stop` command — explicitly clears whatever item `examine` last focused. See docs/systems/parts.md and GameEngine.unfocus. */
  | { kind: "unfocus" }
  | { kind: "help" }
  /**
   * Requests that `content` be shown in the fixed `slot` — e.g. the `verbs`
   * word requests `{ slot: "right", content: "verbs" }`. `TerminalView`
   * decides what actually happens: today it TOGGLES (re-requesting a
   * slot's current content closes it), matching the old dedicated
   * `toggleVerbs`/`toggleLocations` commands this replaces. The parser
   * itself is stateless and doesn't know a slot's current content, so it
   * can only ever say what the player asked FOR, never "hide" as such.
   */
  | { kind: "setPanel"; slot: PanelSlot; content: PanelContentId }
  /**
   * Bare `panel <slot>` with no content named — opens a menu (see
   * `view/menu/panelMenus.ts`) asking which content that slot should show,
   * "None" included (closes it, same as `setPanel`'s toggle-to-`closed`).
   * Same shape as `buyMenu`/`travelMenu`: the parser only knows the player
   * didn't name a content, `TerminalView` builds the actual option list.
   */
  | { kind: "panelMenu"; slot: PanelSlot }
  /**
   * Toggles the VISUAL map overlay (src/mapview/MapView.ts), distinct
   * from the plain-text locations panel (`setPanel` with `content:
   * "locations"`, which the "map" word ALSO means — see
   * EnglishCommandParser). Clicking a discovered location in the overlay
   * travels there directly, reusing GameEngine.travelTo the same way
   * typing its name would.
   */
  | { kind: "toggleWorldMap" }
  | { kind: "time" }
  /** The `sneak` verb — toggles Player.stealthMode. See GameEngine.toggleStealth and docs/systems/checks.md. */
  | { kind: "toggleStealth" }
  /**
   * Dev-only: credits (or, with a negative amount, debits) the player's
   * balance directly via GameEngine.addMoney — a shortcut for testing
   * affordability paths without playing through travel. Never parsed
   * outside a dev build — see ICommandParser's `devMode` note and
   * docs/systems/economy.md's "Known gaps."
   */
  | { kind: "devAddMoney"; amountMinor: number }
  /**
   * Dev-only: flips the locations panel between showing only
   * `Player.visitedLocationIds` (the player-facing default) and every
   * location that exists (the old, always-unfiltered debug behavior) —
   * purely view-side state, TerminalView handles it directly rather than
   * calling GameEngine. See docs/systems/navigation.md.
   */
  | { kind: "devToggleAllLocations" }
  /**
   * Opens the notebook interface (`docs/systems/notebooks.md`'s "Notebook
   * selection" section): no notebooks owned fails cleanly, one owned opens
   * it directly, 2+ prompts which one via a `MenuFlow` screen — see
   * `view/menu/notebookMenus.ts`.
   */
  | { kind: "notebook" }
  /**
   * `jotDown` — always creates a NEW block (never appends), stamped with
   * the current time/location, containing `text`. Resolving WHICH
   * notebook to jot into (the active one, or prompting when none is set)
   * happens in `TerminalView`, not here — see
   * docs/systems/notebooks.md's `jotDown` section. `text` is whatever the
   * player typed after the verb, UNLESS it's the literal word "last"/
   * "that" — `TerminalView` resolves that special case to the most
   * recently printed line before this Command is acted on, setting
   * `sourceRef` to record where it came from. See
   * `TerminalView.resolveJotDownText`.
   */
  | { kind: "jotDown"; text: string; sourceRef?: string }
  /**
   * A bare `jot down`/`jot` with no text — enters `TerminalView`'s
   * click-to-jot picking mode instead of jotting anything itself: the
   * player then clicks an earlier line of game output in the scrollback,
   * which becomes a `jotDown` with `sourceRef: "scrollback:click"`. See
   * `docs/systems/notebooks.md`'s `jotDown` section and
   * `TerminalView.enterJotPickMode`.
   */
  | { kind: "jotDownPick" }
  /**
   * Opens the case board overlay — a full-screen, player-authored
   * corkboard of facts/NPCs/locations/items and free-text notes, connected
   * by colored strings the player draws. Opening/closing is pure view-side
   * state, same as `toggleWorldMap` — `GameEngine` only gets called for the
   * actual node/connection edits, via `getBoard`/`addBoardNode`/etc. See
   * docs/systems/case-board.md.
   */
  | { kind: "board" }
  | { kind: "unknown"; raw: string };

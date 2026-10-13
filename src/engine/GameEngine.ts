import { addConnection, addNode, editNoteText, listAddableEntities, moveNode, recolorConnection, removeConnection, removeNode } from "./board/board";
import type { AddableEntity } from "./board/board";
import { formatMoneyParts } from "./economy/money";
import { blockActiveTextLength, charsRemaining, charsUsed, commitBlockEdit, generateNotebookId, toNoteTimestamp } from "./notebooks";
import { findPath } from "./navigation/pathfinding";
import { containedWorldObjectsIn, npcsAtLocation, worldObjectsAtLocation } from "./placement";
import type { CalendarDate } from "./time/calendar";
import { calendarDisplayParams, toCalendarDate } from "./time/calendar";
import { resolveDifficultyCheck } from "./checks/checks";
import { evaluateCondition } from "./npc/conditions";
import { applyDialogueEffects } from "./npc/effects";
import { witnessObservation } from "./npc/memory";
import { syncNpcLocations } from "./npc/schedule";
import { getStatValue } from "./stats/stats";
import { computeVisibility, visibilityTierForValue } from "./visibility/visibility";
import type {
  ActionResult,
  BoardNode,
  BoardNodeId,
  BoardState,
  BoardStringColor,
  CheckResult,
  Condition,
  Connection,
  DialogueTopic,
  Direction,
  GameEvent,
  GameState,
  Location,
  LocationId,
  Notebook,
  NoteBlock,
  NotebookProduct,
  Npc,
  NpcId,
  Part,
  PartState,
  ResolutionChoice,
  SceneImage,
  StatKey,
  TopicId,
  VisibilityTier,
  WorldObject,
  WorldObjectId,
} from "./types";

const DIRECTION_WORDS: readonly Direction[] = ["north", "south", "east", "west", "up", "down", "in", "out"];

/**
 * The headless game simulation. Owns all world state and exposes discrete
 * actions (travelTo, takeItem, etc.). Every action is synchronous and
 * returns an ActionResult — a list of structured events, not display text.
 *
 * This class has zero knowledge of how (or whether) its output is rendered.
 * A view — terminal, graphical, or a test harness — drives it by calling
 * actions and consuming the returned events. See CLAUDE.md and
 * docs/architecture.md for why this boundary is enforced.
 */
export class GameEngine {
  /**
   * `rng` is a [0, 1) random source, defaulting to real `Math.random`.
   * The only reason this exists is engine/checks/checks.ts — the first
   * system needing randomness. Tests inject a fixed/stubbed `rng` for
   * deterministic skill-check assertions instead of mocking
   * `Math.random` globally; production code never needs to pass one.
   */
  constructor(
    private state: GameState,
    private rng: () => number = Math.random,
  ) {}

  /** Read-only snapshot access for views that need to render current state (e.g. inventory panel). */
  getState(): Readonly<GameState> {
    return this.state;
  }

  getCurrentLocation(): Location {
    const location = this.state.locations[this.state.player.locationId];
    if (!location) {
      throw new Error(`Player is in unknown location "${this.state.player.locationId}"`);
    }
    return location;
  }

  /**
   * The current absolute calendar date/time, derived from
   * GameClock.epoch + minutesElapsed — see engine/time/calendar.ts. This
   * is THE time display now (see docs/systems/time.md for why the
   * earlier relative "Day N" format was dropped entirely rather than
   * kept alongside it) and also what content/logic needing a real date
   * reads (e.g. "this newspaper is dated 20 September 1946").
   * Turning this into display text is src/i18n/calendarFormat.ts's/
   * `calendarDisplayParams`'s job, never the engine's.
   */
  getCalendarDate(): CalendarDate {
    return toCalendarDate(this.state.clock.epoch, this.state.clock.minutesElapsed);
  }

  /** Produces a "look" event re-describing the player's current location — always includes the full description (regardless of prior visits), plus items/NPCs present. See describeLocation. */
  look(): ActionResult {
    return { ok: true, events: this.describeLocation(this.getCurrentLocation(), { includeDescription: true }) };
  }

  checkTime(): ActionResult {
    return { ok: true, events: [this.describeTime("event.timeChecked")] };
  }

  /**
   * Current visibility for a location — defaults to the player's current
   * one. Pure query, like `getCalendarDate()`: nothing here is stored on
   * `GameState`, it's derived fresh from the location's authored
   * `baseVisibility`/`affectedByDaylight` plus the current clock reading
   * every time it's called — see `engine/visibility/visibility.ts` and
   * docs/systems/visibility.md. Consumed by `describeLocation` (the
   * player-facing visibility line); NPC-notice/stealth and examine-detail
   * gating don't exist yet and are still future work.
   */
  getVisibility(locationId?: LocationId): { tier: VisibilityTier; value: number } {
    const location = locationId !== undefined ? this.state.locations[locationId] : this.getCurrentLocation();
    if (location === undefined) throw new Error(`getVisibility: no location "${locationId}".`);
    const value = computeVisibility(location, this.getCalendarDate().hour);
    return { tier: visibilityTierForValue(value), value };
  }

  /**
   * Current value (0-100) of one of the player's stats — pure query, like
   * `getVisibility()`/`getCalendarDate()`: nothing here mutates
   * `GameState`. Falls back to that stat's own `STAT_DEFINITIONS` default
   * when the player has no stored value for `key` (see `getStatValue`). No
   * mutation API exists yet — see docs/systems/stats.md; this is storage +
   * fallback + query only.
   */
  getPlayerStat(key: StatKey): number {
    return getStatValue(this.state.player.stats, key);
  }

  /**
   * Every fact the player has learned, joining `state.playerFacts` (what/
   * when) with `state.facts` (the authored text), oldest-first. The ONLY
   * new read surface this system adds — no grouping, no "case complete"
   * inference, nothing beyond "what has the player learned, and when." See
   * docs/systems/case-system.md.
   */
  getPlayerFacts(): { id: string; textKey: string; atMinutes: number }[] {
    return Object.entries(this.state.playerFacts)
      .map(([id, { atMinutes }]) => ({ id, textKey: this.state.facts[id]?.textKey ?? "", atMinutes }))
      .sort((a, b) => a.atMinutes - b.atMinutes);
  }

  /** The player's case board — a read-only getter, mirroring `getNotebooks`. See docs/systems/case-board.md. */
  getBoard(): BoardState {
    return this.state.board;
  }

  /** Every entity the "add node" picker can currently offer — see `listAddableEntities`'s doc comment for exactly what counts as "known." Pure query, no mutation. */
  listAddableBoardEntities(): AddableEntity[] {
    return listAddableEntities(this.state);
  }

  /** Adds a node to the case board. `refId`/`text` are validated by the caller (the view's picker only ever offers ids from `listAddableBoardEntities`, or a player-typed string for a `"note"` node) — this always succeeds. */
  addBoardNode(refKind: BoardNode["refKind"], refId: string | null, text: string | null, x: number, y: number): ActionResult {
    this.state.board = addNode(this.state.board, { refKind, refId, text, x, y }).board;
    return { ok: true, events: [{ type: "board_node_added", textKey: "event.boardNodeAdded" }] };
  }

  /**
   * Repositions a node — called on every drag-END (not per-pointer-move),
   * so this deliberately produces NO printable event, same posture as
   * `setPanel`: a drag gesture isn't scrollback-worthy, and firing an event
   * per frame would spam the log.
   */
  moveBoardNode(nodeId: BoardNodeId, x: number, y: number): ActionResult {
    this.state.board = moveNode(this.state.board, nodeId, x, y);
    return { ok: true, events: [] };
  }

  /** Removes a node and any connection touching it — see `removeNode`'s cascade. */
  removeBoardNode(nodeId: BoardNodeId): ActionResult {
    this.state.board = removeNode(this.state.board, nodeId);
    return { ok: true, events: [{ type: "board_node_removed", textKey: "event.boardNodeRemoved" }] };
  }

  /** Edits a `"note"` node's free text. No-ops (still reports success) if `nodeId` isn't a note node, matching `editNoteText`'s pure-logic behavior. */
  editBoardNoteText(nodeId: BoardNodeId, text: string): ActionResult {
    this.state.board = editNoteText(this.state.board, nodeId, text);
    return { ok: true, events: [{ type: "board_note_edited", textKey: "event.boardNoteEdited" }] };
  }

  /** Draws a string between two nodes. Fails without mutating on a self-connection, a missing endpoint, or a duplicate of an existing unordered pair — see `addConnection`. */
  addBoardConnection(fromNodeId: BoardNodeId, toNodeId: BoardNodeId, color: BoardStringColor): ActionResult {
    const result = addConnection(this.state.board, fromNodeId, toNodeId, color);
    if (!result) return { ok: false, events: [{ type: "board_connection_invalid", textKey: "event.boardConnectionInvalid" }] };
    this.state.board = result.board;
    return { ok: true, events: [{ type: "board_connection_added", textKey: "event.boardConnectionAdded" }] };
  }

  /** Removes a string. Always succeeds, even if `connectionId` no longer exists. */
  removeBoardConnection(connectionId: string): ActionResult {
    this.state.board = removeConnection(this.state.board, connectionId);
    return { ok: true, events: [{ type: "board_connection_removed", textKey: "event.boardConnectionRemoved" }] };
  }

  /** Changes an existing string's color. Always succeeds, even if `connectionId` no longer exists (no-op). */
  recolorBoardConnection(connectionId: string, color: BoardStringColor): ActionResult {
    this.state.board = recolorConnection(this.state.board, connectionId, color);
    return { ok: true, events: [{ type: "board_connection_recolored", textKey: "event.boardConnectionRecolored" }] };
  }

  /**
   * Current value (0-100) of one NPC's stat — same fallback rule as
   * `getPlayerStat`, but reading fixed content (`Npc.stats`) instead of
   * the mutable player slice; there is no NPC-stat mutation path at all
   * (NPC stats are content, not save-scoped state).
   */
  getNpcStat(npcId: NpcId, key: StatKey): number {
    const npc = this.state.npcs[npcId];
    if (npc === undefined) throw new Error(`getNpcStat: no NPC "${npcId}".`);
    return getStatValue(npc.stats, key);
  }

  /**
   * Player's stealth vs. the given location's visibility (defaults to
   * the player's current one) — a resolveDifficultyCheck, since
   * visibility never rolls; it isn't an actor. Pure query: no event, no
   * mutation. First real consumer of getPlayerStat and getVisibility
   * together — see docs/systems/checks.md. No NPC-notice check or
   * player-facing verb consumes this result yet.
   */
  getStealthConcealment(locationId?: LocationId): CheckResult {
    const stealth = this.getPlayerStat("stealth");
    const { value: visibility } = this.getVisibility(locationId);
    return resolveDifficultyCheck(stealth, visibility, this.rng);
  }

  /**
   * The `sneak` verb — flips Player.stealthMode. Turning it ON immediately
   * rolls concealment for the current location (see rerollConcealment), so
   * the player knows their status the instant they engage, not just after
   * their next move. Turning it OFF clears `concealment` entirely — there's
   * no exposure status to report when not trying to hide. Always succeeds.
   */
  toggleStealth(): ActionResult {
    this.state.player.stealthMode = !this.state.player.stealthMode;
    if (!this.state.player.stealthMode) {
      this.state.player.concealment = undefined;
      return { ok: true, events: [{ type: "stealth_mode_off", textKey: "event.stealthModeOff" }] };
    }
    return { ok: true, events: [{ type: "stealth_mode_on", textKey: "event.stealthModeOn" }, ...this.rerollConcealment()] };
  }

  /**
   * Re-rolls getStealthConcealment() for the CURRENT location and stores it
   * on Player.concealment, returning a status event. Called by
   * toggleStealth(true) and, from travelTo/executeHop, after every
   * successful arrival while already sneaking — see docs/systems/checks.md.
   * Not exported as its own verb; always a side effect of one of those two.
   * A failed roll does NOT turn stealthMode off — see Player.stealthMode's
   * doc comment.
   */
  private rerollConcealment(): GameEvent[] {
    const result = this.getStealthConcealment();
    this.state.player.concealment = result.outcome;
    return [
      {
        type: "concealment_updated",
        textKey: "event.concealmentUpdated",
        params: { concealmentKey: `concealment.tier.${result.outcome}` },
      },
    ];
  }

  /**
   * Resolves `query` to a destination and travels there — see
   * docs/systems/navigation.md for the two resolution paths:
   *  1. A compass word (north/south/...) matches a Connection's
   *     compassLabel on the CURRENT location — travels that exact connection.
   *  2. Anything else is matched against every location's name aliases
   *     across the whole map, then reached by the fewest-hops path
   *     (`findPath`) — the "go to the archive" case, which may cross
   *     several rooms. The player ends up at the destination in one step
   *     (the intermediate rooms are not visited or described).
   * Travel has no time, distance or cost.
   */
  travelTo(query: string): ActionResult {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return { ok: false, events: [{ type: "location_not_found", textKey: "event.locationNotFound", params: { query } }] };
    }

    const current = this.getCurrentLocation();

    if (DIRECTION_WORDS.includes(needle as Direction)) {
      const connection = current.connections.find((c) => c.compassLabel === needle);
      if (!connection) {
        return { ok: false, events: [{ type: "move_blocked", textKey: "event.moveBlocked", params: { direction: needle } }] };
      }
      return this.executeHop(current.id, connection);
    }

    const destination = this.findLocationByAlias(needle);
    if (!destination) {
      return { ok: false, events: [{ type: "location_not_found", textKey: "event.locationNotFound", params: { query } }] };
    }
    if (destination.id === current.id) {
      return { ok: true, events: [{ type: "already_there", textKey: "event.alreadyThere", params: { locationKey: destination.nameKey } }] };
    }

    const path = findPath(this.state, current.id, destination.id);
    if (!path) {
      return { ok: false, events: [{ type: "route_not_found", textKey: "event.routeNotFound", params: { locationKey: destination.nameKey } }] };
    }

    const firstVisit = !this.state.player.visitedLocationIds.includes(destination.id);
    this.observeDeparture(current.id);
    this.moveTo(destination.id);
    this.clearFocus(); // traveling is a "universal" action that breaks focus — see docs/systems/parts.md.
    syncNpcLocations(this.state);
    const events: GameEvent[] = [
      { type: "player_traveled", textKey: "event.playerTraveled", params: { locationKey: destination.nameKey } },
      ...this.describeLocation(this.getCurrentLocation(), { includeDescription: firstVisit }),
      ...(this.state.player.stealthMode ? this.rerollConcealment() : []),
    ];
    this.observeArrival(destination.id); // After the concealment re-roll above, so bystanders judge the NEW roll.
    return { ok: true, events };
  }

  /** Take by typed alias — may come back ambiguous, see `resolveWorldObjectQuery`. */
  takeItem(query: string): ActionResult;
  /** Take a specific, already-disambiguated object directly by id — the follow-up call a disambiguation menu selection makes; see docs/systems/parts.md's "Ambiguous targets." */
  takeItem(target: { id: WorldObjectId }): ActionResult;
  takeItem(target: string | { id: WorldObjectId }): ActionResult {
    const resolved = this.resolveWorldObjectQuery(target);
    if (resolved && "ambiguous" in resolved) return this.ambiguousWorldObjectResult(resolved.ambiguous);
    const worldObject = resolved;
    if (!worldObject) {
      return {
        ok: false,
        events: [{ type: "item_not_found", textKey: "event.itemNotFound", params: { query: typeof target === "string" ? target : target.id } }],
      };
    }
    if (!worldObject.portable) {
      return {
        ok: false,
        events: [{ type: "item_not_portable", textKey: "event.itemNotPortable", params: { itemKey: worldObject.nameKey } }],
      };
    }

    delete this.state.placement.worldObjectLocationId[worldObject.id];
    delete this.state.placement.containedIn[worldObject.id];
    this.state.player.inventory.push(worldObject.id);
    witnessObservation(this.state, {
      verb: "took",
      subject: { kind: "player" },
      object: { kind: "object", id: worldObject.id },
      locationId: this.state.player.locationId,
    });
    return {
      ok: true,
      events: [{ type: "item_taken", textKey: "event.itemTaken", params: { itemKey: worldObject.nameKey } }],
    };
  }

  /** Current balance in minor units — a read-only getter, not an action (no event needed to check a number). */
  getMoney(): number {
    return this.state.player.money;
  }

  /** Every LocationId the player has actually visited, in first-visit order — a read-only getter, mirroring getMoney. Used by the view to render a spoiler-safe "discovered only" locations panel; see moveTo and docs/systems/navigation.md. */
  getVisitedLocationIds(): readonly LocationId[] {
    return this.state.player.visitedLocationIds;
  }

  /** Credits the player's balance. Always succeeds — earning money has no failure mode today. */
  addMoney(amountMinor: number): ActionResult {
    this.state.player.money += amountMinor;
    return {
      ok: true,
      events: [{ type: "money_added", textKey: "event.moneyAdded", params: this.moneyEventParams("amount", amountMinor) }],
    };
  }

  /**
   * Debits the player's balance, refusing (without touching the balance)
   * if it would go negative — the check happens BEFORE any mutation, not
   * as a try-then-rollback. This is the dedicated charging primitive:
   * `buyNotebook` calls it, and it's general enough for any future
   * purchase (an item, a bribe, ...) to reuse the same way. See
   * docs/systems/economy.md.
   */
  spendMoney(amountMinor: number): ActionResult {
    if (amountMinor > this.state.player.money) {
      return {
        ok: false,
        events: [
          {
            type: "insufficient_funds",
            textKey: "event.insufficientFunds",
            params: {
              ...this.moneyEventParams("amount", amountMinor),
              ...this.moneyEventParams("balance", this.state.player.money),
            },
          },
        ],
      };
    }
    this.state.player.money -= amountMinor;
    return {
      ok: true,
      events: [{ type: "money_spent", textKey: "event.moneySpent", params: this.moneyEventParams("amount", amountMinor) }],
    };
  }

  /**
   * Buys the NotebookProduct named by `query` (alias-matched, like
   * `takeItem`/`talkTo`) if the player can afford it. Creates a brand-new, unnamed
   * `Notebook` (see `Notebook.name`'s doc comment — free player text, not
   * set here) with `product.pageCount` blank pages, each carrying the
   * product's `charCapacity`. Does NOT make it the active
   * notebook — see `setActiveNotebook`. See docs/systems/notebooks.md's
   * "Economy integration" decision.
   */
  buyNotebook(target: { id: string }): ActionResult;
  buyNotebook(query: string): ActionResult;
  buyNotebook(target: string | { id: string }): ActionResult {
    const product = typeof target === "string" ? this.findNotebookProductByAlias(target) : this.state.notebookProducts[target.id];
    if (!product) {
      return {
        ok: false,
        events: [
          {
            type: "notebook_product_not_found",
            textKey: "event.notebookProductNotFound",
            params: { query: typeof target === "string" ? target : target.id },
          },
        ],
      };
    }

    const charge = this.spendMoney(product.priceMinor);
    if (!charge.ok) return charge;

    const notebook: Notebook = {
      id: generateNotebookId("notebook"),
      name: "",
      pages: Array.from({ length: product.pageCount }, () => ({
        charCapacity: product.charCapacity,
        blocks: [],
      })),
    };
    this.state.notebooks.notebooks.push(notebook);

    return {
      ok: true,
      events: [...charge.events, { type: "notebook_purchased", textKey: "event.notebookPurchased", params: { productKey: product.nameKey } }],
    };
  }

  /** Every notebook the player owns — a read-only getter, mirroring getMoney. */
  getNotebooks(): readonly Notebook[] {
    return this.state.notebooks.notebooks;
  }

  /** The currently-active notebook's id, or null if none — see docs/systems/notebooks.md. */
  getActiveNotebookId(): string | null {
    return this.state.notebooks.activeNotebookId;
  }

  /** Sets `name` (free player-authored text — see `Notebook.name`'s doc comment) on notebook `id`. Fails if no such notebook exists. */
  renameNotebook(id: string, name: string): ActionResult {
    const notebook = this.findNotebook(id);
    if (!notebook) return this.notebookNotFoundResult(id);
    notebook.name = name;
    return { ok: true, events: [{ type: "notebook_renamed", textKey: "event.notebookRenamed", params: { name } }] };
  }

  /**
   * Marks notebook `id` as the active one — the one `jotDown` writes to
   * without prompting. Fails if no such notebook exists. Only one notebook
   * can be active at a time; setting a new one implicitly replaces
   * whichever was active before.
   */
  setActiveNotebook(id: string): ActionResult {
    const notebook = this.findNotebook(id);
    if (!notebook) return this.notebookNotFoundResult(id);
    this.state.notebooks.activeNotebookId = id;
    return { ok: true, events: [{ type: "active_notebook_set", textKey: "event.activeNotebookSet", params: { name: notebook.name } }] };
  }

  /** Clears the active-notebook flag back to null — the next `jotDown` prompts again, same as if no notebook had ever been made active. Always succeeds, even if nothing was active. See docs/systems/notebooks.md's "Notebook disposal" — the confirmation step itself is a view/command concern. */
  clearActiveNotebook(): ActionResult {
    this.state.notebooks.activeNotebookId = null;
    return { ok: true, events: [{ type: "active_notebook_cleared", textKey: "event.activeNotebookCleared" }] };
  }

  /**
   * Removes notebook `id` entirely. If it was the active notebook,
   * `activeNotebookId` clears to `null` — no automatic fallback to another
   * notebook. The confirmation step ("really get rid of it?") is a view/
   * command concern; by the time this is called, the player has already
   * confirmed. See docs/systems/notebooks.md's "Notebook disposal."
   */
  disposeNotebook(id: string): ActionResult {
    const notebook = this.findNotebook(id);
    if (!notebook) return this.notebookNotFoundResult(id);
    this.state.notebooks.notebooks = this.state.notebooks.notebooks.filter((n) => n.id !== id);
    if (this.state.notebooks.activeNotebookId === id) this.state.notebooks.activeNotebookId = null;
    return { ok: true, events: [{ type: "notebook_disposed", textKey: "event.notebookDisposed", params: { name: notebook.name } }] };
  }

  /**
   * Always creates a NEW block (never appends to an existing one), stamped
   * with the current time/location, containing `text` as its initial span
   * — see docs/systems/notebooks.md's `jotDown` section. Resolving WHICH
   * notebook to jot into (the active one, or prompting when none is set)
   * is entirely a command-handler concern; this call always takes an
   * explicit `notebookId`. Lands on the first page with room (a FLAT
   * character budget per page, see `Page.charCapacity`'s doc comment —
   * no separate per-entry cap); if the block doesn't fit on ANY page,
   * fails with "notebook full" and writes nothing. If `text` is longer
   * than a page's ENTIRE capacity (would never fit even on a totally
   * empty page), that's reported as a distinct "note too long" failure
   * instead — the fix there is "write a shorter note," not "find room."
   */
  jotNote(notebookId: string, text: string, sourceRef?: string): ActionResult {
    const notebook = this.findNotebook(notebookId);
    if (!notebook) return this.notebookNotFoundResult(notebookId);

    const page = notebook.pages.find((p) => text.length <= charsRemaining(p));
    if (!page) {
      const pageCapacity = notebook.pages[0]?.charCapacity ?? 0;
      if (text.length > pageCapacity) {
        return {
          ok: false,
          events: [{ type: "note_too_long", textKey: "event.noteTooLong", params: { name: notebook.name, maxChars: String(pageCapacity) } }],
        };
      }
      return { ok: false, events: [{ type: "notebook_full", textKey: "event.notebookFull", params: { name: notebook.name } }] };
    }

    const block: NoteBlock = {
      id: generateNotebookId("block"),
      timestamp: toNoteTimestamp(this.getCalendarDate()),
      locationId: this.state.player.locationId,
      spans: [{ id: generateNotebookId("span"), text, struck: false }],
      ...(sourceRef !== undefined ? { sourceRef } : {}),
    };
    page.blocks.push(block);
    return { ok: true, events: [{ type: "note_jotted", textKey: "event.noteJotted", params: { name: notebook.name } }] };
  }

  /**
   * Commits an edit to an existing block, per docs/systems/notebooks.md's
   * editing model: diffs `newText` against the block's current active text
   * (`commitBlockEdit`) — unchanged runs stay active, removed runs are
   * struck and stamped with the current time/location, inserted runs
   * become new active spans. Fails without mutating if the edit would push
   * the page over its FLAT `charCapacity` — live typing is expected to
   * have already hard-stopped before this is ever called (v1, see
   * docs/systems/notebooks.md's "Page overflow" decision), but this is
   * still checked here rather than trusted blindly.
   */
  amendNote(notebookId: string, blockId: string, newText: string): ActionResult {
    const notebook = this.findNotebook(notebookId);
    if (!notebook) return this.notebookNotFoundResult(notebookId);

    for (const page of notebook.pages) {
      const block = page.blocks.find((b) => b.id === blockId);
      if (!block) continue;

      const otherBlocksChars = charsUsed(page) - blockActiveTextLength(block);
      if (newText.length > page.charCapacity - otherBlocksChars) {
        const type = newText.length > page.charCapacity ? "note_too_long" : "notebook_page_full";
        const textKey = newText.length > page.charCapacity ? "event.noteTooLong" : "event.notebookPageFull";
        return { ok: false, events: [{ type, textKey, params: { name: notebook.name, maxChars: String(page.charCapacity) } }] };
      }

      block.spans = commitBlockEdit(block.spans, newText, {
        timestamp: toNoteTimestamp(this.getCalendarDate()),
        locationId: this.state.player.locationId,
      });
      return { ok: true, events: [{ type: "note_amended", textKey: "event.noteAmended", params: { name: notebook.name } }] };
    }

    return { ok: false, events: [{ type: "note_block_not_found", textKey: "event.noteBlockNotFound", params: { notebookId: notebook.name } }] };
  }

  private findNotebook(id: string): Notebook | undefined {
    return this.state.notebooks.notebooks.find((n) => n.id === id);
  }

  private notebookNotFoundResult(id: string): ActionResult {
    return { ok: false, events: [{ type: "notebook_not_found", textKey: "event.notebookNotFound", params: { query: id } }] };
  }

  private findNotebookProductByAlias(query: string): NotebookProduct | undefined {
    const needle = query.trim().toLowerCase();
    return Object.values(this.state.notebookProducts).find((product) => product.aliases.includes(needle));
  }

  listInventory(): ActionResult {
    const itemKeys = this.state.player.inventory.map((id) => this.state.worldObjects[id]?.nameKey ?? id);
    return {
      ok: true,
      events: [
        {
          type: "inventory_listed",
          textKey: itemKeys.length > 0 ? "event.inventoryListed" : "event.inventoryEmpty",
          params: { items: itemKeys.join(", ") },
        },
      ],
    };
  }

  /** Shared gate check for `dialogueRules`, topic availability, and topic `responses` — see docs/systems/dialogue.md. */
  private gateHolds(npcId: NpcId, gate: { requires: string[]; when?: Condition }): boolean {
    return gate.requires.every((flag) => this.state.flags[flag] === true) && (gate.when === undefined || evaluateCondition(this.state, npcId, gate.when));
  }

  /** Topics currently OFFERED (gate holds) for this NPC — empty for an NPC with no `topics` authored, or none currently unlocked. */
  private topicsForNpc(npc: Npc): DialogueTopic[] {
    return (npc.topics ?? []).filter((topic) => this.gateHolds(npc.id, topic));
  }

  /**
   * Public by-id counterpart to `listTopics`'s alias resolution — lets a
   * view already holding a resolved `NpcId` (e.g. rebuilding the topic
   * menu after `askAbout`, when availability may have changed) re-query
   * without re-running alias matching on a query string. Empty for an NPC
   * with no `topics` authored, or none currently unlocked.
   */
  topicsForNpcId(npcId: NpcId): { id: TopicId; labelKey: string }[] {
    const npc = this.state.npcs[npcId];
    if (!npc) return [];
    return this.topicsForNpc(npc).map((topic) => ({ id: topic.id, labelKey: topic.labelKey }));
  }

  talkTo(query: string): ActionResult {
    const location = this.getCurrentLocation();
    const npc = this.findNpcByAlias(npcsAtLocation(this.state.placement, location.id), query);
    if (!npc) {
      return {
        ok: false,
        events: [{ type: "npc_not_found", textKey: "event.npcNotFound", params: { query } }],
      };
    }

    // Matched against flags as they stood BEFORE this conversation's own
    // talkedTo write below, so "have I talked to them before" means prior
    // conversations only — see docs/systems/dialogue.md.
    const matchedRule = npc.dialogueRules.find((rule) => this.gateHolds(npc.id, rule));
    const textKey = matchedRule?.textKey ?? npc.dialogueKey;

    this.clearFocus(); // talking is one of the "universal" actions that breaks focus — see docs/systems/parts.md.
    this.state.flags[`talkedTo.${npc.id}`] = true;
    if (matchedRule?.effects) applyDialogueEffects(this.state, npc.id, matchedRule.effects);
    // Recorded AFTER rule selection, same as the talkedTo flag, so a `memory`
    // condition means "before this conversation". The NPC spoken to is a
    // participant: they remember it even if the player is sneaking.
    witnessObservation(
      this.state,
      { verb: "spoke-to", subject: { kind: "player" }, object: { kind: "npc", id: npc.id }, locationId: location.id },
      { participants: [npc.id] },
    );
    return {
      ok: true,
      events: [
        {
          type: "npc_talked",
          textKey,
          params: { npcKey: npc.nameKey },
        },
      ],
    };
  }

  /**
   * Which topics are currently offered for an NPC in scope, for the view to
   * decide whether `talk` should open a topic menu — see
   * docs/systems/dialogue.md's "Topic menus" section. An empty `topics`
   * array covers BOTH "none authored" and "authored but none currently
   * unlocked"; the view treats both the same (fall back to plain `talk`).
   */
  listTopics(
    query: string,
  ):
    | { ok: true; npcId: NpcId; nameKey: string; dialogueKey: string; topics: { id: TopicId; labelKey: string }[] }
    | { ok: false; events: GameEvent[] } {
    const location = this.getCurrentLocation();
    const npc = this.findNpcByAlias(npcsAtLocation(this.state.placement, location.id), query);
    if (!npc) {
      return { ok: false, events: [{ type: "npc_not_found", textKey: "event.npcNotFound", params: { query } }] };
    }
    return { ok: true, npcId: npc.id, nameKey: npc.nameKey, dialogueKey: npc.dialogueKey, topics: this.topicsForNpcId(npc.id) };
  }

  /**
   * Asks a specific topic — the view only ever passes a `topicId` that
   * `listTopics` just returned, so the topic is content-guaranteed to
   * exist and be currently offered. Mirrors `talkTo`'s effect/flag/witness
   * sequence exactly, one level deeper (topic `responses` instead of
   * `npc.dialogueRules`) — see docs/systems/dialogue.md.
   */
  askAbout(npcId: NpcId, topicId: TopicId): ActionResult {
    const npc = this.state.npcs[npcId];
    const location = this.getCurrentLocation();
    const topic = npc?.topics?.find((t) => t.id === topicId);
    if (!npc || !topic) {
      return { ok: false, events: [{ type: "npc_not_found", textKey: "event.npcNotFound", params: { query: topicId } }] };
    }

    const matchedRule = topic.responses.find((rule) => this.gateHolds(npc.id, rule));
    const textKey = matchedRule?.textKey ?? topic.textKey;

    this.state.flags[`talkedTo.${npc.id}`] = true;
    if (matchedRule?.effects) applyDialogueEffects(this.state, npc.id, matchedRule.effects);
    witnessObservation(
      this.state,
      { verb: "spoke-to", subject: { kind: "player" }, object: { kind: "npc", id: npc.id }, locationId: location.id },
      { participants: [npc.id] },
    );
    return { ok: true, events: [{ type: "npc_talked", textKey, params: { npcKey: npc.nameKey } }] };
  }

  /** Examine by typed alias — may come back ambiguous, see `resolveWorldObjectQuery`. */
  examine(query: string): ActionResult;
  /** Examine a specific, already-disambiguated object directly by id — the follow-up call a disambiguation menu selection makes; see docs/systems/parts.md's "Ambiguous targets." */
  examine(target: { id: WorldObjectId }): ActionResult;
  /**
   * Resolves `target` to a world object, an NPC, or (new) a `Part` of some
   * world object in scope — see docs/systems/parts.md for the full
   * focus/importance resolution tiers `resolvePart` implements. Finding an
   * object with `parts` FOCUSES it (`focusedWorldObjectId`); finding a
   * plain object, an NPC, or nothing at all clears focus (a part match
   * keeps/sets focus on its parent, since the player is now looking right
   * at it). NPC and part lookups only apply to a typed alias — an id
   * always names a specific world object, so there's nothing left to fall
   * back to if it isn't (or is no longer) in scope.
   */
  examine(target: string | { id: WorldObjectId }): ActionResult {
    const location = this.getCurrentLocation();
    const resolved = this.resolveWorldObjectQuery(target);
    if (resolved && "ambiguous" in resolved) return this.ambiguousWorldObjectResult(resolved.ambiguous);
    const worldObject = resolved;
    if (worldObject) {
      const events: GameEvent[] = [{ type: "item_examined", textKey: worldObject.descriptionKey }];
      this.state.examinedTarget = { kind: "worldObject", id: worldObject.id };
      if (worldObject.parts?.length) {
        this.state.focusedWorldObjectId = worldObject.id;
        for (const part of worldObject.parts) {
          const state = this.currentPartState(worldObject, part);
          if (state.important) events.push({ type: "part_state_noted", textKey: state.summaryKey ?? state.descriptionKey });
        }
      } else {
        this.state.focusedWorldObjectId = null;
      }
      return { ok: true, events };
    }

    if (typeof target !== "string") {
      return { ok: false, events: [{ type: "item_not_found", textKey: "event.itemNotFound", params: { query: target.id } }] };
    }

    const npc = this.findNpcByAlias(npcsAtLocation(this.state.placement, location.id), target);
    if (npc) {
      this.clearFocus();
      this.state.examinedTarget = { kind: "npc", id: npc.id };
      return { ok: true, events: [{ type: "npc_examined", textKey: npc.descriptionKey }] };
    }

    const match = this.resolvePart(target);
    if (match === "unreachable") {
      return { ok: false, events: [{ type: "part_not_focused", textKey: "event.partNotFocused" }] };
    }
    if (match) {
      const { item: parent, part } = match;
      this.state.focusedWorldObjectId = parent.id;
      this.state.examinedTarget = { kind: "worldObject", id: parent.id };
      const state = this.currentPartState(parent, part);
      return {
        ok: true,
        events: [
          { type: "part_examined", textKey: part.descriptionKey },
          { type: "part_state_noted", textKey: state.descriptionKey },
        ],
      };
    }

    return {
      ok: false,
      events: [{ type: "examine_not_found", textKey: "event.examineNotFound", params: { query: target } }],
    };
  }

  /**
   * Attempts to transition a `Part` (of some item in scope) into whichever
   * of its states has `verb` in its `enterAliases` — the engine side of
   * `open`/`close`/etc. `query` is resolved via the same focus/importance
   * tiers as `examine`'s part fallback — see `resolvePart` and
   * docs/systems/parts.md. A successful transition sets focus on the
   * part's parent item, so a follow-up interaction doesn't need to
   * re-examine it.
   */
  interact(verb: string, query: string): ActionResult {
    const match = this.resolvePart(query);
    if (match === "unreachable") {
      return { ok: false, events: [{ type: "part_not_focused", textKey: "event.partNotFocused" }] };
    }
    if (!match) {
      return { ok: false, events: [{ type: "item_not_found", textKey: "event.itemNotFound", params: { query } }] };
    }

    const { item, part } = match;
    const target = part.states.find((s) => s.enterAliases?.includes(verb));
    if (!target) {
      return {
        ok: false,
        events: [{ type: "part_verb_not_applicable", textKey: "event.partVerbNotApplicable", params: { verb, partKey: part.nameKey } }],
      };
    }

    if (target.id === this.currentPartStateId(item, part)) {
      return {
        ok: true,
        events: [{ type: "part_already_in_state", textKey: "event.partAlreadyInState", params: { stateKey: target.nameKey } }],
      };
    }

    (this.state.partStates[item.id] ??= {})[part.id] = target.id;
    this.state.focusedWorldObjectId = item.id;
    this.state.examinedTarget = { kind: "worldObject", id: item.id };
    return { ok: true, events: [{ type: "part_state_noted", textKey: target.descriptionKey }] };
  }

  /** The `back`/`stop` command — explicitly clears focus, reporting what (if anything) was focused. See docs/systems/parts.md. */
  unfocus(): ActionResult {
    const focused = this.getFocusedWorldObject();
    this.clearFocus();
    if (!focused) {
      return { ok: true, events: [{ type: "nothing_focused", textKey: "event.nothingFocused" }] };
    }
    return { ok: true, events: [{ type: "focus_cleared", textKey: "event.focusCleared", params: { itemKey: focused.nameKey } }] };
  }

  /** Event-less focus break, for callers where losing focus is a side effect of something else (a successful travel, talking to an NPC, or the view opening the travel menu) rather than the point of the action — see docs/systems/parts.md. */
  clearFocus(): void {
    this.state.focusedWorldObjectId = null;
    this.state.examinedTarget = null;
  }

  /**
   * The image the scene pane should show right now (see
   * docs/systems/image-pane.md), as a pure function of state so it needs no
   * events and is testable headless. While the player is examining
   * something, that thing's image wins: for an object, the image of the
   * LAST part (authored order) whose CURRENT state has one, else the
   * object's own `image`; for an NPC, its `image`. A thing with no image
   * falls through to the location's, so the pane never blanks mid-scene.
   */
  getSceneImage(): SceneImage | undefined {
    const target = this.state.examinedTarget;
    if (target?.kind === "npc") {
      const image = this.state.npcs[target.id]?.image;
      if (image) return image;
    } else if (target) {
      const object = this.state.worldObjects[target.id];
      if (object) {
        for (const part of [...(object.parts ?? [])].reverse()) {
          const image = this.currentPartState(object, part).image;
          if (image) return image;
        }
        if (object.image) return object.image;
      }
    }
    return this.getCurrentLocation().image;
  }

  /** The currently-focused world object, if any — a read-only getter, mirroring getMoney, for the view's "You are examining the X" status reminder. */
  getFocusedWorldObject(): WorldObject | undefined {
    return this.state.focusedWorldObjectId ? this.state.worldObjects[this.state.focusedWorldObjectId] : undefined;
  }

  /** Executes a single, explicitly-chosen connection (the compass fast path) and moves the player exactly one hop. */
  private executeHop(fromId: string, connection: Connection): ActionResult {
    const destination = this.state.locations[connection.toId];
    if (!destination) {
      throw new Error(`Connection from "${fromId}" points to unknown location "${connection.toId}"`);
    }

    const firstVisit = !this.state.player.visitedLocationIds.includes(destination.id);
    this.observeDeparture(fromId);
    this.moveTo(destination.id);
    this.clearFocus(); // traveling is a "universal" action that breaks focus — see docs/systems/parts.md.
    syncNpcLocations(this.state);
    const events: GameEvent[] = [
      { type: "player_moved", textKey: "event.playerMoved", params: { direction: connection.compassLabel ?? "" } },
      ...this.describeLocation(this.getCurrentLocation(), { includeDescription: firstVisit }),
      ...(this.state.player.stealthMode ? this.rerollConcealment() : []),
    ];
    this.observeArrival(destination.id);
    return { ok: true, events };
  }

  /**
   * Sets `clock.minutesElapsed` outright — the ONLY way the clock moves; the
   * caller owns real time. Takes plain minutes since the clock's epoch so the
   * engine never touches `Date` itself — converting wall-clock time into that
   * number is the view layer's job. Also re-syncs scheduled NPCs to where
   * their routine says they are at the new time (see docs/systems/npcs.md's
   * "Schedules"). There is no per-tick loop: sync happens when time is set
   * and when the player moves.
   */
  syncClock(minutesElapsed: number): void {
    this.state.clock.minutesElapsed = minutesElapsed;
    syncNpcLocations(this.state);
  }

  /** Witness step for the player leaving `locationId` — call BEFORE `moveTo`. See docs/systems/npcs.md. */
  private observeDeparture(locationId: LocationId): void {
    witnessObservation(this.state, { verb: "left", subject: { kind: "player" }, locationId });
  }

  /** Witness step for the player arriving at `locationId` — call AFTER the clock advance (NPCs may have just moved) and any concealment re-roll. */
  private observeArrival(locationId: LocationId): void {
    witnessObservation(this.state, { verb: "entered", subject: { kind: "player" }, locationId });
  }

  /** The single choke point for changing `Player.locationId` — both `travelTo` (named-destination branch) and `executeHop` (compass branch, also used by `travelToConnection`) go through this, so `visitedLocationIds` can never be forgotten at one call site and remembered at another. */
  private moveTo(locationId: LocationId): void {
    this.state.player.locationId = locationId;
    if (!this.state.player.visitedLocationIds.includes(locationId)) {
      this.state.player.visitedLocationIds.push(locationId);
    }
  }

  /**
   * Builds the event sequence for arriving at or re-examining `location`,
   * in a fixed order: the full prose description (only when
   * `includeDescription` — first-ever visit on arrival, or always for an
   * explicit `look`, per docs/systems/navigation.md), immediately followed
   * by a visibility line (see `getVisibility`/docs/systems/visibility.md) —
   * gated the same way, since re-stating "it's dim here" on every ordinary
   * revisit would be noise — then a setpieces-present line, an
   * items-present line, and an NPCs-present line — each omitted entirely
   * when empty rather than printed as
   * "nothing here" filler. A slot for NPC entry reactions belongs after
   * these once that system exists (see docs/systems); no such system
   * exists yet, so nothing is emitted for it today.
   *
   * Setpieces (`WorldObject.kind === "setpiece"` — furniture/landmarks,
   * conventionally non-portable) are grouped with the description rather
   * than the items line, and are gated the same way: shown in full when
   * `includeDescription` is true, otherwise only the subset with
   * `announceOnRevisit` set (a scene piece whose state can change in a
   * way worth noticing immediately). Items (`kind === "item"`, small
   * portable clutter) are always announced on every arrival regardless.
   *
   * Directly-placed objects only — a revealed CONTAINED object (see
   * docs/systems/parts.md's "Containment") joins these same lines ONE HOP
   * deep, and only when the part that exposed it also has
   * `revealInAmbientListing: true`; otherwise it's discoverable only by
   * examining/interacting with its container, not blasted into the
   * ambient description the moment it becomes reachable.
   */
  private describeLocation(location: Location, options: { includeDescription: boolean }): GameEvent[] {
    const events: GameEvent[] = [];
    if (options.includeDescription) {
      events.push({
        type: "location_described",
        textKey: location.descriptionKey,
        params: { locationNameKey: location.nameKey },
      });
      const { tier } = this.getVisibility(location.id);
      events.push({
        type: "location_visibility",
        textKey: "event.locationVisibility",
        params: { tierKey: `visibility.tier.${tier}` },
      });
    }

    const directObjects = worldObjectsAtLocation(this.state.placement, location.id)
      .map((id) => this.state.worldObjects[id])
      .filter((obj) => obj !== undefined);

    // Revealed contained children (see the doc comment above) are pulled
    // in unconditionally once their exposing part opts them into ambient
    // listing — `announceOnRevisit` below is a DIFFERENT gate, specific to
    // directly-placed objects deciding whether THEY reappear on a plain
    // revisit, and doesn't apply to a child revealed this way.
    const revealedChildren = directObjects.flatMap((obj) =>
      (obj.parts ?? []).flatMap((part) => {
        const state = this.currentPartState(obj, part);
        if (!state.exposesContents || !state.revealInAmbientListing) return [];
        return containedWorldObjectsIn(this.state.placement, obj.id, part.id)
          .map((id) => this.state.worldObjects[id])
          .filter((child) => child !== undefined);
      }),
    );

    const setpieceNames = [
      ...directObjects.filter((obj) => obj.kind === "setpiece" && (options.includeDescription || obj.announceOnRevisit)),
      ...revealedChildren.filter((obj) => obj.kind === "setpiece"),
    ].map((obj) => obj.nameKey);
    if (setpieceNames.length > 0) {
      events.push({ type: "setpieces_present", textKey: "event.setpiecesPresent", params: { objects: setpieceNames.join(", ") } });
    }

    const itemNames = [...directObjects, ...revealedChildren].filter((obj) => obj.kind === "item").map((obj) => obj.nameKey);
    if (itemNames.length > 0) {
      events.push({ type: "items_present", textKey: "event.itemsPresent", params: { items: itemNames.join(", ") } });
    }

    const npcNames = npcsAtLocation(this.state.placement, location.id).map((id) => this.state.npcs[id]?.nameKey ?? id);
    if (npcNames.length > 0) {
      events.push({ type: "npcs_present", textKey: "event.npcsPresent", params: { npcs: npcNames.join(", ") } });
    }

    return events;
  }

  /** The current absolute calendar date/time as event params — see `calendarDisplayParams`'s doc comment for the `{day, monthKey, year, weekdayKey, hour, minute}` shape and why it's safe for the engine to build despite never producing display strings itself. */
  private describeTime(textKey: string): GameEvent {
    return { type: "time_checked", textKey, params: calendarDisplayParams(this.getCalendarDate()) };
  }

  /** Splits a minor-unit amount into `{prefix}Sign`/`{prefix}Major`/`{prefix}Minor` event params (e.g. "amountSign"/"amountMajor"/"amountMinor"), letting one event carry both an amount and a balance without key collisions. */
  private moneyEventParams(prefix: string, amountMinor: number): Record<string, string> {
    const { sign, major, minor } = formatMoneyParts(amountMinor);
    return { [`${prefix}Sign`]: sign, [`${prefix}Major`]: major, [`${prefix}Minor`]: minor };
  }

  private findLocationByAlias(needle: string): Location | undefined {
    return Object.values(this.state.locations).find((location) => location.aliases.includes(needle));
  }

  /**
   * The shared alias/id resolution behind `examine`/`takeItem` (and any
   * future verb that targets a bare `WorldObject` in scope). A string
   * target does exact alias matching within `worldObjectIdsInScope()`; an
   * `{ id }` target (the follow-up call a disambiguation menu selection
   * makes) looks up that id directly, still gated on being in scope, so a
   * stale id from a since-changed state can't reach through. Returns
   * `{ ambiguous }` — never a single "first match wins" guess — when a
   * string target matches more than one object, since silently picking
   * one is exactly the bug this exists to avoid (e.g. an inventory item
   * sharing a name with something at the current location). See
   * docs/systems/parts.md's "Ambiguous targets."
   */
  private resolveWorldObjectQuery(target: string | { id: WorldObjectId }): WorldObject | { ambiguous: WorldObject[] } | undefined {
    const scope = this.worldObjectIdsInScope();
    if (typeof target !== "string") {
      return scope.includes(target.id) ? this.state.worldObjects[target.id] : undefined;
    }
    const needle = target.trim().toLowerCase();
    const matches = scope.map((id) => this.state.worldObjects[id]).filter((obj): obj is WorldObject => !!obj && obj.aliases.includes(needle));
    if (matches.length === 0) return undefined;
    if (matches.length === 1) return matches[0];
    return { ambiguous: matches };
  }

  /** Builds the "which one do you mean?" result for a `resolveWorldObjectQuery` ambiguous match — one `ResolutionChoice` per candidate, labeled with its parent so otherwise-identical options read distinctly (e.g. "letter (desk)" vs "letter (carried)"). See docs/systems/parts.md's "Ambiguous targets." */
  private ambiguousWorldObjectResult(candidates: WorldObject[]): ActionResult {
    const choices: ResolutionChoice[] = candidates.map((obj) => ({
      id: obj.id,
      kind: "resolution",
      textKey: "ui.disambiguationOption",
      params: { itemKey: obj.nameKey, locationKey: this.worldObjectLocationLabel(obj.id) },
    }));
    return { ok: true, events: [{ type: "target_ambiguous", textKey: "event.targetAmbiguous" }], choices };
  }

  /** The parent to show next to an ambiguous candidate's name — its container's own nameKey if it's `containedIn` one, the fixed "carried" label if it's in inventory, otherwise the current location's nameKey. */
  private worldObjectLocationLabel(id: WorldObjectId): string {
    const contained = this.state.placement.containedIn[id];
    if (contained) return this.state.worldObjects[contained.containerId]!.nameKey;
    if (this.state.player.inventory.includes(id)) return "ui.inventoryLabel";
    return this.getCurrentLocation().nameKey;
  }

  private findNpcByAlias(npcIds: string[], query: string): Npc | undefined {
    const needle = query.trim().toLowerCase();
    return npcIds
      .map((id) => this.state.npcs[id])
      .find((npc): npc is Npc => !!npc && npc.aliases.includes(needle));
  }

  /**
   * Every world object id currently reachable for examine/interact/take:
   * at the current location or carried in inventory, PLUS (transitively)
   * anything `containedIn` one of those objects through a part whose
   * current state has `exposesContents: true` — see docs/systems/parts.md's
   * "Containment." A `Set`-backed fixpoint expansion, so a cycle (which
   * `cityLoader.ts` already rejects at content-load time) can't loop here
   * either.
   */
  private worldObjectIdsInScope(): string[] {
    const seen = new Set<string>([
      ...worldObjectsAtLocation(this.state.placement, this.getCurrentLocation().id),
      ...this.state.player.inventory,
    ]);
    const queue = [...seen];
    for (let i = 0; i < queue.length; i++) {
      const obj = this.state.worldObjects[queue[i]!];
      for (const part of obj?.parts ?? []) {
        if (!this.currentPartState(obj!, part).exposesContents) continue;
        for (const childId of containedWorldObjectsIn(this.state.placement, obj!.id, part.id)) {
          if (!seen.has(childId)) {
            seen.add(childId);
            queue.push(childId);
          }
        }
      }
    }
    return queue;
  }

  /** `part`'s current state id — falls back to its `defaultStateId` when `GameState.partStates` has no entry yet (a part added to content after a save was made, or simply never interacted with). See docs/systems/parts.md. */
  private currentPartStateId(worldObject: WorldObject, part: Part): string {
    return this.state.partStates[worldObject.id]?.[part.id] ?? part.defaultStateId;
  }

  /** `part`'s current `PartState` definition — see `currentPartStateId`. Falls back to the part's default state if a stored state id doesn't (or no longer) match any of `part.states` — defensive, shouldn't happen against validated content. */
  private currentPartState(worldObject: WorldObject, part: Part): PartState {
    const stateId = this.currentPartStateId(worldObject, part);
    return part.states.find((s) => s.id === stateId) ?? part.states.find((s) => s.id === part.defaultStateId)!;
  }

  /**
   * Resolves `query` to a `Part` of some world object in scope, following
   * docs/systems/parts.md's focus/importance tiers:
   *  1. If an object is focused (and still in scope), search only ITS
   *     parts — this is what makes "open drawer" unambiguous once you've
   *     examined the desk, even if another desk elsewhere has an
   *     identically-aliased drawer.
   *  2. Otherwise, search only parts CURRENTLY in an `important` state,
   *     across every object in scope — the "already surfaced, so
   *     immediately actionable" exception.
   *  3. If `query` matches a part somewhere in scope that neither tier
   *     reached, returns the literal string `"unreachable"` — a distinct
   *     signal from "not found at all," so callers can say "you'd need to
   *     take a closer look first" instead of a flat not-found.
   * Returns `undefined` when `query` matches no part anywhere in scope.
   */
  private resolvePart(query: string): { item: WorldObject; part: Part } | "unreachable" | undefined {
    const needle = query.trim().toLowerCase();
    const itemsWithParts = this.worldObjectIdsInScope()
      .map((id) => this.state.worldObjects[id])
      .filter((item): item is WorldObject => !!item?.parts?.length);

    const focusedId = this.state.focusedWorldObjectId;
    if (focusedId) {
      const focused = itemsWithParts.find((item) => item.id === focusedId);
      const part = focused?.parts?.find((p) => p.aliases.includes(needle));
      if (focused && part) return { item: focused, part };
    }

    for (const item of itemsWithParts) {
      for (const part of item.parts ?? []) {
        if (part.aliases.includes(needle) && this.currentPartState(item, part).important) {
          return { item, part };
        }
      }
    }

    for (const item of itemsWithParts) {
      if (item.parts?.some((p) => p.aliases.includes(needle))) return "unreachable";
    }

    return undefined;
  }
}

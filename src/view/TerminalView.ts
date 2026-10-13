import { DEFAULT_IMAGE_DITHER_STEPS, DEFAULT_IMAGE_FADE_DURATION_MS, renderImagePane } from "./imagePane";
import { loadCityContent } from "../content/world";
import { defaultNodePosition } from "../engine/board/board";
import type { GameEngine } from "../engine/GameEngine";
import { blockActiveText, blockActiveTextLength, charsRemaining, charsUsed } from "../engine/notebooks";
import type { Command, PanelContentId, PanelSlot } from "../engine/parsing/Command";
import type { ICommandParser } from "../engine/parsing/ICommandParser";
import { buildStateFromSave, serializeState } from "../engine/save/save";
import type { ActionResult, BoardNode, BoardStringColor, GameEvent, Notebook, NoteBlock, Page, ResolutionChoice, WorldObjectId } from "../engine/types";
import { formatCalendarDate } from "../i18n/calendarFormat";
import { t } from "../i18n/resolver";
import type { MapNode } from "../mapview/MapView";
import { MapView } from "../mapview/MapView";
import { buildConnectionEdges } from "../mapview/connectionEdges";
import type { AddNodeCategory, AddNodeMenuState, BoardViewState } from "./boardView";
import { renderAddNodeMenu, renderBoard } from "./boardView";
import { buildBuyMenuScreen, buyByQuery } from "./menu/buyMenu";
import type { MenuOutcome, MenuScreen } from "./menu/MenuFlow";
import { MenuFlow } from "./menu/MenuFlow";
import { buildDisambiguationScreen } from "./menu/disambiguationMenus";
import { buildJotDownPickerScreen, openNotebookCommand } from "./menu/notebookMenus";
import { buildTopicsScreen } from "./menu/npcMenus";
import { buildPanelMenuScreen } from "./menu/panelMenus";
import { buildDirectConnectionsScreen } from "./menu/travelMenus";
import { loadFromStorage, saveToStorage } from "./save/browserSaveStore";
import { minutesSinceEpoch } from "./wallClock";

/**
 * Which `Command.kind`s can produce a `ResolutionChoice`-bearing ambiguous
 * result (see `GameEngine.resolveWorldObjectQuery`), and how to re-issue
 * that exact verb once the player picks one — via its id-based overload,
 * never by re-running alias matching on the option's label. Extend this
 * table (not `handleSubmit`) when a new verb starts resolving a
 * `WorldObject` through the same scope/alias lookup. See
 * docs/systems/parts.md's "Ambiguous targets."
 */
const WORLD_OBJECT_RESOLVERS: Partial<Record<Command["kind"], (engine: GameEngine, id: WorldObjectId) => ActionResult>> = {
  take: (engine, id) => engine.takeItem({ id }),
  examine: (engine, id) => engine.examine({ id }),
};

/** Locale key for each log-expansion mode's toggle-button label — see `applyLogExpansion`. */
const LOG_MODE_LABEL_KEY = {
  auto: "ui.logModeAuto",
  expanded: "ui.logModeExpanded",
  collapsed: "ui.logModeCollapsed",
} as const;

/** Shared box markup for a side panel's title + item list — see .side-panel in terminal.css. */
function renderSidePanel(titleKey: string, items: Array<string | { label: string; command: string }>): string {
  // An item with a `command` renders as a button that runs it through the normal input path (see the click handler in the constructor).
  const listItems = items
    .map((item) =>
      typeof item === "string"
        ? `<li>${item}</li>`
        : `<li><button type="button" class="side-panel__link" data-command="${item.command.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">${item.label}</button></li>`,
    )
    .join("");
  return `<h2 class="side-panel__title">${t(titleKey)}</h2><ul class="side-panel__list">${listItems}</ul>`;
}

/**
 * The verb guide under the locations panel: a short, curated list for visitors
 * new to text adventures — deliberately NOT the parser's full vocabulary (that
 * is the debug `verbs` panel content). Grow it as the site needs more verbs.
 */
const VERB_HINT_KEYS = ["ui.verbHint.goTo", "ui.verbHint.examine", "ui.verbHint.talkTo", "ui.verbHint.open", "ui.verbHint.close"] as const;

/** The hints contain literal "<place>"-style placeholders, so they must be escaped before going through innerHTML. */
function renderVerbHints(): string {
  const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return renderSidePanel("ui.verbsPanelTitle", VERB_HINT_KEYS.map((key) => escape(t(key))));
}

/**
 * A placeholder ascii motif shown by the `closed` panel content — a stand-in
 * for future actual art (a location sketch, a case-relevant image, ...).
 * Deliberately tiny/generic for now; swapping it (or making it vary, e.g.
 * per location) is a content change to SIDE_PANELS.closed.render, not a
 * mechanism change. See docs/systems/parsing.md's "Side panels".
 */
const CLOSED_PANEL_ART = `   ___
  /   \\
 | · · |
  \\___/
    \\
     \\
      \\`;

/** Everything a `SIDE_PANELS` entry's `render` might need — passed as one bundle so the registry doesn't grow a bespoke parameter list per content. */
interface PanelRenderContext {
  engine: GameEngine;
  parser: ICommandParser;
  /** See renderLocationsPanel's old doc: spoiler-safe "discovered only" by default, flipped by the dev-only `devlocations` command. Only the `locations` content reads this. */
  showAllLocations: boolean;
}

interface PanelContent {
  /** Returns the slot's full inner HTML — list-based contents build it via `renderSidePanel`, but a content isn't required to (see `closed`, which renders raw ascii art with no title/list at all). */
  render(ctx: PanelRenderContext): string;
}

/**
 * Every content a side panel slot can show, keyed by `PanelContentId`
 * (`Command.ts`). `closed` is a REAL entry, not a hidden/empty special
 * case — closing a slot no longer removes it from the layout, it shows
 * `CLOSED_PANEL_ART` instead, which is the whole point of modeling
 * `"closed"` as a content rather than a boolean in the first place. Add a
 * new entry here (plus a `PanelContentId` union member) to make a new
 * content selectable — see docs/architecture.md's side-panel note.
 */
const SIDE_PANELS: Record<PanelContentId, PanelContent> = {
  /**
   * Whatever ICommandParser.listVerbs() currently returns — the parser's
   * full vocabulary, NOT filtered by what's usable in the player's current
   * context. A debug/reference aid. See docs/systems/parsing.md.
   */
  verbs: {
    render: (ctx) => renderSidePanel("ui.verbsPanelTitle", ctx.parser.listVerbs().map((verb) => t(verb.usageKey))),
  },
  /** Location names — see docs/systems/navigation.md. */
  locations: {
    render: (ctx) => {
      const visited = new Set(ctx.engine.getVisitedLocationIds());
      const names = Object.values(ctx.engine.getState().locations)
        .filter((location) => ctx.showAllLocations || visited.has(location.id))
        // A click types and runs "go to <name>" like the player would — a location's display name is always one of its own aliases (world.test.ts).
        .map((location) => ({ label: t(location.nameKey), command: `go to ${t(location.nameKey).toLowerCase()}` }));
      return renderSidePanel("ui.locationsPanelTitle", names);
    },
  },
  /**
   * The player's carried items, read live off `GameState.player.inventory`
   * — same source `GameEngine.listInventory()` uses for the one-shot
   * `inventory` command's printed line, but re-queried fresh on every
   * render rather than tied to that command; the two are independent (see
   * Command.ts's `setPanel` doc — this panel doesn't replace `inventory`).
   */
  inventory: {
    render: (ctx) => {
      const state = ctx.engine.getState();
      const names = state.player.inventory.map((id) => t(state.worldObjects[id]?.nameKey ?? id));
      return renderSidePanel("ui.inventoryPanelTitle", names);
    },
  },
  /**
   * Every fact the player has learned, oldest-first — see
   * `GameEngine.getPlayerFacts()` and docs/systems/case-system.md. A flat
   * log, not a solver: no grouping, no "case complete" indication.
   */
  facts: {
    render: (ctx) => renderSidePanel("ui.factsPanelTitle", ctx.engine.getPlayerFacts().map((fact) => t(fact.textKey))),
  },
  /** No title, no list — just decoration. See CLOSED_PANEL_ART. */
  closed: {
    render: () => `<pre class="side-panel__art" aria-hidden="true">${CLOSED_PANEL_ART}</pre>`,
  },
};

/**
 * A styled-terminal view over GameEngine. This is one possible presentation
 * of the engine's output — see CLAUDE.md. Any future view (different
 * layout, images, animation) is expected to be a new module that, like this
 * one, only ever reads engine output and calls engine actions; it must
 * never reach into engine internals.
 *
 * Takes its ICommandParser via constructor injection rather than importing
 * one directly — the parser is a swappable language-specific grammar (see
 * docs/systems/parsing.md), and this view has no business hardcoding which
 * one is active.
 */
export class TerminalView {
  private readonly clockEl: HTMLElement;
  private readonly locationEl: HTMLElement;
  private readonly imageEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly logToggleEl: HTMLButtonElement;
  /** Log expansion mode, cycled by the toggle button: "auto" (hover-expand, default), "expanded" (always over the image), "collapsed" (never, hover does nothing). */
  private logMode: "auto" | "expanded" | "collapsed" = "collapsed";
  /** Pointer currently over the log (hover-expand, only consulted in "auto"); collapse is delayed via `logCollapseTimer`. */
  private logHovered = false;
  private logCollapseTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the log was scrolled to the bottom before its height last changed — see `pinLogToBottomOnResize`. */
  private logStickToBottom = true;
  private readonly inputEl: HTMLInputElement;
  /** The two fixed side-panel slots' host elements — which CONTENT each shows is `leftPanelContent`/`rightPanelContent`, not tied to the slot itself. See SIDE_PANELS. */
  private readonly panelEls: Record<PanelSlot, HTMLElement>;
  private readonly worldMapOverlayEl: HTMLElement;
  private readonly worldMapCanvasEl: HTMLElement;
  private readonly worldMapModeButton: HTMLButtonElement;
  private readonly notebookOverlayEl: HTMLElement;
  private readonly notebookTitleEl: HTMLElement;
  private readonly notebookPageIndicatorEl: HTMLElement;
  private readonly notebookMeterEl: HTMLElement;
  private readonly notebookPageEl: HTMLElement;
  private readonly notebookPrevPageButton: HTMLButtonElement;
  private readonly notebookNextPageButton: HTMLButtonElement;
  private readonly notebookNewBlockButton: HTMLButtonElement;
  /** The active multi-screen menu, if any (e.g. the bare-`travel` flow) — see menu/MenuFlow.ts. */
  private readonly menu = new MenuFlow();
  /** The DOM block of the menu screen currently accepting input; every earlier block's option buttons are disabled (retireStaleMenus). */
  private liveMenuBlock: HTMLElement | null = null;
  /** Whether the locations panel shows every location (dev-only `devlocations` toggle) instead of just `Player.visitedLocationIds` — see SIDE_PANELS.locations. */
  private showAllLocations = false;
  /** Which content the left/right side-panel slots currently show — sides are fixed, content is player-selectable via `setPanel`. See SIDE_PANELS and Command.ts's PanelContentId doc. */
  private leftPanelContent: PanelContentId = "locations";
  private rightPanelContent: PanelContentId = "inventory";
  /** Lazily created on first `toggleWorldMap` — see renderWorldMap. Distinct from the text locations panel: a visual, clickable graph (src/mapview/MapView.ts). */
  private worldMapView: MapView | null = null;
  /** Independent of `showAllLocations` — the plain-text locations panel and the visual world map are separate UI, each with its own "everything vs. discovered" toggle. */
  private worldMapShowAll = false;
  /** Which notebook/page the page-view overlay is currently showing — see openNotebookPageView. Null when the overlay is closed. */
  private notebookView: { notebookId: string; pageIndex: number } | null = null;
  /**
   * Which block (if any) is currently open for editing in the page-view
   * overlay — the view-owned edit buffer is just the `<textarea>` DOM
   * element itself (native browser undo covers "reversible until exit,"
   * see docs/systems/notebooks.md's editing model); this only tracks
   * WHICH block that textarea belongs to, so re-rendering the page (e.g.
   * after changing page) knows to close it.
   */
  private editingBlockId: string | null = null;
  /** True while the page-view overlay is showing a blank "+ New note" textarea not yet committed to any block — see startNewNoteDraft. */
  private newNoteDraftOpen = false;
  private readonly boardOverlayEl: HTMLElement;
  private readonly boardCanvasMountEl: HTMLElement;
  private readonly boardAddNodeMountEl: HTMLElement;
  /** All transient, view-only interaction state for the case board overlay — never persisted, cleared on close. See renderBoardOverlay and docs/systems/case-board.md. */
  private boardUiState: BoardViewState = { pendingConnection: null, recoloring: null };
  /** Which `"note"` node (if any) is currently showing its editable textarea — only one at a time, cleared on close/blur-commit. See renderBoardOverlay. */
  private boardEditingNoteId: string | null = null;
  /** The "+ Add node" dropdown's open/drill-down state — see renderAddNodeMenu. Cleared on board close. */
  private boardAddNodeMenuState: AddNodeMenuState = { open: false, category: null };
  /** The most recently PRINTED line's resolved text — what `jotDown "last"`/`"that"` jots, so the player never has to retype something they just read (an examine result, dialogue, ...). See resolveJotDownText. Updated in presentEvent; deliberately not reset by menus/status-bar chrome, only by actual printed event lines. */
  private lastPrintedLine: string | null = null;
  /** True while the click-to-jot picker (a bare `jot down`) is waiting for the player to click a scrollback line — see enterJotPickMode/handleLogClick. */
  private jotPicking = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly engine: GameEngine,
    private readonly parser: ICommandParser,
    /** Passed through to `renderImagePane` — a developer/content knob, not a player setting. 0 disables the fade (instant swap). */
    private readonly imageFadeDurationMs: number = DEFAULT_IMAGE_FADE_DURATION_MS,
    /** Passed through to `renderImagePane` — makes scene-image fades a stepped pixel-dissolve (retro look) instead of an opacity fade. Off by default; a developer knob, not a player setting. */
    private readonly imageDitherEnabled: boolean = false,
    /** Number of dissolve frames per fade, see `DEFAULT_IMAGE_DITHER_STEPS`. Ignored unless `imageDitherEnabled`. */
    private readonly imageDitherSteps: number = DEFAULT_IMAGE_DITHER_STEPS,
  ) {
    this.root.innerHTML = `
      <div class="layout">
        <div class="side-column">
          <aside class="side-panel side-panel--fixed" data-role="panel-left"></aside>
          <aside class="side-panel" data-role="panel-verbs"></aside>
        </div>
        <div class="terminal">
          <div class="terminal__status-bar">
            <span class="terminal__clock" data-role="clock"></span>
            <span class="terminal__location" data-role="location"></span>
          </div>
          <div class="terminal__stage" data-role="stage">
            <div class="terminal__image" data-role="image" hidden></div>
            <button type="button" class="terminal__log-toggle terminal__log-toggle--active" data-role="log-toggle" aria-expanded="false" title="${t("ui.logToggleHint")}" hidden>${t("ui.logModeCollapsed")}</button>
            <div class="terminal__log" data-role="log"></div>
          </div>
          <div class="terminal__input-row">
            <span class="terminal__prompt">${t("ui.prompt")}</span>
            <input class="terminal__input" data-role="input" type="text" autocomplete="off" spellcheck="false" />
          </div>
        </div>
        <aside class="side-panel side-panel--fixed" data-role="panel-right"></aside>
      </div>
      <div class="world-map-overlay" data-role="world-map-overlay" hidden>
        <div class="world-map-overlay__toolbar">
          <span class="world-map-overlay__title">${t("ui.worldMapTitle")}</span>
          <button type="button" data-role="world-map-mode">${t("ui.worldMapShowAll")}</button>
          <button type="button" data-role="world-map-close">${t("ui.worldMapClose")}</button>
        </div>
        <div class="world-map-overlay__canvas" data-role="world-map-canvas"></div>
      </div>
      <div class="notebook-overlay" data-role="notebook-overlay" hidden>
        <div class="notebook-overlay__book">
          <div class="notebook-overlay__toolbar">
            <span class="notebook-overlay__title" data-role="notebook-title"></span>
            <button type="button" data-role="notebook-prev-page">${t("ui.notebookPrevPage")}</button>
            <span class="notebook-overlay__page-indicator" data-role="notebook-page-indicator"></span>
            <button type="button" data-role="notebook-next-page">${t("ui.notebookNextPage")}</button>
            <span class="notebook-overlay__meter" data-role="notebook-meter"></span>
            <button type="button" data-role="notebook-new-block">${t("ui.notebookNewNote")}</button>
            <button type="button" data-role="notebook-close">${t("ui.notebookSaveNote")}</button>
          </div>
          <div class="notebook-overlay__page" data-role="notebook-page"></div>
        </div>
      </div>
      <div class="board-overlay" data-role="board-overlay" hidden>
        <div class="board-overlay__toolbar">
          <span class="board-overlay__title">${t("ui.boardTitle")}</span>
          <span class="board-overlay__add-node" data-role="board-add-node-mount"></span>
          <button type="button" data-role="board-close">${t("ui.boardClose")}</button>
        </div>
        <div class="board-overlay__canvas-wrapper" data-role="board-canvas-mount"></div>
      </div>
    `;
    this.clockEl = this.root.querySelector('[data-role="clock"]')!;
    this.locationEl = this.root.querySelector('[data-role="location"]')!;
    this.imageEl = this.root.querySelector('[data-role="image"]')!;
    this.logEl = this.root.querySelector('[data-role="log"]')!;
    this.stageEl = this.root.querySelector('[data-role="stage"]')!;
    this.logToggleEl = this.root.querySelector('[data-role="log-toggle"]')!;
    this.inputEl = this.root.querySelector('[data-role="input"]')!;
    this.root.querySelector('[data-role="panel-verbs"]')!.innerHTML = renderVerbHints();
    this.panelEls = {
      left: this.root.querySelector('[data-role="panel-left"]')!,
      right: this.root.querySelector('[data-role="panel-right"]')!,
    };
    // Clickable side-panel entries (the locations list) feed their command through runInput, same as a typed line or a hotspot click.
    for (const slotEl of Object.values(this.panelEls)) {
      slotEl.addEventListener("click", (event) => {
        const command = (event.target as HTMLElement).closest<HTMLElement>("[data-command]")?.dataset.command;
        if (command) void this.runInput(command).then(() => this.updateStatusBar());
      });
    }
    this.worldMapOverlayEl = this.root.querySelector('[data-role="world-map-overlay"]')!;
    this.worldMapCanvasEl = this.root.querySelector('[data-role="world-map-canvas"]')!;
    this.worldMapModeButton = this.root.querySelector('[data-role="world-map-mode"]')!;
    this.notebookOverlayEl = this.root.querySelector('[data-role="notebook-overlay"]')!;
    this.notebookTitleEl = this.root.querySelector('[data-role="notebook-title"]')!;
    this.notebookPageIndicatorEl = this.root.querySelector('[data-role="notebook-page-indicator"]')!;
    this.notebookMeterEl = this.root.querySelector('[data-role="notebook-meter"]')!;
    this.notebookPageEl = this.root.querySelector('[data-role="notebook-page"]')!;
    this.notebookPrevPageButton = this.root.querySelector('[data-role="notebook-prev-page"]')!;
    this.notebookNextPageButton = this.root.querySelector('[data-role="notebook-next-page"]')!;
    this.notebookNewBlockButton = this.root.querySelector('[data-role="notebook-new-block"]')!;
    this.boardOverlayEl = this.root.querySelector('[data-role="board-overlay"]')!;
    this.boardCanvasMountEl = this.root.querySelector('[data-role="board-canvas-mount"]')!;
    this.boardAddNodeMountEl = this.root.querySelector('[data-role="board-add-node-mount"]')!;
    this.root.querySelector('[data-role="board-close"]')!.addEventListener("click", () => this.hideBoard());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.handleSubmit();
    });
    this.worldMapModeButton.addEventListener("click", () => {
      this.worldMapShowAll = !this.worldMapShowAll;
      this.renderWorldMap();
    });
    this.root.querySelector('[data-role="world-map-close"]')!.addEventListener("click", () => this.hideWorldMap());
    this.notebookPrevPageButton.addEventListener("click", () => this.turnNotebookPage(-1));
    this.notebookNextPageButton.addEventListener("click", () => this.turnNotebookPage(1));
    this.notebookNewBlockButton.addEventListener("click", () => this.startNewNoteDraft());
    this.root.querySelector('[data-role="notebook-close"]')!.addEventListener("click", () => this.closeNotebookPageView());
    this.logEl.addEventListener("click", (e) => this.handleLogClick(e));
    this.wireLogExpansion();
    this.updateStatusBar();
    this.inputEl.focus();
  }

  /** Prints the engine's initial location description without requiring player input. */
  async start(): Promise<void> {
    await this.consumeEvents(this.engine.look().events);
  }

  private async handleSubmit(): Promise<void> {
    const raw = this.inputEl.value;
    if (!raw.trim()) return;
    this.inputEl.value = "";
    await this.runInput(raw);
  }

  /**
   * The shared "player entered this text" path: echoes it and runs it through
   * the parser/menu/jot-pick handling exactly as typed input. Split out of
   * handleSubmit so an image hotspot click (see imagePane.ts) can feed its
   * command in without touching whatever the player has half-typed.
   */
  private async runInput(raw: string): Promise<void> {
    this.printLine(`${t("ui.prompt")}${raw}`, "input");

    if (this.jotPicking) {
      const lower = raw.trim().toLowerCase();
      if (lower === "cancel" || lower === "exit") {
        this.exitJotPickMode();
        await this.consumeEvents([{ type: "menu_cancelled", textKey: "event.menuCancelled" }]);
      } else {
        await this.consumeEvents([{ type: "jot_pick_still_waiting", textKey: "ui.jotDownPickStillWaiting" }]);
      }
      this.updateStatusBar();
      return;
    }

    if (this.menu.isActive) {
      await this.handleMenuInput(raw.trim());
      this.updateStatusBar();
      return;
    }

    let command = this.parser.parse(raw);
    if (command.kind === "jotDownPick") {
      if (this.engine.getNotebooks().length === 0) {
        // Nothing to jot INTO — check this before letting the player click
        // around the log for nothing (docs/systems/notebooks.md's `jotDown`
        // section), rather than only discovering it after a click, the way
        // submitJotDown's own (later) check would.
        await this.consumeEvents([{ type: "no_notebooks_owned", textKey: "event.noNotebooksOwned" }]);
      } else {
        this.enterJotPickMode();
      }
      this.updateStatusBar();
      return;
    }
    if (command.kind === "jotDown") {
      const resolved = this.resolveJotDownText(command.text);
      if (resolved === null) {
        await this.consumeEvents([{ type: "jot_nothing_to_jot", textKey: "event.jotNothingToJot" }]);
        this.updateStatusBar();
        return;
      }
      await this.submitJotDown(resolved.text, resolved.sourceRef);
      this.updateStatusBar();
      return;
    }
    if (command.kind === "travelMenu") {
      this.engine.clearFocus(); // opening the travel menu is a "universal" action that breaks focus — see docs/systems/parts.md.
      const screen = buildDirectConnectionsScreen(this.engine);
      this.menu.start(screen);
      this.renderMenuScreen(screen);
      this.updateStatusBar();
      return;
    }
    if (command.kind === "buyMenu") {
      const screen = buildBuyMenuScreen(this.engine);
      this.menu.start(screen);
      this.renderMenuScreen(screen);
      this.updateStatusBar();
      return;
    }
    if (command.kind === "panelMenu") {
      const screen = buildPanelMenuScreen(command.slot, (content) => this.setPanelContent(command.slot, content));
      this.menu.start(screen);
      this.renderMenuScreen(screen);
      this.updateStatusBar();
      return;
    }
    if (command.kind === "notebook") {
      const { result, screen } = openNotebookCommand(this.engine);
      if (screen) {
        this.menu.start(screen);
        this.renderMenuScreen(screen);
        this.updateStatusBar();
        return;
      }
      await this.consumeEvents(result.events);
      this.updateStatusBar();
      return;
    }
    if (command.kind === "talk") {
      const listed = this.engine.listTopics(command.query);
      if (listed.ok && listed.topics.length > 0) {
        // Runs the SAME dialogueRules matching + effects/talkedTo/witness
        // bookkeeping a plain (no-topics) `talk` does — opening the topic
        // menu must not skip an NPC's ordinary greeting/first-talk rule
        // (e.g. a trust bump), just present it with a menu appended. See
        // docs/systems/dialogue.md's "Topic menus" section.
        const greeting = this.engine.talkTo(command.query);
        const header: GameEvent[] = [...greeting.events, { type: "topic_prompt", textKey: "event.topicPrompt" }];
        const screen = buildTopicsScreen(this.engine, listed.npcId, header);
        this.menu.start(screen);
        this.renderMenuScreen(screen);
        this.updateStatusBar();
        return;
      }
      // No topics authored, or none currently unlocked — falls through to
      // the ordinary dispatch()->talkTo path below, unchanged.
    }

    const result = this.dispatch(command, raw);
    const resolveById = WORLD_OBJECT_RESOLVERS[command.kind];
    if (resolveById && result.choices?.some((choice) => choice.kind === "resolution")) {
      const screen = buildDisambiguationScreen(result.events, result.choices as ResolutionChoice[], (id) => resolveById(this.engine, id));
      this.menu.start(screen);
      this.renderMenuScreen(screen);
      this.updateStatusBar();
      return;
    }

    await this.consumeEvents(result.events);
    this.printFocusReminder();
    this.updateStatusBar();
  }

  /**
   * Resolves a parsed `jotDown` Command's `text` — the literal word
   * "last" or "that" means "whatever was last printed" (an examine
   * result, dialogue line, ...) instead of the player retyping it by
   * hand; anything else is jotted verbatim as typed. Returns `null` when
   * "last"/"that" was asked for but nothing has been printed yet this
   * session — the caller reports that as a failure rather than jotting an
   * empty note. See `Command.ts`'s `jotDown` doc comment and
   * `lastPrintedLine`.
   */
  private resolveJotDownText(text: string): { kind: "jotDown"; text: string; sourceRef?: string } | null {
    const trimmed = text.trim().toLowerCase();
    if (trimmed !== "last" && trimmed !== "that") return { kind: "jotDown", text };
    if (!this.lastPrintedLine) return null;
    return { kind: "jotDown", text: this.lastPrintedLine, sourceRef: "scrollback:last" };
  }

  /**
   * The one place that actually commits a `jotDown` (whether the text
   * came from typing it, `last`/`that`, or clicking a scrollback line):
   * if a notebook is active, jots straight into it without interrupting
   * the player. Otherwise, per `docs/systems/notebooks.md`'s `jotDown`
   * section, step 3:
   *  - owning none at all fails cleanly with `event.noNotebooksOwned`
   *    (same message the bare `notebook` command uses) rather than
   *    opening a "which notebook?" picker with nothing to pick;
   *  - owning exactly one jots straight into it, silently, without
   *    asking "which one?" for a question with only one possible
   *    answer — mirrors `openNotebookCommand`'s same skip-the-picker
   *    behavior for a single notebook;
   *  - owning two or more opens `buildJotDownPickerScreen` to ask.
   * Shared by the keyboard path (`handleSubmit`'s `jotDown` branch) and
   * the click-to-jot path (`handleLogClick`) so this resolution only
   * lives in one place.
   */
  private async submitJotDown(text: string, sourceRef?: string): Promise<void> {
    const activeNotebookId = this.engine.getActiveNotebookId();
    if (activeNotebookId !== null) {
      const result = this.engine.jotNote(activeNotebookId, text, sourceRef);
      await this.consumeEvents(result.events);
      this.printFocusReminder();
      return;
    }
    const notebooks = this.engine.getNotebooks();
    if (notebooks.length === 0) {
      await this.consumeEvents([{ type: "no_notebooks_owned", textKey: "event.noNotebooksOwned" }]);
      return;
    }
    if (notebooks.length === 1) {
      const result = this.engine.jotNote(notebooks[0]!.id, text, sourceRef);
      await this.consumeEvents(result.events);
      this.printFocusReminder();
      return;
    }
    const screen = buildJotDownPickerScreen(this.engine, text, sourceRef);
    this.menu.start(screen);
    this.renderMenuScreen(screen);
  }

  /**
   * Enters the click-to-jot picking mode triggered by a bare `jot down`
   * (`Command`'s `jotDownPick` kind) — the fuller "pick an arbitrary
   * earlier line" affordance `docs/systems/notebooks.md`'s `jotDown`
   * section originally imagined, alongside the narrower `last`/`that`
   * special case `resolveJotDownText` already covers. Prints an
   * instruction line (tagged `data-role="jot-prompt"` so it's excluded
   * from being clickable/jottable itself — see `handleLogClick`) and
   * flips `jotPicking`, which both the log's click handler and
   * `handleSubmit`'s keyboard-restriction check gate on. Exited by either
   * a successful click (`handleLogClick`) or the player typing
   * "cancel"/"exit" (`handleSubmit`).
   */
  private enterJotPickMode(): void {
    this.jotPicking = true;
    this.logEl.classList.add("terminal__log--jot-picking");
    const line = document.createElement("p");
    line.className = "terminal__line";
    line.dataset.role = "jot-prompt";
    line.textContent = t("ui.jotDownPickPrompt");
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private exitJotPickMode(): void {
    this.jotPicking = false;
    this.logEl.classList.remove("terminal__log--jot-picking");
  }

  /**
   * Delegated click handler on the log (registered once in the
   * constructor, gated on `jotPicking` so it's a no-op outside pick
   * mode). Only lines of actual game OUTPUT are jottable — the player's
   * own echoed input (`.terminal__line--input`), rendered menu text
   * (inside `.terminal__menu`), and the pick-mode prompt line itself
   * (`data-role="jot-prompt"`) are excluded, since jotting your own typed
   * command or UI chrome into a detective's notebook doesn't match what
   * "click a line to jot it" is for. Clicking one of those prints a
   * rejection line rather than silently doing nothing — playtesting
   * found silence read as broken, not "not applicable" — and stays in
   * picking mode so the player can just try a different line.
   */
  private handleLogClick(event: MouseEvent): void {
    // A menu option is a click shortcut for typing its number: same path, so
    // echo, back/exit handling and status refresh all behave identically.
    const option = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".terminal__menu-option") : null;
    if (option) {
      if (!option.disabled) void this.runInput(option.dataset.option ?? "").then(() => this.updateStatusBar());
      return;
    }
    if (!this.jotPicking) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".terminal__line") : null;
    if (!target) return;
    const excluded = target.dataset.role === "jot-prompt" || target.classList.contains("terminal__line--input") || target.closest(".terminal__menu");
    if (excluded) {
      void this.consumeEvents([{ type: "jot_pick_invalid_line", textKey: "ui.jotDownPickInvalidLine" }]);
      return;
    }
    const text = target.textContent?.trim();
    if (!text) return;
    this.exitJotPickMode();
    void this.submitJotDown(text, "scrollback:click").then(() => this.updateStatusBar());
  }

  /** Status chrome, not an engine event — prints "You are examining X." after every command while GameEngine.getFocusedWorldObject() is non-null. See docs/systems/parts.md. */
  private printFocusReminder(): void {
    const focused = this.engine.getFocusedWorldObject();
    if (focused) this.printLine(t("ui.examiningReminder", { itemKey: focused.nameKey }));
  }

  /**
   * Routes input while a menu is active: "exit"/"cancel" and "back" are
   * universal (work regardless of which screen is showing, and never
   * reach the screen's own options); a prompt screen gets the raw text;
   * a choices screen expects a bare number. See menu/MenuFlow.ts.
   */
  private async handleMenuInput(raw: string): Promise<void> {
    try {
      await this.routeMenuInput(raw);
    } finally {
      this.retireStaleMenus();
    }
  }

  /**
   * Disables the option buttons of every menu block that is no longer the
   * live screen (replaced by a later screen, or the menu has ended). A click
   * on one would otherwise index into a different screen's options.
   */
  private retireStaleMenus(): void {
    const live = this.menu.isActive ? this.liveMenuBlock : null;
    for (const block of Array.from(this.logEl.querySelectorAll<HTMLElement>(".terminal__menu"))) {
      if (block === live) continue;
      block.classList.add("terminal__menu--spent");
      for (const button of Array.from(block.querySelectorAll<HTMLButtonElement>(".terminal__menu-option"))) button.disabled = true;
    }
  }

  private async routeMenuInput(raw: string): Promise<void> {
    const lower = raw.toLowerCase();
    if (lower === "exit" || lower === "cancel") {
      this.menu.clear();
      await this.consumeEvents([{ type: "menu_cancelled", textKey: "event.menuCancelled" }]);
      return;
    }
    if (lower === "back") {
      await this.applyMenuOutcome({ type: "back" });
      return;
    }

    const screen = this.menu.current;
    if (!screen) return; // isActive was already checked by the caller; defensive only.

    if (screen.kind === "prompt") {
      await this.applyMenuOutcome(screen.submit(raw));
      return;
    }

    const index = Number(raw);
    const byNumber = Number.isInteger(index) ? screen.options[index - 1] : undefined;
    // A bare number is the primary way to pick an option, but a domain
    // may also attach `aliases` (a mode/category name, or "fastest"/
    // "cheapest" when earned — see MenuOption.aliases) so the player can
    // type the word itself instead of counting list positions.
    const option = byNumber ?? screen.options.find((candidate) => candidate.aliases?.includes(lower));
    if (!option) {
      await this.consumeEvents([{ type: "menu_invalid_choice", textKey: "event.menuInvalidChoice" }]);
      return;
    }
    await this.applyMenuOutcome(option.select());
  }

  private async applyMenuOutcome(outcome: MenuOutcome): Promise<void> {
    switch (outcome.type) {
      case "goto":
        this.menu.push(outcome.screen);
        this.renderMenuScreen(outcome.screen);
        return;
      case "restart":
        this.menu.start(outcome.screen);
        this.renderMenuScreen(outcome.screen);
        return;
      case "back": {
        const previous = this.menu.back();
        if (previous) {
          this.renderMenuScreen(previous);
        } else {
          await this.consumeEvents([{ type: "menu_cancelled", textKey: "event.menuCancelled" }]);
        }
        return;
      }
      case "exit": {
        this.menu.clear();
        if (outcome.events) await this.consumeEvents(outcome.events);
        // A "notebook_opened" event is a real, printable line (see
        // notebookMenus.ts's buildNotebookActionsScreen) AND the marker
        // TerminalView watches for to actually show the page-view overlay
        // — the two aren't in tension, this just reacts to it in addition
        // to printing it.
        const opened = outcome.events?.find((e) => e.type === "notebook_opened");
        if (opened?.params?.notebookId) this.openNotebookPageView(opened.params.notebookId);
        return;
      }
    }
  }

  /** Renders a menu screen as one visually distinct, tinted block (see .terminal__menu / data-menu-kind in terminal.css) — header lines, then numbered options for a choices screen. */
  private renderMenuScreen(screen: MenuScreen): void {
    const container = document.createElement("div");
    container.className = "terminal__menu";
    container.dataset.menuKind = screen.menuKind;

    for (const event of screen.header) {
      const line = document.createElement("p");
      line.className = "terminal__line";
      line.textContent = t(event.textKey, event.params);
      container.appendChild(line);
    }

    if (screen.kind === "choices") {
      screen.options.forEach((option, index) => {
        const line = document.createElement("p");
        line.className = "terminal__line";
        // A button, not bare text, so the option can be clicked as well as typed (see handleLogClick).
        const button = document.createElement("button");
        button.type = "button";
        button.className = "terminal__menu-option";
        button.dataset.option = String(index + 1);
        button.textContent = `${index + 1}) ${t(option.textKey, option.params)}`;
        line.appendChild(button);
        container.appendChild(line);
      });
    }

    this.liveMenuBlock = container;
    this.logEl.appendChild(container);
    this.retireStaleMenus();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /**
   * Makes the status-bar clock follow the visitor's real local time: syncs the
   * engine immediately, then re-syncs every `intervalMs` (cheap; 15 s keeps the
   * minute display from lagging). Only meaningful for an engine built with
   * `externalClock` — otherwise travel would advance the clock too and be
   * overwritten on the next tick. Returns a stop function.
   */
  startWallClock(intervalMs = 15_000): () => void {
    const tick = (): void => {
      this.engine.syncClock(minutesSinceEpoch(this.engine.getState().clock.epoch));
      this.updateStatusBar();
    };
    tick();
    const handle = setInterval(tick, intervalMs);
    return () => clearInterval(handle);
  }

  /**
   * Refreshes the always-visible clock (top-left) and current-location label
   * (top-right) — together, "when it is and where we are". The money display
   * was dropped from the website; the engine still tracks money —
   * plus the locations side panel (its "discovered" filter needs to grow
   * as the player visits new places). All from current engine state.
   * Called after every turn rather than only after actions known to
   * change time/money/location — cheap, and keeps this view from having
   * to track which commands do or don't. See docs/systems/time.md and
   * docs/systems/economy.md.
   */
  private updateStatusBar(): void {
    // ui.clockDisplay is a PATTERN (see calendarFormat.ts's token syntax),
    // not a {placeholder} template — resolved once through t() (so a
    // different language can pick its own date ordering) and then applied
    // to the current date via formatCalendarDate, not through the
    // resolver's own {word} substitution.
    this.clockEl.textContent = formatCalendarDate(this.engine.getCalendarDate(), t("ui.clockDisplay"));

    this.locationEl.textContent = t("ui.locationDisplay", { locationKey: this.engine.getCurrentLocation().nameKey });

    const image = this.engine.getSceneImage();
    renderImagePane(
      this.imageEl,
      image,
      (key) => t(key),
      (command) => void this.runInput(command).then(() => this.updateStatusBar()),
      this.imageFadeDurationMs,
      this.imageDitherEnabled,
      this.imageDitherSteps,
    );
    this.stageEl.classList.toggle("terminal__stage--has-image", image !== undefined);
    this.logToggleEl.hidden = image === undefined;
    this.applyLogExpansion();

    this.renderPanelSlot("left");
    this.renderPanelSlot("right");
  }

  /**
   * Hover / toggle-button expansion of the log over the scene image (see
   * docs/systems/image-pane.md). With an image showing, the log is only a few
   * lines tall (it is cropped from the top), so hovering it — or pressing the
   * toggle, which is the touch/keyboard route — lets it overlay the image.
   * Leaving is delayed slightly so a pointer skimming the edge doesn't
   * flicker the layout. The log is also kept scrolled to the bottom across
   * height changes, so a shrink crops OLD lines off the top, not new ones.
   */
  private wireLogExpansion(): void {
    this.logEl.addEventListener("mouseenter", () => {
      clearTimeout(this.logCollapseTimer);
      this.logHovered = true;
      this.applyLogExpansion();
    });
    this.logEl.addEventListener("mouseleave", () => {
      clearTimeout(this.logCollapseTimer);
      this.logCollapseTimer = setTimeout(() => {
        this.logHovered = false;
        this.applyLogExpansion();
      }, 250);
    });
    this.logToggleEl.addEventListener("click", () => {
      const order = ["auto", "expanded", "collapsed"] as const;
      this.logMode = order[(order.indexOf(this.logMode) + 1) % order.length]!;
      this.applyLogExpansion();
    });
    this.logEl.addEventListener("scroll", () => {
      this.logStickToBottom = this.logEl.scrollHeight - this.logEl.scrollTop - this.logEl.clientHeight < 4;
    });
    // jsdom (tests) has no ResizeObserver, and no layout for it to observe.
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => {
        if (this.logStickToBottom) this.logEl.scrollTop = this.logEl.scrollHeight;
      }).observe(this.logEl);
    }
  }

  /** Syncs the expanded class, toggle label and aria state; only applies while an image is showing. */
  private applyLogExpansion(): void {
    const hasImage = !this.imageEl.hidden;
    const expanded = hasImage && (this.logMode === "expanded" || (this.logMode === "auto" && this.logHovered));
    this.logEl.classList.toggle("terminal__log--expanded", expanded);
    this.logToggleEl.setAttribute("aria-expanded", String(expanded));
    this.logToggleEl.classList.toggle("terminal__log-toggle--active", this.logMode !== "auto");
    this.logToggleEl.textContent = t(LOG_MODE_LABEL_KEY[this.logMode]);
  }

  /**
   * Renders whichever content `leftPanelContent`/`rightPanelContent`
   * currently names into the given slot's `<aside>` — the slot itself is
   * always visible now, even when its content is `"closed"` (it shows
   * `CLOSED_PANEL_ART` rather than being hidden — see SIDE_PANELS.closed).
   * Called for BOTH slots on every turn via `updateStatusBar`, same
   * "cheap, don't bother tracking which commands could have changed it"
   * reasoning as the rest of that method — see its doc comment.
   */
  private renderPanelSlot(slot: PanelSlot): void {
    const content = slot === "left" ? this.leftPanelContent : this.rightPanelContent;
    const el = this.panelEls[slot];
    const ctx: PanelRenderContext = { engine: this.engine, parser: this.parser, showAllLocations: this.showAllLocations };
    el.innerHTML = SIDE_PANELS[content].render(ctx);
  }

  /** Sets which content a slot shows and re-renders it immediately — the shared write path for both `setPanel`'s toggle and a `panelMenu` selection (`buildPanelMenuScreen`'s `setContent` callback). */
  private setPanelContent(slot: PanelSlot, content: PanelContentId): void {
    if (slot === "left") this.leftPanelContent = content;
    else this.rightPanelContent = content;
    this.renderPanelSlot(slot);
  }

  private showWorldMap(): void {
    this.worldMapOverlayEl.hidden = false;
    this.renderWorldMap();
  }

  private hideWorldMap(): void {
    this.worldMapOverlayEl.hidden = true;
    this.inputEl.focus();
  }

  /**
   * Populates (creating on first use) the visual world map from current
   * engine state — see src/mapview/MapView.ts. Defaults to
   * `Player.visitedLocationIds` only (spoiler-safe, mirroring
   * SIDE_PANELS.locations's default), toggleable to every location via
   * the overlay's own "show entire map" button — independent of the
   * plain-text locations panel's `devlocations`-only toggle, since a
   * player is expected to use this one, not just developers.
   */
  private renderWorldMap(): void {
    if (!this.worldMapView) {
      this.worldMapView = new MapView(this.worldMapCanvasEl);
      this.worldMapView.onNodeClick((id) => void this.travelToWorldMapNode(id));
    }
    this.worldMapModeButton.textContent = t(this.worldMapShowAll ? "ui.worldMapShowDiscovered" : "ui.worldMapShowAll");

    const visited = new Set(this.engine.getVisitedLocationIds());
    const locations = Object.values(this.engine.getState().locations).filter(
      (loc) => loc.x !== undefined && loc.y !== undefined && (this.worldMapShowAll || visited.has(loc.id)),
    );
    const nodes: MapNode[] = locations.map((loc) => ({ id: loc.id, x: loc.x!, y: loc.y!, label: t(loc.nameKey), kind: loc.kind }));
    // `locations` is already filtered to the placed/visible set — buildConnectionEdges silently
    // skips a connection whose destination isn't in it, matching the old placedIds.has() check.
    const edges = buildConnectionEdges(locations, (id) => t(this.engine.getState().locations[id]?.nameKey ?? id)).map((g) => g.edge);
    this.worldMapView.setData(nodes, edges);
  }

  /** A world-map click gives a LocationId; travelTo takes free text — so this reuses the location's own displayed name (guaranteed to be in its aliases, lowercased — see docs/content-schema.md's "Rules") as the query, rather than adding an id-based travel entry point to the engine just for this. */
  private async travelToWorldMapNode(id: string): Promise<void> {
    const location = this.engine.getState().locations[id];
    if (!location) return;
    this.hideWorldMap();
    const result = this.engine.travelTo(t(location.nameKey).toLowerCase());
    await this.consumeEvents(result.events);
    this.updateStatusBar();
  }

  /** Opens the case board overlay — pure view-state, no engine call, same posture as `showWorldMap`. See docs/systems/case-board.md. */
  private showBoard(): void {
    this.boardUiState = { pendingConnection: null, recoloring: null };
    this.boardEditingNoteId = null;
    this.boardAddNodeMenuState = { open: false, category: null };
    this.boardOverlayEl.hidden = false;
    this.renderBoardOverlay();
  }

  private hideBoard(): void {
    this.boardOverlayEl.hidden = true;
    this.inputEl.focus();
  }

  /** A board node's display label — resolved here (not in `boardView.ts`) so the render module never calls `t()` itself; a `"note"` node's `text` is player-authored, never run through `t()`. See docs/systems/case-board.md. */
  private resolveBoardNodeLabel(node: BoardNode): string {
    if (node.refKind === "note") return node.text ?? "";
    const state = this.engine.getState();
    const nameKey =
      node.refKind === "fact"
        ? state.facts[node.refId ?? ""]?.textKey
        : node.refKind === "npc"
          ? state.npcs[node.refId ?? ""]?.nameKey
          : node.refKind === "location"
            ? state.locations[node.refId ?? ""]?.nameKey
            : state.worldObjects[node.refId ?? ""]?.nameKey;
    return nameKey ? t(nameKey) : "";
  }

  /** Full wholesale redraw of the board overlay's canvas AND its "+ Add node" toolbar dropdown — same "no incremental patching" posture as `renderNotebookPage`. Called on open and after every mutating callback. */
  private renderBoardOverlay(): void {
    const board = this.engine.getBoard();
    this.renderBoardAddNodeMenu();
    if (board.nodes.length === 0) {
      const hint = document.createElement("p");
      hint.className = "board-overlay__empty-hint";
      hint.textContent = t("ui.boardEmptyState");
      this.boardCanvasMountEl.replaceChildren(hint);
      return;
    }
    renderBoard(this.boardCanvasMountEl, board, (node) => this.resolveBoardNodeLabel(node), this.boardEditingNoteId, this.boardUiState, {
      onNodeDragEnd: (nodeId, x, y) => {
        this.engine.moveBoardNode(nodeId, x, y);
        this.renderBoardOverlay();
      },
      onConnectionDragEnd: (fromNodeId, toNodeId) => {
        this.boardUiState = { pendingConnection: { fromNodeId, toNodeId }, recoloring: null };
        this.renderBoardOverlay();
      },
      onEditNote: (nodeId) => {
        this.boardEditingNoteId = nodeId;
        this.renderBoardOverlay();
      },
      onNoteTextCommit: (nodeId, text) => {
        this.boardEditingNoteId = null;
        const result = this.engine.editBoardNoteText(nodeId, text);
        void this.consumeEvents(result.events).then(() => {
          this.renderBoardOverlay();
          this.updateStatusBar();
        });
      },
      onRemoveNode: (nodeId) => {
        if (this.boardEditingNoteId === nodeId) this.boardEditingNoteId = null;
        const result = this.engine.removeBoardNode(nodeId);
        void this.consumeEvents(result.events).then(() => {
          this.renderBoardOverlay();
          this.updateStatusBar();
        });
      },
      onConnectionClick: (connectionId) => {
        this.boardUiState = { pendingConnection: null, recoloring: { connectionId } };
        this.renderBoardOverlay();
      },
      onPickColor: (color) => this.handleBoardPickColor(color),
      onRemoveConnection: (connectionId) => {
        this.boardUiState = { pendingConnection: null, recoloring: null };
        const result = this.engine.removeBoardConnection(connectionId);
        void this.consumeEvents(result.events).then(() => {
          this.renderBoardOverlay();
          this.updateStatusBar();
        });
      },
    });
  }

  /** Resolves whichever pending color-swatch popover is open — either finishing a new connection (`pendingConnection`, carrying both endpoint ids from the pin-drag gesture) or recoloring an existing one (`recoloring`). */
  private handleBoardPickColor(color: BoardStringColor): void {
    const { pendingConnection, recoloring } = this.boardUiState;
    this.boardUiState = { pendingConnection: null, recoloring: null };
    const result = pendingConnection
      ? this.engine.addBoardConnection(pendingConnection.fromNodeId, pendingConnection.toNodeId, color)
      : recoloring
        ? this.engine.recolorBoardConnection(recoloring.connectionId, color)
        : null;
    if (!result) return;
    void this.consumeEvents(result.events).then(() => {
      this.renderBoardOverlay();
      this.updateStatusBar();
    });
  }

  /**
   * The "+ Add node" toolbar dropdown — plain DOM, not a `MenuFlow`
   * screen (see `boardView.ts`'s header comment on `renderAddNodeMenu`
   * for why). Adding a node closes the dropdown and re-renders the
   * canvas so the new card appears immediately.
   */
  private renderBoardAddNodeMenu(): void {
    const addNode = (refKind: BoardNode["refKind"], refId: string | null, text: string | null) => {
      const { x, y } = defaultNodePosition(this.engine.getBoard().nodes.length);
      this.boardAddNodeMenuState = { open: false, category: null };
      const result = this.engine.addBoardNode(refKind, refId, text, x, y);
      void this.consumeEvents(result.events).then(() => {
        this.renderBoardOverlay();
        this.updateStatusBar();
      });
    };
    renderAddNodeMenu(this.boardAddNodeMountEl, this.engine.listAddableBoardEntities(), t, this.boardAddNodeMenuState, {
      onToggle: () => {
        this.boardAddNodeMenuState = { open: !this.boardAddNodeMenuState.open, category: null };
        this.renderBoardAddNodeMenu();
      },
      onSelectCategory: (category: AddNodeCategory) => {
        this.boardAddNodeMenuState = { open: true, category };
        this.renderBoardAddNodeMenu();
      },
      onSelectEntity: (entity) => addNode(entity.refKind, entity.refId, null),
      onSubmitNote: (text) => addNode("note", null, text),
      onBack: () => {
        this.boardAddNodeMenuState = { open: true, category: null };
        this.renderBoardAddNodeMenu();
      },
    });
  }

  /**
   * Opens the full-screen notebook page-view overlay — a separate view
   * mode, same category as the world-map overlay, reached only via the
   * "Open" option on the notebook actions menu (`notebookMenus.ts`). See
   * docs/systems/notebooks.md's "The notebook page interface."
   */
  private openNotebookPageView(notebookId: string): void {
    this.notebookView = { notebookId, pageIndex: 0 };
    this.editingBlockId = null;
    this.newNoteDraftOpen = false;
    this.notebookOverlayEl.hidden = false;
    this.renderNotebookPage();
  }

  private closeNotebookPageView(): void {
    this.notebookOverlayEl.hidden = true;
    this.notebookView = null;
    this.editingBlockId = null;
    this.newNoteDraftOpen = false;
    this.inputEl.focus();
  }

  private getViewedNotebook(): Notebook | undefined {
    if (!this.notebookView) return undefined;
    return this.engine.getNotebooks().find((n) => n.id === this.notebookView!.notebookId);
  }

  private turnNotebookPage(delta: number): void {
    if (!this.notebookView) return;
    const notebook = this.getViewedNotebook();
    if (!notebook) return;
    const nextIndex = this.notebookView.pageIndex + delta;
    if (nextIndex < 0 || nextIndex >= notebook.pages.length) return;
    this.notebookView.pageIndex = nextIndex;
    this.editingBlockId = null;
    this.newNoteDraftOpen = false;
    this.renderNotebookPage();
  }

  /** The "+ New note" button — the player's explicit "start a new note" action while inside the notebook UI (see docs/systems/notebooks.md's "Why blocks" section), distinct from `jotDown`. Only reveals a blank textarea; nothing is written to GameState until it's blurred with non-empty text — see renderNewNoteDraft. */
  private startNewNoteDraft(): void {
    if (!this.notebookView || this.newNoteDraftOpen) return;
    this.editingBlockId = null;
    this.newNoteDraftOpen = true;
    this.renderNotebookPage();
  }

  /**
   * Redraws the currently-viewed notebook page from scratch — title, page
   * indicator, the `charsUsed`/`charCapacity` resource meter, then every
   * block (read-mode, or a live textarea for whichever one `editingBlockId`
   * names), plus a trailing blank draft textarea when `newNoteDraftOpen`.
   * Closes the overlay defensively if the notebook/page it was pointing at
   * no longer exists (e.g. disposed from another tab — not reachable
   * today, but cheap to guard).
   */
  private renderNotebookPage(): void {
    const notebook = this.getViewedNotebook();
    const page = this.notebookView && notebook ? notebook.pages[this.notebookView.pageIndex] : undefined;
    if (!this.notebookView || !notebook || !page) {
      this.closeNotebookPageView();
      return;
    }

    this.notebookTitleEl.textContent = notebook.name || t("ui.unnamedNotebook");
    this.notebookPageIndicatorEl.textContent = t("ui.notebookPageIndicator", {
      page: String(this.notebookView.pageIndex + 1),
      pageCount: String(notebook.pages.length),
    });
    this.updateNotebookMeter(page, charsUsed(page), 0);
    this.notebookPrevPageButton.disabled = this.notebookView.pageIndex === 0;
    this.notebookNextPageButton.disabled = this.notebookView.pageIndex === notebook.pages.length - 1;

    this.notebookPageEl.replaceChildren();
    for (const block of page.blocks) {
      const { element, onMounted } = this.renderNotebookBlock(notebook.id, page, block);
      this.notebookPageEl.appendChild(element);
      onMounted?.();
    }
    if (this.newNoteDraftOpen) {
      const { element, onMounted } = this.renderNewNoteDraft(notebook.id, page);
      this.notebookPageEl.appendChild(element);
      onMounted();
    }
  }

  /**
   * Grows a notebook textarea's height to fit exactly however many rows
   * its content actually wrapped to — the standard "reset to auto, then
   * read `scrollHeight`" autosize technique. Needed because the box is
   * now full page-width (see docs/systems/notebooks.md's "The notebook
   * page interface" — there is no character-per-line concept to compute
   * a row count from anymore); only meaningful once the element is
   * actually laid out in the document (a detached/hidden element reports
   * a bogus `scrollHeight`), so callers must run this AFTER mounting.
   */
  private autosizeNotebookTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  /**
   * Redraws the `{used}/{capacity}` toolbar meter from LIVE, uncommitted
   * text — `otherBlocksChars` is every OTHER block's already-committed
   * size on this page, `liveChars` the in-progress textarea's current
   * length. Without this the meter only reflects reality after a block
   * is committed (blur), so the player types blind right up until
   * `maxLength` silently stops them — see docs/systems/notebooks.md's
   * "The notebook page interface."
   */
  private updateNotebookMeter(page: Page, otherBlocksChars: number, liveChars: number): void {
    this.notebookMeterEl.textContent = t("ui.notebookCharsMeter", { used: String(otherBlocksChars + liveChars), capacity: String(page.charCapacity) });
  }

  /**
   * One block, in read mode (struck spans rendered as `<s>`, the
   * auto-stamped header visually distinct via .notebook-block__header —
   * see docs/systems/notebooks.md) or, while `editingBlockId` names it,
   * as a live `<textarea>`. The textarea's own native undo/redo IS the
   * "reversible until exit" edit buffer the design doc calls for — no
   * hand-rolled undo stack needed; nothing reaches GameState until blur,
   * which commits via `GameEngine.amendNote` (the commit-time diff). Its
   * `maxLength` is the page's remaining FLAT character budget (excluding
   * this block's own current contribution) — no separate per-entry cap,
   * so typing only stops when the PAGE actually runs out, never mid-note
   * just because a fixed line count was hit. See
   * docs/systems/notebooks.md's "Page overflow" decision.
   *
   * Returns an `onMounted` callback (only when this block is the one
   * being edited) that the caller MUST run immediately after actually
   * appending the returned element into the visible document — sizing
   * the textarea and priming the live meter both need real layout
   * dimensions, which a detached node doesn't have yet.
   */
  private renderNotebookBlock(notebookId: string, page: Page, block: NoteBlock): { element: HTMLElement; onMounted?: () => void } {
    const container = document.createElement("div");
    container.className = "notebook-block";

    const header = document.createElement("div");
    header.className = "notebook-block__header";
    const locationKey = this.engine.getState().locations[block.locationId]?.nameKey ?? block.locationId;
    header.textContent = t("ui.notebookBlockHeader", { day: block.timestamp.day, time: block.timestamp.time, locationKey });
    container.appendChild(header);

    if (this.editingBlockId === block.id) {
      const textarea = document.createElement("textarea");
      textarea.className = "notebook-block__editor";
      textarea.value = blockActiveText(block);
      const otherBlocksChars = charsUsed(page) - blockActiveTextLength(block);
      textarea.maxLength = Math.max(0, page.charCapacity - otherBlocksChars);
      const sync = () => {
        this.autosizeNotebookTextarea(textarea);
        this.updateNotebookMeter(page, otherBlocksChars, textarea.value.length);
      };
      textarea.addEventListener("input", sync);
      textarea.addEventListener("blur", () => {
        this.editingBlockId = null;
        const result = this.engine.amendNote(notebookId, block.id, textarea.value);
        void this.consumeEvents(result.events).then(() => {
          this.renderNotebookPage();
          this.updateStatusBar();
        });
      });
      container.appendChild(textarea);
      return { element: container, onMounted: () => (sync(), textarea.focus()) };
    }

    const text = document.createElement("div");
    text.className = "notebook-block__text";
    for (const span of block.spans) {
      const node = document.createElement(span.struck ? "s" : "span");
      node.textContent = span.text;
      text.appendChild(node);
    }
    container.appendChild(text);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = t("ui.notebookEditNote");
    editButton.addEventListener("click", () => {
      this.editingBlockId = block.id;
      this.renderNotebookPage();
    });
    container.appendChild(editButton);

    return { element: container };
  }

  /**
   * The blank textarea shown while `newNoteDraftOpen` — see
   * startNewNoteDraft. Blurring with empty/whitespace-only text just
   * discards the draft (never calls `jotNote`); non-empty text commits
   * via `jotNote`, which decides which page it actually lands on (this
   * page, if it has room — see docs/systems/notebooks.md's "Page
   * overflow" decision for `jotDown`). Returns an `onMounted` callback —
   * see `renderNotebookBlock`'s doc comment for why the caller must run
   * it only after actually appending the element.
   */
  private renderNewNoteDraft(notebookId: string, page: Page): { element: HTMLElement; onMounted: () => void } {
    const container = document.createElement("div");
    container.className = "notebook-block notebook-block--draft";

    const textarea = document.createElement("textarea");
    textarea.className = "notebook-block__editor";
    textarea.maxLength = Math.max(0, charsRemaining(page));
    textarea.placeholder = t("ui.notebookNewNotePlaceholder");
    const sync = () => {
      this.autosizeNotebookTextarea(textarea);
      this.updateNotebookMeter(page, charsUsed(page), textarea.value.length);
    };
    textarea.addEventListener("input", sync);
    textarea.addEventListener("blur", () => {
      this.newNoteDraftOpen = false;
      const value = textarea.value.trim();
      if (value.length === 0) {
        this.renderNotebookPage();
        return;
      }
      const result = this.engine.jotNote(notebookId, value);
      void this.consumeEvents(result.events).then(() => {
        this.renderNotebookPage();
        this.updateStatusBar();
      });
    });
    container.appendChild(textarea);
    return { element: container, onMounted: () => (sync(), textarea.focus()) };
  }

  /**
   * `command` is never `{ kind: "travelMenu" }`/`{ kind: "buyMenu" }`/
   * `{ kind: "panelMenu" }`/`{ kind: "notebook" }`/`{ kind: "jotDownPick" }`/
   * `{ kind: "jotDown" }` here — handleSubmit intercepts all of those before
   * dispatch is called: the first four because opening a menu (or entering
   * the click-to-jot picker) isn't a plain ActionResult, and `jotDown`
   * because resolving which notebook to write to (possibly prompting)
   * is handled by `submitJotDown`.
   */
  private dispatch(
    command: Exclude<Command, { kind: "travelMenu" | "buyMenu" | "panelMenu" | "notebook" | "jotDownPick" | "jotDown" }>,
    raw: string,
  ): ActionResult {
    switch (command.kind) {
      case "look":
        return this.engine.look();
      case "travel":
        return this.engine.travelTo(command.query);
      case "time":
        return this.engine.checkTime();
      case "travelPreference":
        if (command.preference) return this.engine.setTravelPreference(command.preference);
        return {
          ok: true,
          events: [
            {
              type: "travel_preference_checked",
              textKey: "event.travelPreferenceChecked",
              params: { preferenceKey: `preference.${this.engine.getTravelPreference()}` },
            },
          ],
        };
      case "take":
        return this.engine.takeItem(command.query);
      case "buy":
        return buyByQuery(this.engine, command.query);
      case "inventory":
        return this.engine.listInventory();
      case "talk":
        return this.engine.talkTo(command.query);
      case "examine":
        return this.engine.examine(command.query);
      case "interact":
        return this.engine.interact(command.verb, command.query);
      case "unfocus":
        return this.engine.unfocus();
      case "toggleStealth":
        return this.engine.toggleStealth();
      case "help":
        return { ok: true, events: [{ type: "help_shown", textKey: "ui.help" }] };
      case "setPanel": {
        const current = command.slot === "left" ? this.leftPanelContent : this.rightPanelContent;
        // Re-requesting a slot's current content closes it — preserves the old toggleVerbs/toggleLocations behavior (see Command.ts's setPanel doc).
        const next: PanelContentId = current === command.content ? "closed" : command.content;
        this.setPanelContent(command.slot, next);
        return { ok: true, events: [] };
      }
      case "toggleWorldMap":
        if (this.worldMapOverlayEl.hidden) this.showWorldMap();
        else this.hideWorldMap();
        return { ok: true, events: [] };
      case "board":
        if (this.boardOverlayEl.hidden) this.showBoard();
        else this.hideBoard();
        return { ok: true, events: [] };
      case "save":
        saveToStorage(serializeState(this.engine.getState()));
        return { ok: true, events: [{ type: "game_saved", textKey: "event.gameSaved" }] };
      case "load":
        return this.loadGame();
      case "devAddMoney":
        return this.engine.addMoney(command.amountMinor);
      case "devToggleAllLocations":
        // Pure view state (see SIDE_PANELS.locations) — no GameEngine call.
        // updateStatusBar (called after every turn, including this one)
        // re-renders the panel with the flipped filter.
        this.showAllLocations = !this.showAllLocations;
        return { ok: true, events: [] };
      case "unknown":
        return { ok: false, events: [{ type: "unknown_command", textKey: "ui.unknownCommand", params: { raw } }] };
    }
  }

  /**
   * Loads the one save slot, if any, replacing the engine's current state
   * wholesale via `GameEngine.loadState` — see docs/systems/save.md. Pairs
   * the saved mutable slice with FRESH static content (`loadCityContent()`),
   * never the content the engine happened to already be holding, since a
   * loaded save is meant to reflect the on-disk content as it is now, not
   * as it was at some earlier point in this session. Re-runs `look()`
   * afterward so the player sees where the loaded game actually left them,
   * same as `start()` does for a new game.
   */
  private loadGame(): ActionResult {
    const data = loadFromStorage();
    if (!data) {
      return { ok: false, events: [{ type: "no_save_found", textKey: "event.noSaveFound" }] };
    }
    let state;
    try {
      state = buildStateFromSave(loadCityContent(), data);
    } catch {
      return { ok: false, events: [{ type: "save_incompatible", textKey: "event.saveIncompatible" }] };
    }
    this.engine.loadState(state);
    return {
      ok: true,
      events: [{ type: "game_loaded", textKey: "event.gameLoaded" }, ...this.engine.look().events],
    };
  }

  /**
   * Walks the engine's event list and prints each one. Printing is instant
   * today, but every event is awaited individually so a future animated
   * view can insert a delay (e.g. `await playAnimation(event)`) per event
   * without changing this loop's shape or touching the engine at all. See
   * CLAUDE.md, point 2.
   *
   * If this batch actually changed the player's location — a
   * `player_moved`/`player_traveled` event is present — a horizontal
   * divider is printed FIRST, before any event in the batch (including a
   * preceding `money_spent` charge for the trip), so the whole action
   * that caused the move reads as one clearly bounded group in the log.
   * Checked once per batch rather than per individual event: a plain
   * `look` (which also emits a `location_described` event, just never a
   * move/travel one) must never get a divider.
   */
  private async consumeEvents(events: GameEvent[]): Promise<void> {
    if (events.some((e) => e.type === "player_moved" || e.type === "player_traveled")) {
      this.printDivider();
    }
    for (const event of events) {
      await this.presentEvent(event);
    }
  }

  private async presentEvent(event: GameEvent): Promise<void> {
    const text = t(event.textKey, event.params);
    // Excludes the two note-commit confirmations themselves — otherwise
    // "jot down last" right after jotting something would just jot its
    // own "You jot it down..." confirmation instead of anything useful.
    if (event.type !== "note_jotted" && event.type !== "note_amended") this.lastPrintedLine = text;
    this.printLine(text);
  }

  private printLine(text: string, variant: "output" | "input" = "output"): void {
    const line = document.createElement("p");
    line.className = variant === "input" ? "terminal__line terminal__line--input" : "terminal__line";
    line.textContent = text;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /** Marks a location change in the scrollback — see consumeEvents' doc comment. Purely a log-legibility aid; carries no text of its own. */
  private printDivider(): void {
    const hr = document.createElement("hr");
    hr.className = "terminal__divider";
    this.logEl.appendChild(hr);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}

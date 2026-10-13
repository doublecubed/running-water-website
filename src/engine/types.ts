/**
 * Core data shapes for the headless engine. Nothing in this file (or
 * anywhere under src/engine/) may reference the DOM, timers, or any
 * rendering concept — see CLAUDE.md, "Engine is headless and synchronous."
 */

import type { CalendarEpoch } from "./time/calendar";

export type LocationId = string;
export type WorldObjectId = string;
export type NpcId = string;
export type PartId = string;

/**
 * Compass words are NOT a fixed exit system — see docs/systems/navigation.md.
 * They only ever label a Connection as a convenience alias ("go north"
 * instead of naming the destination), and the parser normalizes typed
 * direction words to these canonical values.
 */
export type Direction = "north" | "south" | "east" | "west" | "up" | "down" | "in" | "out";

/**
 * A one-way link from one Location to another. Content authors must add
 * the reverse Connection on the destination Location too if travel should
 * be possible both ways — directionality is not assumed, so a one-way
 * street or a locked gate is representable without a special case.
 */
export interface Connection {
  toId: LocationId;
  /** Optional convenience alias so "go north" resolves this exact connection without naming the destination. */
  compassLabel?: Direction;
  /**
   * Optional single quadratic-bezier control point bending this
   * connection's line on the map canvas (src/mapview/MapView.ts) instead
   * of drawing it straight — purely presentational, like Location.x/y;
   * nothing in the engine reads it. Absent means a straight line.
   */
  curve?: { cx: number; cy: number };
}

interface BaseLocation {
  id: LocationId;
  /** Localization key for the location's display name. */
  nameKey: string;
  /** Localization key for the location's description text. */
  descriptionKey: string;
  /** Words the command parser accepts to name this location directly, e.g. ["docks", "the docks"]. */
  aliases: string[];
  connections: Connection[];
  /**
   * Optional map-canvas position — see src/mapview/MapView.ts and
   * docs/content-schema.md. Absent for locations not yet placed on the
   * map; such a location simply can't be rendered there, not an error.
   * Purely a presentation coordinate — nothing in the engine reads these
   * for navigation/pathfinding, which is graph-based, not spatial.
   */
  x?: number;
  y?: number;
  /**
   * Ambient visibility tier, before time-of-day is applied — see
   * docs/systems/visibility.md and engine/visibility/visibility.ts.
   * Defaults to "normal" when absent.
   */
  baseVisibility?: VisibilityTier;
  /**
   * Optional scene image shown above the log while the player is here,
   * with clickable hotspots — see docs/systems/image-pane.md. Authored
   * content, never saved; the view derives "which image" from the current
   * location, so the engine emits no event for it.
   */
  image?: LocationImage;
}

/**
 * A scene image — a location's, or (while the player is examining it) a
 * world object's, an NPC's or a part state's. `src` is a filename under
 * `public/images/` (an asset reference, not player-facing text); the alt
 * text is a locale key like every other player-facing string.
 */
export interface SceneImage {
  src: string;
  altKey: string;
  hotspots: Hotspot[];
}

/** Original name, from when only locations had images. */
export type LocationImage = SceneImage;

/** What `GameState.examinedTarget` points at. */
export type ExaminedTarget = { kind: "worldObject"; id: WorldObjectId } | { kind: "npc"; id: NpcId };

/**
 * A clickable rectangle over a `SceneImage`. Coordinates are PERCENT of
 * the image (0-100), not pixels, so they survive any display size.
 * `command` is raw text fed through the normal input path, exactly as if
 * the player had typed it — so hotspots can never do anything typing
 * couldn't, and the engine needs no knowledge of them.
 */
export interface Hotspot {
  labelKey: string;
  command: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Named visibility tiers a content author picks from, rather than a raw
 * 0-100 number they'd have no way to intuit — see
 * docs/systems/visibility.md. `engine/visibility/visibility.ts` maps each
 * tier to a fixed numeric constant so the engine can still combine it
 * arithmetically with time-of-day (and, later, a stealth stat/NPC
 * perception check).
 */
export type VisibilityTier = "dark" | "dim" | "normal" | "bright";

/**
 * A named stat key a Player/NPC/(later) Location can carry a value for —
 * see docs/systems/stats.md and engine/stats/stats.ts's STAT_DEFINITIONS,
 * which is where each key's default/min/max/display-name lives. Kept here
 * (not in stats.ts) for the same reason VisibilityTier lives here rather
 * than in visibility.ts: this file is the dependency leaf other engine
 * types (Npc, Player) reference inline, and must not import from sibling
 * engine modules.
 */
export type StatKey = "stealth" | "intimidation" | "handguns";

/**
 * An optional stat record any entity (Player, Npc, later a Location) can
 * carry — see engine/stats/stats.ts's getStatValue for the shared
 * fallback every consumer goes through instead of duplicating per-entity
 * defaulting logic.
 */
export type StatBlock = Partial<Record<StatKey, number>>;

/**
 * Outcome band for a skill check (see docs/systems/checks.md), keyed off
 * how far the roll-adjusted margin landed from 0. Symmetric: three
 * failure tiers, three success tiers.
 */
export type CheckOutcomeTier =
  | "failedSpectacularly"
  | "failedBadly"
  | "failed"
  | "succeeded"
  | "succeededWell"
  | "succeededSpectacularly";

/**
 * Result of resolveDifficultyCheck/resolveContestedCheck
 * (engine/checks/checks.ts). `success` is stored explicitly (not derived
 * from `outcome`'s name) so a binary-only consumer never has to know all
 * six tier names. `rolls` is length 1 for a difficulty check, 2 for a
 * contested check (one 2d10 modifier per rolling side).
 */
export interface CheckResult {
  outcome: CheckOutcomeTier;
  success: boolean;
  margin: number;
  rolls: number[];
}

/** An outdoor/public location — a street, dock, highway, ... Can own one or more InteriorLocations (see ExteriorLocation.id / InteriorLocation.exteriorId). */
export interface ExteriorLocation extends BaseLocation {
  kind: "exterior";
}

/**
 * A location inside a building. `exteriorId` is which building/exterior
 * location owns it — see docs/systems/navigation.md's "Interiors"
 * section. Critically, this is NOT "which location did I just walk in
 * from" — every InteriorLocation in a multi-room/multi-floor building
 * (a lobby, its upper floors, side rooms) carries the SAME `exteriorId`
 * (the street outside), not the id of whichever interior room connects
 * to it. That's what lets a future "leave the building" shortcut resolve
 * in one lookup regardless of how deep the player is, instead of
 * chaining through intermediate interior parents.
 *
 * The named entry point of a building (what a player types to arrive
 * there, e.g. "the diner", "the Grand Hotel") IS an InteriorLocation —
 * either the whole building (a single-room building has no separate
 * "outside the door" location at all) or its lobby (a multi-room
 * building). There is no separate "building facade" exterior node.
 */
export interface InteriorLocation extends BaseLocation {
  kind: "interior";
  exteriorId: LocationId;
  /** Display/flavor only (e.g. "You're on floor 2") — floor-to-floor movement is just ordinary up/down Connections; nothing reads this for navigation. */
  floorNumber?: number;
  /**
   * Whether daylight through windows affects this interior's visibility
   * at all — `false` for a basement/warehouse with no windows, which
   * then ignores time-of-day entirely and stays at its `baseVisibility`
   * around the clock. Defaults to `true` when absent (most interiors
   * have at least some window light). Exterior locations have no
   * equivalent field — they're always time-of-day-affected. See
   * docs/systems/visibility.md.
   */
  affectedByDaylight?: boolean;
}

export type Location = ExteriorLocation | InteriorLocation;

/**
 * Anything placeable in the world besides an NPC — small portable clutter
 * AND fixed furniture/landmarks alike; `kind` distinguishes the two. See
 * docs/content-schema.md's "World object" section for why "object" is the
 * umbrella term while "item"/"setpiece" name the two `kind`s.
 */
export interface WorldObject {
  id: WorldObjectId;
  nameKey: string;
  descriptionKey: string;
  /** Words the command parser accepts to refer to this object, e.g. ["letter", "note"]. */
  aliases: string[];
  /**
   * Presentation category, independent of `portable` (see that field's doc
   * comment for why the two aren't collapsed into one flag): "item" is
   * small clutter announced in the items-present line on every arrival;
   * "setpiece" is furniture/landmarks (a desk, a streetlamp) presented
   * alongside the location description instead — see `announceOnRevisit`
   * and docs/systems/navigation.md.
   */
  kind: "item" | "setpiece";
  /**
   * Whether the object can currently be picked up into inventory — gates
   * `GameEngine.takeItem`. Deliberately separate from `kind`: an "item"
   * may be temporarily non-portable for a situational/narrative reason
   * (e.g. an NPC in the room is guarding it) without becoming a
   * "setpiece", and this field is where that future gating would live.
   * A "setpiece" is conventionally always `false`, but nothing here
   * enforces that mechanically.
   */
  portable: boolean;
  /**
   * Setpieces only: when true, this setpiece is announced on EVERY
   * arrival, not just on first-visit/`look` like other setpieces — for a
   * scene piece whose state can change in a way worth noticing
   * immediately (e.g. a drawer left open). Ignored for `kind: "item"`,
   * which is always announced on arrival regardless. Defaults to
   * false/absent.
   */
  announceOnRevisit?: boolean;
  /**
   * Named sub-parts of this object (a desk's drawers, a lighter's
   * engraved symbol) — see docs/systems/parts.md. A part doesn't need
   * multiple states or any `enterAliases` to justify existing: a purely
   * descriptive part (revealed only by examining it directly) is enough.
   * Most objects have none.
   */
  parts?: Part[];
  /** Image shown in place of the location's while this object is being examined (a part state's own image overrides it) — see docs/systems/image-pane.md. Authored content, never saved. */
  image?: SceneImage;
}

/**
 * A named sub-part of a `WorldObject` — see `WorldObject.parts` and
 * docs/systems/parts.md for the full design (focus-based targeting,
 * the `important`-state examine bubble-up, containment, and the
 * `interact` verb).
 */
export interface Part {
  id: PartId;
  nameKey: string;
  /** Shown when this part is examined directly, before its current state's own descriptionKey fragment. */
  descriptionKey: string;
  aliases: string[];
  states: PartState[];
  /** Must reference one of `states`' `id`s — the part's state before any save/interaction changes it. */
  defaultStateId: string;
}

/**
 * One state a `Part` can be in. `enterAliases` — the verb words that
 * transition INTO this state (e.g. a drawer's "open" state:
 * `["open"]`) — is what content authors use to wire up `interact`
 * without any engine code change; a state with no `enterAliases` simply
 * isn't reachable via `interact`, which is fine for a purely descriptive
 * part (see `WorldObject.parts`'s doc comment).
 */
export interface PartState {
  id: string;
  /** Short label (e.g. "open") — used in an "it's already X" message, resolved recursively like `preferenceKey`/`categoryKey`. */
  nameKey: string;
  /** The full text shown on a DIRECT examine of this part while it's current, AND the "you just did it" feedback line for a successful `interact` that reaches this state. */
  descriptionKey: string;
  /**
   * Short ambient text for the `important`-state bubble-up in the
   * parent's general `examine` (see `important` below) — defaults to
   * `descriptionKey` when absent. Set this explicitly when the bubble
   * line should be shorter/vaguer than the full direct-examine text
   * (e.g. "One of its drawers is open." vs. a `descriptionKey` that
   * actually describes what's inside) — see docs/systems/parts.md.
   */
  summaryKey?: string;
  /** When true, this state (while current) is surfaced automatically in the PARENT object's general `examine` (via `summaryKey ?? descriptionKey`), not just this part's own. Defaults to false. */
  important?: boolean;
  enterAliases?: string[];
  /**
   * When true and this state is current, world objects `containedIn`
   * THIS PART become reachable via `examine`/`interact`/`takeItem` — see
   * docs/systems/parts.md's "Containment." Defaults to false.
   */
  exposesContents?: boolean;
  /**
   * When true (only meaningful alongside `exposesContents`), a revealed
   * DIRECT child of this part also joins the location's ambient item/
   * setpiece line, not just becoming examine/take-able — otherwise
   * (the default) it's discoverable only by examining/interacting with
   * the container. See docs/systems/parts.md.
   */
  revealInAmbientListing?: boolean;
  /** Image shown while the object is examined and this state is current — overrides the object's own `image`. See docs/systems/image-pane.md. */
  image?: SceneImage;
}

export type LabelId = string;
export type FactId = string;

/**
 * One fact the player can learn — authored content, like `NpcLabel`. Player-
 * facing (unlike `NpcState.knowledge`, which tracks what NPCs know about the
 * same `FactId` space). See docs/systems/case-system.md.
 */
export interface Fact {
  id: FactId;
  /** Localization key for a one-line, player-facing summary — `fact.<id>`. */
  textKey: string;
}

/**
 * A role/affiliation tag an NPC can carry several of ("worker",
 * "city-official", "docks"). Pure data the engine reads — there is no
 * per-label code. One concept serves both roles and reputation scopes:
 * "people at the docks" is just the `docks` label. See docs/systems/npcs.md.
 */
export interface NpcLabel {
  id: LabelId;
  nameKey: string;
  /** Flat opinion-of-the-player offset every NPC carrying this label gets (e.g. city officials start out wary: -2). */
  trustOffset: number;
  /** How NPCs with THIS label feel toward NPCs carrying each listed label, as a flat opinion offset ("worker" -> "city-official": -1). */
  labelOpinions: Record<LabelId, number>;
}

/** What an NPC does with a given fact — see docs/systems/npcs.md's "Knowledge". */
export type KnowledgeDisposition = "knows" | "conceals" | "lies" | "unaware";

/**
 * The closed vocabulary of things a memory/observation can be about — no
 * free text, so matching is pure data comparison and testimony renders via
 * the `memory.verb.<verb>` i18n keys. Extending it is a code+i18n change on
 * purpose: a verb the engine never emits or matches would be dead content.
 */
export const MEMORY_VERBS = ["took", "entered", "left", "spoke-to", "gave", "attacked", "saw", "learned"] as const;
export type MemoryVerb = (typeof MEMORY_VERBS)[number];

export const REF_KINDS = ["player", "npc", "object", "location", "fact"] as const;
export type RefKind = (typeof REF_KINDS)[number];

/** A typed pointer to something a memory is about. `id` is absent only for `kind: "player"`. */
export interface Ref {
  kind: RefKind;
  id?: string;
}

/**
 * Something that happened, as structured data — the parallel of a
 * `GameEvent` (display text) that the simulation can actually reason on.
 * Engine actions emit these; witnesses turn them into `Memory`s.
 */
export interface Observation {
  verb: MemoryVerb;
  subject: Ref;
  object?: Ref;
  locationId?: LocationId;
}

/** One thing an NPC remembers. JSON-safe by construction — it is plain data. */
export interface Memory extends Observation {
  /** `GameClock.minutesElapsed` when it happened (0 for memories authored as pre-game history). */
  atMinutes: number;
  source: "witnessed" | "told" | "inferred";
  /** Who told them, when `source` is `"told"`. */
  fromNpcId?: NpcId;
  /** How the NPC felt about it, negative to positive. 0 = neutral. */
  valence: number;
}

/** A query over memories: every present field must match, absent fields are wildcards. */
export interface MemoryPattern {
  verb?: MemoryVerb;
  subject?: Ref;
  object?: Ref;
  locationId?: LocationId;
  /** Only memories no older than this many minutes before the current clock. */
  withinMinutes?: number;
}

export type ComparisonOp = "<" | "<=" | ">" | ">=" | "==" | "!=";

/**
 * A structured, data-only condition — the successor to a bare flag list.
 * Evaluated by `engine/npc/conditions.ts` in the context of ONE NPC (the
 * one being talked to), so `npcStat`/`knows`/`memory`/`hasLabel` mean "this
 * NPC's". See docs/systems/npcs.md.
 */
export type Condition =
  | { flag: string }
  | { not: Condition }
  | { all: Condition[] }
  | { any: Condition[] }
  | { npcStat: "trust" | "suspicion" | "opinionOfPlayer"; op: ComparisonOp; value: number }
  | { knows: FactId }
  | { memory: MemoryPattern }
  | { hasLabel: LabelId }
  | { reputation: { scope: "global" | LabelId; op: ComparisonOp; value: number } }
  | { playerKnows: FactId };

/** One entry of an NPC's lookup-table schedule — see `engine/npc/schedule.ts`. */
export interface ScheduleSlot {
  /** Inclusive start hour, 0-23. */
  fromHour: number;
  /** Exclusive end hour, 0-24. `fromHour > toHour` means the slot wraps past midnight (e.g. 20 -> 6). */
  toHour: number;
  locationId: LocationId;
  /** Restrict to these weekdays (0 = Sunday .. 6 = Saturday). Absent = every day. */
  weekdays?: number[];
}

/**
 * One conditional dialogue override — see docs/systems/dialogue.md. A rule
 * matches when EVERY `requires` flag is `true` AND its optional `when`
 * condition holds. At least one of the two is always present in valid
 * content — an always-true override is just `dialogueKey` itself.
 */
export interface DialogueRule {
  /** All of these flags must be `true` in `GameState.flags`. May be empty when `when` is set. */
  requires: string[];
  /** Structured extra condition, evaluated for the NPC being talked to. */
  when?: Condition;
  textKey: string;
  /**
   * State changes applied when this rule is the one selected, after the
   * line is chosen. Authored content, so the engine never persists them —
   * only their results land in the mutable slice. To avoid farming, guard
   * the rule so it stops matching once its effect has landed (e.g. a
   * `not: { flag: talkedTo.<npc> }` first-talk rule, or a threshold the
   * effect itself crosses). See docs/systems/dialogue.md.
   */
  effects?: DialogueEffect[];
}

/**
 * One state change a `DialogueRule` applies. Every variant acts on the NPC
 * being talked to except `reputation` and `setFlag`, which are global.
 */
export type DialogueEffect =
  | { trust: number }
  | { suspicion: number }
  | { opinion: { subject: string; delta: number } }
  | { reputation: { scope: "global" | LabelId; delta: number } }
  | { setFlag: string }
  | { knowledge: { fact: FactId; disposition: KnowledgeDisposition } }
  /** An observation the NPC records as a `"told"` memory, in the authoring shorthand's parsed form. */
  | { memory: Observation }
  /** Records this fact as learned by the PLAYER — see `GameState.playerFacts` and docs/systems/case-system.md. */
  | { learnFact: FactId };

export type TopicId = string;

/**
 * One selectable conversation topic — the same `requires`/`when`-gated,
 * ordered-override pattern as `Npc.dialogueRules`, one level deeper: a
 * topic is OFFERED when its own `requires`/`when` hold, and once selected,
 * `responses` picks the answer the same way `dialogueRules` picks a line
 * (first match wins, else `textKey`). Reuses `Condition`/`DialogueEffect`
 * as-is — no new mechanism, just one more nesting level. See
 * docs/systems/dialogue.md's "Topic menus" section.
 */
export interface DialogueTopic {
  id: TopicId;
  /** Localization key for this topic's menu-option label. */
  labelKey: string;
  /** Fallback answer when no `responses` entry matches (or `responses` is empty). */
  textKey: string;
  /** Gates whether this topic is OFFERED at all. May be empty when `when` is set. */
  requires: string[];
  when?: Condition;
  /** Same shape/matching as `Npc.dialogueRules` — picks the answer once this topic is asked about. */
  responses: DialogueRule[];
}

/**
 * Mutable, saved, per-NPC state — the third layer of the NPC model (see
 * docs/systems/npcs.md). Lives on `GameState.npcStates`, never on `Npc`
 * (content is never saved). Seeded at new-game time from each NPC's
 * authored initial values by `cityLoader.ts`.
 */
export interface NpcState {
  trust: number;
  suspicion: number;
  /** Oldest first, capped at `MAX_MEMORIES_PER_NPC` (oldest dropped). */
  memories: Memory[];
  /** Opinion per subject: `"player"` or `"npc:<id>"`. */
  opinions: Record<string, number>;
  /** Per-case, mutable knowledge — seeded from the NPC's authored defaults. */
  knowledge: Record<FactId, KnowledgeDisposition>;
}

/** Player reputation: one global number plus one per label ("the docks know him"). */
export interface Reputation {
  global: number;
  byLabel: Record<LabelId, number>;
}

export interface Npc {
  id: NpcId;
  nameKey: string;
  descriptionKey: string;
  aliases: string[];
  /** Image shown in place of the location's while this NPC is being examined — see docs/systems/image-pane.md. Authored content, never saved. */
  image?: SceneImage;
  /**
   * Ordered flag-gated overrides, checked in order before falling back to
   * `dialogueKey` — see `GameEngine.talkTo` and docs/systems/dialogue.md.
   * Empty for an NPC with no conditional lines authored.
   */
  dialogueRules: DialogueRule[];
  /** Localization key for this NPC's default/fallback dialogue line — used when no `dialogueRules` entry matches. */
  dialogueKey: string;
  /** Role/affiliation labels — see `NpcLabel`. Empty when none authored. Static in v1. */
  labels: LabelId[];
  /**
   * Lookup-table daily routine. Absent (or no slot matching the current
   * time) means the NPC stays wherever `placement` last put them. See
   * `engine/npc/schedule.ts`.
   */
  schedule?: ScheduleSlot[];
  /**
   * Fixed, content-authored stat values for this NPC (e.g. a bouncer's
   * high intimidation). No mutation API — NPC stats don't change at
   * runtime this round — and no save-schema impact (NPCs are static
   * content, never saved — see GameState's doc comment). Absent keys, or
   * an absent stats object entirely, fall back to
   * STAT_DEFINITIONS[key].default via getStatValue — see
   * docs/systems/stats.md.
   */
  stats?: StatBlock;
  /**
   * Selectable conversation topics — see `DialogueTopic`. Absent/empty
   * means this NPC behaves exactly as before topics existed: `talk`
   * prints one line (a `dialogueRules` match, else `dialogueKey`) with no
   * menu. See docs/systems/dialogue.md's "Topic menus" section.
   */
  topics?: DialogueTopic[];
}

/**
 * WHERE every world object and NPC currently is — deliberately NOT stored
 * on `Location`/`Npc` themselves. World object/NPC placement is
 * case-instance data: it's set up once per case (today: copied straight
 * from `world.yaml`'s authored `itemIds`/`npcIds`/`locationId`/
 * `containerId`/`containerPartId` fields by `cityLoader.ts`; later:
 * produced by a procedural case generator drawing from the object/NPC
 * catalog — see the project's procedural-case-content plan) and can change
 * during play (an NPC walking somewhere, an object being moved) — it is
 * NOT part of the static city/catalog content that reloads unchanged from
 * YAML every launch. This is mutable state, alongside
 * `Player`/`GameClock` (nothing is persisted). A location/
 * NPC with nothing placed there simply has no entry pointing at it;
 * nothing needs an empty-array placeholder.
 */
export interface Placement {
  worldObjectLocationId: Record<WorldObjectId, LocationId>;
  npcLocationId: Record<NpcId, LocationId>;
  /**
   * Where a world object is placed INSIDE another world object's part,
   * instead of directly at a location — a torn photograph in a desk
   * drawer. Mutually exclusive with `worldObjectLocationId`: every world
   * object not in `player.inventory` has an entry in exactly one of the
   * two. See docs/systems/parts.md's "Containment."
   */
  containedIn: Record<WorldObjectId, { containerId: WorldObjectId; partId: PartId }>;
}

/**
 * A purchasable notebook product — content, not player progress (compare
 * `Notebook`, the actual owned instance in `NotebookState`). Mirrors
 * `Pass`'s shape closely since both are sold through the same generalized
 * `buy` menu — see docs/systems/notebooks.md's "Economy integration"
 * decision and `GameEngine.buyNotebook`.
 */
export interface NotebookProduct {
  id: string;
  /** Localization key for this product's display name, e.g. "Pocket Notebook". */
  nameKey: string;
  /** Words the command parser accepts to name this product, e.g. ["notebook", "pocket notebook"]. */
  aliases: string[];
  /** Minor-unit price to buy one. */
  priceMinor: number;
  /** How many blank pages a freshly-bought notebook starts with. */
  pageCount: number;
  /**
   * Total characters of ink a page can hold — see `Page.charCapacity`.
   * A FLAT budget, not lines × chars-per-line: an earlier version
   * capped both the page AND each individual entry in terms of ruled
   * LINES, which (a) fought the textarea's own natural word-wrap (the
   * two never lined up pixel-for-pixel, so wrapped text looked broken
   * against the ruled background) and (b) hard-stopped a note mid-thought
   * the moment it hit its own line cap, with no way to keep writing
   * except starting a whole new entry. A flat character budget avoids
   * both: a block is limited only by what's actually left on the page,
   * however many visual rows that ends up wrapping to. See
   * docs/systems/notebooks.md's "Page overflow" decision.
   */
  charCapacity: number;
}

/** `{day, time}` strings derived from a `CalendarDate` — locale-neutral (zero-padded ISO-shaped, not a translation key), matching `calendarDisplayParams`'s precedent of doing numeric formatting engine-side. See `engine/notebooks.ts`'s `toNoteTimestamp` and docs/systems/notebooks.md. */
export interface NoteTimestamp {
  /** "YYYY-MM-DD". */
  day: string;
  /** "HH:MM", 24-hour. */
  time: string;
}

/**
 * One contiguous run of text within a `NoteBlock`. Never deleted outright —
 * an edit that removes text just flips `struck: true` on the affected
 * span(s) instead, so old text survives struck-through. See
 * docs/systems/notebooks.md's editing model.
 */
export interface Span {
  id: string;
  text: string;
  struck: boolean;
  /**
   * When/where this span was struck — set only when `struck: true`, stamped
   * at BLOCK-COMMIT time (when the player exits the notebook UI), not the
   * exact keystroke that removed it — see docs/systems/notebooks.md's
   * "Editing" section for why. Stored for potential future review tooling;
   * NEVER shown in the notebook UI itself.
   */
  struckAt?: { timestamp: NoteTimestamp; locationId: LocationId };
}

/**
 * One note — created either by `jotDown` or by the player manually starting
 * a new note while editing. Auto-stamped with when/where it was created;
 * see docs/systems/notebooks.md's "Why blocks, not one flat span list."
 */
export interface NoteBlock {
  id: string;
  timestamp: NoteTimestamp;
  locationId: LocationId;
  spans: Span[];
  /**
   * Provenance for a block created by `jotDown` — e.g. `"examine:item.desk"`,
   * `"dialogue:npc.barkeep.line3"` — or absent for a free-standing thought
   * jotted with no particular source. Selecting the source text is entirely
   * a view/command concern (see docs/systems/notebooks.md's `jotDown`
   * section); the engine just stores whatever string it's given.
   */
  sourceRef?: string;
}

/**
 * One page of a `Notebook`. `charsUsed`/`charsRemaining` (see
 * `engine/notebooks.ts`) are derived at read time from `blocks`, never
 * stored, so they can't drift out of sync with the spans they're
 * computed from.
 */
export interface Page {
  /** Total characters of ink this page can hold — see `NotebookProduct.charCapacity`'s doc comment for why this is a flat budget rather than lines × chars-per-line. Seeded from the product at purchase time (`GameEngine.buyNotebook`). */
  charCapacity: number;
  blocks: NoteBlock[];
}

/** One notebook the player owns. `name` is free player-authored text, not a translation key — see docs/systems/notebooks.md's "Localization note." */
export interface Notebook {
  id: string;
  name: string;
  pages: Page[];
}

/**
 * Persistent notebook progress — a new sibling struct next to `Player`/
 * `clock`/`placement` in `GameState`'s mutable slice, per `CLAUDE.md`
 * boundary #6. JSON-safe (plain arrays/records only). See
 * docs/systems/notebooks.md.
 */
export interface NotebookState {
  notebooks: Notebook[];
  /** At most one notebook is active at a time — a single nullable field, not a per-notebook flag, so "two notebooks both active" simply can't be represented. See docs/systems/notebooks.md. */
  activeNotebookId: string | null;
}

export type BoardNodeId = string;

/**
 * One card on the case board. `refKind` identifies what real-world thing
 * it represents; `refId` is that entity's id (null for `"note"`, the only
 * kind with no referenced entity). `text` is the free-text body for
 * `"note"` nodes only — player-authored, never a translation key, same
 * posture as `Notebook.name`. `x`/`y` are board-space coordinates, set on
 * add and updated by dragging. See docs/systems/case-board.md.
 */
export interface BoardNode {
  id: BoardNodeId;
  refKind: "fact" | "npc" | "location" | "item" | "note";
  refId: FactId | NpcId | LocationId | WorldObjectId | null;
  text: string | null;
  x: number;
  y: number;
}

/** Fixed v1 palette a player picks from when drawing a string — see docs/systems/case-board.md. */
export type BoardStringColor = "red" | "blue" | "yellow" | "green";

/** A player-drawn "string" between two board nodes. Undirected — `fromNodeId`/`toNodeId` order carries no meaning. */
export interface BoardConnection {
  id: string;
  fromNodeId: BoardNodeId;
  toNodeId: BoardNodeId;
  color: BoardStringColor;
}

/**
 * The player's case board — a purely player-authored spatial layer over
 * things they've already encountered (known facts, NPCs met, locations
 * visited, inventory items) plus free-text notes, connected by colored
 * strings the player draws themselves. No auto-inference, no contradiction
 * detection — see docs/systems/case-board.md. Part of the mutable slice,
 * sibling to `notebooks`/`flags`/`playerFacts` on
 * `GameState`, per `CLAUDE.md` boundary #6. JSON-safe (plain arrays only).
 */
export interface BoardState {
  nodes: BoardNode[];
  connections: BoardConnection[];
}

export interface Player {
  locationId: LocationId;
  inventory: WorldObjectId[];
  /**
   * Integer minor units (like cents) — never a float, to avoid
   * floating-point drift across repeated add/spend. See
   * engine/economy/money.ts for why this is a scalar on Player rather than
   * a stackable Item: the current inventory model has no quantity concept,
   * and money is fundamentally a number, not a discrete owned object.
   */
  money: number;
  /**
   * Every LocationId the player has ever actually arrived at, in first-
   * visit order — set once by `content/world.ts`'s `createInitialState`
   * (containing at least the starting location) and grown by
   * `GameEngine`'s private `moveTo` helper, the single choke point both
   * `travelTo` and `executeHop` go through to change `locationId`. This is
   * what lets the locations panel default to spoiler-safe "discovered
   * only" instead of listing the whole map — see docs/systems/navigation.md.
   */
  visitedLocationIds: LocationId[];
  /**
   * Player's own stat values. Optional
   * and NOT eagerly populated for every StatKey: a fresh game/save may
   * omit a key (or the whole object) entirely, and getStatValue falls
   * back to that stat's own registry default, same as an NPC authored
   * before a stat existed. No mutation API/verb exists yet — see
   * GameEngine.getPlayerStat and docs/systems/stats.md; this round is
   * storage + fallback + query only.
   */
  stats?: StatBlock;
  /**
   * Whether the player currently intends to be sneaking — set only by the
   * `sneak` verb (GameEngine.toggleStealth). Persists across a failed
   * concealment roll; see `concealment` below and docs/systems/checks.md.
   *
   */
  stealthMode: boolean;
  /**
   * The last concealment roll's outcome while `stealthMode` is true —
   * undefined when not currently sneaking, or before the first roll.
   * Refreshed by toggleStealth(true) and by every successful travel while
   * already sneaking; see GameEngine.rerollConcealment and
   * docs/systems/checks.md.
   */
  concealment?: CheckOutcomeTier;
}

/**
 * Simulated time as minutes elapsed since the game's epoch (minute 0 =
 * `epoch`, 00:00). Kept as a single number rather than a Date-like struct
 * so advancing it (travel, waiting, etc.) is trivial arithmetic. `epoch`
 * is the real-world calendar date minute 0 corresponds to — set once by
 * content (see content/world.ts) — and `toCalendarDate`
 * (engine/time/calendar.ts) is what turns `minutesElapsed` into an
 * absolute date; this IS the only time format the game shows — see
 * docs/systems/time.md for why an earlier relative "Day N" reading was
 * dropped entirely rather than kept alongside it.
 */
export interface GameClock {
  minutesElapsed: number;
  epoch: CalendarEpoch;
}

export interface GameState {
  locations: Record<LocationId, Location>;
  worldObjects: Record<WorldObjectId, WorldObject>;
  npcs: Record<NpcId, Npc>;
  /** Every label definition — static content, see `NpcLabel`. */
  labels: Record<LabelId, NpcLabel>;
  /** Every purchasable notebook product — static content, like `passes`, sold through the same generalized `buy` menu. See `NotebookProduct` and docs/systems/notebooks.md. */
  notebookProducts: Record<string, NotebookProduct>;
  /** Every fact the player could learn — static content. See `Fact` and docs/systems/case-system.md. */
  facts: Record<FactId, Fact>;
  /** Where every world object/NPC currently is — see `Placement`'s doc comment for why this is separate from `locations`/`npcs`. */
  placement: Placement;
  /**
   * Current state id per world object/part — `partStates[objectId][partId]`.
   * Only objects with `parts` have an entry; each part starts at its own
   * `defaultStateId`, seeded by `cityLoader.ts`'s `initialPartStates`
   * (mirrors how `initialPlacement` seeds `placement`). See docs/systems/parts.md. A part with no
   * entry here falls back to its `defaultStateId` at read time (see
   * `GameEngine`'s `currentPartStateId` helper).
   */
  partStates: Record<WorldObjectId, Record<PartId, string>>;
  /**
   * Which world object (if any) is currently "focused" via `examine` —
   * see docs/systems/parts.md's focus-mode rules. A transient
   * interaction mode (like `MenuFlow`'s screen stack), not simulation state.
   * Lives here rather than on the view because the resolution rules that
   * read it (`examine`/`interact`) are core simulation logic.
   */
  focusedWorldObjectId: WorldObjectId | null;
  /**
   * What the player is currently examining, for the scene image pane — see
   * `GameEngine.getSceneImage` and docs/systems/image-pane.md. Broader than
   * `focusedWorldObjectId` (which only tracks objects with parts): plain
   * objects and NPCs count too. Transient like focus, and cleared at the same places focus is.
   */
  examinedTarget: ExaminedTarget | null;
  player: Player;
  clock: GameClock;
  /** Every notebook the player owns, plus which (if any) is active — see `NotebookState` and docs/systems/notebooks.md. Part of the mutable slice. */
  notebooks: NotebookState;
  /** Global flat flag store for dialogue conditions (and, later, case/deduction state) — see docs/systems/dialogue.md. Part of the mutable slice. */
  flags: Record<string, boolean>;
  /** Per-NPC mutable state (trust, memories, opinions, knowledge) — see `NpcState` and docs/systems/npcs.md. Part of the mutable slice. */
  npcStates: Record<NpcId, NpcState>;
  /** The player's public reputation — see `Reputation`. Part of the mutable slice. */
  reputation: Reputation;
  /**
   * Facts the player has learned, keyed by `FactId`, with when they first
   * learned it — set only via `learnFact` (`state.ts`), idempotent (first-
   * learned time wins). Joined with `facts` (the authored text) by
   * `GameEngine.getPlayerFacts()`. Part of the mutable slice. See
   * docs/systems/case-system.md.
   */
  playerFacts: Record<FactId, { atMinutes: number }>;
  /** The player's case board — see `BoardState`. Part of the mutable slice. */
  board: BoardState;
}

/**
 * A structured, localization-key-based description of something that
 * happened as a result of an action. Views resolve `textKey` (+ `params`)
 * to display text; the engine never produces display strings directly.
 * See docs/systems/event-log.md.
 */
export interface GameEvent {
  type: string;
  textKey: string;
  params?: Record<string, string>;
}

/**
 * One candidate when a query (e.g. `examine("letter")`) matched more than
 * one `WorldObject` in scope — see `GameEngine`'s `resolveWorldObjectQuery`
 * and docs/systems/parts.md's "Ambiguous targets." `id` is a real `WorldObjectId`, not an opaque string the view re-quotes
 * back as text — a view resolves the player's pick via the id-based
 * overload of the verb that produced the ambiguity (e.g.
 * `examine({ id })`), never by re-running alias matching on the option's
 * label, which is the whole point: id-based resolution is what actually
 * disambiguates two objects sharing a name.
 */
export interface ResolutionChoice {
  id: WorldObjectId;
  kind: "resolution";
  textKey: string;
  params?: Record<string, string>;
}

/**
 * Return shape of every engine action. `ok` distinguishes success/failure
 * for callers that need a quick branch; `events` is the full, ordered
 * account of what happened and is what views actually render. An action
 * commonly produces more than one event (e.g. traveling also produces a
 * "look" event for the new location).
 *
 * `choices`, when present, are options a view MAY render as a numbered
 * list and let the player select from on their very next input (a bare
 * number), rather than parsing it as a normal command. Choices are
 * deliberately NOT persisted engine-side — there is no "pending choice"
 * in GameState. The engine never remembers what it last offered; a view
 * remembers, and a selection becomes an ordinary, fully-specified
 * follow-up call (e.g. `examine({ id })`) that re-derives
 * the same result deterministically rather than replaying stored state.
 * This keeps the engine's per-call statelessness intact — see CLAUDE.md's
 * engine/view boundary — interaction-mode state belongs to the view.
 */
export interface ActionResult {
  ok: boolean;
  events: GameEvent[];
  choices?: ResolutionChoice[];
}

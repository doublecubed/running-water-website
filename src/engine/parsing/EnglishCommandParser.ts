import type { TravelCategory } from "../types";
import type { Command, PanelContentId, PanelSlot } from "./Command";
import type { ICommandParser, VerbHelp } from "./ICommandParser";

/**
 * Normalizes typed compass abbreviations to their canonical word. This is
 * purely a parsing convenience — it does NOT mean a connection exists in
 * that direction; GameEngine.travelTo checks the current location's actual
 * data for that. See docs/systems/navigation.md.
 */
const DIRECTION_ALIASES: Record<string, string> = {
  north: "north",
  n: "north",
  south: "south",
  s: "south",
  east: "east",
  e: "east",
  west: "west",
  w: "west",
  up: "up",
  u: "up",
  down: "down",
  d: "down",
  in: "in",
  inside: "in",
  out: "out",
  outside: "out",
};

/**
 * Normalizes typed preference words to a canonical TravelCategory — the
 * natural foot/transit/taxi choice, not an abstract fastest/cheapest goal
 * (see TravelCategory's doc comment in types.ts). "fastest"/"cheapest"
 * are deliberately NOT accepted here: they're inquiry-time labels a
 * category can earn, not a standing preference of their own.
 */
const PREFERENCE_ALIASES: Record<string, TravelCategory> = {
  foot: "foot",
  walk: "foot",
  walking: "foot",
  transit: "transit",
  bus: "transit",
  public: "transit",
  taxi: "taxi",
  cab: "taxi",
};

/** First-word aliases for `PanelSlot`, used by the `panel <slot> <content>` command. */
const PANEL_SLOT_ALIASES: Record<string, PanelSlot> = {
  left: "left",
  right: "right",
};

/**
 * Word aliases for `PanelContentId`, used by the `panel <slot> <content>`
 * command — see Command.ts's `setPanel` doc. Kept separate from (rather
 * than reusing) the `verbs`/`locations` VERB_RULES words above: those are
 * bare top-level commands in their own right, these are the second
 * argument to `panel`, and the two vocabularies happen to overlap only
 * because both ultimately name a `PanelContentId`.
 */
const PANEL_CONTENT_ALIASES: Record<string, PanelContentId> = {
  verbs: "verbs",
  commands: "verbs",
  locations: "locations",
  map: "locations",
  inventory: "inventory",
  inv: "inventory",
  facts: "facts",
  close: "closed",
  closed: "closed",
  off: "closed",
};

/**
 * Canonicalizes typed interaction-verb synonyms ("shut") to the single
 * canonical word content authors write in `PartState.enterAliases` — same
 * pattern as `DIRECTION_ALIASES`. Adding a new interaction verb WORD means
 * one new entry here plus one new VERB_RULES rule; which parts/states it
 * actually affects is entirely content-driven — see docs/systems/parts.md.
 *
 * Exported so `src/editor/main.ts`'s world object editor can validate an
 * authored `enterAliases` word against the SAME table the parser actually
 * uses, instead of hand-duplicating this list and risking the two drifting
 * apart — see that file's `unknownVerbs`.
 */
export const INTERACT_VERB_ALIASES: Record<string, string> = {
  open: "open",
  close: "close",
  shut: "close",
};

interface ParseContext {
  /** Words after the verb, as typed (already lowercased/trimmed). */
  rest: string[];
  /** The matched first word itself, e.g. "go", "n", "take". */
  verb: string;
  /** The full original input, for unknown/fallback events. */
  raw: string;
}

interface VerbRule {
  /** First-token words that trigger this rule. */
  words: string[];
  /** i18n key for this verb's usage line — the single source listVerbs() reads. */
  usageKey: string;
  /** Dev-only verb (e.g. devmoney, devlocations) — excluded from both parse() and listVerbs() unless the parser was constructed with devMode: true. See EnglishCommandParser's constructor doc comment. */
  dev?: true;
  build: (ctx: ParseContext) => Command;
}

/**
 * The parser's entire vocabulary, as data. `parse()` and `listVerbs()` both
 * read this table — there is no second, hand-maintained verb list to drift
 * out of sync. Adding a verb means adding one entry here.
 */
const VERB_RULES: VerbRule[] = [
  {
    words: ["look", "l"],
    usageKey: "verb.look.usage",
    build: () => ({ kind: "look" }),
  },
  {
    words: ["inventory", "i", "inv"],
    usageKey: "verb.inventory.usage",
    build: () => ({ kind: "inventory" }),
  },
  {
    words: ["help", "?"],
    usageKey: "verb.help.usage",
    build: () => ({ kind: "help" }),
  },
  {
    words: ["verbs", "commands"],
    usageKey: "verb.verbs.usage",
    build: () => ({ kind: "setPanel", slot: "right", content: "verbs" }),
  },
  {
    words: ["locations", "map"],
    usageKey: "verb.locations.usage",
    build: () => ({ kind: "setPanel", slot: "left", content: "locations" }),
  },
  {
    words: ["worldmap"],
    usageKey: "verb.worldmap.usage",
    build: () => ({ kind: "toggleWorldMap" }),
  },
  {
    words: ["panel"],
    usageKey: "verb.panel.usage",
    build: ({ rest, raw }) => {
      const [slotWord, ...contentWords] = rest;
      const slot = slotWord ? PANEL_SLOT_ALIASES[slotWord] : undefined;
      if (!slot) return { kind: "unknown", raw };
      // Bare "panel <slot>" (no content word) opens a menu instead of
      // failing as unknown — same treatment as bare "buy"/"travel".
      if (contentWords.length === 0) return { kind: "panelMenu", slot };
      const content = PANEL_CONTENT_ALIASES[contentWords.join(" ")];
      return content ? { kind: "setPanel", slot, content } : { kind: "unknown", raw };
    },
  },
  {
    words: ["go", "travel", ...Object.keys(DIRECTION_ALIASES)],
    usageKey: "verb.travel.usage",
    build: ({ verb, rest, raw }) => {
      if (verb === "go" || verb === "travel") {
        const query = rest.filter((w) => w !== "to").join(" ");
        if (query) return { kind: "travel", query };
        // Bare "go" stays unknown (no meaningful "go menu"); bare "travel" opens the direct-connections menu.
        return verb === "travel" ? { kind: "travelMenu" } : { kind: "unknown", raw };
      }
      const direction = DIRECTION_ALIASES[verb];
      return direction ? { kind: "travel", query: direction } : { kind: "unknown", raw };
    },
  },
  {
    words: ["take", "get", "pick"],
    usageKey: "verb.take.usage",
    build: ({ rest, raw }) => {
      const query = rest.filter((w) => w !== "up").join(" ");
      return query ? { kind: "take", query } : { kind: "unknown", raw };
    },
  },
  {
    words: ["buy", "purchase"],
    usageKey: "verb.buy.usage",
    build: ({ rest }) => {
      const query = rest.join(" ");
      // Bare "buy" opens the generalized buy menu instead of failing as
      // unknown — see docs/systems/notebooks.md's "Economy integration"
      // decision and Command.ts's "buyMenu" doc comment.
      return query ? { kind: "buy", query } : { kind: "buyMenu" };
    },
  },
  {
    words: ["talk", "ask", "speak"],
    usageKey: "verb.talk.usage",
    build: ({ rest, raw }) => {
      const query = rest.filter((w) => w !== "to" && w !== "with").join(" ");
      return query ? { kind: "talk", query } : { kind: "unknown", raw };
    },
  },
  {
    words: ["examine", "x", "inspect"],
    usageKey: "verb.examine.usage",
    build: ({ rest, raw }) => {
      const query = rest.join(" ");
      return query ? { kind: "examine", query } : { kind: "unknown", raw };
    },
  },
  {
    words: Object.keys(INTERACT_VERB_ALIASES),
    usageKey: "verb.interact.usage",
    build: ({ verb, rest, raw }) => {
      const query = rest.join(" ");
      return query ? { kind: "interact", verb: INTERACT_VERB_ALIASES[verb]!, query } : { kind: "unknown", raw };
    },
  },
  {
    words: ["back", "stop"],
    usageKey: "verb.unfocus.usage",
    build: () => ({ kind: "unfocus" }),
  },
  {
    words: ["time", "clock"],
    usageKey: "verb.time.usage",
    build: () => ({ kind: "time" }),
  },
  {
    words: ["sneak"],
    usageKey: "verb.sneak.usage",
    build: () => ({ kind: "toggleStealth" }),
  },
  {
    words: ["prefer", "preference"],
    usageKey: "verb.prefer.usage",
    build: ({ rest, raw }) => {
      if (rest.length === 0) return { kind: "travelPreference" };
      const preference = PREFERENCE_ALIASES[rest[0]!];
      return preference ? { kind: "travelPreference", preference } : { kind: "unknown", raw };
    },
  },
  {
    words: ["notebook", "notebooks"],
    usageKey: "verb.notebook.usage",
    build: () => ({ kind: "notebook" }),
  },
  {
    words: ["board", "corkboard"],
    usageKey: "verb.board.usage",
    build: () => ({ kind: "board" }),
  },
  {
    words: ["jot", "jotdown"],
    usageKey: "verb.jotDown.usage",
    build: ({ raw }) => {
      // Rebuilds from the ORIGINAL (not lowercased) raw text, unlike every
      // other rule here — a jotted note is player-authored free text (see
      // docs/systems/notebooks.md's "Localization note"), so its casing
      // must survive, not get flattened by parse()'s blanket
      // `.toLowerCase()`. Only a LEADING "down" is stripped ("jot down the
      // desk was locked") — never one occurring naturally within the
      // note's own text.
      const words = raw.trim().split(/\s+/);
      words.shift();
      if (words[0]?.toLowerCase() === "down") words.shift();
      const text = words.join(" ");
      return text ? { kind: "jotDown", text } : { kind: "jotDownPick" };
    },
  },
  {
    words: ["save"],
    usageKey: "verb.save.usage",
    build: () => ({ kind: "save" }),
  },
  {
    words: ["load"],
    usageKey: "verb.load.usage",
    build: () => ({ kind: "load" }),
  },
  {
    words: ["devmoney"],
    usageKey: "verb.devMoney.usage",
    dev: true,
    build: ({ rest, raw }) => {
      // Typed in dollars, like every other player-facing money figure —
      // converted to minor units the same way the rest of the engine
      // represents money. A negative amount is allowed on purpose (a dev
      // tool for testing the insufficient-funds path), unlike a normal
      // in-fiction way to gain/lose money.
      const dollars = Number(rest[0]);
      if (rest.length !== 1 || !Number.isFinite(dollars) || dollars === 0) return { kind: "unknown", raw };
      return { kind: "devAddMoney", amountMinor: Math.round(dollars * 100) };
    },
  },
  {
    words: ["devlocations"],
    usageKey: "verb.devLocations.usage",
    dev: true,
    build: () => ({ kind: "devToggleAllLocations" }),
  },
];

/**
 * English verb-first parsing: "go north", "take letter", "talk to barkeep".
 * This is one ICommandParser implementation among potentially several — see
 * docs/systems/parsing.md before assuming its word-order/particle rules
 * ("to", "up") generalize to another language's parser.
 *
 * `devMode` gates the `dev: true` VERB_RULES entries (devmoney,
 * devlocations) out of BOTH `parse()` and `listVerbs()` when false — a
 * dev-only verb typed in a production build is just unrecognized input,
 * not merely hidden from the help panel. Deliberately a plain constructor
 * flag rather than reading `import.meta.env.DEV` here: this file is
 * environment-agnostic engine code (see CLAUDE.md's engine/view
 * boundary), so the actual environment check belongs at the composition
 * root (`main.ts`), which decides what to pass in.
 */
export class EnglishCommandParser implements ICommandParser {
  constructor(private readonly devMode: boolean = false) {}

  parse(raw: string): Command {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return { kind: "unknown", raw };

    const [verb = "", ...rest] = trimmed.split(/\s+/);
    const rule = VERB_RULES.find((r) => r.words.includes(verb) && (!r.dev || this.devMode));
    return rule ? rule.build({ verb, rest, raw }) : { kind: "unknown", raw };
  }

  listVerbs(): VerbHelp[] {
    return VERB_RULES.filter((rule) => !rule.dev || this.devMode).map((rule) => ({ usageKey: rule.usageKey }));
  }
}

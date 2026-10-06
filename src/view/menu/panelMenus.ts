import type { PanelContentId, PanelSlot } from "../../engine/parsing/Command";
import type { MenuOption, MenuOutcome, MenuScreen } from "./MenuFlow";

const MENU_KIND = "panel";

/** Option label keys for every content a side panel can show, "closed" (offered as "None") included. Order here is the order options are numbered. */
const PANEL_OPTION_KEYS: Record<PanelContentId, string> = {
  locations: "ui.panelOptionLocations",
  verbs: "ui.panelOptionVerbs",
  inventory: "ui.panelOptionInventory",
  facts: "ui.panelOptionFacts",
  closed: "ui.panelOptionNone",
};

/**
 * The screen behind bare `panel <slot>` (no content named) — see
 * Command.ts's `panelMenu` doc. Purely view-side: `setContent` is
 * `TerminalView`'s own panel-slot state setter, since which content a slot
 * shows isn't GameEngine state at all (see `PanelRenderContext`).
 */
export function buildPanelMenuScreen(slot: PanelSlot, setContent: (content: PanelContentId) => void): MenuScreen {
  const options: MenuOption[] = (Object.keys(PANEL_OPTION_KEYS) as PanelContentId[]).map((content) => ({
    textKey: PANEL_OPTION_KEYS[content],
    aliases: content === "closed" ? ["none"] : undefined,
    select: (): MenuOutcome => {
      setContent(content);
      return { type: "exit", events: [] };
    },
  }));

  return {
    kind: "choices",
    menuKind: MENU_KIND,
    // `slot` itself ("left"/"right") isn't a translation key — t() falls
    // back to using a param's raw text whenever it isn't one, so this
    // works without a dedicated ui.panelSlot.* lookup table.
    header: [{ type: "panel_menu_header", textKey: "event.panelMenuHeader", params: { slot } }],
    options,
  };
}

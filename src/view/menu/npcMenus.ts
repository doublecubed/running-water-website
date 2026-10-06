import type { GameEngine } from "../../engine/GameEngine";
import type { GameEvent, NpcId } from "../../engine/types";
import type { MenuOption, MenuOutcome, MenuScreen } from "./MenuFlow";

const MENU_KIND = "dialogue";

/**
 * The topic menu opened by `talk <npc>` when that NPC has any topic
 * currently offered — see docs/systems/dialogue.md's "Topic menus"
 * section. Rebuilt (not mutated) on every selection: `askAbout`'s answer
 * becomes the NEXT screen's `header` (a `MenuOutcome.goto` carries no
 * separate printable events — see MenuFlow.ts's doc comment), and
 * re-deriving the option list from `topicsForNpcId` each time picks up any
 * availability change the answer itself may have caused (e.g. an
 * opinion-gated topic's answer changing once a threshold is crossed).
 */
export function buildTopicsScreen(engine: GameEngine, npcId: NpcId, header: GameEvent[]): MenuScreen {
  const options: MenuOption[] = engine.topicsForNpcId(npcId).map((topic) => ({
    textKey: topic.labelKey,
    select: (): MenuOutcome => {
      const result = engine.askAbout(npcId, topic.id);
      return { type: "goto", screen: buildTopicsScreen(engine, npcId, result.events) };
    },
  }));
  options.push({
    textKey: "ui.leaveConversationOption",
    aliases: ["leave"],
    select: (): MenuOutcome => ({ type: "exit", events: [] }),
  });

  return { kind: "choices", menuKind: MENU_KIND, header, options };
}

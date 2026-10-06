import type { GameEngine } from "../../engine/GameEngine";
import type { ActionResult, Notebook } from "../../engine/types";
import { t } from "../../i18n/resolver";
import type { MenuOption, MenuOutcome, MenuScreen } from "./MenuFlow";

const MENU_KIND = "notebook";

/** Notebook.name is free player text, possibly still empty right after a purchase — this is the one place that needs a display fallback, resolved here (a view file) rather than left blank. */
function displayName(notebook: Notebook): string {
  return notebook.name || t("ui.unnamedNotebook");
}

/**
 * Bare `notebook` (`docs/systems/notebooks.md`'s "Notebook selection"):
 * no notebooks owned fails cleanly (no menu to open); exactly one owned
 * skips straight to ITS actions screen (open/rename/active/dispose,
 * skipping the "which one?" step entirely); 2+ prompts which one first.
 */
export function openNotebookCommand(engine: GameEngine): { result: ActionResult; screen?: MenuScreen } {
  const notebooks = engine.getNotebooks();
  if (notebooks.length === 0) {
    return { result: { ok: false, events: [{ type: "no_notebooks_owned", textKey: "event.noNotebooksOwned" }] } };
  }
  if (notebooks.length === 1) {
    return { result: { ok: true, events: [] }, screen: buildNotebookActionsScreen(engine, notebooks[0]!.id) };
  }
  return { result: { ok: true, events: [] }, screen: buildNotebookPickerScreen(engine) };
}

function buildNotebookPickerScreen(engine: GameEngine): MenuScreen {
  const options: MenuOption[] = engine.getNotebooks().map((notebook) => ({
    textKey: "ui.notebookOption",
    params: { name: displayName(notebook) },
    select: (): MenuOutcome => ({ type: "goto", screen: buildNotebookActionsScreen(engine, notebook.id) }),
  }));
  return {
    kind: "choices",
    menuKind: MENU_KIND,
    header: [{ type: "which_notebook_prompt", textKey: "event.whichNotebookPrompt" }],
    options,
  };
}

/**
 * "The notebook interface" itself (docs/systems/notebooks.md): open the
 * actual page-view overlay, rename, mark active/clear active, or dispose
 * (behind its own confirm screen). "Open" exits the menu with a
 * `notebook_opened` marker event — `TerminalView` watches for that type
 * specifically and reacts by showing the page-view overlay; the event
 * still carries a real, printable `event.notebookOpened` line, it's not
 * a silent signal.
 */
function buildNotebookActionsScreen(engine: GameEngine, notebookId: string): MenuScreen {
  const notebook = engine.getNotebooks().find((n) => n.id === notebookId);
  if (!notebook) {
    return {
      kind: "choices",
      menuKind: MENU_KIND,
      header: [{ type: "notebook_not_found", textKey: "event.notebookNotFound", params: { query: notebookId } }],
      options: [],
    };
  }

  const isActive = engine.getActiveNotebookId() === notebookId;
  const options: MenuOption[] = [
    {
      textKey: "ui.openNotebookOption",
      select: (): MenuOutcome => ({
        type: "exit",
        events: [{ type: "notebook_opened", textKey: "event.notebookOpened", params: { name: displayName(notebook), notebookId } }],
      }),
    },
    {
      textKey: "ui.renameNotebookOption",
      select: (): MenuOutcome => ({ type: "goto", screen: buildRenamePromptScreen(engine, notebookId) }),
    },
    isActive
      ? {
          textKey: "ui.clearActiveNotebookOption",
          select: (): MenuOutcome => ({ type: "exit", events: engine.clearActiveNotebook().events }),
        }
      : {
          textKey: "ui.setActiveNotebookOption",
          select: (): MenuOutcome => ({ type: "exit", events: engine.setActiveNotebook(notebookId).events }),
        },
    {
      textKey: "ui.disposeNotebookOption",
      select: (): MenuOutcome => ({ type: "goto", screen: buildDisposeConfirmScreen(engine, notebookId) }),
    },
  ];

  return {
    kind: "choices",
    menuKind: MENU_KIND,
    header: [{ type: "notebook_actions_header", textKey: "event.notebookActionsHeader", params: { name: displayName(notebook) } }],
    options,
  };
}

function buildRenamePromptScreen(engine: GameEngine, notebookId: string): MenuScreen {
  return {
    kind: "prompt",
    menuKind: MENU_KIND,
    header: [{ type: "rename_notebook_prompt", textKey: "event.renameNotebookPrompt" }],
    submit: (input: string): MenuOutcome => ({ type: "exit", events: engine.renameNotebook(notebookId, input.trim()).events }),
  };
}

/** Disposal requires this explicit confirm step — see docs/systems/notebooks.md's "Notebook disposal" decision. Warns specifically when disposing the ACTIVE notebook, since that also silently clears `activeNotebookId` to null. */
function buildDisposeConfirmScreen(engine: GameEngine, notebookId: string): MenuScreen {
  const notebook = engine.getNotebooks().find((n) => n.id === notebookId);
  const wasActive = engine.getActiveNotebookId() === notebookId;
  return {
    kind: "choices",
    menuKind: MENU_KIND,
    header: [
      {
        type: "dispose_notebook_confirm",
        textKey: "event.disposeNotebookConfirm",
        params: { name: notebook ? displayName(notebook) : notebookId, activeNote: wasActive ? "ui.disposeActiveNotebookWarning" : "" },
      },
    ],
    options: [
      { textKey: "ui.confirmDispose", select: (): MenuOutcome => ({ type: "exit", events: engine.disposeNotebook(notebookId).events }) },
      { textKey: "ui.cancelDispose", select: (): MenuOutcome => ({ type: "exit", events: [{ type: "menu_cancelled", textKey: "event.menuCancelled" }] }) },
    ],
  };
}

/**
 * `jotDown` when no notebook is active — prompts which one to jot into
 * (docs/systems/notebooks.md's `jotDown` section, step 3). Selecting one
 * jots immediately and closes; does NOT make it the active notebook —
 * that's a separate, explicit action via the notebook actions screen.
 */
export function buildJotDownPickerScreen(engine: GameEngine, text: string, sourceRef?: string): MenuScreen {
  const options: MenuOption[] = engine.getNotebooks().map((notebook) => ({
    textKey: "ui.notebookOption",
    params: { name: displayName(notebook) },
    select: (): MenuOutcome => ({ type: "exit", events: engine.jotNote(notebook.id, text, sourceRef).events }),
  }));
  return {
    kind: "choices",
    menuKind: MENU_KIND,
    header: [{ type: "which_notebook_prompt", textKey: "event.whichNotebookPrompt" }],
    options,
  };
}

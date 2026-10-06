# Case board — manual/browser verification checklist

Companion to `docs/systems/case-board.md`. Automated coverage (`vitest`)
is thorough for logic; this tracks what still needs eyes-on browser
verification, per stage — same convention as
`docs/npc-editor-manual-tests-plan.md`.

## Stage 1 — engine/data layer, save migration, command skeleton

No UI ships in this stage — everything is covered by headless tests
(`src/engine/board/board.test.ts`, `GameEngine.test.ts`'s "case board"
block, `save.test.ts`'s schema-13 migration tests,
`EnglishCommandParser.test.ts`). Nothing to manually verify yet, EXCEPT:

- [ ] Typing `board` or `corkboard` in the running game doesn't crash or
      print "unknown command" — should silently no-op (the Stage 1
      placeholder), confirming the command skeleton is wired end to end
      ahead of Stage 2's real overlay.
- [ ] Load an existing save made before this change (schema 12 or
      earlier) and confirm it still loads without error (the 12→13
      migration backfills `board` transparently).

## Stage 2 — full-screen overlay view

- [ ] `board`/`corkboard` opens a full-screen overlay; the toolbar's
      Close button (or typing `board`/`corkboard` again) returns to the
      terminal (no ESC binding exists for any overlay in this codebase —
      don't expect one).
- [ ] Dragging a node card BY ITS BODY (not the pin) visibly follows the
      cursor and, on release, stays at the dropped position after
      closing/reopening the board (confirms `moveBoardNode` only fires on
      drag-end, and the position persists across a save/load).
- [ ] A brief click on a node's body (no real drag) does NOT move it and
      does not start a connection.
- [ ] A `"note"` card shows plain text at rest; hovering it reveals a
      pencil icon; clicking the pencil swaps in an editable textarea,
      focused immediately; the edit commits on blur and survives a
      reopen, returning to plain-text display.
- [ ] Reference nodes (fact/NPC/location/item) never show a pencil icon.
- [ ] Pressing and holding a node's pin, dragging, shows a thread
      following the cursor live; releasing over a DIFFERENT node's pin
      opens the color swatch picker near the drop point; picking a color
      draws a line between the two nodes' pins (not their top-left
      corners) in that color.
- [ ] Releasing a pin-drag over the SAME node, or over empty canvas
      space, cancels cleanly — no popover, no connection, no leftover
      temporary thread.
- [ ] Dragging a node's pin does NOT move the node itself.
- [ ] An existing string can be recolored by clicking it (a fairly wide
      area around the visible line should register the click) and
      picking a new swatch; the same popover's "×" removes the string
      instead, without touching its two endpoint nodes.
- [ ] Removing a node (its card's "×") also removes any string attached
      to it.
- [ ] Strings render ABOVE node cards by default (visibly crossing over
      card text is fine); hovering a card visibly brings it above any
      string crossing it, so its text stays legible on demand.
- [ ] The board renders correctly with zero nodes (empty-state hint) and
      with a realistic number of nodes/connections (no visual overlap
      making cards unreadable).

## Stage 3 — node picker, note authoring

Node/connection deletion and recoloring already shipped in Stage 2 (see
above) — nothing left to check for those here.

- [ ] "+ Add node" opens a category picker (Facts/People/Places/Items/
      Note); each reference category lists only entities the player has
      actually encountered, and excludes anything already on the board.
- [ ] Adding a fact/NPC/location/item node shows the correct resolved
      display label (not a raw id or an untranslated key).
- [ ] "Note" opens a free-text prompt; the resulting card shows and
      persists the typed text.
- [ ] A category with nothing eligible yet (e.g. no facts learned) shows
      the empty-category message instead of a blank list.

## General regression checks (repeat after each stage)

- [ ] `npx tsc --noEmit && npx vitest run && npm run build` all pass.
- [ ] Opening/closing the board overlay (once it exists) doesn't affect
      the side panels, the notebook overlay, or the world-map overlay —
      each still opens/closes independently.
- [ ] A full save → reload round-trip preserves the board exactly
      (node positions, note text, connection colors).

/**
 * The one piece of `MapView.ts`'s drag-gesture handling that's genuinely
 * shared with `src/view/boardView.ts` (Stage 2 of the case board — see
 * docs/systems/case-board.md): the click-vs-drag threshold. Everything
 * else in `MapView`'s pointer handling (`dragState`, pan-via-viewBox,
 * node-drag-via-`clientToUser`) is tied to SVG viewBox math that has no
 * equivalent shape in the board's plain CSS-transform-positioned HTML
 * cards — extracting a shared "DragGesture" state machine across both
 * would force an abstraction over two genuinely different coordinate
 * systems for no real benefit, so this module deliberately stays small
 * (a documented, deliberate scope call — see docs/systems/case-board.md).
 */

/**
 * Below this much total pointer movement, a press+release counts as a
 * click, not a drag. See `MapView.ts`'s original doc comment on this
 * constant for why a small value (e.g. 4px) misreads ordinary clicks as
 * micro-drags on a real mouse/trackpad.
 */
export const CLICK_MOVEMENT_THRESHOLD_PX = 10;

/** Total on-screen pointer movement since a gesture started — the input to `isClick`. */
export function movedDistance(dxClient: number, dyClient: number): number {
  return Math.hypot(dxClient, dyClient);
}

/** Whether a gesture that moved this many pixels total should resolve as a click rather than a drag. */
export function isClick(movedPx: number): boolean {
  return movedPx < CLICK_MOVEMENT_THRESHOLD_PX;
}

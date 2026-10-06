# Image pane — manual/browser verification checklist

Companion to `docs/systems/image-pane.md`; vitest covers wiring, not layout.

- [ ] Start the game, go to the Back Alley: the placeholder image appears
      between the location line and the log; other locations show no pane.
- [ ] Travelling away hides/swaps the image; travelling back restores it.
- [ ] Hover a hotspot: outline appears; the tooltip shows its label.
- [ ] Hotspot rectangles line up with the picture (stranger's outline
      around the figure; the south hotspot over the bottom strip) at
      several window widths, including a narrow/mobile width.
- [ ] Clicking "Talk to the stranger" echoes `> talk informant` and runs it;
      "Head south" moves to the street and the image goes away.
- [ ] Text half-typed in the input box survives a hotspot click.
- [ ] Tab reaches each hotspot; Enter/Space activates it.
- [ ] The log stays usable (image never pushes the input off-screen).
- [ ] Layout: entering the alley causes no browser scrollbar and the page
      doesn't move; the panel keeps the same size for any image; the log
      shrinks from the top (newest lines stay visible). Leaving the alley
      gives the log the full height back.
- [ ] A small image is centered at natural size with padding; a large one is
      scaled down. Hotspots still line up in both cases.
- [ ] Hovering the log expands it over the image (top strip of the image
      stays visible); moving the pointer out collapses it after a moment,
      with no flicker at the edges. Scrolling inside the expanded log works
      and it stays scrolled to the newest line.
- [ ] The log toggle button (top-right of the panel) cycles Auto → Expanded →
      Collapsed → Auto on each click, and its label always names the current
      mode. In Expanded the log stays over the image with no hovering; in
      Collapsed hovering the log does nothing; back in Auto, hover behaves as
      before. It works by keyboard and by tap on a phone-width window, and is
      absent at locations without an image.
- [ ] Typing in the input does not change the log mode.

Examine-driven images (placeholder art on the office desk):
- [ ] In the office (no location image), `examine desk`: the pane appears with
      the desk picture showing the right drawer OPEN; hotspots line up.
- [ ] `close right drawer` (typed, or the "Close the right drawer" hotspot)
      swaps to the closed-drawer picture; `open right drawer` swaps back.
- [ ] `back` (or travelling) hides the pane / restores the location image.
- [ ] Examining something with no image while a location image is up leaves
      the location image showing.
- [ ] Save while examining, load: pane shows the location image again;
      `examine desk` shows the picture for the SAVED drawer state.
- [ ] `npx tsc --noEmit && npx vitest run && npm run build` pass.

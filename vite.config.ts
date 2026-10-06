import { defineConfig } from "vite";

/**
 * Two entry points share this one Vite project: `index.html` (the game)
 * and `editor.html` (the map editor). Both import the same
 * src/mapview/MapView.ts and src/content/cityLoader.ts — they must never
 * drift apart, which is the whole reason the editor lives here instead of
 * a separate app/repo. See docs/architecture.md.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        editor: "editor.html",
      },
    },
  },
  test: {
    // Only src/mapview/MapView.ts (and future editor tests) touch the DOM;
    // everything else (the headless engine, i18n, cityLoader) doesn't need
    // it but is unaffected by jsdom being available.
    environment: "jsdom",
  },
});

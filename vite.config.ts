import { defineConfig } from "vite";

/**
 * The production build is the game only (`index.html`). `editor.html` (the
 * map editor) is a dev-time tool: `npm run dev:editor` still serves it, but
 * it is deliberately not a build input, so it never ships to the website.
 * Both pages share src/mapview/MapView.ts and src/content/cityLoader.ts, which
 * is why the editor lives in this project. See docs/architecture.md.
 *
 * `base: "./"` makes asset URLs relative, so the same build works under
 * GitHub Pages' /<repo>/ subpath and on a custom domain.
 */
export default defineConfig({
  base: "./",
  test: {
    // Only src/mapview/MapView.ts (and future editor tests) touch the DOM;
    // everything else (the headless engine, i18n, cityLoader) doesn't need
    // it but is unaffected by jsdom being available.
    environment: "jsdom",
  },
});

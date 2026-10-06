import { createInitialState } from "./content/world";
import { GameEngine } from "./engine/GameEngine";
import { getCommandParser } from "./engine/parsing/registry";
import { DEFAULT_IMAGE_DITHER_STEPS, DEFAULT_IMAGE_FADE_DURATION_MS } from "./view/imagePane";
import { TerminalView } from "./view/TerminalView";

const ACTIVE_LANGUAGE = "en"; // Swap via engine/parsing/registry + i18n/resolver's TABLES when a second language is added.

const appEl = document.querySelector<HTMLDivElement>("#app")!;
const engine = new GameEngine(createInitialState());
// import.meta.env.DEV (Vite) is a build-time flag: true under `npm run
// dev`, statically false and dead-code-eliminated in a production build
// — so dev-only verbs (devmoney, devlocations) simply don't exist for a
// shipped build, not merely hidden. See registry.ts/EnglishCommandParser.
const parser = getCommandParser(ACTIVE_LANGUAGE, import.meta.env.DEV);
// Scene-image look, adjusted here in code (not a player setting). With dither
// on, image fades are a stepped pixel dissolve instead of an opacity fade;
// DITHER_STEPS is how many frames it takes (fewer = chunkier).
const IMAGE_FADE_DURATION_MS = DEFAULT_IMAGE_FADE_DURATION_MS;
const IMAGE_DITHER_ENABLED = true;
const IMAGE_DITHER_STEPS = DEFAULT_IMAGE_DITHER_STEPS;
const view = new TerminalView(appEl, engine, parser, IMAGE_FADE_DURATION_MS, IMAGE_DITHER_ENABLED, IMAGE_DITHER_STEPS);
void view.start();

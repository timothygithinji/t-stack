/**
 * Static registry of built-in presets. Importing them here causes Bun's
 * bundler to inline the preset modules into dist/cli.js at build time.
 *
 * This sidesteps a runtime hazard: Node refuses to strip types from .ts
 * files located under node_modules, so the published package can't load
 * presets/*.ts dynamically via `import()`. Bundling them in means the
 * published artifact ships only dist/cli.js — no .ts source needed.
 *
 * loadPreset() consults this registry first, then falls back to a
 * filesystem scan for user-added presets (currently unused, kept as a
 * future extension point).
 */
import monorepoCf from "../presets/monorepo-cf.js";
import soloCfWorker from "../presets/solo-cf-worker.js";
import type { PresetDef } from "./core/preset.js";

export const BUILTIN_PRESETS: Readonly<Record<string, PresetDef>> = {
  "monorepo-cf": monorepoCf,
  "solo-cf-worker": soloCfWorker,
};

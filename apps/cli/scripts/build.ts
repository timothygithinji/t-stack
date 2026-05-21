#!/usr/bin/env bun
/**
 * Build the CLI: bundle workspace packages (@t-stack/*) into dist/cli.js,
 * keep regular npm dependencies external so they resolve normally at runtime.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "pathe";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = join(SCRIPT_DIR, "../package.json");
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as {
  dependencies?: Record<string, string>;
};
const deps = Object.keys(pkg.dependencies ?? {});
const external = deps.filter((d) => !d.startsWith("@t-stack/"));

const result = await Bun.build({
  entrypoints: [join(SCRIPT_DIR, "../src/cli.ts")],
  outdir: join(SCRIPT_DIR, "../dist"),
  target: "node",
  format: "esm",
  external,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const bytes = result.outputs.reduce((sum, o) => sum + o.size, 0);
console.log(`Bundled CLI: ${(bytes / 1024).toFixed(1)} KB → dist/cli.js`);

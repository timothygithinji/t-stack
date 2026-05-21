#!/usr/bin/env bun
/**
 * Strip @t-stack/* workspace deps from package.json before publishing.
 * Bun's build inlines those packages into dist/cli.js, so the published
 * package doesn't need them as runtime deps. Leaving them in would break
 * `npm install` against the published tarball because consumers can't
 * resolve `workspace:*`.
 *
 * Wired as `prepublishOnly` (not `prepack`) so the stripped package.json is
 * still on disk when npm captures the registry version-metadata document
 * after pack. With a postpack-restore the metadata would carry workspace:*
 * even though the tarball was clean, and `bun install` reads from that
 * metadata, not the tarball.
 *
 * The companion script restore-publish.ts puts the original back via
 * `postpublish`, after the upload has completed.
 */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG = join(SCRIPT_DIR, "../package.json");
const BACKUP = join(SCRIPT_DIR, "../package.json.publish-bak");

await copyFile(PKG, BACKUP);
const raw = await readFile(PKG, "utf8");
const pkg = JSON.parse(raw) as {
  dependencies?: Record<string, string>;
};
if (pkg.dependencies) {
  for (const key of Object.keys(pkg.dependencies)) {
    if (key.startsWith("@t-stack/")) {
      delete pkg.dependencies[key];
    }
  }
}
await writeFile(PKG, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
console.log("prepare-publish: stripped @t-stack/* from dependencies");

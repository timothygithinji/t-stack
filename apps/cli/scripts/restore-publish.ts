#!/usr/bin/env bun
/**
 * Companion to prepare-publish.ts — restore package.json from the backup
 * once npm publish has finished consuming the stripped version. Wired as
 * `postpublish` (not `postpack`) so the restore happens after the registry
 * metadata is captured, not before.
 */
import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG = join(SCRIPT_DIR, "../package.json");
const BACKUP = join(SCRIPT_DIR, "../package.json.publish-bak");

if (existsSync(BACKUP)) {
  await rename(BACKUP, PKG);
  console.log("restore-publish: package.json restored");
}

#!/usr/bin/env bun
/**
 * Copy templates from the canonical `@t-stack/templates` source into
 * `apps/cli/templates/` so the CLI's filesystem-based scaffold reads them
 * at the legacy `<cliRoot>/templates/` location.
 *
 * Runs in dev (predev, pretest), at build (prebuild), and at publish (prepack).
 * `apps/cli/templates/` is gitignored — this script is the source of truth.
 */
import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "pathe";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = join(SCRIPT_DIR, "../../../packages/templates/files");
const DEST = join(SCRIPT_DIR, "../templates");

await rm(DEST, { recursive: true, force: true });
await cp(SRC, DEST, { recursive: true });
console.log(`Synced ${SRC} → ${DEST}`);

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as p from "@clack/prompts";
import { initSchema } from "@t-stack/schema";
import { renderTemplate } from "@t-stack/templating";
import { defineCommand } from "citty";
import { execa } from "execa";
import { dirname, isAbsolute, join, resolve } from "pathe";
import { createSpinner } from "../core/log.js";
import { createOrgsStore } from "../core/orgs.js";
import type {
  EnvScope,
  InitDecisions,
  OrgProfile,
  PresetDef,
} from "../core/preset.ts";
import type { State } from "../core/state.ts";
import { resolveZoneForDomain } from "../core/zones.js";
import {
  buildPaths,
  findCliRoot,
  loadPreset,
  resolvePresetId,
} from "./_ctx.js";

export interface ScaffoldOptions {
  cwd: string;
  decisions: InitDecisions;
  cliRoot?: string;
  /** Skip the post-render `bun install` (default: install runs). */
  skipInstall?: boolean;
  /** Pre-resolved preset. When omitted, derived from decisions.structure. */
  preset?: PresetDef;
  /** Explicit preset id (alternative to passing the full PresetDef). */
  presetId?: string;
}

function deriveVars(
  opts: ScaffoldOptions,
  orgProfile: OrgProfile | { name: string },
  presetId: string
) {
  const d = opts.decisions;
  const zones =
    "cloudflareZones" in orgProfile ? orgProfile.cloudflareZones : {};
  const resolved = resolveZoneForDomain(d.domain, zones);
  if (!resolved) {
    const apexes = Object.keys(zones);
    throw new Error(
      `No Cloudflare zone registered for the apex of "${d.domain}" under org "${d.org}".\nAvailable apexes: ${apexes.length > 0 ? apexes.join(", ") : "(none)"}\nRegister via:\n  t-stack org zone add ${d.org} <apex> <zoneId>\nOr auto-discover (requires CF token with Zone:Read):\n  t-stack org zone discover ${d.org} <apex>`
    );
  }
  const host = d.databaseHost;
  // Template vars keep the legacy `database` axis name; phase 4 will rewrite
  // templates to consume databaseHost directly. For now, map host → legacy slug.
  function legacyDbSlug(h: typeof host): "neon" | "turso" | "none" {
    if (h === "neon") {
      return "neon";
    }
    if (h === "turso") {
      return "turso";
    }
    return "none";
  }
  const dbSlug = legacyDbSlug(host);
  return {
    org: orgProfile,
    orgName: d.org,
    projectName: d.projectName,
    archetype: presetId,
    domain: d.domain,
    database: dbSlug,
    envs: d.envs,
    trigger: d.trigger,
    access: d.access,
    hookdeck: d.hookdeck,
    neon: dbSlug === "neon",
    turso: dbSlug === "turso",
    cloudflareZoneId: resolved.zoneId,
    cloudflareZoneApex: resolved.apex,
    createdAt: new Date().toISOString(),
    // Expose the full decisions under `d` so fragment templates can branch on
    // sibling axis state (e.g., {{#if (eq d.structure "monorepo")}}).
    d: opts.decisions,
  };
}

/**
 * Compose `fragments/<axis>/<value>/` directories on top of the preset output.
 *
 * Each fragment dir contains files that belong to a single axis-value pair —
 * e.g. `fragments/storage/r2/docker-compose.yml` lands only when the user
 * picks `storage=r2`. Last writer wins for any colliding file, which lets a
 * fragment override a preset file when needed.
 *
 * Booleans use string values "true" / "false"; the "false" / "none" cases are
 * skipped because they represent "don't add anything", which is the default.
 */
async function renderFragments(
  templatesRoot: string,
  destDir: string,
  decisions: InitDecisions,
  vars: Record<string, unknown>
): Promise<number> {
  const fragmentsRoot = join(templatesRoot, "fragments");
  if (!existsSync(fragmentsRoot)) {
    return 0;
  }

  const pairs: [string, string][] = [
    ["structure", decisions.structure],
    ["cloudProvider", decisions.cloudProvider],
    ["iac", decisions.iac],
    ["runtime", decisions.runtime],
    ["frontend", decisions.frontend],
    ["backend", decisions.backend],
    ["docs", decisions.docs],
    ["api", decisions.api],
    ["database", decisions.database],
    ["databaseHost", decisions.databaseHost],
    ["orm", decisions.orm],
    ["auth", decisions.auth],
    ["storage", decisions.storage],
    ["payments", decisions.payments],
    ["packageManager", decisions.packageManager],
    ["envs", decisions.envs],
    ["trigger", String(decisions.trigger)],
    ["access", String(decisions.access)],
    ["hookdeck", String(decisions.hookdeck)],
    ["git", String(decisions.git)],
    ["install", String(decisions.install)],
  ];

  let total = 0;
  for (const [axis, value] of pairs) {
    if (!value || value === "none" || value === "false") {
      continue;
    }
    const fragDir = join(fragmentsRoot, axis, value);
    if (!existsSync(fragDir)) {
      continue;
    }
    const r = await renderTemplate(fragDir, destDir, vars);
    total += r.filesWritten;
  }

  // `addons` is multi-valued; render each enabled addon's fragment if present.
  for (const addon of decisions.addons ?? []) {
    const fragDir = join(fragmentsRoot, "addons", addon);
    if (!existsSync(fragDir)) {
      continue;
    }
    const r = await renderTemplate(fragDir, destDir, vars);
    total += r.filesWritten;
  }

  return total;
}

/**
 * Files-only project scaffolding. Renders `_base/` followed by the preset's
 * overlay directory on top, then initialises `.t-stack/state.json` if missing.
 *
 * Pure file I/O — no cloud calls. Safe to call from `init` before `provision`.
 */
export async function runScaffold(opts: ScaffoldOptions): Promise<{
  filesWritten: number;
  destDir: string;
}> {
  const cliRoot = opts.cliRoot ?? findCliRoot();
  const templatesRoot = join(cliRoot, "templates");
  const baseDir = join(templatesRoot, "_base");

  const paths = buildPaths(opts.cwd, cliRoot);
  let preset = opts.preset;
  if (!preset) {
    const resolved = await resolvePresetId({
      presetId: opts.presetId,
      decisions: opts.decisions,
      stateFile: paths.stateFile,
    });
    if (resolved.source === "structure-fallback") {
      console.warn(
        `[scaffold] No preset on file; deriving "${resolved.id}" from structure=${opts.decisions.structure}. Pass --preset to be explicit.`
      );
    }
    preset = await loadPreset(resolved.id, cliRoot);
  }
  // Phase 4 will reshape templates/ to align with new preset ids; for now the
  // template directories still match the preset id 1:1.
  const archetypeDir = join(templatesRoot, preset.id);

  if (!existsSync(archetypeDir)) {
    throw new Error(
      `Template directory not found for preset "${preset.id}" (looked at ${archetypeDir}).`
    );
  }

  const orgs = createOrgsStore();
  const orgProfile = await orgs.get(opts.decisions.org);
  const vars = deriveVars(
    opts,
    orgProfile ?? { name: opts.decisions.org },
    preset.id
  );

  const destDir = opts.cwd;
  await mkdir(destDir, { recursive: true });

  let filesWritten = 0;
  if (existsSync(baseDir)) {
    const r = await renderTemplate(baseDir, destDir, vars);
    filesWritten += r.filesWritten;
  }
  const r2 = await renderTemplate(archetypeDir, destDir, vars);
  filesWritten += r2.filesWritten;

  // Axis-conditional content lives under `templates/fragments/<axis>/<value>/`.
  // Composed last so a fragment can override the preset overlay if needed.
  filesWritten += await renderFragments(
    templatesRoot,
    destDir,
    opts.decisions,
    vars
  );

  // Initialise state.json if missing.
  if (!existsSync(paths.stateFile)) {
    await mkdir(dirname(paths.stateFile), { recursive: true });
    const initial: State = {
      version: 1,
      project: {
        name: opts.decisions.projectName,
        presetId: preset.id,
        org: opts.decisions.org,
        createdAt: new Date().toISOString(),
      },
      steps: {},
    };
    await writeFile(
      paths.stateFile,
      `${JSON.stringify(initial, null, 2)}\n`,
      "utf8"
    );
  }

  // Install dependencies so `wrangler deploy` can bundle the worker.
  if (!opts.skipInstall && existsSync(join(destDir, "package.json"))) {
    const s = createSpinner();
    s.start("Installing dependencies (bun install)");
    try {
      await execa("bun", ["install", "--silent"], {
        cwd: destDir,
        stdio: "pipe",
      });
      s.stop("✓ Dependencies installed");
    } catch (err) {
      s.stop("✗ bun install failed");
      throw new Error(
        `bun install failed in ${destDir}: ${(err as Error).message}`
      );
    }
  }

  return { filesWritten, destDir };
}

export const scaffoldCommand = defineCommand({
  meta: {
    name: "scaffold",
    description:
      "Render templates into a new project directory (files only, no cloud calls).",
  },
  args: {
    name: { type: "positional", required: false, description: "Project name" },
    org: { type: "string", description: "Org slug from orgs.toml" },
    preset: { type: "string", description: "solo-cf-worker | monorepo-cf" },
    domain: { type: "string", description: "FQDN" },
    db: { type: "string", description: "neon | turso", valueHint: "neon" },
    envs: { type: "string", description: "prd | dev+prd | dev+stg+prd" },
    trigger: { type: "boolean", default: true },
    access: { type: "boolean", default: false },
    hookdeck: { type: "boolean", default: false },
    cwd: {
      type: "string",
      description: "Parent directory (project will be created inside)",
    },
    "skip-install": {
      type: "boolean",
      description: "Skip the post-render `bun install`",
    },
  },
  async run({ args }) {
    p.intro("t-stack scaffold");
    try {
      const projectName = (args.name as string | undefined) ?? "";
      if (!projectName) {
        p.cancel("scaffold requires a project name positional argument.");
        process.exit(1);
      }
      const parentCwd = (args.cwd as string | undefined) ?? process.cwd();
      const cwd = isAbsolute(parentCwd)
        ? join(parentCwd, projectName)
        : resolve(parentCwd, projectName);

      const presetId = (args.preset as string | undefined) ?? "solo-cf-worker";
      const structure: "single" | "monorepo" =
        presetId === "monorepo-cf" ? "monorepo" : "single";
      const dbHost = (args.db as string) ?? "neon";
      function dbEngineFor(h: string): "postgres" | "sqlite" | "none" {
        if (h === "neon") {
          return "postgres";
        }
        if (h === "turso" || h === "d1") {
          return "sqlite";
        }
        return "none";
      }
      const database = dbEngineFor(dbHost);
      const decisions: InitDecisions = initSchema.parse({
        org: (args.org as string) ?? "default",
        projectName,
        domain: (args.domain as string) ?? `${projectName}.example.com`,
        structure,
        database,
        databaseHost: dbHost,
        envs: ((args.envs as string) ?? "prd") as EnvScope,
        trigger: Boolean(args.trigger),
        access: Boolean(args.access),
        hookdeck: Boolean(args.hookdeck),
      });

      const res = await runScaffold({
        cwd,
        decisions,
        presetId,
        skipInstall: Boolean(args["skip-install"]),
      });
      p.outro(`Scaffolded ${res.filesWritten} files · ${res.destDir}`);
    } catch (err) {
      p.cancel(`scaffold failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

export default scaffoldCommand;
export type { Ctx } from "../core/preset.ts";

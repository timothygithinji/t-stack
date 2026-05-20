import { existsSync } from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import { execa } from "execa";
import { dirname, isAbsolute, join, resolve } from "pathe";
import { createSpinner } from "../core/log.js";
import { createOrgsStore } from "../core/orgs.js";
import type {
  Archetype,
  Ctx,
  Database,
  EnvScope,
  InitDecisions,
  OrgProfile,
} from "../core/preset.ts";
import type { State } from "../core/state.ts";
import { renderTemplate } from "../core/templating.js";
import { resolveZoneForDomain } from "../core/zones.js";
import { buildPaths, findCliRoot } from "./_ctx.js";

export interface ScaffoldOptions {
  cwd: string;
  decisions: InitDecisions;
  cliRoot?: string;
  /** Skip the post-render `bun install` (default: install runs). */
  skipInstall?: boolean;
}

function deriveVars(
  opts: ScaffoldOptions,
  orgProfile: OrgProfile | { name: string }
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
  return {
    org: orgProfile,
    orgName: d.org,
    projectName: d.projectName,
    archetype: d.archetype,
    domain: d.domain,
    database: d.database,
    envs: d.envs,
    trigger: d.trigger,
    access: d.access,
    hookdeck: d.hookdeck,
    neon: d.database === "neon",
    turso: d.database === "turso",
    cloudflareZoneId: resolved.zoneId,
    cloudflareZoneApex: resolved.apex,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Files-only project scaffolding. Renders `_base/` followed by the archetype's
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
  const archetypeDir = join(templatesRoot, opts.decisions.archetype);

  if (!existsSync(archetypeDir)) {
    throw new Error(
      `Template directory not found for archetype "${opts.decisions.archetype}" (looked at ${archetypeDir}).`
    );
  }

  const orgs = createOrgsStore();
  const orgProfile = await orgs.get(opts.decisions.org);
  const vars = deriveVars(opts, orgProfile ?? { name: opts.decisions.org });

  const destDir = opts.cwd;
  await mkdir(destDir, { recursive: true });

  let filesWritten = 0;
  if (existsSync(baseDir)) {
    const r = await renderTemplate(baseDir, destDir, vars);
    filesWritten += r.filesWritten;
  }
  const r2 = await renderTemplate(archetypeDir, destDir, vars);
  filesWritten += r2.filesWritten;

  // Conditional assets (not rendered through Handlebars — copied verbatim).
  if (opts.decisions.hookdeck) {
    const sdkSrc = join(templatesRoot, "_assets", "hookdeck-sdk");
    if (existsSync(sdkSrc)) {
      const sdkDest = join(destDir, "infra", "hookdeck", "sdks", "hookdeck");
      await cp(sdkSrc, sdkDest, { recursive: true });
    }
  }

  // Initialise state.json if missing.
  const paths = buildPaths(destDir, cliRoot);
  if (!existsSync(paths.stateFile)) {
    await mkdir(dirname(paths.stateFile), { recursive: true });
    const initial: State = {
      version: 1,
      project: {
        name: opts.decisions.projectName,
        archetype: opts.decisions.archetype,
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
    archetype: { type: "string", description: "solo-cf-worker | monorepo-cf" },
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
    try {
      const projectName = (args.name as string | undefined) ?? "";
      if (!projectName) {
        p.log.error("scaffold requires a project name positional argument.");
        process.exit(1);
      }
      const parentCwd = (args.cwd as string | undefined) ?? process.cwd();
      const cwd = isAbsolute(parentCwd)
        ? join(parentCwd, projectName)
        : resolve(parentCwd, projectName);

      const decisions: InitDecisions = {
        org: (args.org as string) ?? "default",
        projectName,
        archetype: ((args.archetype as string) ??
          "solo-cf-worker") as Archetype,
        domain: (args.domain as string) ?? `${projectName}.example.com`,
        database: ((args.db as string) ?? "neon") as Database,
        envs: ((args.envs as string) ?? "prd") as EnvScope,
        trigger: Boolean(args.trigger),
        access: Boolean(args.access),
        hookdeck: Boolean(args.hookdeck),
      };

      const res = await runScaffold({
        cwd,
        decisions,
        skipInstall: Boolean(args["skip-install"]),
      });
      p.log.success(`Scaffolded ${res.filesWritten} files into ${res.destDir}`);
    } catch (err) {
      p.log.error(`scaffold failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

export default scaffoldCommand;
export type { Ctx };

#!/usr/bin/env bun
/**
 * Diff `templates/<archetype>/` against a real project at `~/Developer/<repoName>/`.
 *
 * Usage:
 *   bun run sync-template <repoName>
 *
 * Maps:
 *   scout / dalili      -> solo-cf-worker
 *   fanya-labs / uploader -> monorepo-cf
 *
 * Renders templates with placeholder vars (projectName=REPLACE_ME, etc.) before diffing.
 * Review-only: no files are modified.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "pathe";
import { renderTemplate } from "@t-stack/templating";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// Templates moved to @t-stack/templates workspace package — resolve relatively
// from this dev script (monorepo-only; not bundled with the published CLI).
const TEMPLATES_DIR = join(SCRIPT_DIR, "../../../packages/templates/files");
const SKIP = new Set([
  "node_modules",
  "dist",
  ".git",
  ".wrangler",
  "bun.lockb",
  ".turbo",
  ".next",
]);

type Archetype = "solo-cf-worker" | "monorepo-cf";

const ARCHETYPE_MAP: Record<string, Archetype> = {
  scout: "solo-cf-worker",
  dalili: "solo-cf-worker",
  "fanya-labs": "monorepo-cf",
  uploader: "monorepo-cf",
};

function placeholderVars(repoName: string): Record<string, unknown> {
  return {
    projectName: "REPLACE_ME",
    name: "REPLACE_ME",
    org: {
      name: "REPLACE_ORG",
      githubOwner: "REPLACE_ORG",
      cloudflareAccountId: "REPLACE_CF_ACCOUNT",
      cloudflareZoneId: "REPLACE_CF_ZONE",
      defaultDomain: "REPLACE_DOMAIN",
      infisicalOrgSlug: "REPLACE_ORG",
      pulumiOrg: "REPLACE_ORG",
    },
    domain: `${repoName}.example.dev`,
    database: "neon",
    db: "neon",
    envs: "dev+prd",
    trigger: true,
    access: false,
    hookdeck: true,
  };
}

async function walkAll(root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string): Promise<void> {
    let entries: string[];
    try {
      const fs = await import("node:fs/promises");
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP.has(entry)) {
        continue;
      }
      const full = join(dir, entry);
      let s: Awaited<ReturnType<typeof stat>>;
      try {
        s = await stat(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        await rec(full);
      } else if (s.isFile()) {
        out.push(full);
      }
    }
  }
  await rec(root);
  return out;
}

function gitDiff(a: string, b: string): string {
  const res = spawnSync(
    "git",
    ["--no-pager", "diff", "--no-index", "--no-color", a, b],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }
  );
  // git diff exits 1 when there's a diff, 0 when identical.
  return res.stdout ?? "";
}

async function main() {
  const repoName = process.argv[2];
  if (!repoName) {
    console.error("Usage: bun run sync-template <repoName>");
    process.exit(2);
  }
  const archetype = ARCHETYPE_MAP[repoName];
  if (!archetype) {
    console.error(
      `Unknown repo "${repoName}". Known: ${Object.keys(ARCHETYPE_MAP).join(", ")}`
    );
    process.exit(2);
  }

  const repoDir = join(homedir(), "Developer", repoName);
  if (!existsSync(repoDir)) {
    console.error(`Repo not found at ${repoDir}`);
    process.exit(2);
  }

  const templateSrc = join(TEMPLATES_DIR, archetype);
  const baseSrc = join(TEMPLATES_DIR, "_base");
  if (!existsSync(templateSrc)) {
    console.error(`Template not found at ${templateSrc}`);
    process.exit(2);
  }

  const renderedDir = await mkdtemp(
    join(tmpdir(), `sync-template-${repoName}-`)
  );
  const vars = placeholderVars(repoName);

  // Render the base overlay first, then the archetype, mirroring how `init` does it.
  if (existsSync(baseSrc)) {
    await renderTemplate(baseSrc, renderedDir, vars);
  }
  await renderTemplate(templateSrc, renderedDir, vars);

  const tmplFiles = await walkAll(renderedDir);
  const repoFiles = await walkAll(repoDir);

  const tmplMap = new Map(tmplFiles.map((f) => [relative(renderedDir, f), f]));
  const repoMap = new Map(repoFiles.map((f) => [relative(repoDir, f), f]));

  const allRels = new Set<string>([...tmplMap.keys(), ...repoMap.keys()]);
  const sorted = [...allRels].sort();

  for (const rel of sorted) {
    const t = tmplMap.get(rel);
    const r = repoMap.get(rel);
    if (t && r) {
      const diff = gitDiff(t, r);
      if (diff.trim().length > 0) {
      }
    } else if (t && !r) {
      try {
        const content = await readFile(t, "utf8");
        const _preview = content.split("\n").slice(0, 5).join("\n");
        if (content.split("\n").length > 5) {
        }
      } catch {}
    } else if (r && !t) {
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

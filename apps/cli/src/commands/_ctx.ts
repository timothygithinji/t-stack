import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, join, resolve } from "pathe";
import { createLogger } from "../core/log.js";
import { createOrgsStore } from "../core/orgs.js";
import type { Ctx, InitDecisions, Paths, PresetDef } from "../core/preset.ts";
import { createStateStore } from "../core/state.js";
import { loadTokens } from "../core/tokens.js";
import { exportPerProjectSecret } from "../plugins/doppler.js";

/**
 * Walk up from this file to locate the CLI install root (the directory
 * containing the `@timothygithinji/t-stack` package.json).
 */
export function findCliRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const raw = readFileSync(pkgPath, "utf8");
        const pkg = JSON.parse(raw) as { name?: string };
        if (pkg.name === "@timothygithinji/t-stack") {
          return dir;
        }
      } catch {
        // ignore, keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  // Fallback to the immediate ancestor directory.
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function userConfigDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return join(home, ".t-stack");
}

export function buildPaths(cwd: string, cliRoot?: string): Paths {
  const root = cliRoot ?? findCliRoot();
  const absCwd = isAbsolute(cwd) ? cwd : resolve(cwd);
  return {
    cwd: absCwd,
    cliRoot: root,
    userConfig: userConfigDir(),
    stateFile: join(absCwd, ".t-stack", "state.json"),
  };
}

/**
 * Reads the project's `t-stack.config.ts` (or `.js`) using a dynamic import.
 * The file is expected to `export default` an InitDecisions-shaped object.
 *
 * Note: this assumes a runtime capable of executing TypeScript (Bun) when
 * called against a `.ts` file. When running under plain Node, the build step
 * should emit `t-stack.config.js` alongside.
 */
export async function loadConfig(cwd: string): Promise<InitDecisions> {
  const candidates = [
    join(cwd, "t-stack.config.ts"),
    join(cwd, "t-stack.config.mjs"),
    join(cwd, "t-stack.config.js"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `No t-stack.config.ts / .mjs / .js found in ${cwd}. Are you in a t-stack project directory?`
    );
  }
  const url = pathToFileURL(found).href;
  const mod = (await import(url)) as { default?: unknown };
  const decisions = mod.default as InitDecisions | undefined;
  if (!decisions || typeof decisions !== "object") {
    throw new Error(
      `t-stack.config at ${found} must \`export default\` an InitDecisions object.`
    );
  }
  return decisions;
}

export interface ResolvedPresetId {
  id: string;
  /** Where the id came from — surfaces when callers want to warn the user. */
  source: "explicit" | "state" | "structure-fallback";
}

/**
 * Derive a preset id from the available signals, in order:
 *   1. explicit `presetId` argument
 *   2. previously-persisted state.json `project.presetId`
 *   3. fallback by `decisions.structure` (monorepo → monorepo-cf, else solo-cf-worker)
 *
 * The returned `source` lets callers warn the user when a structure-derived
 * preset is being substituted for an explicit "custom" choice.
 */
export async function resolvePresetId(opts: {
  presetId?: string;
  decisions: InitDecisions;
  stateFile: string;
}): Promise<ResolvedPresetId> {
  if (opts.presetId) {
    return { id: opts.presetId, source: "explicit" };
  }
  if (existsSync(opts.stateFile)) {
    try {
      const raw = readFileSync(opts.stateFile, "utf8");
      const parsed = JSON.parse(raw) as {
        project?: { presetId?: string };
      };
      const fromState = parsed.project?.presetId;
      if (typeof fromState === "string" && fromState.length > 0) {
        return { id: fromState, source: "state" };
      }
    } catch {
      // fall through to structure-based fallback
    }
  }
  return {
    id:
      opts.decisions.structure === "monorepo"
        ? "monorepo-cf"
        : "solo-cf-worker",
    source: "structure-fallback",
  };
}

export interface BuildCtxOpts {
  cwd: string;
  decisions: InitDecisions;
  cliRoot?: string;
  nonInteractive?: boolean;
  /** Optional prompt answers map (init wizard fills this). */
  answers?: Record<string, unknown>;
  /** Pre-resolved preset bundle (preferred). When omitted, derived via `resolvePresetId`. */
  preset?: PresetDef;
  /** Explicit preset id to look up when `preset` is not supplied. */
  presetId?: string;
}

/**
 * Compose a full Ctx — loads the org profile, fetches tokens via Doppler,
 * wires up state store and logger.
 */
export async function buildCtx(opts: BuildCtxOpts): Promise<Ctx> {
  const paths = buildPaths(opts.cwd, opts.cliRoot);
  const orgs = createOrgsStore();
  const org = await orgs.get(opts.decisions.org);
  if (!org) {
    throw new Error(
      `Org "${opts.decisions.org}" not found. Run \`t-stack org add <name>\` first.`
    );
  }
  const logger = createLogger();
  const state = createStateStore(paths.stateFile);
  const tokens = await loadTokens(org.name);

  // Per-project Hookdeck API key resolution. Priority:
  //   1. decisions.hookdeckApiKey — set by `t-stack init` for the in-flight run.
  //   2. Per-project Doppler config (seeded by a previous init).
  // We only attempt lookup when the project actually opted into Hookdeck;
  // missing key + hookdeck=true is a hard error so we fail fast rather than
  // letting Pulumi blow up with an opaque message later.
  if (opts.decisions.hookdeck) {
    if (opts.decisions.hookdeckApiKey) {
      tokens.hookdeckApiKey = opts.decisions.hookdeckApiKey;
    } else {
      const fromDoppler = await exportPerProjectSecret(
        org.name,
        opts.decisions.projectName,
        "prd",
        "HOOKDECK_API_KEY"
      );
      if (fromDoppler) {
        tokens.hookdeckApiKey = fromDoppler;
      } else {
        throw new Error(
          `Hookdeck enabled but no HOOKDECK_API_KEY found in Doppler project \`${opts.decisions.projectName}/prd\`. Re-run \`t-stack init\` or run \`t-stack secrets pull --env prd\` to seed it.`
        );
      }
    }
  }

  let preset = opts.preset;
  if (!preset) {
    const resolved = await resolvePresetId({
      presetId: opts.presetId,
      decisions: opts.decisions,
      stateFile: paths.stateFile,
    });
    if (resolved.source === "structure-fallback") {
      logger.warn(
        `No preset on file; deriving "${resolved.id}" from structure=${opts.decisions.structure}. Pass --preset to be explicit.`
      );
    }
    preset = await loadPreset(resolved.id, paths.cliRoot);
  }

  const answers = opts.answers ?? {};
  return {
    org,
    projectName: opts.decisions.projectName,
    preset,
    decisions: opts.decisions,
    paths,
    logger,
    state,
    tokens,
    choice<T = unknown>(id: string): T {
      return answers[id] as T;
    },
    nonInteractive: opts.nonInteractive ?? false,
  };
}

/**
 * Enumerate available preset ids by scanning `<cliRoot>/presets/`. Skips the
 * `_base` helper and any file that doesn't look like a preset module.
 */
export async function listPresetIds(cliRoot?: string): Promise<string[]> {
  const root = cliRoot ?? findCliRoot();
  const presetsDir = join(root, "presets");
  if (!existsSync(presetsDir)) {
    return [];
  }
  try {
    const entries = await readdir(presetsDir);
    const ids = new Set<string>();
    for (const entry of entries) {
      const m = entry.match(/^(?!_)([a-z0-9][a-z0-9-]*)\.(ts|mjs|js)$/);
      if (m?.[1]) {
        ids.add(m[1]);
      }
    }
    return [...ids].sort();
  } catch {
    return [];
  }
}

/**
 * Dynamically load a preset module from `<cliRoot>/presets/<presetId>.{ts,mjs,js}`.
 * Throws a friendly error (listing available preset ids) if not found.
 */
export async function loadPreset(
  presetId: string,
  cliRoot?: string
): Promise<PresetDef> {
  const root = cliRoot ?? findCliRoot();
  const candidates = [
    join(root, "presets", `${presetId}.ts`),
    join(root, "presets", `${presetId}.mjs`),
    join(root, "presets", `${presetId}.js`),
    join(root, "dist", "presets", `${presetId}.js`),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    const available = await listPresetIds(root);
    const list = available.length > 0 ? available.join(", ") : "(none)";
    throw new Error(
      `Preset "${presetId}" not found. Available: ${list}.\nLooked in:\n  ${candidates.join("\n  ")}`
    );
  }
  const url = pathToFileURL(found).href;
  const mod = (await import(url)) as { default?: PresetDef };
  if (!mod.default || typeof mod.default.run !== "function") {
    throw new Error(
      `Preset at ${found} must \`export default definePreset({...})\`.`
    );
  }
  return mod.default;
}

export type { OrgProfile } from "../core/preset.ts";

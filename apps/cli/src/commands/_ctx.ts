import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, join, resolve } from "pathe";
import { createLogger } from "../core/log.js";
import { createOrgsStore } from "../core/orgs.js";
import type {
  Archetype,
  Ctx,
  InitDecisions,
  OrgProfile,
  Paths,
  PresetDef,
} from "../core/preset.ts";
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

export interface BuildCtxOpts {
  cwd: string;
  decisions: InitDecisions;
  cliRoot?: string;
  nonInteractive?: boolean;
  /** Optional prompt answers map (init wizard fills this). */
  answers?: Record<string, unknown>;
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

  const answers = opts.answers ?? {};
  return {
    org,
    projectName: opts.decisions.projectName,
    archetype: opts.decisions.archetype,
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
 * Dynamically load a preset module from `<cliRoot>/presets/<archetype>.{ts,mjs,js}`.
 * Throws a friendly error if not found.
 */
export async function loadPreset(
  archetype: Archetype,
  cliRoot?: string
): Promise<PresetDef> {
  const root = cliRoot ?? findCliRoot();
  const candidates = [
    join(root, "presets", `${archetype}.ts`),
    join(root, "presets", `${archetype}.mjs`),
    join(root, "presets", `${archetype}.js`),
    join(root, "dist", "presets", `${archetype}.js`),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `Preset "${archetype}" not found. Looked in:\n  ${candidates.join("\n  ")}`
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

export type { OrgProfile };

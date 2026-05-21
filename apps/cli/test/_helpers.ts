import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { createSilentLogger } from "../src/core/log.js";
import type {
  Ctx,
  InitDecisions,
  OrgProfile,
  Paths,
  PresetDef,
} from "../src/core/preset.ts";
import { type StateStore, createStateStore } from "../src/core/state.js";
import type { TokenBag } from "../src/core/tokens.ts";

export async function makeTempDir(prefix = "t-stack-test-"): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

export function defaultOrg(overrides: Partial<OrgProfile> = {}): OrgProfile {
  return {
    name: "fanya-labs",
    cloudflareAccountId: "cf-account-1",
    cloudflareZones: { "fanyalabs.dev": "cf-zone-1" },
    defaultDomain: "fanyalabs.dev",
    githubOwner: "fanya-labs",
    dopplerWorkplaceName: "fanya-labs",
    pulumiOrg: "fanya-labs",
    triggerOrgSlug: "personal-test",
    ...overrides,
  };
}

export function defaultDecisions(
  overrides: Partial<InitDecisions> = {}
): InitDecisions {
  return {
    org: "fanya-labs",
    projectName: "demo",
    domain: "demo.fanyalabs.dev",
    structure: "single",
    cloudProvider: "cloudflare",
    iac: "pulumi",
    runtime: "workers",
    frontend: "none",
    backend: "hono",
    docs: "none",
    api: "none",
    database: "postgres",
    databaseHost: "neon",
    orm: "drizzle",
    auth: "better-auth",
    storage: "none",
    payments: "none",
    addons: [],
    packageManager: "bun",
    git: true,
    install: true,
    envs: "dev+prd",
    trigger: false,
    access: false,
    hookdeck: false,
    ...overrides,
  };
}

export function defaultTokens(overrides: Partial<TokenBag> = {}): TokenBag {
  return {
    cloudflareApiToken: "cf-token",
    triggerAccessToken: "trg-token",
    hookdeckApiKey: "hd-token",
    ...overrides,
  };
}

/**
 * Lightweight stand-in for a PresetDef. Tests rarely invoke `run()`, so we
 * provide a no-op. Override fields as needed.
 */
export function defaultPreset(overrides: Partial<PresetDef> = {}): PresetDef {
  return {
    id: "solo-cf-worker",
    name: "Solo CF Worker",
    description: "Test stub preset",
    defaults: {},
    templates: ["_base", "solo-cf-worker"],
    async run() {
      // no-op for tests
    },
    ...overrides,
  };
}

export interface MakeCtxOptions {
  cwd?: string;
  projectName?: string;
  org?: Partial<OrgProfile>;
  decisions?: Partial<InitDecisions>;
  tokens?: Partial<TokenBag>;
  preset?: PresetDef;
}

export async function makeTestCtx(opts: MakeCtxOptions = {}): Promise<Ctx> {
  const cwd = opts.cwd ?? (await makeTempDir());
  const projectName = opts.projectName ?? "demo";
  const org = defaultOrg(opts.org);
  const decisions = defaultDecisions({
    projectName,
    org: org.name,
    ...opts.decisions,
  });
  const tokens = defaultTokens(opts.tokens);
  const paths: Paths = {
    cwd,
    cliRoot: process.cwd(),
    userConfig: join(cwd, ".config"),
    stateFile: join(cwd, "state.json"),
  };
  const state: StateStore = createStateStore(paths.stateFile);
  await state.read();
  const logger = createSilentLogger();
  const preset = opts.preset ?? defaultPreset();

  return {
    org,
    projectName,
    preset,
    decisions,
    paths,
    logger,
    state,
    tokens,
    choice: <T = unknown>(_id: string): T => undefined as unknown as T,
    nonInteractive: true,
  };
}

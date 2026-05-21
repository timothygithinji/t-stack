import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { execa } from "execa";
import { ofetch } from "ofetch";
import { join } from "pathe";
import type { Ctx } from "../core/preset.ts";

const DOPPLER_API_BASE = "https://api.doppler.com/v3";

export interface DopplerProject {
  id?: string;
  slug: string;
  name: string;
  description?: string;
}

export interface DopplerConfig {
  name: string;
  project: string;
  environment: string;
  root: boolean;
  locked: boolean;
}

interface ConfigsListResp {
  configs?: DopplerConfig[];
}

interface ProjectsListResp {
  projects?: DopplerProject[];
}

interface ProjectCreateResp {
  project?: DopplerProject;
}

interface DopplerServiceToken {
  slug: string;
  name: string;
  /** Only present in the create response. List/get responses redact it. */
  key?: string;
  expires_at?: string | null;
  access?: string;
}

interface TokensListResp {
  tokens?: DopplerServiceToken[];
}

interface TokenCreateResp {
  /** POST /v3/configs/config/tokens wraps the token object. */
  token?: DopplerServiceToken;
}

/** Per-org scope directory the user `doppler login --scope`'d against. */
export function orgScope(orgName: string): string {
  return join(homedir(), ".t-stack", "orgs", orgName);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function envSlugs(ctx: Ctx): readonly string[] {
  switch (ctx.decisions.envs) {
    case "prd":
      return ["prd"];
    case "dev+prd":
      return ["dev", "prd"];
    case "dev+stg+prd":
      return ["dev", "stg", "prd"];
    default:
      return ["prd"];
  }
}

const tokenCache = new Map<string, string>();

async function getCliToken(ctx: Ctx): Promise<string> {
  const fromEnv = process.env.DOPPLER_TOKEN;
  if (fromEnv) {
    return fromEnv;
  }

  const scope = orgScope(ctx.org.name);
  const cached = tokenCache.get(scope);
  if (cached) {
    return cached;
  }

  try {
    const { stdout } = await execa(
      "doppler",
      ["configure", "get", "token", "--scope", scope, "--plain"],
      { stdio: "pipe" }
    );
    const token = stdout.trim();
    if (!token) {
      throw new Error("doppler returned an empty token");
    }
    tokenCache.set(scope, token);
    return token;
  } catch (err) {
    throw new Error(
      `Doppler not authenticated for org "${ctx.org.name}". Run:\n  doppler login --scope ${scope}\nand pick the "${ctx.org.dopplerWorkplaceName}" workplace. (${(err as Error).message})`
    );
  }
}

export function clearCachedToken(): void {
  tokenCache.clear();
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function listProjects(token: string): Promise<DopplerProject[]> {
  const res = await ofetch<ProjectsListResp>(`${DOPPLER_API_BASE}/projects`, {
    method: "GET",
    headers: authHeaders(token),
    query: { per_page: 100 },
  });
  return res.projects ?? [];
}

async function findProjectBySlug(
  token: string,
  slug: string
): Promise<DopplerProject | undefined> {
  const projects = await listProjects(token);
  return projects.find((p) => p.slug === slug || p.name === slug);
}

export async function createProject(
  ctx: Ctx,
  opts: { name?: string; description?: string } = {}
): Promise<{ slug: string; name: string }> {
  const token = await getCliToken(ctx);
  const name = opts.name ?? ctx.projectName;
  const slug = slugify(name);
  const description = opts.description ?? `t-stack project ${name}`;

  ctx.logger.debug(
    `doppler.createProject name=${name} recreateMode=${ctx.recreateMode ?? "default"}`
  );

  // "adopt" mode short-circuits to the lookup path; "new" mode skips lookup
  // entirely so a fresh create is attempted. Doppler rejects duplicate slugs
  // server-side, so "new" will throw rather than silently dup.
  if (ctx.recreateMode === "adopt") {
    const existing = await findProjectBySlug(token, slug);
    if (!existing) {
      throw new Error(
        `doppler.createProject asked to adopt project "${slug}" but it was not found in the workplace.`
      );
    }
    ctx.logger.info(
      `doppler.project: adopting existing project "${existing.slug}" (recreateMode=adopt)`
    );
    return { slug: existing.slug, name: existing.name };
  }

  try {
    ctx.logger.info(`doppler.project: creating new project "${name}"`);
    const res = await ofetch<ProjectCreateResp>(
      `${DOPPLER_API_BASE}/projects`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: { name, description },
      }
    );
    const project = res.project;
    if (!project) {
      throw new Error("Doppler create-project response missing `project` body");
    }
    return { slug: project.slug, name: project.name };
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 409 || status === 422 || status === 400) {
      if (ctx.recreateMode === "new") {
        throw new Error(
          `doppler.createProject asked to create a fresh "${slug}" but Doppler reports it already exists. Delete it in the dashboard first or pick a different name.`
        );
      }
      const existing = await findProjectBySlug(token, slug);
      if (existing) {
        ctx.logger.info(
          `doppler.project: reusing existing project "${existing.slug}"`
        );
        return { slug: existing.slug, name: existing.name };
      }
    }
    throw err;
  }
}

/**
 * Liveness check for the verify-on-skip flow. The `doppler.project` step
 * stores empty refs, so we derive the slug from ctx.projectName (same
 * derivation that `createProject` uses).
 */
export async function verifyProjectExists(
  ctx: Ctx,
  _refs: Record<string, unknown>
): Promise<boolean> {
  const token = await getCliToken(ctx);
  const slug = slugify(ctx.projectName);
  const existing = await findProjectBySlug(token, slug);
  return existing !== undefined;
}

async function listConfigs(
  token: string,
  project: string,
  environment?: string
): Promise<DopplerConfig[]> {
  const query: Record<string, string | number> = { project, per_page: 100 };
  if (environment) {
    query.environment = environment;
  }
  const res = await ofetch<ConfigsListResp>(`${DOPPLER_API_BASE}/configs`, {
    method: "GET",
    headers: authHeaders(token),
    query,
  });
  return res.configs ?? [];
}

/**
 * Doppler auto-creates the three default environments (dev/stg/prd) when a
 * project is created, each with one root config of the same name. Callers
 * normally don't need to call this — but if a non-default env is requested,
 * we create it explicitly.
 */
export async function ensureConfig(
  ctx: Ctx,
  project: string,
  configName: string
): Promise<void> {
  const token = await getCliToken(ctx);
  const existing = await listConfigs(token, project);
  if (existing.some((c) => c.name === configName)) {
    ctx.logger.debug(`doppler.ensureConfig ${configName} already exists`);
    return;
  }
  try {
    await ofetch(`${DOPPLER_API_BASE}/configs`, {
      method: "POST",
      headers: authHeaders(token),
      body: { project, environment: configName, name: configName },
    });
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 409 || status === 422) {
      ctx.logger.debug("doppler.ensureConfig race — config exists");
      return;
    }
    throw err;
  }
}

export async function setSecret(
  ctx: Ctx,
  project: string,
  config: string,
  key: string,
  value: string
): Promise<void> {
  ctx.logger.debug(
    `doppler.setSecret project=${project} config=${config} key=${key}`
  );
  // Use the REST API rather than `doppler secrets set` so the value never lands
  // in argv (visible briefly to `ps aux`). Auth via in-memory Bearer token.
  await uploadSecrets(ctx, project, config, { [key]: value });
}

export async function uploadSecrets(
  ctx: Ctx,
  project: string,
  config: string,
  secrets: Record<string, string>
): Promise<void> {
  const token = await getCliToken(ctx);
  ctx.logger.debug(
    `doppler.uploadSecrets project=${project} config=${config} keys=${Object.keys(secrets).length}`
  );
  await ofetch(`${DOPPLER_API_BASE}/configs/config/secrets`, {
    method: "POST",
    headers: authHeaders(token),
    body: { project, config, secrets },
  });
}

/**
 * Push a single secret to every env config of the current project. Mirrors
 * the iteration order `seedSecrets` uses so prd is always written first.
 *
 * Idempotent — the upload endpoint upserts, so re-running with the same value
 * is a cheap no-op from the user's perspective. Used by leaf plugins
 * (neon, trigger) to keep Doppler in sync with the resource they own
 * whenever they actually run, independent of `seedSecrets` re-firing.
 */
export async function setProjectSecret(
  ctx: Ctx,
  key: string,
  value: string
): Promise<void> {
  const project = slugify(ctx.projectName);
  const envs = envSlugs(ctx);
  const ordered = ["prd", ...envs.filter((e) => e !== "prd")];
  for (const env of ordered) {
    await uploadSecrets(ctx, project, env, { [key]: value });
  }
}

/**
 * Seed Doppler with secrets owned by the orchestrator rather than by an
 * individual resource plugin. Today that's just `HOOKDECK_API_KEY` — the
 * user supplies it at init and we persist it here so the deploy workflow
 * can pull it from Doppler later.
 *
 * `DATABASE_URL` and `TRIGGER_SECRET_KEY` used to flow through this step
 * but their owning plugins (`neon.create`, `turso.create`,
 * `trigger.createProject`) now push them directly on every run. Keeping
 * that logic here too would duplicate writes without buying anything.
 */
export async function seedOrchestratorSecrets(ctx: Ctx): Promise<void> {
  const projectSlug = slugify(ctx.projectName);

  const entries: Array<{ key: string; value: string }> = [];
  if (ctx.decisions.hookdeck && ctx.tokens.hookdeckApiKey) {
    entries.push({ key: "HOOKDECK_API_KEY", value: ctx.tokens.hookdeckApiKey });
  }
  if (ctx.decisions.auth === "better-auth") {
    // Better Auth signs sessions with this — must be stable across deploys
    // so existing sessions survive. Reuse whatever's already in prd; only
    // mint a new value on first provision.
    let existing: Record<string, string> = {};
    try {
      existing = await exportEnv(ctx, "prd");
    } catch (err) {
      ctx.logger.debug(
        `doppler.seedOrchestratorSecrets: exportEnv probe failed (${(err as Error).message}); will mint a fresh BETTER_AUTH_SECRET`
      );
    }
    const current = existing.BETTER_AUTH_SECRET;
    if (current && current.length > 0) {
      ctx.logger.debug(
        "doppler.seedOrchestratorSecrets: reusing existing BETTER_AUTH_SECRET"
      );
    } else {
      entries.push({
        key: "BETTER_AUTH_SECRET",
        value: randomBytes(32).toString("hex"),
      });
    }
  }
  if (entries.length === 0) {
    return;
  }

  const secretsBag = Object.fromEntries(
    entries.map(({ key, value }) => [key, value])
  );

  const envs = envSlugs(ctx);
  const ordered = ["prd", ...envs.filter((e) => e !== "prd")];
  for (const env of ordered) {
    await uploadSecrets(ctx, projectSlug, env, secretsBag);
  }
}

export async function exportEnv(
  ctx: Ctx,
  config: string
): Promise<Record<string, string>> {
  const projectSlug = slugify(ctx.projectName);
  const scope = orgScope(ctx.org.name);
  ctx.logger.debug(`doppler.exportEnv project=${projectSlug} config=${config}`);
  const { stdout } = await execa(
    "doppler",
    [
      "secrets",
      "download",
      `--project=${projectSlug}`,
      `--config=${config}`,
      "--format=json",
      "--no-file",
      `--scope=${scope}`,
    ],
    { stdio: "pipe" }
  );
  const parsed = JSON.parse(stdout) as Record<string, string>;
  return parsed;
}

/**
 * Best-effort lookup of a single secret from a per-project Doppler config.
 * Returns undefined when the project/config doesn't exist or the key is
 * missing — callers decide whether absence is fatal. No ctx required so
 * this can be used from `buildCtx` before a full ctx is composed.
 */
export async function exportPerProjectSecret(
  orgName: string,
  projectName: string,
  config: string,
  key: string
): Promise<string | undefined> {
  const projectSlug = slugify(projectName);
  const scope = orgScope(orgName);
  try {
    const { stdout } = await execa(
      "doppler",
      [
        "secrets",
        "download",
        `--project=${projectSlug}`,
        `--config=${config}`,
        "--format=json",
        "--no-file",
        `--scope=${scope}`,
      ],
      { stdio: "pipe" }
    );
    const parsed = JSON.parse(stdout) as Record<string, string>;
    const v = parsed[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  } catch {
    return;
  }
}

async function listServiceTokens(
  token: string,
  project: string,
  config: string
): Promise<DopplerServiceToken[]> {
  const res = await ofetch<TokensListResp>(
    `${DOPPLER_API_BASE}/configs/config/tokens`,
    {
      method: "GET",
      headers: authHeaders(token),
      query: { project, config },
    }
  );
  return res.tokens ?? [];
}

async function deleteServiceToken(
  token: string,
  project: string,
  config: string,
  slug: string
): Promise<void> {
  await ofetch(`${DOPPLER_API_BASE}/configs/config/tokens/token`, {
    method: "DELETE",
    headers: authHeaders(token),
    body: { project, config, slug },
  });
}

async function createServiceToken(
  token: string,
  project: string,
  config: string,
  name: string,
  access: "read" | "read/write"
): Promise<string> {
  const res = await ofetch<TokenCreateResp>(
    `${DOPPLER_API_BASE}/configs/config/tokens`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: { project, config, name, access },
    }
  );
  const key = res.token?.key;
  if (!key) {
    throw new Error(
      "Doppler service token create response did not include `token.key`"
    );
  }
  return key;
}

/**
 * Mint a Doppler service token for `${project}/${config}` under a stable name
 * and return its key. If a token with the same name already exists in that
 * config, it is deleted first — the existing key is irretrievable (Doppler
 * only returns the key on creation) so rotation is the only path to a usable
 * value on re-runs.
 */
export async function upsertServiceToken(
  ctx: Ctx,
  project: string,
  config: string,
  name: string,
  access: "read" | "read/write" = "read"
): Promise<string> {
  const token = await getCliToken(ctx);
  ctx.logger.debug(
    `doppler.upsertServiceToken project=${project} config=${config} name=${name}`
  );
  const existing = await listServiceTokens(token, project, config);
  for (const t of existing) {
    if (t.name === name) {
      ctx.logger.debug(
        `doppler.upsertServiceToken deleting existing slug=${t.slug}`
      );
      await deleteServiceToken(token, project, config, t.slug);
    }
  }
  return createServiceToken(token, project, config, name, access);
}

export async function destroyProject(ctx: Ctx, slug: string): Promise<void> {
  const token = await getCliToken(ctx);
  ctx.logger.debug(`doppler.destroyProject slug=${slug}`);
  await ofetch(`${DOPPLER_API_BASE}/projects/project`, {
    method: "DELETE",
    headers: authHeaders(token),
    body: { project: slug },
  });
}

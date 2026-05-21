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

interface SeedRefs {
  db?: { connectionString?: string } | undefined;
  trg?: { secretKey?: string } | undefined;
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

  ctx.logger.debug(`doppler.createProject name=${name}`);

  try {
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
      const existing = await findProjectBySlug(token, slug);
      if (existing) {
        ctx.logger.debug(`doppler.createProject reusing ${existing.slug}`);
        return { slug: existing.slug, name: existing.name };
      }
    }
    throw err;
  }
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

export async function seedSecrets(ctx: Ctx, refs: SeedRefs): Promise<void> {
  const projectSlug = slugify(ctx.projectName);

  const entries: Array<{ key: string; value: string }> = [];
  if (refs.db?.connectionString) {
    entries.push({ key: "DATABASE_URL", value: refs.db.connectionString });
  }
  if (ctx.decisions.trigger && refs.trg?.secretKey) {
    entries.push({ key: "TRIGGER_SECRET_KEY", value: refs.trg.secretKey });
  }
  if (ctx.decisions.hookdeck && ctx.tokens.hookdeckApiKey) {
    entries.push({ key: "HOOKDECK_API_KEY", value: ctx.tokens.hookdeckApiKey });
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

export async function destroyProject(ctx: Ctx, slug: string): Promise<void> {
  const token = await getCliToken(ctx);
  ctx.logger.debug(`doppler.destroyProject slug=${slug}`);
  await ofetch(`${DOPPLER_API_BASE}/projects/project`, {
    method: "DELETE",
    headers: authHeaders(token),
    body: { project: slug },
  });
}

import { ofetch } from "ofetch";
import type { Ctx } from "../core/preset.ts";

const TRIGGER_API_BASE = "https://api.trigger.dev/api/v1";

export interface TriggerRefs {
  projectRef: string;
  slug: string;
  secretKey: string;
}

export interface TriggerOrg {
  id: string;
  title: string;
  slug: string;
}

export interface TriggerProject {
  id?: string;
  ref?: string;
  externalRef?: string;
  slug: string;
  name: string;
  organization?: TriggerOrg;
}

interface TriggerProjectListResponse {
  projects?: TriggerProject[];
  data?: TriggerProject[];
}

interface TriggerProjectApiKey {
  type?: string;
  environment?: string;
  key?: string;
  apiKey?: string;
}

interface TriggerProjectKeysResponse {
  keys?: TriggerProjectApiKey[];
  apiKeys?: TriggerProjectApiKey[];
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function listProjects(token: string): Promise<TriggerProject[]> {
  const res = await ofetch<TriggerProjectListResponse | TriggerProject[]>(
    `${TRIGGER_API_BASE}/projects`,
    { method: "GET", headers: authHeaders(token) }
  );
  if (Array.isArray(res)) {
    return res;
  }
  return res.projects ?? res.data ?? [];
}

export async function listOrgs(token: string): Promise<TriggerOrg[]> {
  // Trigger.dev's REST API doesn't expose an /orgs endpoint, so we derive the
  // unique set of orgs from the projects list. PATs with zero visible projects
  // will return an empty list.
  const projects = await listProjects(token);
  const seen = new Map<string, TriggerOrg>();
  for (const p of projects) {
    if (p.organization?.slug && !seen.has(p.organization.slug)) {
      seen.set(p.organization.slug, p.organization);
    }
  }
  return Array.from(seen.values());
}

async function listProjectsForActiveOrg(ctx: Ctx): Promise<TriggerProject[]> {
  if (!ctx.org.triggerOrgSlug) {
    throw new Error(
      `Org "${ctx.org.name}" has no triggerOrgSlug configured. Set it via:\n  t-stack org trigger discover ${ctx.org.name}\nor pass --trigger-org-slug at org-add time.`
    );
  }
  const all = await listProjects(ctx.tokens.triggerAccessToken);
  return all.filter((p) => p.organization?.slug === ctx.org.triggerOrgSlug);
}

async function findProjectByName(
  ctx: Ctx,
  name: string
): Promise<TriggerProject | undefined> {
  const orgProjects = await listProjectsForActiveOrg(ctx);
  return orgProjects.find((p) => p.name === name);
}

async function fetchProdSecretKey(
  ctx: Ctx,
  projectRef: string
): Promise<string> {
  const res = await ofetch<TriggerProjectKeysResponse>(
    `${TRIGGER_API_BASE}/projects/${projectRef}/keys`,
    { method: "GET", headers: authHeaders(ctx.tokens.triggerAccessToken) }
  );
  const keys = res.keys ?? res.apiKeys ?? [];
  const prod = keys.find(
    (k) =>
      (k.environment === "prod" || k.environment === "production") &&
      (k.type === "secret" || k.type === undefined)
  );
  const key = prod?.key ?? prod?.apiKey;
  if (!key) {
    throw new Error(
      `Trigger.dev project ${projectRef} has no production secret key available`
    );
  }
  return key;
}

export async function createProject(ctx: Ctx): Promise<TriggerRefs> {
  if (!ctx.org.triggerOrgSlug) {
    throw new Error(
      `Org "${ctx.org.name}" has no triggerOrgSlug configured. Set it via:\n  t-stack org trigger discover ${ctx.org.name}\nor pass --trigger-org-slug at org-add time.`
    );
  }

  ctx.logger.debug(
    `trigger.createProject name=${ctx.projectName} orgSlug=${ctx.org.triggerOrgSlug}`
  );

  let project: TriggerProject | undefined;
  try {
    const created = await ofetch<TriggerProject | { project?: TriggerProject }>(
      `${TRIGGER_API_BASE}/projects`,
      {
        method: "POST",
        headers: authHeaders(ctx.tokens.triggerAccessToken),
        body: {
          name: ctx.projectName,
          organizationSlug: ctx.org.triggerOrgSlug,
        },
      }
    );
    project =
      (created as { project?: TriggerProject }).project ??
      (created as TriggerProject);
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 404 || status === 405) {
      ctx.logger.debug(
        "trigger.createProject create endpoint unavailable, looking up existing project by name"
      );
      project = await findProjectByName(ctx, ctx.projectName);
      if (!project) {
        throw new Error(
          `Project named "${ctx.projectName}" not found in Trigger.dev org "${ctx.org.triggerOrgSlug}". Create it in the dashboard first.`
        );
      }
    } else if (status === 409 || status === 422) {
      project = await findProjectByName(ctx, ctx.projectName);
      if (!project) {
        throw new Error(
          `Trigger.dev reported project "${ctx.projectName}" exists but could not locate it in org "${ctx.org.triggerOrgSlug}"`
        );
      }
    } else {
      throw err;
    }
  }

  const projectRef = project.ref ?? project.externalRef ?? project.id;
  if (!projectRef) {
    throw new Error("Trigger.dev project missing ref/id in response");
  }
  const secretKey = await fetchProdSecretKey(ctx, projectRef);
  return { projectRef, slug: project.slug, secretKey };
}

export async function syncEnvVars(
  ctx: Ctx,
  refs: TriggerRefs,
  secrets: Record<string, string>
): Promise<void> {
  const entries = Object.entries(secrets);
  if (entries.length === 0) {
    return;
  }
  ctx.logger.debug(
    `trigger.syncEnvVars projectRef=${refs.projectRef} keys=${entries.map(([k]) => k).join(",")}`
  );

  try {
    await ofetch(
      `${TRIGGER_API_BASE}/projects/${refs.projectRef}/envvars/prod/import`,
      {
        method: "POST",
        headers: authHeaders(ctx.tokens.triggerAccessToken),
        body: {
          variables: entries.map(([name, value]) => ({ name, value })),
          override: true,
        },
      }
    );
    return;
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status !== 404 && status !== 405) {
      throw err;
    }
  }

  for (const [name, value] of entries) {
    await ofetch(
      `${TRIGGER_API_BASE}/projects/${refs.projectRef}/envvars/prod/${encodeURIComponent(name)}`,
      {
        method: "PUT",
        headers: authHeaders(ctx.tokens.triggerAccessToken),
        body: { value },
      }
    );
  }
}

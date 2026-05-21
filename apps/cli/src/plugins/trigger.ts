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

interface TriggerProjectEnvResponse {
  apiKey: string;
  name: string;
  apiUrl: string;
  projectId: string;
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
  const res = await ofetch<
    TriggerOrg[] | { orgs?: TriggerOrg[]; data?: TriggerOrg[] }
  >(`${TRIGGER_API_BASE}/orgs`, { method: "GET", headers: authHeaders(token) });
  if (Array.isArray(res)) {
    return res;
  }
  return res.orgs ?? res.data ?? [];
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
  const needle = name.toLowerCase();
  return orgProjects.find((p) => p.name.toLowerCase() === needle);
}

async function fetchProdSecretKey(
  ctx: Ctx,
  projectRef: string
): Promise<string> {
  const res = await ofetch<TriggerProjectEnvResponse>(
    `${TRIGGER_API_BASE}/projects/${projectRef}/prod`,
    { method: "GET", headers: authHeaders(ctx.tokens.triggerAccessToken) }
  );
  if (!res.apiKey) {
    throw new Error(
      `Trigger.dev project ${projectRef} has no production secret key available`
    );
  }
  return res.apiKey;
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

  // Trigger.dev's POST endpoint allows duplicate names (returns 200 with a
  // disambiguated slug), so we must look up by name first to stay idempotent
  // across re-runs. Match is case-insensitive to avoid creating a sibling
  // project that only differs in casing.
  let project = await findProjectByName(ctx, ctx.projectName);

  if (!project) {
    const created = await ofetch<TriggerProject | { project?: TriggerProject }>(
      `${TRIGGER_API_BASE}/orgs/${ctx.org.triggerOrgSlug}/projects`,
      {
        method: "POST",
        headers: authHeaders(ctx.tokens.triggerAccessToken),
        body: { name: ctx.projectName },
      }
    );
    project =
      (created as { project?: TriggerProject }).project ??
      (created as TriggerProject);
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

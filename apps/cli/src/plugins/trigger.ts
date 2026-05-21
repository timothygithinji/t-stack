import { ofetch } from "ofetch";
import type { Ctx } from "../core/preset.ts";
import * as doppler from "./doppler.js";

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
    `trigger.createProject name=${ctx.projectName} orgSlug=${ctx.org.triggerOrgSlug} recreateMode=${ctx.recreateMode ?? "default"}`
  );

  // Trigger.dev's POST endpoint allows duplicate names (returns 200 with a
  // disambiguated slug), so we must look up by name first to stay idempotent
  // across re-runs. Match is case-insensitive to avoid creating a sibling
  // project that only differs in casing. recreateMode lets the verify-on-skip
  // flow force a particular path.
  const skipLookup = ctx.recreateMode === "new";
  let project = skipLookup
    ? undefined
    : await findProjectByName(ctx, ctx.projectName);

  if (!project) {
    if (ctx.recreateMode === "adopt") {
      throw new Error(
        `trigger.createProject asked to adopt an existing project named "${ctx.projectName}" but none was found in Trigger.dev org "${ctx.org.triggerOrgSlug}".`
      );
    }
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

  // Push to Doppler on every run so re-creation propagates without waiting
  // for doppler.seedSecrets to re-fire. See neon.create for the same pattern.
  try {
    await doppler.setProjectSecret(ctx, "TRIGGER_SECRET_KEY", secretKey);
  } catch (err) {
    ctx.logger.debug(
      `trigger.createProject: pushing TRIGGER_SECRET_KEY to Doppler failed: ${(err as Error).message}`
    );
  }

  return { projectRef, slug: project.slug, secretKey };
}

/**
 * Liveness check: the stored `projectRef` (e.g. `proj_xxx`) is still listable
 * in the active Trigger.dev org. We reuse `findProjectByName` to avoid an
 * extra endpoint and to honor case-insensitive matching consistent with create.
 */
export async function verifyExists(
  ctx: Ctx,
  refs: Record<string, unknown>
): Promise<boolean> {
  const projectRef = refs.projectRef;
  if (typeof projectRef !== "string" || projectRef.length === 0) {
    return false;
  }
  // Hit the env endpoint we already use during create; 404 there means the
  // project (or at least its prod env) is gone.
  try {
    await ofetch(`${TRIGGER_API_BASE}/projects/${projectRef}/prod`, {
      method: "GET",
      headers: authHeaders(ctx.tokens.triggerAccessToken),
    });
    return true;
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 404 || status === 400) {
      return false;
    }
    throw err;
  }
}

export async function syncEnvVars(
  ctx: Ctx,
  refs: TriggerRefs,
  secrets: Record<string, string>
): Promise<void> {
  if (Object.keys(secrets).length === 0) {
    return;
  }
  ctx.logger.debug(
    `trigger.syncEnvVars projectRef=${refs.projectRef} keys=${Object.keys(secrets).join(",")}`
  );

  await ofetch(
    `${TRIGGER_API_BASE}/projects/${refs.projectRef}/envvars/prod/import`,
    {
      method: "POST",
      headers: authHeaders(ctx.tokens.triggerAccessToken),
      body: {
        variables: secrets,
        override: true,
      },
    }
  );
}

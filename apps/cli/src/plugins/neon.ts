import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as p from "@clack/prompts";
import { execa } from "execa";
import { ofetch } from "ofetch";
import { join } from "pathe";
import type { Ctx } from "../core/preset.ts";
import * as doppler from "./doppler.js";

export interface NeonRefs {
  projectId: string;
  projectName: string;
  branchId: string;
  connectionString: string;
}

export interface NeonRegion {
  region_id: string;
  name: string;
  default: boolean;
}

/**
 * Static fallback used when the Neon API is unreachable or the user hasn't
 * authenticated via `neonctl auth` yet. Mirrors the values surfaced in
 * `neonctl projects create --help` at the time of writing.
 */
const STATIC_NEON_REGIONS: NeonRegion[] = [
  {
    region_id: "aws-us-east-1",
    name: "AWS US East 1 (N. Virginia)",
    default: true,
  },
  { region_id: "aws-us-east-2", name: "AWS US East 2 (Ohio)", default: false },
  {
    region_id: "aws-us-west-2",
    name: "AWS US West 2 (Oregon)",
    default: false,
  },
  {
    region_id: "aws-eu-central-1",
    name: "AWS Europe Central 1 (Frankfurt)",
    default: false,
  },
  {
    region_id: "aws-ap-southeast-1",
    name: "AWS Asia Pacific 1 (Singapore)",
    default: false,
  },
  {
    region_id: "aws-ap-southeast-2",
    name: "AWS Asia Pacific 2 (Sydney)",
    default: false,
  },
  {
    region_id: "azure-eastus2",
    name: "Azure East US 2 (Virginia)",
    default: false,
  },
];

function neonctlCredsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, "neonctl", "credentials.json");
}

function readNeonctlToken(): string | undefined {
  const path = neonctlCredsPath();
  if (!existsSync(path)) {
    return;
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as { access_token?: string };
    return parsed.access_token;
  } catch {
    return;
  }
}

/**
 * Interactive region picker used when `neon.create` is about to create a new
 * project and `ctx.decisions.databaseRegion` is missing. Duplicates the select
 * prompt that `init`'s field resolver renders, but lives here so re-creation
 * paths (which bypass init's prompt loop) still surface the choice.
 */
async function promptRegion(): Promise<string> {
  const regions = await listRegions();
  const fallback = regions.find((r) => r.default)?.region_id ?? "aws-us-east-1";
  const choice = await p.select({
    message:
      "Neon region (no `databaseRegion` in config — picking one for this project)",
    options: regions.map((r) => ({
      value: r.region_id,
      label: r.default ? `${r.name} (default)` : r.name,
    })),
    initialValue: fallback,
  });
  if (p.isCancel(choice)) {
    throw new Error("Cancelled.");
  }
  return String(choice);
}

/**
 * List Neon's currently-supported regions. Fetched live from the API when the
 * user has neonctl credentials cached locally; falls back to a static list
 * otherwise so init can still surface a choice without forcing a prior auth.
 */
export async function listRegions(): Promise<NeonRegion[]> {
  const token = readNeonctlToken();
  if (token) {
    try {
      const res = await ofetch<{ regions: NeonRegion[] }>(
        "https://console.neon.tech/api/v2/regions",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (Array.isArray(res.regions) && res.regions.length > 0) {
        return res.regions;
      }
    } catch {
      // fall through to static
    }
  }
  return STATIC_NEON_REGIONS;
}

interface NeonProjectListItem {
  id: string;
  name: string;
  default_branch_id?: string;
  org_id?: string;
}

interface NeonProjectCreateOutput {
  project?: { id?: string; name?: string; default_branch_id?: string };
  branch?: { id?: string };
}

interface NeonConnectionStringOutput {
  uri?: string;
  connection_uri?: string;
  connectionUri?: string;
}

function neonEnv(_ctx: Ctx): NodeJS.ProcessEnv {
  // neonctl reads NEON_API_KEY from env when available; rely on user's saved auth otherwise.
  return { ...process.env };
}

function orgArgs(ctx: Ctx): string[] {
  return ctx.org.neonOrgId ? ["--org-id", ctx.org.neonOrgId] : [];
}

async function findExistingProject(
  ctx: Ctx,
  name: string
): Promise<NeonProjectListItem | undefined> {
  const { stdout } = await execa(
    "neonctl",
    ["projects", "list", ...orgArgs(ctx), "--output", "json"],
    { stdio: "pipe", env: neonEnv(ctx) }
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("Failed to parse `neonctl projects list` JSON output");
  }
  let list: NeonProjectListItem[];
  if (Array.isArray(parsed)) {
    list = parsed as NeonProjectListItem[];
  } else if (
    Array.isArray((parsed as { projects?: NeonProjectListItem[] }).projects)
  ) {
    list = (parsed as { projects: NeonProjectListItem[] }).projects;
  } else {
    list = [];
  }
  const needle = name.toLowerCase();
  return list.find((p) => p.name.toLowerCase() === needle);
}

async function fetchConnectionString(
  ctx: Ctx,
  projectId: string
): Promise<string> {
  const { stdout } = await execa(
    "neonctl",
    ["connection-string", "--project-id", projectId, "--output", "json"],
    { stdio: "pipe", env: neonEnv(ctx) }
  );
  try {
    const parsed = JSON.parse(stdout) as NeonConnectionStringOutput | string;
    if (typeof parsed === "string") {
      return parsed;
    }
    const uri = parsed.uri ?? parsed.connection_uri ?? parsed.connectionUri;
    if (!uri) {
      throw new Error("neonctl connection-string returned no uri field");
    }
    return uri;
  } catch (err) {
    // Some neonctl versions return a bare string; try the raw stdout.
    const trimmed = stdout.trim();
    if (trimmed.startsWith("postgres") || trimmed.startsWith("postgresql")) {
      return trimmed;
    }
    throw new Error(
      `Failed to parse \`neonctl connection-string\` output: ${(err as Error).message}`
    );
  }
}

export async function create(ctx: Ctx): Promise<NeonRefs> {
  const name = ctx.projectName;
  ctx.logger.debug(
    `neon.create name=${name} recreateMode=${ctx.recreateMode ?? "default"}`
  );

  // Neon allows multiple projects with the same name and doesn't surface a
  // "already exists" error on duplicate creation, so a naive POST would create
  // a sibling project on every retry. Look up by name first (case-insensitive)
  // to stay idempotent across re-runs. The recreateMode hook lets the
  // verify-on-skip flow force a different path on demand.
  let projectId: string | undefined;
  let projectName = name;
  let branchId: string | undefined;

  const skipLookup = ctx.recreateMode === "new";
  const existing = skipLookup
    ? undefined
    : await findExistingProject(ctx, name);
  if (existing) {
    ctx.logger.info(`neon.create: reusing existing project "${name}"`);
    projectId = existing.id;
    projectName = existing.name;
    branchId = existing.default_branch_id;
  } else {
    if (ctx.recreateMode === "adopt") {
      throw new Error(
        `neon.create asked to adopt an existing project named "${name}" but none was found in Neon.`
      );
    }
    // loadConfig doesn't apply Zod defaults, so legacy configs that pre-date
    // databaseRegion will have `undefined` here at runtime even though the
    // type says string. Prompt the user (interactively) when we're about to
    // create a new project and the choice hasn't been made yet — otherwise
    // neonctl would silently pick its own default region.
    let region = ctx.decisions.databaseRegion as string | undefined;
    if (!(region || ctx.nonInteractive)) {
      region = await promptRegion();
    }
    ctx.logger.info(
      `neon.create: creating new project "${name}"${region ? ` in ${region}` : ""}`
    );
    const args = [
      "projects",
      "create",
      "--name",
      name,
      ...orgArgs(ctx),
      ...(region ? ["--region-id", region] : []),
      "--output",
      "json",
    ];
    const { stdout } = await execa("neonctl", args, {
      stdio: "pipe",
      env: neonEnv(ctx),
    });
    const parsed = JSON.parse(stdout) as NeonProjectCreateOutput;
    projectId = parsed.project?.id;
    projectName = parsed.project?.name ?? name;
    branchId = parsed.branch?.id ?? parsed.project?.default_branch_id;
  }

  if (!projectId) {
    throw new Error("Failed to determine Neon project id");
  }
  if (!branchId) {
    branchId = "";
  }

  const connectionString = await fetchConnectionString(ctx, projectId);

  // Keep Doppler in sync with the resource we just owned: push DATABASE_URL
  // every time `create` runs, regardless of adopt vs new. This is what makes
  // re-running neon.create self-healing — without it, a fresh Neon project
  // would leave doppler.seedSecrets pointing at the deleted previous one
  // (since that step skips when its own refs aren't redacted). Idempotent:
  // Doppler upserts, so writing the same value is a cheap no-op.
  try {
    await doppler.setProjectSecret(ctx, "DATABASE_URL", connectionString);
  } catch (err) {
    // Don't fail the whole step if Doppler is unreachable — the dependency
    // cascade (doppler.seedSecrets invalidation) will give the user a clean
    // retry. Log so it's not silent.
    ctx.logger.debug(
      `neon.create: pushing DATABASE_URL to Doppler failed: ${(err as Error).message}`
    );
  }
  return { projectId, projectName, branchId, connectionString };
}

/**
 * Liveness check for the plugin-graph verify-on-skip flow. Returns false when
 * the Neon project recorded in state.json has been deleted out-of-band.
 *
 * Implementation: hit `neonctl projects get` for the stored `projectId`.
 * neonctl exits non-zero with "project not found" in stderr when missing —
 * any other failure (auth, network) re-throws so the runner can fall back
 * to trusting state rather than treating it as a guaranteed miss.
 */
export async function verifyExists(
  ctx: Ctx,
  refs: Record<string, unknown>
): Promise<boolean> {
  const projectId = refs.projectId;
  if (typeof projectId !== "string" || projectId.length === 0) {
    return false;
  }
  try {
    await execa(
      "neonctl",
      [
        "projects",
        "get",
        "--project-id",
        projectId,
        ...orgArgs(ctx),
        "--output",
        "json",
      ],
      { stdio: "pipe", env: neonEnv(ctx) }
    );
    return true;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (/not found|does not exist|no such/i.test(stderr)) {
      return false;
    }
    throw err;
  }
}

export async function destroy(ctx: Ctx, refs: NeonRefs): Promise<void> {
  ctx.logger.debug(`neon.destroy projectId=${refs.projectId}`);
  try {
    await execa(
      "neonctl",
      ["projects", "delete", refs.projectId, ...orgArgs(ctx)],
      {
        stdio: "pipe",
        env: neonEnv(ctx),
      }
    );
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    // Idempotent: project already deleted (or never created) is a soft-success.
    if (/failed to fetch project|not found/i.test(stderr)) {
      ctx.logger.debug(`neon.destroy project ${refs.projectId} already gone`);
      return;
    }
    throw err;
  }
}

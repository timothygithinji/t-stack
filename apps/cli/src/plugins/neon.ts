import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { execa } from "execa";
import { ofetch } from "ofetch";
import { join } from "pathe";
import type { Ctx } from "../core/preset.ts";

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
  ctx.logger.debug(`neon.create name=${name}`);

  // Neon allows multiple projects with the same name and doesn't surface a
  // "already exists" error on duplicate creation, so a naive POST would create
  // a sibling project on every retry. Look up by name first (case-insensitive)
  // to stay idempotent across re-runs.
  let projectId: string | undefined;
  let projectName = name;
  let branchId: string | undefined;

  const existing = await findExistingProject(ctx, name);
  if (existing) {
    ctx.logger.debug(`neon.create project ${name} already exists, reusing`);
    projectId = existing.id;
    projectName = existing.name;
    branchId = existing.default_branch_id;
  } else {
    // loadConfig doesn't apply Zod defaults, so legacy configs that pre-date
    // databaseRegion will have `undefined` here at runtime even though the
    // type says string. The conditional below preserves that path.
    const region = ctx.decisions.databaseRegion as string | undefined;
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
  return { projectId, projectName, branchId, connectionString };
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

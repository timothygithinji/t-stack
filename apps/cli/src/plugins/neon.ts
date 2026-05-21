import { execa } from "execa";
import type { Ctx } from "../core/preset.ts";

export interface NeonRefs {
  projectId: string;
  projectName: string;
  branchId: string;
  connectionString: string;
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
  return list.find((p) => p.name === name);
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

  const args = [
    "projects",
    "create",
    "--name",
    name,
    ...orgArgs(ctx),
    "--output",
    "json",
  ];

  let projectId: string | undefined;
  let projectName = name;
  let branchId: string | undefined;

  try {
    const { stdout } = await execa("neonctl", args, {
      stdio: "pipe",
      env: neonEnv(ctx),
    });
    const parsed = JSON.parse(stdout) as NeonProjectCreateOutput;
    projectId = parsed.project?.id;
    projectName = parsed.project?.name ?? name;
    branchId = parsed.branch?.id ?? parsed.project?.default_branch_id;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (/already exists|duplicate/i.test(stderr)) {
      ctx.logger.debug(`neon.create project ${name} already exists, fetching`);
      const existing = await findExistingProject(ctx, name);
      if (!existing) {
        throw new Error(
          `Neon reported project ${name} exists but it was not found in \`neonctl projects list\``
        );
      }
      projectId = existing.id;
      projectName = existing.name;
      branchId = existing.default_branch_id;
    } else {
      throw err;
    }
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

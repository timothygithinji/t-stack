import { existsSync } from "node:fs";
import { Octokit } from "@octokit/rest";
import { execa } from "execa";
import sodium from "libsodium-wrappers";
import { join } from "pathe";
import type { Ctx } from "../core/preset.ts";

export interface GitHubRepoRef {
  owner: string;
  name: string;
  htmlUrl: string;
  sshUrl: string;
}

async function getGhToken(): Promise<string> {
  try {
    const { stdout } = await execa("gh", ["auth", "token"], { stdio: "pipe" });
    const token = stdout.trim();
    if (!token) {
      throw new Error("`gh auth token` returned empty");
    }
    return token;
  } catch (err) {
    throw new Error(
      `Failed to obtain GitHub token via \`gh auth token\`. Run \`gh auth login\` first. (${(err as Error).message})`
    );
  }
}

async function getAuthenticatedLogin(gh: Octokit): Promise<string> {
  const res = await gh.rest.users.getAuthenticated();
  return res.data.login;
}

export async function createGithubClient(): Promise<Octokit> {
  const token = await getGhToken();
  return new Octokit({ auth: token });
}

export async function createRepo(ctx: Ctx): Promise<GitHubRepoRef> {
  const gh = await createGithubClient();
  const owner = ctx.org.githubOwner;
  const name = ctx.projectName;
  ctx.logger.debug(`github.createRepo owner=${owner} name=${name}`);

  let me: string | undefined;
  try {
    me = await getAuthenticatedLogin(gh);
  } catch {
    me = undefined;
  }
  const isUserOwner =
    me !== undefined && me.toLowerCase() === owner.toLowerCase();

  try {
    const res = isUserOwner
      ? await gh.rest.repos.createForAuthenticatedUser({
          name,
          private: true,
          auto_init: false,
        })
      : await gh.rest.repos.createInOrg({
          org: owner,
          name,
          private: true,
          auto_init: false,
        });
    return {
      owner: res.data.owner.login,
      name: res.data.name,
      htmlUrl: res.data.html_url,
      sshUrl: res.data.ssh_url,
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    const message = (err as Error).message ?? "";
    if (status === 422 && /already exists/i.test(message)) {
      ctx.logger.debug(
        `github.createRepo repo exists, fetching ${owner}/${name}`
      );
      const existing = await gh.rest.repos.get({ owner, repo: name });
      return {
        owner: existing.data.owner.login,
        name: existing.data.name,
        htmlUrl: existing.data.html_url,
        sshUrl: existing.data.ssh_url,
      };
    }
    throw err;
  }
}

function orgEnvSuffix(orgSlug: string): string {
  return orgSlug.toUpperCase().replace(/-/g, "_");
}

export async function configureDopplerOidc(
  ctx: Ctx,
  gh: Octokit
): Promise<void> {
  const owner = ctx.org.githubOwner;
  const repo = ctx.projectName;
  const suffix = orgEnvSuffix(ctx.org.dopplerWorkplaceName);
  const envVarKey = `T_STACK_DOPPLER_OIDC_IDENTITY_ID_${suffix}`;
  const identityId = ctx.org.dopplerOidcIdentityId ?? process.env[envVarKey];
  if (!identityId) {
    ctx.logger.debug(
      `Skipping GHA Doppler OIDC vars: no identity configured for org ${ctx.org.name}. ` +
        `Set \`dopplerOidcIdentityId\` in orgs.toml or export ${envVarKey} to enable GitHub Actions deploys.`
    );
    return;
  }

  const projectSlug = ctx.projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const vars: Record<string, string> = {
    DOPPLER_IDENTITY_ID: identityId,
    DOPPLER_PROJECT_SLUG: projectSlug,
  };

  for (const [name, value] of Object.entries(vars)) {
    ctx.logger.debug(`github.configureDopplerOidc set var ${name}`);
    try {
      await gh.request("PATCH /repos/{owner}/{repo}/actions/variables/{name}", {
        owner,
        repo,
        name,
        value,
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        await gh.request("POST /repos/{owner}/{repo}/actions/variables", {
          owner,
          repo,
          name,
          value,
        });
      } else {
        throw err;
      }
    }
  }
}

export async function setRepoSecret(
  ctx: Ctx,
  gh: Octokit,
  name: string,
  value: string
): Promise<void> {
  const owner = ctx.org.githubOwner;
  const repo = ctx.projectName;
  ctx.logger.debug(`github.setRepoSecret name=${name}`);

  const { data: pubKey } = await gh.rest.actions.getRepoPublicKey({
    owner,
    repo,
  });

  await sodium.ready;
  const binkey = sodium.from_base64(
    pubKey.key,
    sodium.base64_variants.ORIGINAL
  );
  const binsec = sodium.from_string(value);
  const encBytes = sodium.crypto_box_seal(binsec, binkey);
  const encryptedValue = sodium.to_base64(
    encBytes,
    sodium.base64_variants.ORIGINAL
  );

  await gh.rest.actions.createOrUpdateRepoSecret({
    owner,
    repo,
    secret_name: name,
    encrypted_value: encryptedValue,
    key_id: pubKey.key_id,
  });
}

async function execGit(
  ctx: Ctx,
  args: string[],
  opts: { allowFail?: boolean; input?: string } = {}
): Promise<{ stdout: string; exitCode: number } | undefined> {
  try {
    const res = await execa("git", args, {
      cwd: ctx.paths.cwd,
      stdio: "pipe",
      ...(opts.input === undefined ? {} : { input: opts.input }),
    });
    return { stdout: res.stdout, exitCode: res.exitCode ?? 0 };
  } catch (err) {
    if (opts.allowFail) {
      return;
    }
    throw err;
  }
}

export async function pushInitial(ctx: Ctx, gh: Octokit): Promise<void> {
  void gh;
  const cwd = ctx.paths.cwd;
  const gitDir = join(cwd, ".git");
  const repo = await ensureRepoRef(ctx);

  if (!existsSync(gitDir)) {
    ctx.logger.debug("github.pushInitial git init");
    await execGit(ctx, ["init"]);
  }

  // Configure default branch if no commits yet.
  await execGit(ctx, ["checkout", "-B", "main"], { allowFail: true });

  // Stage and commit if there are changes / no commits.
  await execGit(ctx, ["add", "-A"]);

  const hasCommit = await execGit(ctx, ["rev-parse", "--verify", "HEAD"], {
    allowFail: true,
  });
  if (!hasCommit) {
    ctx.logger.debug("github.pushInitial initial commit");
    await execGit(ctx, ["commit", "-m", "chore: initial commit from t-stack"], {
      allowFail: true,
    });
  }

  await execGit(ctx, ["branch", "-M", "main"], { allowFail: true });

  // Prefer the HTTPS URL — gh's credential helper handles auth without SSH keys.
  // Fall back to SSH if gh isn't configured.
  const httpsUrl = `https://github.com/${repo.owner}/${repo.name}.git`;
  const ghProto = await detectGhProtocol(ctx);
  const remoteUrl = ghProto === "ssh" ? repo.sshUrl : httpsUrl;

  const remoteRes = await execGit(ctx, ["remote", "get-url", "origin"], {
    allowFail: true,
  });
  if (!remoteRes) {
    ctx.logger.debug(`github.pushInitial adding remote origin -> ${remoteUrl}`);
    await execGit(ctx, ["remote", "add", "origin", remoteUrl]);
  } else if (remoteRes.stdout.trim() !== remoteUrl) {
    ctx.logger.debug(
      `github.pushInitial updating remote origin from ${remoteRes.stdout.trim()} to ${remoteUrl}`
    );
    await execGit(ctx, ["remote", "set-url", "origin", remoteUrl]);
  }

  ctx.logger.debug("github.pushInitial pushing to origin/main");
  await execGit(ctx, ["push", "-u", "origin", "main"]);
}

async function detectGhProtocol(ctx: Ctx): Promise<"https" | "ssh"> {
  try {
    const { stdout } = await execa("gh", ["config", "get", "git_protocol"], {
      stdio: "pipe",
      cwd: ctx.paths.cwd,
    });
    return stdout.trim() === "ssh" ? "ssh" : "https";
  } catch {
    return "https";
  }
}

async function ensureRepoRef(ctx: Ctx): Promise<GitHubRepoRef> {
  // Read createRepo refs from state.json if available; otherwise hit the API to fetch.
  const state = await ctx.state.read();
  const candidate =
    state.steps["github.createRepo"]?.refs ??
    state.steps["github.repo"]?.refs ??
    undefined;
  if (
    candidate &&
    typeof candidate.sshUrl === "string" &&
    typeof candidate.owner === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.htmlUrl === "string"
  ) {
    return candidate as unknown as GitHubRepoRef;
  }
  const gh = await createGithubClient();
  const res = await gh.rest.repos.get({
    owner: ctx.org.githubOwner,
    repo: ctx.projectName,
  });
  return {
    owner: res.data.owner.login,
    name: res.data.name,
    htmlUrl: res.data.html_url,
    sshUrl: res.data.ssh_url,
  };
}

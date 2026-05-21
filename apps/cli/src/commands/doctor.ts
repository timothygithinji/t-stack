import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import { execa } from "execa";
import { ofetch } from "ofetch";
import { join } from "pathe";
import { createSpinner } from "../core/log.js";
import { createOrgsStore } from "../core/orgs.js";
import { createStateStore } from "../core/state.js";
import { loadTokens } from "../core/tokens.js";
import * as doppler from "../plugins/doppler.js";
import { buildPaths, loadConfig } from "./_ctx.js";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const META_PROJECT_SLUG = "t-stack";
const META_CONFIG = "prd";
const REQUIRED_META_KEYS = [
  "CLOUDFLARE_API_TOKEN",
  "TRIGGER_ACCESS_TOKEN",
] as const;

async function checkDopplerCli(): Promise<Check> {
  try {
    const { stdout } = await execa("doppler", ["--version"], { stdio: "pipe" });
    return {
      name: "doppler CLI installed",
      ok: true,
      detail: stdout.split("\n")[0],
    };
  } catch {
    return {
      name: "doppler CLI installed",
      ok: false,
      detail: "`doppler` not found in PATH",
    };
  }
}

async function checkDopplerAuthed(
  orgName: string,
  workplaceSlug: string
): Promise<Check> {
  const scope = doppler.orgScope(orgName);
  try {
    const { stdout } = await execa(
      "doppler",
      ["configure", "get", "token", "--scope", scope, "--plain"],
      { stdio: "pipe" }
    );
    const token = stdout.trim();
    if (!token) {
      throw new Error("empty token");
    }
    return {
      name: `doppler authed for ${orgName}`,
      ok: true,
      detail: `workplace ${workplaceSlug}`,
    };
  } catch (err) {
    return {
      name: `doppler authed for ${orgName}`,
      ok: false,
      detail: `run \`doppler login --scope ${scope}\` and pick "${workplaceSlug}" (${(err as Error).message})`,
    };
  }
}

async function checkMetaConfig(orgName: string): Promise<Check> {
  const scope = doppler.orgScope(orgName);
  try {
    const { stdout } = await execa(
      "doppler",
      [
        "secrets",
        "download",
        `--project=${META_PROJECT_SLUG}`,
        `--config=${META_CONFIG}`,
        "--format=json",
        "--no-file",
        `--scope=${scope}`,
      ],
      { stdio: "pipe" }
    );
    const parsed = JSON.parse(stdout) as Record<string, string>;
    const missing = REQUIRED_META_KEYS.filter((k) => !parsed[k]);
    if (missing.length > 0) {
      return {
        name: `${META_PROJECT_SLUG}/${META_CONFIG} for ${orgName}`,
        ok: false,
        detail: `missing keys: ${missing.join(", ")}`,
      };
    }
    return {
      name: `${META_PROJECT_SLUG}/${META_CONFIG} for ${orgName}`,
      ok: true,
      detail: `${Object.keys(parsed).length} keys`,
    };
  } catch (err) {
    return {
      name: `${META_PROJECT_SLUG}/${META_CONFIG} for ${orgName}`,
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function verifyCfZone(
  apex: string,
  zoneId: string,
  accountId: string,
  token: string
): Promise<Check> {
  try {
    const res = await ofetch<{
      success?: boolean;
      result?: Array<{ id: string; name: string }>;
    }>("https://api.cloudflare.com/client/v4/zones", {
      headers: { Authorization: `Bearer ${token}` },
      query: { name: apex, "account.id": accountId },
    });
    const match = (res.result ?? []).find((z) => z.id === zoneId);
    if (res.success && match) {
      return { name: `CF zone ${apex}`, ok: true, detail: zoneId };
    }
    return {
      name: `CF zone ${apex}`,
      ok: false,
      detail: `expected ${zoneId}, got ${(res.result ?? []).map((z) => z.id).join(",") || "no match"}`,
    };
  } catch (err) {
    return {
      name: `CF zone ${apex}`,
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function verifyCfToken(token: string, accountId: string): Promise<Check> {
  const headers = { Authorization: `Bearer ${token}` };
  // Try account-scoped first (matches the kind of token t-stack expects).
  try {
    const res = await ofetch<{
      success?: boolean;
      result?: { status?: string };
    }>(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
      { headers }
    );
    if (res.success === true) {
      return {
        name: "Cloudflare token",
        ok: true,
        detail: res.result?.status ?? "active",
      };
    }
  } catch {
    // fall through to user-token endpoint
  }
  try {
    const res = await ofetch<{
      success?: boolean;
      result?: { status?: string };
    }>("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers });
    return {
      name: "Cloudflare token",
      ok: res.success === true,
      detail: res.result?.status ?? "verified",
    };
  } catch (err) {
    return {
      name: "Cloudflare token",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function verifyTriggerToken(token: string): Promise<Check> {
  // Trigger.dev exposes no /whoami; a PAT successfully listing projects is the
  // closest auth probe. 200 = valid (empty array is still success).
  try {
    await ofetch("https://api.trigger.dev/api/v1/projects", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { name: "Trigger.dev token", ok: true };
  } catch (err) {
    return {
      name: "Trigger.dev token",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function verifyTriggerOrgSlug(
  orgName: string,
  triggerOrgSlug: string,
  token: string
): Promise<Check> {
  try {
    const res = await ofetch<unknown>(
      "https://api.trigger.dev/api/v1/projects",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const projects = Array.isArray(res)
      ? (res as Array<{ organization?: { slug?: string } }>)
      : ((
          res as {
            projects?: Array<{ organization?: { slug?: string } }>;
            data?: Array<{ organization?: { slug?: string } }>;
          }
        ).projects ??
        (
          res as {
            data?: Array<{ organization?: { slug?: string } }>;
          }
        ).data ??
        []);
    if (projects.length === 0) {
      return {
        name: `Trigger.dev org for ${orgName}`,
        ok: true,
        detail: "no projects yet — can't verify trigger org slug",
      };
    }
    const orgSlugs = new Set<string>();
    for (const p of projects) {
      if (p.organization?.slug) {
        orgSlugs.add(p.organization.slug);
      }
    }
    if (orgSlugs.has(triggerOrgSlug)) {
      return {
        name: `Trigger.dev org for ${orgName}`,
        ok: true,
        detail: triggerOrgSlug,
      };
    }
    return {
      name: `Trigger.dev org for ${orgName}`,
      ok: false,
      detail: `triggerOrgSlug "${triggerOrgSlug}" not in visible orgs: ${
        Array.from(orgSlugs).join(", ") || "(none)"
      }`,
    };
  } catch (err) {
    return {
      name: `Trigger.dev org for ${orgName}`,
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function verifyHookdeckToken(token: string): Promise<Check> {
  try {
    await ofetch("https://api.hookdeck.com/2024-09-01/user", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { name: "Hookdeck token", ok: true };
  } catch (err) {
    return {
      name: "Hookdeck token",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

async function checkProjectHookdeck(
  orgName: string,
  projectName: string
): Promise<Check> {
  const scope = doppler.orgScope(orgName);
  const projectSlug = slugify(projectName);
  try {
    const { stdout } = await execa(
      "doppler",
      [
        "secrets",
        "download",
        `--project=${projectSlug}`,
        "--config=prd",
        "--format=json",
        "--no-file",
        `--scope=${scope}`,
      ],
      { stdio: "pipe" }
    );
    const parsed = JSON.parse(stdout) as Record<string, string>;
    const key = parsed.HOOKDECK_API_KEY;
    if (!key) {
      return {
        name: `Hookdeck key (${projectSlug}/prd)`,
        ok: false,
        detail: `missing HOOKDECK_API_KEY — re-run \`t-stack init\` or set via \`doppler secrets set HOOKDECK_API_KEY=... --project=${projectSlug} --config=prd\``,
      };
    }
    return await verifyHookdeckToken(key);
  } catch (err) {
    return {
      name: `Hookdeck key (${projectSlug}/prd)`,
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function checkCli(name: string, args: string[]): Promise<Check> {
  try {
    const { stdout } = await execa(name, args, { stdio: "pipe" });
    return {
      name: `${name} ${args.join(" ")}`,
      ok: true,
      detail: stdout.split("\n")[0],
    };
  } catch (err) {
    return {
      name: `${name} ${args.join(" ")}`,
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function checkGhAuth(): Promise<Check> {
  // `gh auth status` writes to stderr; capture both and grep for the account line.
  try {
    const { stdout, stderr } = await execa("gh", ["auth", "status"], {
      stdio: "pipe",
      reject: false,
    });
    const merged = `${stderr}\n${stdout}`;
    const accountMatch = merged.match(/account\s+(\S+)/i);
    const loggedIn = /Logged in/i.test(merged);
    if (loggedIn) {
      const user = accountMatch?.[1] ?? "unknown";
      return { name: "gh auth", ok: true, detail: user };
    }
    return {
      name: "gh auth",
      ok: false,
      detail: "not logged in (run `gh auth login`)",
    };
  } catch (err) {
    return { name: "gh auth", ok: false, detail: (err as Error).message };
  }
}

async function checkNeonctlAuth(): Promise<Check> {
  try {
    const { stdout } = await execa("neonctl", ["me", "--output", "json"], {
      stdio: "pipe",
    });
    const parsed = JSON.parse(stdout) as {
      login?: string;
      email?: string;
      name?: string;
    };
    const id = parsed.login ?? parsed.email ?? parsed.name ?? "(unknown)";
    return { name: "neonctl auth", ok: true, detail: id };
  } catch (err) {
    return { name: "neonctl auth", ok: false, detail: (err as Error).message };
  }
}

function renderResult(c: Check): string {
  const mark = c.ok ? "✓" : "✗";
  return `${mark} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`;
}

async function runCheck(
  title: string,
  fn: () => Promise<Check>
): Promise<Check> {
  const s = createSpinner();
  s.start(title);
  try {
    const result = await fn();
    s.stop(renderResult(result));
    return result;
  } catch (err) {
    const result: Check = {
      name: title,
      ok: false,
      detail: (err as Error).message,
    };
    s.stop(renderResult(result));
    return result;
  }
}

export async function runDoctor(cwd: string): Promise<number> {
  const checks: Check[] = [];

  checks.push(await runCheck("Checking doppler CLI", () => checkDopplerCli()));

  const orgs = createOrgsStore();
  const orgList = await orgs.list();
  for (const org of orgList) {
    checks.push(
      await runCheck(`Doppler auth for ${org.name}`, () =>
        checkDopplerAuthed(org.name, org.dopplerWorkplaceName)
      )
    );
    checks.push(
      await runCheck(`t-stack/prd for ${org.name}`, () =>
        checkMetaConfig(org.name)
      )
    );
    let tokens: Awaited<ReturnType<typeof loadTokens>> | undefined;
    const loadCheck = await runCheck(
      `Loading meta tokens for ${org.name}`,
      async () => {
        try {
          tokens = await loadTokens(org.name);
          return { name: `meta tokens loaded for ${org.name}`, ok: true };
        } catch (err) {
          return {
            name: `meta tokens for ${org.name}`,
            ok: false,
            detail: (err as Error).message,
          };
        }
      }
    );
    if (!(loadCheck.ok && tokens)) {
      checks.push(loadCheck);
      continue;
    }
    const t = tokens;
    checks.push(
      await runCheck("Verifying Cloudflare token", () =>
        verifyCfToken(t.cloudflareApiToken, org.cloudflareAccountId)
      )
    );
    for (const [apex, zoneId] of Object.entries(org.cloudflareZones)) {
      checks.push(
        await runCheck(`Verifying CF zone ${apex}`, () =>
          verifyCfZone(
            apex,
            zoneId,
            org.cloudflareAccountId,
            t.cloudflareApiToken
          )
        )
      );
    }
    checks.push(
      await runCheck("Verifying Trigger.dev token", () =>
        verifyTriggerToken(t.triggerAccessToken)
      )
    );
    if (org.triggerOrgSlug) {
      checks.push(
        await runCheck(`Verifying Trigger.dev org for ${org.name}`, () =>
          verifyTriggerOrgSlug(
            org.name,
            org.triggerOrgSlug as string,
            t.triggerAccessToken
          )
        )
      );
    }
  }

  checks.push(await runCheck("Checking gh auth", () => checkGhAuth()));
  checks.push(
    await runCheck("Checking pulumi auth", () => checkCli("pulumi", ["whoami"]))
  );
  checks.push(
    await runCheck("Checking turso auth", () =>
      checkCli("turso", ["auth", "whoami"])
    )
  );
  checks.push(
    await runCheck("Checking neonctl auth", () => checkNeonctlAuth())
  );

  const cfgPath = join(cwd, "t-stack.config.ts");
  if (existsSync(cfgPath) || existsSync(join(cwd, "t-stack.config.js"))) {
    try {
      const decisions = await loadConfig(cwd);
      const paths = buildPaths(cwd);
      const state = createStateStore(paths.stateFile);
      const s = await state.read();
      const stepIds = Object.keys(s.steps);
      const projectCheck: Check = {
        name: `state.json (${decisions.projectName})`,
        ok: true,
        detail: `${stepIds.length} steps recorded`,
      };
      p.log.info(renderResult(projectCheck));
      checks.push(projectCheck);
      for (const id of stepIds) {
        const rec = s.steps[id];
        if (!rec) {
          continue;
        }
        const stepCheck: Check = {
          name: `  step ${id}`,
          ok: rec.status === "completed",
          detail: rec.status,
        };
        if (stepCheck.ok) {
          p.log.success(renderResult(stepCheck));
        } else {
          p.log.error(renderResult(stepCheck));
        }
        checks.push(stepCheck);
      }
      if (decisions.hookdeck) {
        checks.push(
          await runCheck(
            `Checking project Hookdeck for ${decisions.projectName}`,
            () => checkProjectHookdeck(decisions.org, decisions.projectName)
          )
        );
      }
    } catch (err) {
      const errCheck: Check = {
        name: "project state",
        ok: false,
        detail: (err as Error).message,
      };
      p.log.error(renderResult(errCheck));
      checks.push(errCheck);
    }
  }

  return checks.filter((c) => !c.ok).length;
}

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Verify CLI auth and cloud token health.",
  },
  args: {
    cwd: { type: "string", description: "Project directory (default cwd)" },
  },
  async run({ args }) {
    const cwd = (args.cwd as string | undefined) ?? process.cwd();
    const failed = await runDoctor(cwd);
    if (failed > 0) {
      p.log.error(`${failed} check(s) failed.`);
      process.exit(1);
    }
    p.log.success("All checks passed.");
  },
});

export default doctorCommand;

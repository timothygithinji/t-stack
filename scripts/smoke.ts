#!/usr/bin/env bun
/**
 * End-to-end smoke test: `t-stack init` against a real org, wait for the
 * worker to serve HTTP 200, run `doctor`, then destroy.
 *
 * Env vars:
 *   SMOKE_ORG          Org name from orgs.toml (default: timothygithinji)
 *   SMOKE_APEX         Apex domain (default: timothygithinji.com)
 *   SMOKE_CLI          CLI invocation (default: "bun src/cli.ts")
 *   SMOKE_ARCHETYPE    "solo-cf-worker" (default) or "monorepo-cf"
 *   SMOKE_TRIGGER      "1" to include Trigger.dev in the smoke run.
 *                      Trigger.dev has no public project-create API, so the
 *                      project must already exist in the dashboard with a
 *                      matching name. Off by default.
 *   SMOKE_HOOKDECK     "1" to include Hookdeck in the smoke run. When set,
 *                      HOOKDECK_API_KEY must also be exported and you must
 *                      pre-create the Hookdeck project (recommended name:
 *                      smoke-<ts>) in the Hookdeck dashboard. Defaults off.
 *   SMOKE_SKIP_DESTROY "1" to leave resources in place at the end (useful for
 *                      iterating; remember to clean up manually).
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";

const ORG = process.env.SMOKE_ORG ?? "timothygithinji";
const APEX = process.env.SMOKE_APEX ?? "timothygithinji.com";
const ARCHETYPE = process.env.SMOKE_ARCHETYPE ?? "solo-cf-worker";
const PROJECT = `smoke-${Date.now()}`;
const DOMAIN = `${PROJECT}.${APEX}`;
const CLI = process.env.SMOKE_CLI ?? "bun src/cli.ts";
const CLI_PARTS = CLI.split(" ");
const TRIGGER_ENABLED = process.env.SMOKE_TRIGGER === "1";
const HOOKDECK_ENABLED = process.env.SMOKE_HOOKDECK === "1";
const SKIP_DESTROY = process.env.SMOKE_SKIP_DESTROY === "1";

function runCli(extra: string[]): ReturnType<typeof execa> {
  const [bin, ...rest] = CLI_PARTS;
  if (!bin) {
    throw new Error("SMOKE_CLI is empty");
  }
  return execa(bin, [...rest, ...extra], { stdio: "inherit" });
}

async function resolveViaDig(domain: string): Promise<string[]> {
  // Use system `dig` against 1.1.1.1 — Node's Resolver doesn't surface
  // Cloudflare edge-synthesised A records, but dig does.
  const res = await execa("dig", ["+short", "@1.1.1.1", domain], {
    stdio: "pipe",
    reject: false,
  });
  return res.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\d+\.\d+\.\d+$/.test(line));
}

async function probeOnce(
  domain: string
): Promise<{ status?: number; error?: string }> {
  try {
    const ips = await resolveViaDig(domain);
    if (ips.length === 0) {
      return { error: "no A records yet (DNS not propagated)" };
    }
    const ip = ips[0] as string;
    const res = await execa(
      "curl",
      [
        "-sS",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "--max-time",
        "10",
        "--resolve",
        `${domain}:443:${ip}`,
        `https://${domain}`,
      ],
      { stdio: "pipe", reject: false }
    );
    const status = Number.parseInt(res.stdout.trim(), 10);
    return Number.isFinite(status)
      ? { status }
      : { error: `curl returned: ${res.stdout}` };
  } catch (err) {
    return { error: (err as Error).message.split("\n")[0] };
  }
}

async function main() {
  if (HOOKDECK_ENABLED && !process.env.HOOKDECK_API_KEY) {
    throw new Error(
      `SMOKE_HOOKDECK=1 requires HOOKDECK_API_KEY exported (pre-create Hookdeck project named "${PROJECT}").`
    );
  }

  const hookdeckArgs = HOOKDECK_ENABLED
    ? ["--hookdeck", "--hookdeck-api-key", process.env.HOOKDECK_API_KEY ?? ""]
    : ["--no-hookdeck"];

  await runCli([
    "init",
    PROJECT,
    "--org",
    ORG,
    "--archetype",
    ARCHETYPE,
    "--domain",
    DOMAIN,
    "--db",
    "neon",
    "--envs",
    "dev+prd",
    ...(TRIGGER_ENABLED ? ["--trigger"] : ["--no-trigger"]),
    "--no-access",
    ...hookdeckArgs,
    "--yes",
  ]);

  const _startedAt = Date.now();
  const _url = `https://${DOMAIN}`;
  let success = false;
  let lastResult: { status?: number; error?: string } | undefined;
  for (let i = 0; i < 60; i++) {
    lastResult = await probeOnce(DOMAIN);
    if (lastResult.status === 200) {
      success = true;
      break;
    }
    const _detail = lastResult.status
      ? `status=${lastResult.status}`
      : `error="${lastResult.error}"`;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!success) {
    const detail = lastResult?.status
      ? `last status: ${lastResult.status}`
      : `last error: ${lastResult?.error}`;
    throw new Error(`URL did not return 200 within timeout (${detail})`);
  }

  await runCli(["doctor", "--cwd", PROJECT]);

  if (SKIP_DESTROY) {
    return;
  }

  await runCli(["destroy", "--force", "--yes", "--cwd", PROJECT]);

  // Destroy intentionally leaves the local dir for inspection; smoke doesn't
  // need it after a successful end-to-end run.
  await rm(join(process.cwd(), PROJECT), { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

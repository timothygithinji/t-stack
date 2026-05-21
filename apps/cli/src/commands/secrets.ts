import { writeFile } from "node:fs/promises";
import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import { join } from "pathe";
import type { Ctx } from "../core/preset.ts";
import * as cloudflare from "../plugins/cloudflare.js";
import * as doppler from "../plugins/doppler.js";
import { configureDopplerOidc, createGithubClient } from "../plugins/github.js";
import * as trigger from "../plugins/trigger.js";
import { buildCtx, loadConfig } from "./_ctx.js";

function escapeDotenvValue(v: string): string {
  if (/[\s"'#=]/.test(v)) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return v;
}

function serializeDotenv(record: Record<string, string>): string {
  return `${Object.entries(record)
    .map(([k, v]) => `${k}=${escapeDotenvValue(v)}`)
    .join("\n")}\n`;
}

export async function runSecretsSync(ctx: Ctx, env = "prd"): Promise<void> {
  ctx.logger.step(`Pulling secrets from Doppler (env=${env})...`);
  const secrets = await doppler.exportEnv(ctx, env);

  ctx.logger.step("Pushing secrets to Cloudflare Worker...");
  await cloudflare.pushSecrets(ctx, secrets);

  ctx.logger.step("Configuring GitHub Actions Doppler OIDC vars...");
  const gh = await createGithubClient();
  await configureDopplerOidc(ctx, gh);

  if (ctx.decisions.trigger) {
    const refs = ctx.state.get("trigger.project")?.refs as
      | trigger.TriggerRefs
      | undefined;
    if (refs) {
      ctx.logger.step("Syncing env vars to Trigger.dev...");
      await trigger.syncEnvVars(ctx, refs, secrets);
    } else {
      ctx.logger.warn(
        "No trigger.project refs in state.json; skipping Trigger.dev sync."
      );
    }
  }

  ctx.logger.success(`Secrets synced (${Object.keys(secrets).length} keys).`);
}

export async function runSecretsPull(ctx: Ctx, env: string): Promise<void> {
  ctx.logger.step(`Pulling secrets from Doppler (env=${env})...`);
  const secrets = await doppler.exportEnv(ctx, env);
  const dest = join(ctx.paths.cwd, ".dev.vars");
  await writeFile(dest, serializeDotenv(secrets), "utf8");
  ctx.logger.success(`Wrote ${Object.keys(secrets).length} keys to ${dest}`);
}

export const secretsCommand = defineCommand({
  meta: {
    name: "secrets",
    description: "Sync or pull secrets between Doppler and downstream sinks.",
  },
  subCommands: {
    sync: defineCommand({
      meta: {
        name: "sync",
        description:
          "Push prd secrets to Cloudflare, GitHub vars, Trigger.dev.",
      },
      args: {
        env: { type: "string", description: "Source env (default prd)" },
        cwd: { type: "string", description: "Project directory" },
      },
      async run({ args }) {
        const env = (args.env as string | undefined) ?? "prd";
        const cwd = (args.cwd as string | undefined) ?? process.cwd();
        p.intro(`t-stack secrets sync · ${env}`);
        try {
          const decisions = await loadConfig(cwd);
          const ctx = await buildCtx({ cwd, decisions, nonInteractive: true });
          await ctx.state.read();
          await runSecretsSync(ctx, env);
          p.outro(`Secrets synced · env=${env}`);
        } catch (err) {
          p.log.info(`Hint: t-stack doctor --cwd ${cwd}`);
          p.cancel(`secrets sync failed: ${(err as Error).message}`);
          process.exit(1);
        }
      },
    }),
    pull: defineCommand({
      meta: {
        name: "pull",
        description: "Pull secrets to `.dev.vars` (default env=dev).",
      },
      args: {
        env: { type: "string", description: "Source env (default dev)" },
        cwd: { type: "string", description: "Project directory" },
      },
      async run({ args }) {
        const env = (args.env as string | undefined) ?? "dev";
        const cwd = (args.cwd as string | undefined) ?? process.cwd();
        p.intro(`t-stack secrets pull · ${env}`);
        try {
          const decisions = await loadConfig(cwd);
          const ctx = await buildCtx({ cwd, decisions, nonInteractive: true });
          await ctx.state.read();
          await runSecretsPull(ctx, env);
          p.outro(`Secrets pulled · env=${env}`);
        } catch (err) {
          p.log.info(`Hint: t-stack doctor --cwd ${cwd}`);
          p.cancel(`secrets pull failed: ${(err as Error).message}`);
          process.exit(1);
        }
      },
    }),
  },
});

export default secretsCommand;

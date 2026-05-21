import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import type { Ctx } from "../core/preset.ts";
import * as cloudflare from "../plugins/cloudflare.js";
import * as hookdeck from "../plugins/hookdeck.js";
import { buildCtx, loadConfig } from "./_ctx.js";

export type DeployTarget = "app" | "infra" | "all";

export interface DeployOptions {
  cwd: string;
  target: DeployTarget;
  ctx?: Ctx;
}

function cfOutputsFromState(
  ctx: Ctx
): cloudflare.CloudflareOutputs | undefined {
  // Pull last known cloudflare outputs from state.json.
  // We don't await — caller already has ctx.state preloaded.
  const refs =
    ctx.state.get("cloudflare.pulumiUp")?.refs ??
    ctx.state.get("cloudflare.up")?.refs;
  if (!refs) {
    return undefined;
  }
  const kvNamespaceId = refs.kvNamespaceId as string | undefined;
  const kvNamespaceTitle = refs.kvNamespaceTitle as string | undefined;
  const r2BucketName = refs.r2BucketName as string | undefined;
  const workerUrl = refs.workerUrl as string | undefined;
  if (!(kvNamespaceId && kvNamespaceTitle && r2BucketName && workerUrl)) {
    return undefined;
  }
  const out: cloudflare.CloudflareOutputs = {
    kvNamespaceId,
    kvNamespaceTitle,
    r2BucketName,
    workerUrl,
  };
  const accessAppId = refs.accessAppId as string | undefined;
  if (accessAppId) {
    out.accessAppId = accessAppId;
  }
  return out;
}

export async function runDeploy(opts: DeployOptions): Promise<void> {
  const decisions = opts.ctx?.decisions ?? (await loadConfig(opts.cwd));
  const ctx =
    opts.ctx ??
    (await buildCtx({ cwd: opts.cwd, decisions, nonInteractive: true }));
  await ctx.state.read();

  const target = opts.target;
  if (target === "infra" || target === "all") {
    ctx.logger.step("Deploying infrastructure (Cloudflare)...");
    const cfOut = await cloudflare.pulumiUp(ctx);
    await ctx.state.markCompleted(
      "cloudflare.pulumiUp",
      cfOut as unknown as Record<string, unknown>
    );
    if (decisions.hookdeck) {
      ctx.logger.step("Deploying infrastructure (Hookdeck)...");
      const hd = await hookdeck.pulumiUp(ctx, {
        webhookTargetUrl: cfOut.workerUrl,
      });
      await ctx.state.markCompleted(
        "hookdeck.pulumiUp",
        hd as unknown as Record<string, unknown>
      );
    }
  }

  if (target === "app" || target === "all") {
    ctx.logger.step("Deploying worker...");
    const cfOut = cfOutputsFromState(ctx);
    if (!cfOut) {
      throw new Error(
        "No Cloudflare outputs in state.json — run `t-stack provision` or `t-stack deploy --target infra` first."
      );
    }
    const res = await cloudflare.deployWorker(ctx, cfOut);
    ctx.logger.success(`Worker deployed at ${res.url}`);
  }
}

export const deployCommand = defineCommand({
  meta: { name: "deploy", description: "Deploy app and/or infrastructure." },
  args: {
    target: { type: "string", description: "app | infra | all (default all)" },
    cwd: { type: "string", description: "Project directory (default cwd)" },
  },
  async run({ args }) {
    try {
      const targetRaw = ((args.target as string | undefined) ??
        "all") as DeployTarget;
      if (!["app", "infra", "all"].includes(targetRaw)) {
        p.log.error(
          `Invalid --target "${targetRaw}". Expected app, infra, or all.`
        );
        process.exit(1);
      }
      const cwd = (args.cwd as string | undefined) ?? process.cwd();
      await runDeploy({ cwd, target: targetRaw });
    } catch (err) {
      p.log.error(`deploy failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

export default deployCommand;

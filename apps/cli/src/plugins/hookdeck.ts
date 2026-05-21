import { join } from "pathe";
import {
  pulumiDestroy as adapterDestroy,
  pulumiUp as adapterUp,
} from "../adapters/pulumi.js";
import type { Ctx } from "../core/preset.ts";

export interface HookdeckOutputs {
  sourceUrl: string;
}

function infraDir(ctx: Ctx): string {
  return join(ctx.paths.cwd, "infra", "hookdeck");
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function pulumiUp(
  ctx: Ctx,
  opts: { webhookTargetUrl: string }
): Promise<HookdeckOutputs> {
  ctx.logger.debug(
    `hookdeck.pulumiUp workDir=${infraDir(ctx)} target=${opts.webhookTargetUrl}`
  );
  const outputs = await adapterUp({
    workDir: infraDir(ctx),
    stackName: ctx.org.pulumiOrg
      ? `${ctx.org.pulumiOrg}/production`
      : "production",
    tokens: ctx.tokens,
    logger: ctx.logger,
    config: {
      // Project namespace matches the template's Pulumi.yaml `name` field.
      [`${ctx.projectName}-hookdeck:destinationUrl`]: opts.webhookTargetUrl,
    },
  });
  const sourceUrl = asString(outputs.sourceUrl);
  if (!sourceUrl) {
    throw new Error(
      `Hookdeck Pulumi stack missing required output 'sourceUrl'. Got keys: ${Object.keys(outputs).join(", ")}`
    );
  }
  return { sourceUrl };
}

export async function pulumiDestroy(ctx: Ctx): Promise<void> {
  ctx.logger.debug(`hookdeck.pulumiDestroy workDir=${infraDir(ctx)}`);
  await adapterDestroy({
    workDir: infraDir(ctx),
    stackName: ctx.org.pulumiOrg
      ? `${ctx.org.pulumiOrg}/production`
      : "production",
    tokens: ctx.tokens,
    logger: ctx.logger,
  });
}

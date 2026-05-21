import { existsSync } from "node:fs";
import { execa } from "execa";
import { join } from "pathe";
import { LocalWorkspace } from "@pulumi/pulumi/automation/index.js";
import type { Logger } from "../core/log.ts";
import type { TokenBag } from "../core/tokens.ts";

export interface PulumiArgs {
  workDir: string;
  stackName: string;
  env?: Record<string, string>;
  tokens: TokenBag;
  logger: Logger;
  /** Optional Pulumi config values to set on the stack before invoking up/preview/destroy. */
  config?: Record<string, string>;
}

/**
 * Pulumi reads the program from `workDir` and expects `node_modules/` to be
 * present (it executes via the local Pulumi SDK install). The scaffolder runs
 * `bun install` at the project root but not in each Pulumi sub-program, so
 * provision against a freshly-scaffolded project fails with "Pulumi SDK has
 * not been installed". Install on demand when missing.
 */
async function ensureDepsInstalled(
  workDir: string,
  logger: Logger
): Promise<void> {
  if (existsSync(join(workDir, "node_modules"))) {
    return;
  }
  if (!existsSync(join(workDir, "package.json"))) {
    return;
  }
  logger.debug(`pulumi: installing deps in ${workDir}`);
  await execa("bun", ["install"], { cwd: workDir, stdio: "pipe" });
}

function buildEnvVars(args: PulumiArgs): Record<string, string> {
  return {
    ...(args.tokens.cloudflareApiToken
      ? { CLOUDFLARE_API_TOKEN: args.tokens.cloudflareApiToken }
      : {}),
    ...(args.tokens.hookdeckApiKey
      ? { HOOKDECK_API_KEY: args.tokens.hookdeckApiKey }
      : {}),
    ...(args.env ?? {}),
  };
}

async function selectOrCreateStack(args: PulumiArgs) {
  await ensureDepsInstalled(args.workDir, args.logger);
  const envVars = buildEnvVars(args);
  const stack = await LocalWorkspace.createOrSelectStack(
    { stackName: args.stackName, workDir: args.workDir },
    { workDir: args.workDir, envVars }
  );
  if (args.config && Object.keys(args.config).length > 0) {
    const configMap: Record<string, { value: string }> = {};
    for (const [key, value] of Object.entries(args.config)) {
      configMap[key] = { value };
    }
    await stack.setAllConfig(configMap);
  }
  return stack;
}

export async function pulumiUp(
  args: PulumiArgs
): Promise<Record<string, unknown>> {
  const stack = await selectOrCreateStack(args);
  const result = await stack.up({ onOutput: (msg) => args.logger.debug(msg) });
  const outputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result.outputs)) {
    outputs[key] = value.value;
  }
  return outputs;
}

export async function pulumiDestroy(args: PulumiArgs): Promise<void> {
  const stack = await selectOrCreateStack(args);
  await stack.destroy({ onOutput: (msg) => args.logger.debug(msg) });
  // Remove the (now empty) stack record so the cloud-resource teardown is
  // complete, not just "all resources removed but stack still listed".
  try {
    await stack.workspace.removeStack(stack.name);
  } catch (err) {
    args.logger.debug(
      `pulumi removeStack ${stack.name} failed (non-fatal): ${(err as Error).message}`
    );
  }
}

export async function pulumiPreview(args: PulumiArgs): Promise<void> {
  const stack = await selectOrCreateStack(args);
  await stack.preview({ onOutput: (msg) => args.logger.debug(msg) });
}

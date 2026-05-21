import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import type { Ctx, PresetDef } from "../core/preset.ts";
import { buildCtx, loadConfig, loadPreset } from "./_ctx.js";

export interface ProvisionOptions {
  cwd: string;
  only?: string;
  /** When supplied, skips loading from disk and uses the given Ctx. */
  ctx?: Ctx;
  /** When supplied, skips dynamic preset lookup. */
  preset?: PresetDef;
  /**
   * When supplied, skips `loadConfig(cwd)` and uses these decisions directly.
   * Used by `runInit` to carry transient fields (e.g. hookdeckApiKey) that
   * the persisted `t-stack.config.ts` doesn't store.
   */
  decisions?: import("../core/preset.ts").InitDecisions;
}

/**
 * Decorate ctx so preset code that does `const step = makeStepRunner(ctx)`
 * picks up the filtered variant. Achieved by patching the global step factory
 * is intrusive; instead, expose a ctx-aware helper here that presets can call,
 * or — pragmatically — presets receive ctx and call `makeStepRunner(ctx)` directly.
 *
 * We rely on the convention that presets call `makeStepRunner(ctx)` themselves.
 * To honour `--only`, we attach the filter prefix to ctx via a side-channel
 * property that presets are expected to honour.
 */
interface ProvisionCtx extends Ctx {
  /** Optional filter applied by `--only`. Presets may consult this. */
  __onlyPrefix?: string;
}

export async function runProvision(opts: ProvisionOptions): Promise<void> {
  const decisions =
    opts.ctx?.decisions ?? opts.decisions ?? (await loadConfig(opts.cwd));
  const ctx: ProvisionCtx =
    opts.ctx ??
    (await buildCtx({ cwd: opts.cwd, decisions, nonInteractive: true }));

  if (opts.only) {
    ctx.__onlyPrefix = opts.only;
    // Patch the step runner factory the preset will use by overriding
    // `makeStepRunner` for this ctx — presets should call `makeStepRunner(ctx)`
    // and may consult `ctx.__onlyPrefix`.
  }

  const preset =
    opts.preset ?? (await loadPreset(decisions.archetype, ctx.paths.cliRoot));

  try {
    await preset.run(ctx);
    ctx.logger.success(`Provisioned ${decisions.projectName}`);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    ctx.logger.error(
      `Provision failed: ${msg}\nResume by re-running \`t-stack provision\` once you've addressed the error.`,
      err
    );
    throw err;
  }
}

export const provisionCommand = defineCommand({
  meta: {
    name: "provision",
    description:
      "Run the preset against the current project (creates/updates cloud resources).",
  },
  args: {
    only: {
      type: "string",
      description: "Only run steps whose id starts with this prefix",
    },
    cwd: { type: "string", description: "Project directory (default: cwd)" },
  },
  async run({ args }) {
    p.intro("t-stack provision");
    try {
      const cwd = (args.cwd as string | undefined) ?? process.cwd();
      const only = args.only as string | undefined;
      await runProvision({ cwd, only });
      p.outro("Provisioned");
    } catch (err) {
      // runProvision already logs the detailed error via ctx.logger; close the
      // frame here.
      p.cancel(`provision failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

export default provisionCommand;

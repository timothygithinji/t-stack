import * as p from "@clack/prompts";
import type { InitDecisions } from "@t-stack/schema";
import type { Ctx } from "./preset.ts";
import { hasRedactedValues, makeStepRunner } from "./step.js";

/**
 * Outputs from prior steps, available to later steps. Keyed by step id.
 * E.g., the deploy step needs `cloudflare.pulumiUp` outputs.
 */
export type StepDeps = Record<string, unknown>;

/** A single plugin invocation, gated on decisions. */
export interface PluginStep<T = unknown> {
  /** Unique step id used by state.json (e.g., "cloudflare.pulumiUp"). */
  id: string;
  /** Returns true when this step should run for the current decisions. */
  activate: (d: InitDecisions) => boolean;
  /** What the step actually does. */
  run: (ctx: Ctx, deps: StepDeps) => Promise<T>;
  /**
   * Optional liveness check called before a completed step is skipped.
   *
   * Should return `true` if the cloud resource referenced by `refs` still
   * exists, `false` if it's been deleted out-of-band. Throw only for
   * transient failures (network, auth) — a missing resource is NOT an
   * error, it's a `false` return so the runner can prompt the user.
   *
   * When omitted, the runner trusts state.json and skips as before — so
   * adding `verify` to a plugin is purely opt-in.
   */
  verify?: (ctx: Ctx, refs: Record<string, unknown>) => Promise<boolean>;
}

function toRefs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  // Wrap primitives / arrays / undefined so makeStepRunner gets a plain object.
  return { value };
}

type GateVerdict = "continue" | "skip-removed";

/**
 * Run `step.verify` (if declared) against the state-cached refs for a
 * completed step. If verify reports the resource is gone, prompt the user
 * (or pick a sane default under --yes) and mutate state / `ctx.recreateMode`
 * so the downstream `step` runner does the right thing:
 *
 *   - "keep"    → leave state alone; runner skips with cached refs
 *   - "remove"  → drop the state entry; runner sees "no entry", skip step body
 *   - "adopt"   → drop state entry + set ctx.recreateMode="adopt"; runner runs
 *   - "new"     → drop state entry + set ctx.recreateMode="new";   runner runs
 *
 * Returns "skip-removed" only for the explicit-remove path so the caller can
 * `continue` past the step body entirely; otherwise "continue" lets the
 * normal step-runner path take over.
 */
async function gateOnVerify(ctx: Ctx, step: PluginStep): Promise<GateVerdict> {
  if (!step.verify) {
    return "continue";
  }
  await ctx.state.read();
  const existing = ctx.state.get(step.id);
  if (existing?.status !== "completed") {
    return "continue";
  }
  if (hasRedactedValues(existing.refs ?? {})) {
    // Redacted refs already force a re-run via the step runner, and re-running
    // self-heals via the plugin's lookup-first path. Verify would be redundant.
    return "continue";
  }

  let alive = true;
  try {
    alive = await step.verify(ctx, existing.refs ?? {});
  } catch (err) {
    // Don't false-negative on transient errors (network, auth blips). Trusting
    // state.json is the safer default — if the resource is actually missing,
    // the next genuine cloud call will surface the right error.
    ctx.logger.debug(
      `verify(${step.id}) threw: ${(err as Error).message} — trusting state.`
    );
    return "continue";
  }
  if (alive) {
    return "continue";
  }

  if (ctx.nonInteractive) {
    ctx.logger.info(
      `verify: ${step.id} reports resource missing — recreating (adopt-first, --yes default).`
    );
    await ctx.state.remove(step.id);
    return "continue";
  }

  const choice = await p.select<"adopt" | "new" | "remove" | "keep">({
    message: `Step "${step.id}" tracks a resource that no longer exists.`,
    options: [
      {
        value: "adopt",
        label: "Recreate — adopt existing match by name (errors if none found)",
      },
      {
        value: "new",
        label: "Recreate — force-create a fresh resource (may duplicate)",
      },
      {
        value: "remove",
        label:
          "Remove from state (state.json only — scaffolded code is left as-is)",
      },
      { value: "keep", label: "Keep stale state (resource stays broken)" },
    ],
    initialValue: "adopt",
  });
  if (p.isCancel(choice)) {
    throw new Error("Cancelled.");
  }

  if (choice === "keep") {
    return "continue";
  }
  if (choice === "remove") {
    await ctx.state.remove(step.id);
    ctx.logger.info(`removed: ${step.id} (state cleared)`);
    return "skip-removed";
  }
  await ctx.state.remove(step.id);
  ctx.recreateMode = choice;
  return "continue";
}

/**
 * Runs steps sequentially, honouring activation predicates and storing outputs.
 * Each step is wrapped in `makeStepRunner` so state.json tracking still works.
 * If a step's `activate` returns false, the step is skipped — logged via
 * `ctx.logger.info(\`skip: <id> (not activated)\`)`.
 *
 * `seed` lets a caller carry forward outputs from a prior graph call so a
 * later step can still read them. Seeded entries are visible to step `run`
 * functions but are not re-emitted in the return value unless overwritten.
 */
export async function runPluginGraph(
  ctx: Ctx,
  steps: readonly PluginStep[],
  seed: StepDeps = {}
): Promise<StepDeps> {
  const step = makeStepRunner(ctx);
  const deps: StepDeps = { ...seed };
  for (const s of steps) {
    if (!s.activate(ctx.decisions)) {
      ctx.logger.info(`skip: ${s.id} (not activated)`);
      continue;
    }
    const gate = await gateOnVerify(ctx, s);
    if (gate === "skip-removed") {
      continue;
    }
    try {
      const result = await step(s.id, async () =>
        toRefs(await s.run(ctx, deps))
      );
      // Surface the original return value to downstream steps. If we wrapped a
      // primitive in `{ value }`, unwrap so callers see what they returned.
      deps[s.id] =
        result &&
        typeof result === "object" &&
        "value" in result &&
        Object.keys(result).length === 1
          ? (result as { value: unknown }).value
          : result;
    } finally {
      ctx.recreateMode = undefined;
    }
  }
  return deps;
}

/**
 * Runs all activated steps in parallel. No inter-step deps available — parallel
 * steps can't read each other's outputs. Each step still flows through
 * `makeStepRunner` for state.json tracking, and the returned `StepDeps` map
 * holds every activated step's output keyed by id.
 */
export async function runParallel(
  ctx: Ctx,
  steps: readonly PluginStep[]
): Promise<StepDeps> {
  const step = makeStepRunner(ctx);
  const activated = steps.filter((s) => {
    if (s.activate(ctx.decisions)) {
      return true;
    }
    ctx.logger.info(`skip: ${s.id} (not activated)`);
    return false;
  });

  // Run verify-gates sequentially before kicking off the parallel batch, so
  // prompts (if any) interleave cleanly and don't race for the terminal.
  const toRun: PluginStep[] = [];
  for (const s of activated) {
    const gate = await gateOnVerify(ctx, s);
    if (gate !== "skip-removed") {
      toRun.push(s);
    }
  }

  const emptyDeps: StepDeps = {};
  const results = await Promise.all(
    toRun.map(async (s) => {
      const result = await step(s.id, async () =>
        toRefs(await s.run(ctx, emptyDeps))
      );
      const unwrapped =
        result &&
        typeof result === "object" &&
        "value" in result &&
        Object.keys(result).length === 1
          ? (result as { value: unknown }).value
          : result;
      return [s.id, unwrapped] as const;
    })
  );
  // Reset recreateMode once the parallel batch is done. We don't bother
  // resetting between steps since parallel steps shouldn't share the same
  // recreate intent (each was gated independently).
  ctx.recreateMode = undefined;
  const deps: StepDeps = {};
  for (const [id, value] of results) {
    deps[id] = value;
  }
  return deps;
}

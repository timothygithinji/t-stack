import type { InitDecisions } from "@t-stack/schema";
import type { Ctx } from "./preset.ts";
import { makeStepRunner } from "./step.js";

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
}

function toRefs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  // Wrap primitives / arrays / undefined so makeStepRunner gets a plain object.
  return { value };
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
    const result = await step(s.id, async () => toRefs(await s.run(ctx, deps)));
    // Surface the original return value to downstream steps. If we wrapped a
    // primitive in `{ value }`, unwrap so callers see what they returned.
    deps[s.id] =
      result &&
      typeof result === "object" &&
      "value" in result &&
      Object.keys(result).length === 1
        ? (result as { value: unknown }).value
        : result;
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
  const emptyDeps: StepDeps = {};
  const results = await Promise.all(
    activated.map(async (s) => {
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
  const deps: StepDeps = {};
  for (const [id, value] of results) {
    deps[id] = value;
  }
  return deps;
}

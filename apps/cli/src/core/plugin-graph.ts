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
  /**
   * Step ids whose state should be cleared when *this* step's `run`
   * actually executes (i.e. wasn't skipped via cached state). Lets a
   * preset express "if I rebuilt, my dependents need to refresh too" —
   * e.g. `neon.create` invalidates `doppler.seedSecrets` so a fresh
   * connection string flows through Doppler → Worker → deploy on the
   * same provision pass.
   *
   * Only cleared on a genuine re-run; a no-op skip leaves dependents
   * alone. Invalidation transcends graph boundaries — listing a step id
   * that lives in a later graph call (e.g. parallel batch or finalize)
   * still clears it.
   */
  invalidates?: readonly string[];
}

function toRefs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  // Wrap primitives / arrays / undefined so makeStepRunner gets a plain object.
  return { value };
}

/**
 * Result of the verify-on-skip gate.
 *
 *   - `proceed: false` — the gate explicitly removed the step's state (user
 *     picked "Remove from state"); skip the step body entirely, no cascade.
 *   - `proceed: true, recreated: true` — the gate cleared state because the
 *     resource was missing and we want a real recreate. The step body will
 *     run fresh and downstream consumers MUST be invalidated (so the new
 *     refs flow through the chain).
 *   - `proceed: true, recreated: false` — gate took no destructive action.
 *     The step body may still run (e.g. because refs were redacted and the
 *     step runner is refreshing sensitive values into memory), but that's a
 *     cosmetic re-run that didn't change the underlying resource — downstream
 *     should NOT cascade.
 */
type GateResult = { proceed: false } | { proceed: true; recreated: boolean };

async function invalidateDependents(
  ctx: Ctx,
  ids: readonly string[] | undefined
): Promise<void> {
  if (!ids || ids.length === 0) {
    return;
  }
  await ctx.state.read();
  for (const id of ids) {
    if (ctx.state.get(id)) {
      await ctx.state.remove(id);
      ctx.logger.debug(`invalidated: ${id} (upstream re-ran)`);
    }
  }
}

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
 * The returned `recreated` flag tells the caller whether to cascade
 * invalidation: only `true` when the gate actively cleared completed state
 * (verify failed → user/auto-recreate). A redacted-refs re-run is NOT a
 * recreate — the resource is fine, we're just refreshing sensitive values.
 */
async function gateOnVerify(ctx: Ctx, step: PluginStep): Promise<GateResult> {
  if (!step.verify) {
    return { proceed: true, recreated: false };
  }
  await ctx.state.read();
  const existing = ctx.state.get(step.id);
  if (existing?.status !== "completed") {
    return { proceed: true, recreated: false };
  }
  if (hasRedactedValues(existing.refs ?? {})) {
    // Redacted refs already force a re-run via the step runner, and re-running
    // self-heals via the plugin's lookup-first path. Verify would be redundant.
    // This is a cosmetic re-run, NOT a recreate — leave downstream alone.
    return { proceed: true, recreated: false };
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
    return { proceed: true, recreated: false };
  }
  if (alive) {
    return { proceed: true, recreated: false };
  }

  if (ctx.nonInteractive) {
    ctx.logger.info(
      `verify: ${step.id} reports resource missing — recreating (adopt-first, --yes default).`
    );
    await ctx.state.remove(step.id);
    return { proceed: true, recreated: true };
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
    return { proceed: true, recreated: false };
  }
  if (choice === "remove") {
    await ctx.state.remove(step.id);
    ctx.logger.info(`removed: ${step.id} (state cleared)`);
    return { proceed: false };
  }
  await ctx.state.remove(step.id);
  ctx.recreateMode = choice;
  return { proceed: true, recreated: true };
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
    if (!gate.proceed) {
      continue;
    }
    let ran = false;
    try {
      const result = await step(s.id, async () => {
        ran = true;
        return toRefs(await s.run(ctx, deps));
      });
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
    // Only cascade when the gate signaled a real recreate. A redacted-refs
    // re-run (cosmetic) didn't change the resource, so downstream stays cached.
    if (ran && gate.recreated) {
      await invalidateDependents(ctx, s.invalidates);
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
  const recreatedIds = new Set<string>();
  for (const s of activated) {
    const gate = await gateOnVerify(ctx, s);
    if (!gate.proceed) {
      continue;
    }
    toRun.push(s);
    if (gate.recreated) {
      recreatedIds.add(s.id);
    }
  }

  const emptyDeps: StepDeps = {};
  const results = await Promise.all(
    toRun.map(async (s) => {
      let ran = false;
      const result = await step(s.id, async () => {
        ran = true;
        return toRefs(await s.run(ctx, emptyDeps));
      });
      const unwrapped =
        result &&
        typeof result === "object" &&
        "value" in result &&
        Object.keys(result).length === 1
          ? (result as { value: unknown }).value
          : result;
      return [s.id, unwrapped, ran] as const;
    })
  );
  // Reset recreateMode once the parallel batch is done. We don't bother
  // resetting between steps since parallel steps shouldn't share the same
  // recreate intent (each was gated independently).
  ctx.recreateMode = undefined;
  const deps: StepDeps = {};
  // Invalidate downstream serially AFTER the batch so we don't race against
  // siblings that might be writing the same state file. Only cascade when the
  // gate signaled a recreate — cosmetic redacted-refs re-runs leave dependents
  // cached.
  for (const [id, value, ran] of results) {
    deps[id] = value;
    if (ran && recreatedIds.has(id)) {
      const s = toRun.find((x) => x.id === id);
      await invalidateDependents(ctx, s?.invalidates);
    }
  }
  return deps;
}

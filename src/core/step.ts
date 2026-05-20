import type { Ctx } from "./preset.ts";
import { REDACTED, redactRefsForState } from "./redact.js";

export type StepFn<T extends Record<string, unknown>> = () => Promise<T> | T;

export type StepRunner = <T extends Record<string, unknown>>(
  id: string,
  fn: StepFn<T>
) => Promise<T>;

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function hasRedactedValues(value: unknown): boolean {
  if (value === REDACTED) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasRedactedValues);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      hasRedactedValues
    );
  }
  return false;
}

export function makeStepRunner(ctx: Pick<Ctx, "state" | "logger">): StepRunner {
  return async function step<T extends Record<string, unknown>>(
    id: string,
    fn: StepFn<T>
  ): Promise<T> {
    await ctx.state.read();
    const existing = ctx.state.get(id);

    if (existing?.status === "completed") {
      // If the persisted refs contain redacted sentinels (sensitive values
      // were scrubbed before writing to state.json), re-run the step so
      // its idempotent path can re-fetch the real values into memory.
      // Otherwise the skip is safe and we return the stored refs.
      if (!hasRedactedValues(existing.refs)) {
        ctx.logger.step(`skipped: ${id}`);
        return (existing.refs ?? {}) as T;
      }
      ctx.logger.debug(`re-running ${id}: stored refs are redacted`);
    }

    const spinner = ctx.logger.spinner();
    spinner.start(id);
    await ctx.state.markRunning(id);

    const startedAt = Date.now();
    try {
      const refs = await fn();
      const duration = formatDuration(Date.now() - startedAt);
      // Persist a redacted copy to state.json (sensitive keys like
      // connectionString/authToken/secretKey are scrubbed) while returning
      // the un-redacted refs in-memory so downstream steps still have the
      // real values to consume.
      await ctx.state.markCompleted(id, redactRefsForState(refs));
      spinner.stop(`✓ ${id} ${duration}`);
      return refs;
    } catch (err) {
      const duration = formatDuration(Date.now() - startedAt);
      await ctx.state.markFailed(id, err);
      spinner.stop(`✗ ${id} ${duration}`);
      throw err;
    }
  };
}

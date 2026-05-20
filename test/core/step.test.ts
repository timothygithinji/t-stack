import { join } from "pathe";
import { describe, expect, it, vi } from "vitest";
import { createSilentLogger } from "../../src/core/log.js";
import { createStateStore } from "../../src/core/state.js";
import { makeStepRunner } from "../../src/core/step.js";
import { makeTempDir } from "../_helpers.js";

async function makeRunner() {
  const dir = await makeTempDir();
  const state = createStateStore(join(dir, "state.json"));
  await state.read();
  const logger = createSilentLogger();
  return { state, logger, step: makeStepRunner({ state, logger }) };
}

describe("makeStepRunner", () => {
  it("skips a completed step and returns stored refs", async () => {
    const { step, state } = await makeRunner();
    const fn = vi.fn(async () => ({ id: "first-call" }));

    const first = await step("alpha", fn);
    expect(first).toEqual({ id: "first-call" });
    expect(fn).toHaveBeenCalledTimes(1);

    await state.read();
    const second = await step("alpha", fn);
    expect(second).toEqual({ id: "first-call" });
    expect(fn).toHaveBeenCalledTimes(1); // skipped on re-run
  });

  it("records a successful step as completed with refs", async () => {
    const { step, state } = await makeRunner();
    await step("good", async () => ({ ok: true }));
    await state.read();
    const rec = state.get("good");
    expect(rec?.status).toBe("completed");
    expect(rec?.refs).toEqual({ ok: true });
  });

  it("records a failed step with error info and rethrows", async () => {
    const { step, state } = await makeRunner();
    await expect(
      step("bad", async () => {
        throw new Error("kaboom");
      })
    ).rejects.toThrow("kaboom");

    await state.read();
    const rec = state.get("bad");
    expect(rec?.status).toBe("failed");
    expect(rec?.error?.message).toBe("kaboom");
    // stack is optional but typically present for Error instances
    expect(
      typeof rec?.error?.stack === "string" || rec?.error?.stack === undefined
    ).toBe(true);
  });
});

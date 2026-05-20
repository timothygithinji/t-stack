import { join } from "pathe";
import { describe, expect, it } from "vitest";
import { createStateStore } from "../../src/core/state.js";
import { makeTempDir } from "../_helpers.js";

describe("StateStore", () => {
  it("round-trips a step record", async () => {
    const dir = await makeTempDir();
    const store = createStateStore(join(dir, "state.json"));

    await store.set("step.alpha", {
      status: "completed",
      at: new Date().toISOString(),
      refs: { foo: "bar" },
    });

    await store.read();
    const got = store.get("step.alpha");
    expect(got?.status).toBe("completed");
    expect(got?.refs).toEqual({ foo: "bar" });
  });

  it("markCompleted then get returns completed with refs", async () => {
    const dir = await makeTempDir();
    const store = createStateStore(join(dir, "state.json"));

    await store.markCompleted("step.beta", { id: "xyz", n: 42 });

    await store.read();
    const got = store.get("step.beta");
    expect(got?.status).toBe("completed");
    expect(got?.refs).toEqual({ id: "xyz", n: 42 });
    expect(typeof got?.at).toBe("string");
  });

  it("survives concurrent sets via file lock", async () => {
    const dir = await makeTempDir();
    const store = createStateStore(join(dir, "state.json"));

    const now = new Date().toISOString();
    await Promise.all([
      store.set("step.one", { status: "completed", at: now, refs: { v: 1 } }),
      store.set("step.two", { status: "completed", at: now, refs: { v: 2 } }),
    ]);

    const state = await store.read();
    expect(state.steps["step.one"]).toBeDefined();
    expect(state.steps["step.two"]).toBeDefined();
    expect(state.steps["step.one"]?.refs).toEqual({ v: 1 });
    expect(state.steps["step.two"]?.refs).toEqual({ v: 2 });
  });

  it("markFailed records error message", async () => {
    const dir = await makeTempDir();
    const store = createStateStore(join(dir, "state.json"));
    await store.markFailed("step.fail", new Error("boom"));
    await store.read();
    const got = store.get("step.fail");
    expect(got?.status).toBe("failed");
    expect(got?.error?.message).toBe("boom");
  });
});

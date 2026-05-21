import { join } from "pathe";
import { describe, expect, it, vi } from "vitest";
import { createSilentLogger } from "../../src/core/log.js";
import {
  REDACTED,
  isSensitiveKey,
  redactRefsForState,
} from "../../src/core/redact.js";
import { createStateStore } from "../../src/core/state.js";
import { makeStepRunner } from "../../src/core/step.js";
import { makeTempDir } from "../_helpers.js";

describe("isSensitiveKey", () => {
  it.each([
    "connectionString",
    "authToken",
    "secretKey",
    "apiKey",
    "password",
    "DATABASE_PASSWORD",
    "triggerAccessToken",
    "privateKey",
  ])("flags %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "projectId",
    "projectName",
    "projectRef",
    "branchId",
    "databaseName",
    "url",
    "slug",
    "id",
    "name",
    "ok",
  ])("treats %s as safe", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe("redactRefsForState", () => {
  it("replaces sensitive top-level values with the redaction sentinel", () => {
    const input = {
      projectId: "p1",
      connectionString: "postgres://user:pw@host/db",
    };
    const out = redactRefsForState(input);
    expect(out).toEqual({ projectId: "p1", connectionString: REDACTED });
  });

  it("leaves safe-only refs verbatim", () => {
    const input = { projectId: "p1", name: "demo", branchId: "br_1" };
    const out = redactRefsForState(input);
    expect(out).toEqual(input);
  });

  it("does not mutate the input object", () => {
    const input = {
      projectId: "p1",
      connectionString: "postgres://user:pw@host/db",
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    redactRefsForState(input);
    expect(input).toEqual(snapshot);
  });

  it("redacts every sensitive key in a Trigger.dev-style ref", () => {
    const input = {
      projectRef: "proj_abc",
      slug: "demo",
      secretKey: "tr_prod_xyz",
    };
    expect(redactRefsForState(input)).toEqual({
      projectRef: "proj_abc",
      slug: "demo",
      secretKey: REDACTED,
    });
  });

  it("redacts every sensitive key in a Turso-style ref", () => {
    const input = {
      databaseName: "demo",
      url: "libsql://demo.turso.io",
      authToken: "ey...",
      connectionString: "libsql://demo.turso.io?authToken=ey...",
    };
    expect(redactRefsForState(input)).toEqual({
      databaseName: "demo",
      url: "libsql://demo.turso.io",
      authToken: REDACTED,
      connectionString: REDACTED,
    });
  });

  it("recurses into nested objects", () => {
    const input = {
      project: { id: "p1", secretKey: "ssh!" },
      env: { DATABASE_PASSWORD: "hunter2", name: "prod" },
    };
    expect(redactRefsForState(input)).toEqual({
      project: { id: "p1", secretKey: REDACTED },
      env: { DATABASE_PASSWORD: REDACTED, name: "prod" },
    });
  });

  it("recurses into arrays", () => {
    const input = {
      keys: [
        { name: "a", secretKey: "x" },
        { name: "b", secretKey: "y" },
      ],
    };
    expect(redactRefsForState(input)).toEqual({
      keys: [
        { name: "a", secretKey: REDACTED },
        { name: "b", secretKey: REDACTED },
      ],
    });
  });
});

async function makeRunner() {
  const dir = await makeTempDir();
  const stateFile = join(dir, "state.json");
  const state = createStateStore(stateFile);
  await state.read();
  const logger = createSilentLogger();
  return {
    dir,
    stateFile,
    state,
    logger,
    step: makeStepRunner({ state, logger }),
  };
}

describe("step runner redaction", () => {
  it("persists redacted refs to state.json but returns the un-redacted value to the caller", async () => {
    const { step, state } = await makeRunner();
    const fn = vi.fn(async () => ({
      projectId: "p1",
      connectionString: "postgres://user:pw@host/db",
    }));

    const returned = await step("neon.create", fn);

    // Caller sees the real value (downstream steps depend on this).
    expect(returned).toEqual({
      projectId: "p1",
      connectionString: "postgres://user:pw@host/db",
    });

    // state.json sees only the redacted copy.
    await state.read();
    const stored = state.get("neon.create");
    expect(stored?.status).toBe("completed");
    expect(stored?.refs).toEqual({
      projectId: "p1",
      connectionString: REDACTED,
    });
  });

  it("persists safe-only refs verbatim", async () => {
    const { step, state } = await makeRunner();
    await step("safe.step", async () => ({ projectId: "p1", name: "demo" }));

    await state.read();
    const stored = state.get("safe.step");
    expect(stored?.refs).toEqual({ projectId: "p1", name: "demo" });
  });

  it("re-runs a completed step whose stored refs were redacted (rather than returning sentinels)", async () => {
    const { step, state } = await makeRunner();
    const fn = vi.fn(async () => ({
      projectId: "p1",
      connectionString: "postgres://user:pw@host/db",
    }));

    await step("neon.create", fn);
    expect(fn).toHaveBeenCalledTimes(1);

    // Simulate a resumed `t-stack init`: state.json still on disk, in-memory
    // refs gone. The next call should re-run the step (since stored refs are
    // redacted) so the un-redacted return flows downstream again.
    await state.read();
    const second = await step("neon.create", fn);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(second).toEqual({
      projectId: "p1",
      connectionString: "postgres://user:pw@host/db",
    });
  });

  it("still skips a completed step whose stored refs contain no sensitive values", async () => {
    const { step, state } = await makeRunner();
    const fn = vi.fn(async () => ({ projectId: "p1", name: "demo" }));

    await step("safe.step", fn);
    expect(fn).toHaveBeenCalledTimes(1);

    await state.read();
    const second = await step("safe.step", fn);
    expect(fn).toHaveBeenCalledTimes(1); // skipped on re-run
    expect(second).toEqual({ projectId: "p1", name: "demo" });
  });
});

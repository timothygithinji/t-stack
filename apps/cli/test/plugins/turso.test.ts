import { beforeEach, describe, expect, it, vi } from "vitest";

interface ExecaCall {
  bin: string;
  args: string[];
}
type HandlerResult =
  | { stdout?: string; stderr?: string; exitCode?: number; throws?: true }
  | undefined;
type Handler = (call: ExecaCall) => HandlerResult;

const { execaMock, state } = vi.hoisted(() => {
  const s = { calls: [] as ExecaCall[], handlers: [] as Handler[] };
  const m = vi.fn(async (bin: string, args: string[]) => {
    s.calls.push({ bin, args });
    for (const h of s.handlers) {
      const r = h({ bin, args });
      if (r) {
        if (r.throws) {
          const err = new Error("execa fail") as Error & {
            stderr?: string;
            exitCode?: number;
          };
          err.stderr = r.stderr ?? "";
          err.exitCode = r.exitCode ?? 1;
          throw err;
        }
        return {
          stdout: r.stdout ?? "",
          stderr: r.stderr ?? "",
          exitCode: r.exitCode ?? 0,
        };
      }
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  });
  return { execaMock: m, state: s };
});

vi.mock("execa", () => ({ execa: execaMock }));

function setHandlers(h: Handler[]) {
  state.handlers = h;
}

import { create, verifyExists } from "../../src/plugins/turso.js";
import { makeTestCtx } from "../_helpers.js";

beforeEach(() => {
  state.calls.length = 0;
  setHandlers([]);
  execaMock.mockClear();
});

function isCreate(c: ExecaCall) {
  return c.bin === "turso" && c.args[0] === "db" && c.args[1] === "create";
}
function isShowUrl(c: ExecaCall) {
  return (
    c.bin === "turso" &&
    c.args[0] === "db" &&
    c.args[1] === "show" &&
    c.args.includes("--url")
  );
}
function isTokensCreate(c: ExecaCall) {
  return (
    c.bin === "turso" &&
    c.args[0] === "db" &&
    c.args[1] === "tokens" &&
    c.args[2] === "create"
  );
}

describe("turso.create", () => {
  it("creates a db when the lookup probe reports it missing", async () => {
    let lookupCalls = 0;
    setHandlers([
      (c) => {
        if (isShowUrl(c)) {
          lookupCalls += 1;
          if (lookupCalls === 1) {
            // First call is the lookup probe — DB doesn't exist yet.
            return { throws: true, stderr: "database not found" };
          }
          // Subsequent call is the post-create URL fetch.
          return { stdout: "libsql://demo-fanya.turso.io" };
        }
        if (isCreate(c)) {
          return { stdout: "{}" };
        }
        if (isTokensCreate(c)) {
          return { stdout: "tok_abc" };
        }
        return;
      },
    ]);
    const ctx = await makeTestCtx({ projectName: "demo" });
    const refs = await create(ctx);
    expect(refs.databaseName).toBe("demo");
    expect(refs.url).toBe("libsql://demo-fanya.turso.io");
    expect(refs.authToken).toBe("tok_abc");
    expect(refs.connectionString).toBe(
      "libsql://demo-fanya.turso.io?authToken=tok_abc"
    );
  });

  it("adopts an existing db without calling create", async () => {
    setHandlers([
      (c) => {
        if (isShowUrl(c)) {
          return { stdout: "libsql://demo-fanya.turso.io" };
        }
        if (isCreate(c)) {
          throw new Error("create should not be called when db exists");
        }
        if (isTokensCreate(c)) {
          return { stdout: "tok_existing" };
        }
        return;
      },
    ]);
    const ctx = await makeTestCtx({ projectName: "demo" });
    const refs = await create(ctx);
    expect(refs.url).toBe("libsql://demo-fanya.turso.io");
    expect(refs.connectionString).toContain("authToken=tok_existing");
    expect(state.calls.some(isCreate)).toBe(false);
  });

  it("is idempotent — second call returns equivalent refs without re-creating", async () => {
    setHandlers([
      (c) => {
        if (isShowUrl(c)) {
          return { stdout: "libsql://demo-fanya.turso.io" };
        }
        if (isCreate(c)) {
          throw new Error("create should not be called on idempotent retry");
        }
        if (isTokensCreate(c)) {
          return { stdout: "tok_stable" };
        }
        return;
      },
    ]);
    const ctx = await makeTestCtx({ projectName: "demo" });
    const a = await create(ctx);
    const b = await create(ctx);
    expect(b.databaseName).toBe(a.databaseName);
    expect(b.url).toBe(a.url);
    expect(b.connectionString).toBe(a.connectionString);
    expect(state.calls.filter(isCreate)).toHaveLength(0);
  });
});

describe("turso.verifyExists", () => {
  it("returns true when `turso db show --url` succeeds", async () => {
    setHandlers([
      (c) => {
        if (isShowUrl(c)) {
          return { stdout: "libsql://demo-fanya.turso.io" };
        }
        return;
      },
    ]);
    const ctx = await makeTestCtx({ projectName: "demo" });
    expect(await verifyExists(ctx, { databaseName: "demo" })).toBe(true);
  });

  it("returns false when the CLI reports the db is gone", async () => {
    setHandlers([
      (c) => {
        if (isShowUrl(c)) {
          return { throws: true, stderr: "database not found" };
        }
        return;
      },
    ]);
    const ctx = await makeTestCtx({ projectName: "demo" });
    expect(await verifyExists(ctx, { databaseName: "demo" })).toBe(false);
  });

  it("returns false when refs lack a databaseName", async () => {
    const ctx = await makeTestCtx({ projectName: "demo" });
    expect(await verifyExists(ctx, {})).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

type ExecaCall = { bin: string; args: string[] };
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

import { create } from "../../src/plugins/turso.js";
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
  it("creates a db, fetches its url, and builds the connectionString", async () => {
    setHandlers([
      (c) => {
        if (isCreate(c)) {
          return { stdout: "{}" };
        }
        if (isShowUrl(c)) {
          return { stdout: "libsql://demo-fanya.turso.io" };
        }
        if (isTokensCreate(c)) {
          return { stdout: "tok_abc" };
        }
        return undefined;
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

  it("falls back when create reports already exists", async () => {
    setHandlers([
      (c) => {
        if (isCreate(c)) {
          return { throws: true, stderr: "database already exists" };
        }
        if (isShowUrl(c)) {
          return { stdout: "libsql://demo-fanya.turso.io" };
        }
        if (isTokensCreate(c)) {
          return { stdout: "tok_existing" };
        }
        return undefined;
      },
    ]);
    const ctx = await makeTestCtx({ projectName: "demo" });
    const refs = await create(ctx);
    expect(refs.url).toBe("libsql://demo-fanya.turso.io");
    expect(refs.connectionString).toContain("authToken=tok_existing");
  });

  it("is idempotent — second call returns equivalent refs", async () => {
    let created = false;
    setHandlers([
      (c) => {
        if (isCreate(c)) {
          if (!created) {
            created = true;
            return { stdout: "{}" };
          }
          return { throws: true, stderr: "database already exists" };
        }
        if (isShowUrl(c)) {
          return { stdout: "libsql://demo-fanya.turso.io" };
        }
        if (isTokensCreate(c)) {
          return { stdout: "tok_stable" };
        }
        return undefined;
      },
    ]);
    const ctx = await makeTestCtx({ projectName: "demo" });
    const a = await create(ctx);
    const b = await create(ctx);
    expect(b.databaseName).toBe(a.databaseName);
    expect(b.url).toBe(a.url);
    // Tokens may differ in real life; we mock the same token here.
    expect(b.connectionString).toBe(a.connectionString);
  });
});

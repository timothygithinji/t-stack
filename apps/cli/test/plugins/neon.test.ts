import { beforeEach, describe, expect, it, vi } from "vitest";

// Track every execa call so we can drive the mock per-test.
interface ExecaCall {
  bin: string;
  args: string[];
}
type HandlerResult =
  | { stdout?: string; stderr?: string; exitCode?: number; throws?: true }
  | undefined;
type Handler = (call: ExecaCall) => HandlerResult;

const { execaMock, state } = vi.hoisted(() => {
  const s = {
    calls: [] as ExecaCall[],
    handlers: [] as Handler[],
  };
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

const calls = state.calls;
function setHandlers(h: Handler[]) {
  state.handlers = h;
}

import { create } from "../../src/plugins/neon.js";
import { makeTestCtx } from "../_helpers.js";

beforeEach(() => {
  state.calls.length = 0;
  setHandlers([]);
  execaMock.mockClear();
});

function isCreateCall(c: ExecaCall) {
  return (
    c.bin === "neonctl" && c.args[0] === "projects" && c.args[1] === "create"
  );
}
function isListCall(c: ExecaCall) {
  return (
    c.bin === "neonctl" && c.args[0] === "projects" && c.args[1] === "list"
  );
}
function isConnStringCall(c: ExecaCall) {
  return c.bin === "neonctl" && c.args[0] === "connection-string";
}

describe("neon.create", () => {
  it("creates a project and fetches its connection string", async () => {
    setHandlers([
      (c) => {
        if (isCreateCall(c)) {
          return {
            stdout: JSON.stringify({
              project: { id: "p1", name: "demo", default_branch_id: "br1" },
              branch: { id: "br1" },
            }),
          };
        }
        if (isConnStringCall(c)) {
          return { stdout: JSON.stringify({ uri: "postgres://demo-url" }) };
        }
        return;
      },
    ]);

    const ctx = await makeTestCtx({ projectName: "demo" });
    const refs = await create(ctx);
    expect(refs.projectId).toBe("p1");
    expect(refs.projectName).toBe("demo");
    expect(refs.branchId).toBe("br1");
    expect(refs.connectionString).toBe("postgres://demo-url");
  });

  it("falls back to projects list when create fails with already exists", async () => {
    setHandlers([
      (c) => {
        if (isCreateCall(c)) {
          return { throws: true, stderr: "project already exists" };
        }
        if (isListCall(c)) {
          return {
            stdout: JSON.stringify([
              { id: "p1", name: "demo", default_branch_id: "br1" },
              { id: "p2", name: "other" },
            ]),
          };
        }
        if (isConnStringCall(c)) {
          return {
            stdout: JSON.stringify({ uri: "postgres://demo-existing" }),
          };
        }
        return;
      },
    ]);

    const ctx = await makeTestCtx({ projectName: "demo" });
    const refs = await create(ctx);
    expect(refs.projectId).toBe("p1");
    expect(refs.connectionString).toBe("postgres://demo-existing");
    expect(calls.some((c) => isListCall(c))).toBe(true);
  });

  it("is idempotent — second call returns the same connectionString", async () => {
    // Both invocations: first time the create succeeds, second time the
    // create returns already-exists and we route through the list.
    let created = false;
    setHandlers([
      (c) => {
        if (isCreateCall(c)) {
          if (!created) {
            created = true;
            return {
              stdout: JSON.stringify({
                project: { id: "p1", name: "demo", default_branch_id: "br1" },
                branch: { id: "br1" },
              }),
            };
          }
          return { throws: true, stderr: "project already exists" };
        }
        if (isListCall(c)) {
          return {
            stdout: JSON.stringify([
              { id: "p1", name: "demo", default_branch_id: "br1" },
            ]),
          };
        }
        if (isConnStringCall(c)) {
          return { stdout: JSON.stringify({ uri: "postgres://demo-url" }) };
        }
        return;
      },
    ]);

    const ctx = await makeTestCtx({ projectName: "demo" });
    const first = await create(ctx);
    const second = await create(ctx);
    expect(second.connectionString).toBe(first.connectionString);
    expect(second.projectId).toBe(first.projectId);
  });
});

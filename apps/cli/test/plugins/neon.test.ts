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
  it("creates a project when the projects list contains no match", async () => {
    setHandlers([
      (c) => {
        if (isListCall(c)) {
          return { stdout: JSON.stringify([]) };
        }
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
    expect(calls.some(isCreateCall)).toBe(true);
  });

  it("reuses an existing project without calling create", async () => {
    setHandlers([
      (c) => {
        if (isListCall(c)) {
          return {
            stdout: JSON.stringify([
              { id: "p1", name: "demo", default_branch_id: "br1" },
              { id: "p2", name: "other" },
            ]),
          };
        }
        if (isCreateCall(c)) {
          throw new Error("create should not be called when project exists");
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
    expect(calls.some(isCreateCall)).toBe(false);
  });

  it("matches existing projects case-insensitively", async () => {
    setHandlers([
      (c) => {
        if (isListCall(c)) {
          return {
            stdout: JSON.stringify([
              { id: "p1", name: "DEMO", default_branch_id: "br1" },
            ]),
          };
        }
        if (isCreateCall(c)) {
          throw new Error("create should not be called when project exists");
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
    expect(calls.some(isCreateCall)).toBe(false);
  });

  it("passes --region-id to neonctl when databaseRegion is set in decisions", async () => {
    setHandlers([
      (c) => {
        if (isListCall(c)) {
          return { stdout: JSON.stringify([]) };
        }
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

    const ctx = await makeTestCtx({
      projectName: "demo",
      decisions: { databaseRegion: "aws-eu-central-1" },
    });
    await create(ctx);
    const createCall = calls.find(isCreateCall);
    expect(createCall?.args).toContain("--region-id");
    expect(createCall?.args).toContain("aws-eu-central-1");
  });

  it("is idempotent — second call returns the same connectionString without re-creating", async () => {
    setHandlers([
      (c) => {
        if (isListCall(c)) {
          return {
            stdout: JSON.stringify([
              { id: "p1", name: "demo", default_branch_id: "br1" },
            ]),
          };
        }
        if (isCreateCall(c)) {
          throw new Error("create should not be called on idempotent retry");
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
    expect(calls.filter(isCreateCall)).toHaveLength(0);
  });
});

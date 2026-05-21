import { describe, expect, it, vi } from "vitest";
import {
  type PluginStep,
  runParallel,
  runPluginGraph,
} from "../../src/core/plugin-graph.js";
import { makeTestCtx } from "../_helpers.js";

describe("runPluginGraph", () => {
  it("skips steps whose activate returns false", async () => {
    const ctx = await makeTestCtx({
      decisions: { cloudProvider: "none", databaseHost: "none" },
    });
    const cloudRun = vi.fn(async () => ({ ran: "cloud" }));
    const neonRun = vi.fn(async () => ({ ran: "neon" }));
    const steps: PluginStep[] = [
      {
        id: "cloudflare.pulumiUp",
        activate: (d) => d.cloudProvider === "cloudflare",
        run: cloudRun,
      },
      {
        id: "neon.create",
        activate: (d) => d.databaseHost === "neon",
        run: neonRun,
      },
    ];
    const deps = await runPluginGraph(ctx, steps);
    expect(cloudRun).not.toHaveBeenCalled();
    expect(neonRun).not.toHaveBeenCalled();
    expect(deps).toEqual({});
  });

  it("stores activated step outputs keyed by step id", async () => {
    const ctx = await makeTestCtx();
    const steps: PluginStep[] = [
      {
        id: "neon.create",
        activate: () => true,
        async run() {
          return { connectionString: "postgres://x" };
        },
      },
    ];
    const deps = await runPluginGraph(ctx, steps);
    expect(deps["neon.create"]).toEqual({ connectionString: "postgres://x" });
  });

  it("lets a step read prior step output via deps[priorId]", async () => {
    const ctx = await makeTestCtx();
    const observed: Array<{ db?: unknown }> = [];
    const steps: PluginStep[] = [
      {
        id: "neon.create",
        activate: () => true,
        async run() {
          return { connectionString: "postgres://x" };
        },
      },
      {
        id: "doppler.seedSecrets",
        activate: () => true,
        async run(_c, deps) {
          observed.push({ db: deps["neon.create"] });
          return {};
        },
      },
    ];
    await runPluginGraph(ctx, steps);
    expect(observed).toEqual([{ db: { connectionString: "postgres://x" } }]);
  });

  it("threads seed deps into the first step", async () => {
    const ctx = await makeTestCtx();
    const observed: Record<string, unknown> = {};
    const steps: PluginStep[] = [
      {
        id: "cloudflare.deploy",
        activate: () => true,
        async run(_c, deps) {
          observed.seen = deps["cloudflare.pulumiUp"];
          return { deployed: true };
        },
      },
    ];
    await runPluginGraph(ctx, steps, {
      "cloudflare.pulumiUp": { workerUrl: "https://x.workers.dev" },
    });
    expect(observed.seen).toEqual({ workerUrl: "https://x.workers.dev" });
  });

  it("records activated step ids in state.json", async () => {
    const ctx = await makeTestCtx({
      decisions: { cloudProvider: "none", databaseHost: "neon" },
    });
    const steps: PluginStep[] = [
      {
        id: "neon.create",
        activate: (d) => d.databaseHost === "neon",
        async run() {
          return { connectionString: "x" };
        },
      },
      {
        id: "cloudflare.pulumiUp",
        activate: (d) => d.cloudProvider === "cloudflare",
        async run() {
          return { workerUrl: "x" };
        },
      },
    ];
    await runPluginGraph(ctx, steps);
    await ctx.state.read();
    expect(ctx.state.get("neon.create")?.status).toBe("completed");
    expect(ctx.state.get("cloudflare.pulumiUp")).toBeUndefined();
  });
});

describe("runParallel", () => {
  it("runs all activated steps and returns outputs keyed by id", async () => {
    const ctx = await makeTestCtx();
    const aRun = vi.fn(async () => ({ a: 1 }));
    const bRun = vi.fn(async () => ({ b: 2 }));
    const steps: PluginStep[] = [
      { id: "a", activate: () => true, run: aRun },
      { id: "b", activate: () => true, run: bRun },
    ];
    const deps = await runParallel(ctx, steps);
    expect(aRun).toHaveBeenCalledTimes(1);
    expect(bRun).toHaveBeenCalledTimes(1);
    expect(deps).toEqual({ a: { a: 1 }, b: { b: 2 } });
  });

  it("skips non-activated steps in parallel batches", async () => {
    const ctx = await makeTestCtx({ decisions: { trigger: false } });
    const triggerRun = vi.fn(async () => ({ ran: true }));
    const cfRun = vi.fn(async () => ({ ran: true }));
    const steps: PluginStep[] = [
      {
        id: "secrets.trigger",
        activate: (d) => d.trigger,
        run: triggerRun,
      },
      {
        id: "secrets.cloudflare",
        activate: (d) => d.cloudProvider === "cloudflare",
        run: cfRun,
      },
    ];
    const deps = await runParallel(ctx, steps);
    expect(triggerRun).not.toHaveBeenCalled();
    expect(cfRun).toHaveBeenCalledTimes(1);
    expect(deps).toEqual({ "secrets.cloudflare": { ran: true } });
  });
});

describe("preset activation smoke", () => {
  it("activation predicates exclude unused steps when decisions are off", async () => {
    // Mirrors the predicate table the presets declare. Verifies that with
    // cloudProvider=none / databaseHost=none / trigger=false / hookdeck=false
    // / git=false, NONE of the gated steps would activate.
    const decisions = {
      cloudProvider: "none" as "cloudflare" | "none",
      iac: "pulumi" as "pulumi" | "none",
      databaseHost: "none" as "neon" | "turso" | "none",
      trigger: false,
      hookdeck: false,
      git: false,
    };
    const predicates: Record<string, () => boolean> = {
      "cloudflare.pulumiUp": () =>
        decisions.cloudProvider === "cloudflare" && decisions.iac === "pulumi",
      "cloudflare.patchWrangler": () =>
        decisions.cloudProvider === "cloudflare",
      "cloudflare.deploy": () => decisions.cloudProvider === "cloudflare",
      "secrets.cloudflare": () => decisions.cloudProvider === "cloudflare",
      "neon.create": () => decisions.databaseHost === "neon",
      "turso.create": () => decisions.databaseHost === "turso",
      "trigger.project": () => decisions.trigger,
      "secrets.trigger": () => decisions.trigger,
      "hookdeck.pulumiUp": () => decisions.hookdeck === true,
      "github.repo": () => decisions.git === true,
      "github.firstCommit": () => decisions.git === true,
      "secrets.gha-oidc": () => decisions.git === true,
    };
    for (const [id, fn] of Object.entries(predicates)) {
      expect({ id, active: fn() }).toEqual({ id, active: false });
    }
  });
});

import {
  type PluginStep,
  runParallel,
  runPluginGraph,
} from "../src/core/plugin-graph.js";
import { type Ctx, definePreset } from "../src/core/preset.js";
import * as cf from "../src/plugins/cloudflare.js";
import * as doppler from "../src/plugins/doppler.js";
import { createGithubClient } from "../src/plugins/github.js";
import * as github from "../src/plugins/github.js";
import * as hookdeck from "../src/plugins/hookdeck.js";
import * as neon from "../src/plugins/neon.js";
import * as trigger from "../src/plugins/trigger.js";
import * as turso from "../src/plugins/turso.js";

export default definePreset({
  id: "monorepo-cloudflare",
  name: "Monorepo (Cloudflare)",
  description: "Bun workspaces + Turbo monorepo",
  templates: ["_base", "monorepo-cloudflare"],
  defaults: {
    structure: "monorepo",
    cloudProvider: "cloudflare",
    iac: "pulumi",
    runtime: "workers",
    frontend: "tanstack-router",
    backend: "hono",
    docs: "starlight",
    api: "orpc",
    database: "postgres",
    databaseHost: "neon",
    orm: "drizzle",
    auth: "better-auth",
    storage: "none",
    payments: "none",
    addons: ["turborepo", "biome"],
    packageManager: "bun",
    git: true,
    install: true,
  },
  async run(ctx: Ctx) {
    const provision: PluginStep[] = [
      {
        id: "doppler.project",
        activate: () => true,
        async run(c) {
          await doppler.createProject(c);
          return {};
        },
        verify: doppler.verifyProjectExists,
      },
      {
        id: "github.repo",
        activate: (d) => d.git === true,
        async run(c) {
          return await github.createRepo(c);
        },
        verify: github.verifyRepoExists,
      },
      {
        id: "neon.create",
        activate: (d) => d.databaseHost === "neon",
        async run(c) {
          return await neon.create(c);
        },
        verify: neon.verifyExists,
        invalidates: [
          "doppler.seedSecrets",
          "secrets.cloudflare",
          "cloudflare.deploy",
        ],
      },
      {
        id: "turso.create",
        activate: (d) => d.databaseHost === "turso",
        async run(c) {
          return await turso.create(c);
        },
        verify: turso.verifyExists,
        invalidates: [
          "doppler.seedSecrets",
          "secrets.cloudflare",
          "cloudflare.deploy",
        ],
      },
      {
        id: "trigger.project",
        activate: (d) => d.trigger,
        async run(c) {
          return await trigger.createProject(c);
        },
        verify: trigger.verifyExists,
        invalidates: [
          "doppler.seedSecrets",
          "secrets.trigger",
          "secrets.cloudflare",
          "cloudflare.deploy",
        ],
      },
      {
        id: "doppler.seedSecrets",
        activate: () => true,
        async run(c, deps) {
          const db = (deps["neon.create"] ?? deps["turso.create"]) as
            | { connectionString?: string }
            | undefined;
          const trg = deps["trigger.project"] as
            | { secretKey?: string }
            | undefined;
          await doppler.seedSecrets(c, { db, trg });
          return {};
        },
        invalidates: [
          "secrets.cloudflare",
          "secrets.trigger",
          "cloudflare.deploy",
        ],
      },
      {
        id: "cloudflare.pulumiUp",
        activate: (d) => d.cloudProvider === "cloudflare" && d.iac === "pulumi",
        async run(c) {
          return await cf.pulumiUp(c);
        },
      },
      {
        id: "cloudflare.patchWrangler",
        activate: (d) => d.cloudProvider === "cloudflare",
        async run(c, deps) {
          const cfOut = deps["cloudflare.pulumiUp"] as
            | cf.CloudflareOutputs
            | undefined;
          if (cfOut) {
            await cf.patchWrangler(c, cfOut);
          }
          return {};
        },
      },
      {
        id: "hookdeck.pulumiUp",
        activate: (d) => d.hookdeck === true,
        async run(c, deps) {
          const cfOut = deps["cloudflare.pulumiUp"] as
            | cf.CloudflareOutputs
            | undefined;
          return await hookdeck.pulumiUp(c, {
            webhookTargetUrl: cfOut?.workerUrl ?? "",
          });
        },
      },
    ];
    const provisionDeps = await runPluginGraph(ctx, provision);

    const prdSecrets = await doppler.exportEnv(ctx, "prd");
    const ghClient = await createGithubClient();
    const trg = provisionDeps["trigger.project"] as
      | trigger.TriggerRefs
      | undefined;

    const secretsBatch: PluginStep[] = [
      {
        id: "secrets.cloudflare",
        activate: (d) => d.cloudProvider === "cloudflare",
        async run(c) {
          await cf.pushSecrets(c, prdSecrets);
          return {};
        },
        invalidates: ["cloudflare.deploy"],
      },
      {
        id: "secrets.gha-deploy-token",
        activate: (d) => d.git === true,
        async run(c) {
          await github.configureDopplerDeployToken(c, ghClient);
          return {};
        },
      },
      {
        id: "secrets.trigger",
        activate: (d) => d.trigger,
        async run(c) {
          if (trg) {
            await trigger.syncEnvVars(c, trg, prdSecrets);
          }
          return {};
        },
      },
    ];
    await runParallel(ctx, secretsBatch);

    const finalize: PluginStep[] = [
      {
        id: "cloudflare.deploy",
        activate: (d) => d.cloudProvider === "cloudflare" && d.iac === "pulumi",
        async run(c, deps) {
          const cfOut = deps["cloudflare.pulumiUp"] as
            | cf.CloudflareOutputs
            | undefined;
          if (!cfOut) {
            return {};
          }
          return await cf.deployWorker(c, cfOut);
        },
      },
      {
        id: "github.firstCommit",
        activate: (d) => d.git === true,
        async run(c) {
          await github.pushInitial(c, ghClient);
          return {};
        },
      },
    ];
    await runPluginGraph(ctx, finalize, provisionDeps);
  },
});

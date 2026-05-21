import { type Ctx, definePreset } from "../src/core/preset.js";
import { makeStepRunner } from "../src/core/step.js";
import * as cf from "../src/plugins/cloudflare.js";
import * as doppler from "../src/plugins/doppler.js";
import { createGithubClient } from "../src/plugins/github.js";
import * as github from "../src/plugins/github.js";
import * as hookdeck from "../src/plugins/hookdeck.js";
import * as neon from "../src/plugins/neon.js";
import * as trigger from "../src/plugins/trigger.js";

type Bag<T> = T & Record<string, unknown>;

function bag<T>(value: T): Bag<T> {
  return value as Bag<T>;
}

export default definePreset({
  id: "monorepo-cf",
  description: "Bun workspaces + Turbo monorepo",
  templates: ["_base", "monorepo-cf"],
  async run(ctx: Ctx) {
    const step = makeStepRunner(ctx);

    await step("doppler.project", async () => {
      await doppler.createProject(ctx);
      return {};
    });

    const ghRepo = await step("github.repo", async () =>
      bag(await github.createRepo(ctx))
    );

    const db = await step("neon.create", async () =>
      bag(await neon.create(ctx))
    );

    const trg = ctx.decisions.trigger
      ? await step("trigger.project", async () =>
          bag(await trigger.createProject(ctx))
        )
      : null;

    await step("doppler.seedSecrets", async () => {
      await doppler.seedSecrets(ctx, { db, trg: trg ?? undefined });
      return {};
    });

    const cfOut = await step("cloudflare.pulumiUp", async () =>
      bag(await cf.pulumiUp(ctx))
    );

    await step("cloudflare.patchWrangler", async () => {
      await cf.patchWrangler(ctx, cfOut);
      return {};
    });

    if (ctx.decisions.hookdeck) {
      await step("hookdeck.pulumiUp", async () =>
        bag(await hookdeck.pulumiUp(ctx, { webhookTargetUrl: cfOut.workerUrl }))
      );
    }

    const prdSecrets = await doppler.exportEnv(ctx, "prd");

    const ghClient = await createGithubClient();

    await Promise.all([
      step("secrets.cloudflare", async () => {
        await cf.pushSecrets(ctx, prdSecrets);
        return {};
      }),
      step("secrets.gha-oidc", async () => {
        await github.configureDopplerOidc(ctx, ghClient);
        return {};
      }),
      ...(trg
        ? [
            step("secrets.trigger", async () => {
              await trigger.syncEnvVars(ctx, trg, prdSecrets);
              return {};
            }),
          ]
        : []),
    ]);

    await step("cloudflare.deploy", async () =>
      bag(await cf.deployWorker(ctx, cfOut))
    );

    await step("github.firstCommit", async () => {
      await github.pushInitial(ctx, ghClient);
      return {};
    });

    void ghRepo;
  },
});

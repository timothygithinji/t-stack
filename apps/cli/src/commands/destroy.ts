import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import type { Ctx } from "../core/preset.ts";
import * as cloudflare from "../plugins/cloudflare.js";
import * as doppler from "../plugins/doppler.js";
import { createGithubClient } from "../plugins/github.js";
import * as hookdeck from "../plugins/hookdeck.js";
import * as neon from "../plugins/neon.js";
import * as turso from "../plugins/turso.js";
import { buildCtx, loadConfig } from "./_ctx.js";

export interface DestroyOptions {
  cwd: string;
  force?: boolean;
  only?: string;
  yes?: boolean;
  ctx?: Ctx;
}

interface Teardown {
  id: string;
  /** Plugin prefix used by `--only`. */
  matches: (only: string) => boolean;
  run: (ctx: Ctx) => Promise<void>;
}

function getRefs<T>(ctx: Ctx, ids: string[]): T | undefined {
  for (const id of ids) {
    const refs = ctx.state.get(id)?.refs;
    if (refs) {
      return refs as unknown as T;
    }
  }
  return;
}

// Order: REVERSE of provision. App-layer first, foundational last.
function buildTeardowns(decisions: {
  cloudProvider: string;
  databaseHost: string;
  iac: string;
  trigger: boolean;
  hookdeck: boolean;
  git: boolean;
}): Teardown[] {
  const list: Teardown[] = [];

  // 1. Worker — wrangler creates the Worker + custom domain at deploy time, so
  // wrangler delete is the only way to remove them. Pulumi only manages KV/R2.
  if (decisions.cloudProvider === "cloudflare") {
    list.push({
      id: "cloudflare.deploy",
      matches: (only) => only === "cloudflare",
      async run(ctx) {
        await cloudflare.deleteWorker(ctx);
      },
    });
  }

  // 2. Hookdeck stack
  if (decisions.hookdeck) {
    list.push({
      id: "hookdeck.pulumiDestroy",
      matches: (only) => only === "hookdeck",
      async run(ctx) {
        await hookdeck.pulumiDestroy(ctx);
      },
    });
  }

  // 3. Cloudflare stack — only when Pulumi managed it.
  if (decisions.cloudProvider === "cloudflare" && decisions.iac === "pulumi") {
    list.push({
      id: "cloudflare.pulumiDestroy",
      matches: (only) => only === "cloudflare",
      async run(ctx) {
        await cloudflare.pulumiDestroy(ctx);
      },
    });
  }

  // 4. Trigger.dev (no destroy API — log and mark)
  if (decisions.trigger) {
    list.push({
      id: "trigger.destroy",
      matches: (only) => only === "trigger",
      async run(ctx) {
        ctx.logger.info(
          "Trigger.dev projects must be deleted manually from the dashboard."
        );
      },
    });
  }

  // 5. Database — only when a database host was provisioned.
  if (decisions.databaseHost === "neon" || decisions.databaseHost === "turso") {
    list.push({
      id: "database.destroy",
      matches: (only) =>
        only === "neon" || only === "turso" || only === "database",
      async run(ctx) {
        if (decisions.databaseHost === "neon") {
          const refs = getRefs<neon.NeonRefs>(ctx, [
            "neon.create",
            "neon.create-project",
          ]);
          if (!refs) {
            ctx.logger.warn("No Neon refs in state.json; skipping.");
            return;
          }
          await neon.destroy(ctx, refs);
        } else if (decisions.databaseHost === "turso") {
          const refs = getRefs<turso.TursoRefs>(ctx, [
            "turso.create",
            "turso.create-db",
          ]);
          if (!refs) {
            ctx.logger.warn("No Turso refs in state.json; skipping.");
            return;
          }
          await turso.destroy(ctx, refs);
        }
      },
    });
  }

  // 6. GitHub repo (gated) — only if git was enabled at init time.
  if (decisions.git) {
    list.push({
      id: "github.destroy",
      matches: (only) => only === "github",
      async run(ctx) {
        // Skip the per-repo confirmation when --yes was passed (the top-level
        // confirm already covered "yes, tear everything down").
        if (!ctx.nonInteractive) {
          const confirm = await p.confirm({
            message: `Delete GitHub repository ${ctx.org.githubOwner}/${ctx.projectName}? This is irreversible.`,
            initialValue: false,
          });
          if (p.isCancel(confirm) || !confirm) {
            ctx.logger.info("Skipping GitHub repo deletion.");
            return;
          }
        }
        const gh = await createGithubClient();
        await gh.rest.repos.delete({
          owner: ctx.org.githubOwner,
          repo: ctx.projectName,
        });
      },
    });
  }

  // 7. Doppler project
  list.push({
    id: "doppler.destroy",
    matches: (only) => only === "doppler",
    async run(ctx) {
      const refs = ctx.state.get("doppler.project")?.refs as
        | { slug?: string }
        | undefined;
      const slug =
        refs?.slug ??
        ctx.projectName
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, "");
      if (!slug) {
        ctx.logger.warn("No Doppler project slug in state.json; skipping.");
        return;
      }
      try {
        await doppler.destroyProject(ctx, slug);
      } catch (err) {
        ctx.logger.warn(
          `Failed to delete Doppler project ${slug}: ${(err as Error).message}`
        );
      }
    },
  });

  return list;
}

export async function runDestroy(opts: DestroyOptions): Promise<void> {
  const decisions = opts.ctx?.decisions ?? (await loadConfig(opts.cwd));
  const ctx =
    opts.ctx ??
    (await buildCtx({
      cwd: opts.cwd,
      decisions,
      nonInteractive: Boolean(opts.yes),
    }));
  await ctx.state.read();

  if (!(opts.force || opts.yes)) {
    const ans = await p.confirm({
      message: `Destroy ALL resources for ${decisions.projectName}? This will delete cloud resources.`,
      initialValue: false,
    });
    if (p.isCancel(ans) || !ans) {
      ctx.logger.info("Aborted.");
      return;
    }
  }

  const teardowns = buildTeardowns({
    cloudProvider: decisions.cloudProvider,
    databaseHost: decisions.databaseHost,
    iac: decisions.iac,
    trigger: decisions.trigger,
    hookdeck: decisions.hookdeck,
    git: decisions.git,
  });
  const only = opts.only;

  for (const t of teardowns) {
    if (only && !t.matches(only)) {
      continue;
    }
    ctx.logger.step(`tearing down: ${t.id}`);
    try {
      await t.run(ctx);
      await ctx.state.set(t.id, {
        status: "completed",
        at: new Date().toISOString(),
        refs: { deleted: true },
      });
    } catch (err) {
      ctx.logger.error(`${t.id} failed: ${(err as Error).message}`, err);
      await ctx.state.markFailed(t.id, err);
      if (!opts.force) {
        throw err;
      }
    }
  }

  ctx.logger.success(`Destroyed ${decisions.projectName}`);
}

export const destroyCommand = defineCommand({
  meta: {
    name: "destroy",
    description: "Tear down all cloud resources for the project.",
  },
  args: {
    force: { type: "boolean", description: "Continue past per-step failures" },
    only: { type: "string", description: "Only tear down a single plugin" },
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
    cwd: { type: "string", description: "Project directory (default cwd)" },
  },
  async run({ args }) {
    const cwd = (args.cwd as string | undefined) ?? process.cwd();
    p.intro("t-stack destroy");
    try {
      await runDestroy({
        cwd,
        force: Boolean(args.force),
        only: args.only as string | undefined,
        yes: Boolean(args.yes),
      });
      p.outro("Destroyed");
    } catch (err) {
      p.log.info(
        `Hint: re-run with --force to continue past failures, or t-stack doctor --cwd ${cwd}`
      );
      p.cancel(`destroy failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

export default destroyCommand;

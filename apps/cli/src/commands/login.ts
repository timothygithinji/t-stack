import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import { execa } from "execa";
import { ofetch } from "ofetch";
import { createLogger } from "../core/log.js";
import { createOrgsStore } from "../core/orgs.js";
import type { Ctx, InitDecisions } from "../core/preset.ts";
import { createStateStore } from "../core/state.js";
import * as doppler from "../plugins/doppler.js";
import { buildPaths, loadPreset } from "./_ctx.js";

const META_PROJECT_SLUG = "t-stack";
const META_CONFIG = "prd";

function bail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}

async function verifyCf(token: string, accountId: string): Promise<boolean> {
  const headers = { Authorization: `Bearer ${token}` };
  // Try account-scoped first (matches the kind of token t-stack expects).
  try {
    const res = await ofetch<{ success?: boolean }>(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
      { headers }
    );
    if (res.success === true) {
      return true;
    }
  } catch {
    // fall through
  }
  // Fallback for user-owned tokens.
  try {
    const res = await ofetch<{ success?: boolean }>(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      { headers }
    );
    return res.success === true;
  } catch {
    return false;
  }
}

async function verifyTrigger(token: string): Promise<boolean> {
  try {
    await ofetch("https://api.trigger.dev/api/v1/projects", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return true;
  } catch {
    return false;
  }
}

async function checkDopplerCli(): Promise<void> {
  try {
    await execa("doppler", ["--version"], { stdio: "pipe" });
  } catch {
    bail(
      "`doppler` CLI not found on PATH. Install it: https://docs.doppler.com/docs/install-cli"
    );
  }
}

async function checkDopplerAuthed(
  orgName: string,
  workplaceSlug: string
): Promise<void> {
  const scope = doppler.orgScope(orgName);
  try {
    const { stdout } = await execa(
      "doppler",
      ["configure", "get", "token", "--scope", scope, "--plain"],
      { stdio: "pipe" }
    );
    if (!stdout.trim()) {
      throw new Error("empty token");
    }
  } catch (err) {
    bail(
      `Doppler not authenticated for org "${orgName}". Run:\n  doppler login --scope ${scope}\nand pick the "${workplaceSlug}" workplace. (${(err as Error).message})`
    );
  }
}

export const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Bootstrap meta tokens and Doppler config for an org.",
  },
  args: {
    org: { type: "string", description: "Org name from orgs.toml" },
  },
  async run({ args }) {
    try {
      p.intro("t-stack login");

      const orgsStore = createOrgsStore();
      const orgs = await orgsStore.list();
      if (orgs.length === 0) {
        bail("No orgs configured. Run `t-stack org add <name>` first.");
      }
      let orgName = args.org as string | undefined;
      if (!orgName) {
        const pick = await p.select({
          message: "Which org are you logging in for?",
          options: orgs.map((o) => ({ value: o.name, label: o.name })),
        });
        if (p.isCancel(pick)) {
          bail("Cancelled.");
        }
        orgName = pick as string;
      }
      const org = await orgsStore.get(orgName);
      if (!org) {
        bail(`Org "${orgName}" not found.`);
      }

      await checkDopplerCli();
      await checkDopplerAuthed(org.name, org.dopplerWorkplaceName);
      p.log.success(`Doppler CLI authed against scope for "${org.name}".`);

      // Compose a minimal Ctx so we can reuse the doppler plugin helpers.
      // The meta project is workplace-wide, so projectName isn't load-bearing
      // here — but several plugin helpers slugify ctx.projectName, so we set
      // it to the meta slug.
      const decisions: InitDecisions = {
        org: org.name,
        projectName: META_PROJECT_SLUG,
        domain: org.defaultDomain,
        structure: "single",
        cloudProvider: "cloudflare",
        iac: "pulumi",
        runtime: "workers",
        frontend: "none",
        backend: "hono",
        docs: "none",
        api: "none",
        database: "postgres",
        databaseHost: "neon",
        databaseRegion: "aws-us-east-1",
        orm: "drizzle",
        auth: "better-auth",
        storage: "none",
        payments: "none",
        addons: [],
        packageManager: "bun",
        git: true,
        install: true,
        envs: "prd",
        trigger: false,
        access: false,
        hookdeck: false,
      };
      const paths = buildPaths(process.cwd());
      const logger = createLogger();
      const state = createStateStore(paths.stateFile);
      // login doesn't actually run a preset — it just needs a Ctx-shaped value
      // so the doppler plugin helpers (slug/scope) work. We pick single-cloudflare
      // as a placeholder; the `run()` body is never invoked here.
      const preset = await loadPreset("single-cloudflare", paths.cliRoot);
      const ctx: Ctx = {
        org,
        projectName: META_PROJECT_SLUG,
        preset,
        decisions,
        paths,
        logger,
        state,
        tokens: { cloudflareApiToken: "", triggerAccessToken: "" },
        choice<T = unknown>(): T {
          return undefined as unknown as T;
        },
        nonInteractive: false,
      };

      const meta = await doppler.createProject(ctx, {
        name: META_PROJECT_SLUG,
        description: "t-stack meta tokens (CF, Trigger.dev)",
      });
      p.log.success(
        `Doppler project ${meta.slug} ready in workplace ${org.dopplerWorkplaceName}.`
      );

      await doppler.ensureConfig(ctx, meta.slug, META_CONFIG);
      p.log.success(`Verified ${META_CONFIG} config in ${meta.slug}.`);

      const cfToken = (await p.password({
        message: "Paste your Cloudflare API token",
      })) as string;
      if (p.isCancel(cfToken)) {
        bail("Cancelled.");
      }
      const triggerToken = (await p.password({
        message: "Paste your Trigger.dev personal access token",
      })) as string;
      if (p.isCancel(triggerToken)) {
        bail("Cancelled.");
      }

      const cfOk = await verifyCf(cfToken, org.cloudflareAccountId);
      const trgOk = await verifyTrigger(triggerToken);
      if (!(cfOk && trgOk)) {
        bail(
          `Token verification failed: cloudflare=${cfOk} trigger=${trgOk}. Please re-check the values.`
        );
      }
      p.log.success("Both tokens verified.");

      await doppler.setSecret(
        ctx,
        meta.slug,
        META_CONFIG,
        "CLOUDFLARE_API_TOKEN",
        cfToken
      );
      await doppler.setSecret(
        ctx,
        meta.slug,
        META_CONFIG,
        "TRIGGER_ACCESS_TOKEN",
        triggerToken
      );
      p.log.success(`Tokens stored in ${meta.slug}/${META_CONFIG}.`);

      const existingIdentity = org.dopplerOidcIdentityId ?? "";
      const identity = await p.text({
        message: `Doppler OIDC Identity ID for GitHub Actions in workplace ${org.dopplerWorkplaceName}? (leave blank to set later)`,
        placeholder: existingIdentity || "5f...-uuid",
        defaultValue: existingIdentity,
      });
      if (
        !p.isCancel(identity) &&
        typeof identity === "string" &&
        identity.length > 0
      ) {
        await orgsStore.add({ ...org, dopplerOidcIdentityId: identity });
        p.log.success(`Saved dopplerOidcIdentityId for org "${org.name}".`);
      }

      p.outro(
        "Login complete. Run `t-stack init <name>` to scaffold a project."
      );
    } catch (err) {
      p.cancel(`login failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

export default loginCommand;

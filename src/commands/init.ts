import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import { execa } from "execa";
import { isAbsolute, join, resolve } from "pathe";
import { createOrgsStore } from "../core/orgs.js";
import type {
  Archetype,
  Database,
  EnvScope,
  InitDecisions,
  OrgProfile,
} from "../core/preset.ts";
import { loadTokens } from "../core/tokens.js";
import { discoverZoneViaCfApi, resolveZoneForDomain } from "../core/zones.js";
import { orgScope as dopplerOrgScope } from "../plugins/doppler.js";
import { runDeploy } from "./deploy.js";
import { runProvision } from "./provision.js";
import { runScaffold } from "./scaffold.js";

const ARCHETYPES: readonly Archetype[] = [
  "solo-cf-worker",
  "monorepo-cf",
] as const;
const ENV_SCOPES: readonly EnvScope[] = [
  "prd",
  "dev+prd",
  "dev+stg+prd",
] as const;
const DATABASES: readonly Database[] = ["neon", "turso"] as const;

interface InitFlags {
  name?: string;
  org?: string;
  archetype?: string;
  domain?: string;
  db?: string;
  envs?: string;
  trigger?: boolean;
  access?: boolean;
  hookdeck?: boolean;
  "hookdeck-api-key"?: string;
  yes?: boolean;
  cwd?: string;
}

function bail(msg: string): never {
  p.log.error(msg);
  process.exit(1);
}

async function pickOrg(initial?: string): Promise<string> {
  const orgs = await createOrgsStore().list();
  if (orgs.length === 0) {
    bail("No orgs configured. Run `t-stack org add <name>` first.");
  }
  if (initial && orgs.find((o) => o.name === initial)) {
    return initial;
  }
  if (orgs.length === 1 && orgs[0]) {
    return orgs[0].name;
  }
  const choice = await p.select({
    message: "Which org?",
    options: orgs.map((o) => ({
      value: o.name,
      label: `${o.name} (${o.defaultDomain})`,
    })),
  });
  if (p.isCancel(choice)) {
    bail("Cancelled.");
  }
  return choice as string;
}

async function promptIfMissing<T extends string>(
  value: T | undefined,
  prompt: () => Promise<T | symbol>
): Promise<T> {
  if (value !== undefined && value !== null && `${value}`.length > 0) {
    return value;
  }
  const v = await prompt();
  if (p.isCancel(v)) {
    bail("Cancelled.");
  }
  return v as T;
}

export interface RunInitOptions {
  cwd: string;
  yes: boolean;
}

/**
 * Programmatic entry point: given a fully-resolved InitDecisions object,
 * scaffold into `<cwd>/<projectName>`, then optionally provision and deploy.
 */
export async function runInit(
  decisions: InitDecisions,
  opts: RunInitOptions
): Promise<void> {
  const projectDir = isAbsolute(opts.cwd)
    ? join(opts.cwd, decisions.projectName)
    : resolve(opts.cwd, decisions.projectName);

  if (existsSync(projectDir) && !opts.yes) {
    const proceed = await p.confirm({
      message: `Directory ${projectDir} already exists. Continue (will overlay templates)?`,
      initialValue: false,
    });
    if (p.isCancel(proceed) || !proceed) {
      bail("Cancelled.");
    }
  }

  // 1. Scaffold (files only).
  const scaffoldResult = await runScaffold({ cwd: projectDir, decisions });
  p.log.success(
    `Scaffolded ${scaffoldResult.filesWritten} files into ${projectDir}`
  );

  // 2. Provision.
  let provisioned = false;
  if (opts.yes) {
    await runProvision({ cwd: projectDir, decisions });
    provisioned = true;
  } else {
    const provNow = await p.confirm({
      message: "Provision now?",
      initialValue: true,
    });
    if (p.isCancel(provNow)) {
      bail("Cancelled.");
    }
    if (provNow) {
      await runProvision({ cwd: projectDir, decisions });
      provisioned = true;
    }
  }

  // 3. Optional deploy.
  if (provisioned && decisions.trigger) {
    let deployNow = opts.yes;
    if (!opts.yes) {
      const ans = await p.confirm({
        message: "Deploy now?",
        initialValue: true,
      });
      if (p.isCancel(ans)) {
        bail("Cancelled.");
      }
      deployNow = Boolean(ans);
    }
    if (deployNow) {
      await runDeploy({ cwd: projectDir, target: "all" });
    }
  }

  // 4. Push initial commit (presets typically do this in `run()`, but ask anyway
  //    in case provisioning was skipped — github.pushInitial is idempotent).
  if (!opts.yes && !provisioned) {
    const pushNow = await p.confirm({
      message: "Push initial commit to GitHub?",
      initialValue: false,
    });
    if (!p.isCancel(pushNow) && pushNow) {
      // Defer to the preset's github plugin by calling provision with --only github.
      await runProvision({ cwd: projectDir, only: "github" });
    }
  }

  // 5. Final banner.
  p.log.success(`Done. https://${decisions.domain}`);
  p.log.info(
    `Resume any failed step:  t-stack provision --cwd ${projectDir}\n` +
      `Audit cloud state:       t-stack doctor --cwd ${projectDir}`
  );
}

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Bootstrap a new t-stack project (scaffold + provision).",
  },
  args: {
    name: { type: "positional", required: false, description: "Project name" },
    org: { type: "string", description: "Org slug from orgs.toml" },
    archetype: { type: "string", description: "solo-cf-worker | monorepo-cf" },
    domain: {
      type: "string",
      description: "FQDN (default: <name>.<org.defaultDomain>)",
    },
    db: {
      type: "string",
      description: "neon | turso (turso requires solo-cf-worker)",
    },
    envs: { type: "string", description: "prd | dev+prd | dev+stg+prd" },
    trigger: {
      type: "boolean",
      description:
        "Enable Trigger.dev (use --no-trigger to disable; default true in --yes mode)",
    },
    access: {
      type: "boolean",
      description:
        "Protect with Cloudflare Access (use --no-access to skip; default off in --yes mode)",
    },
    hookdeck: {
      type: "boolean",
      description:
        "Add Hookdeck inbound webhooks (use --no-hookdeck to skip; default off in --yes mode)",
    },
    "hookdeck-api-key": {
      type: "string",
      description:
        "Hookdeck project API key (per-project; only used when --hookdeck is set). Falls back to $HOOKDECK_API_KEY env var.",
    },
    yes: {
      type: "boolean",
      description: "Non-interactive — require all args via flags",
    },
    cwd: { type: "string", description: "Parent directory (default: cwd)" },
  },
  async run({ args }) {
    try {
      const flags = args as unknown as InitFlags;
      const yes = Boolean(flags.yes);
      const cwd = flags.cwd ?? process.cwd();

      // Resolve org.
      const orgName = await pickOrg(flags.org);
      const orgs = createOrgsStore();
      const orgProfile = await orgs.get(orgName);
      if (!orgProfile) {
        bail(`Org "${orgName}" not found.`);
      }

      // Project name.
      const projectName = await promptIfMissing<string>(
        flags.name ?? (args._?.[0] as string | undefined),
        async () =>
          p.text({
            message: "Project name?",
            placeholder: "my-app",
            validate: (v) =>
              v && /^[a-z0-9][a-z0-9-]*$/.test(v)
                ? undefined
                : "lowercase letters, digits and dashes only",
          })
      );

      // Archetype.
      const archetypeRaw =
        flags.archetype ??
        (yes
          ? "solo-cf-worker"
          : await (async () => {
              const v = await p.select({
                message: "Archetype?",
                options: ARCHETYPES.map((a) => ({ value: a, label: a })),
                initialValue: "solo-cf-worker",
              });
              if (p.isCancel(v)) {
                bail("Cancelled.");
              }
              return v as string;
            })());
      if (!ARCHETYPES.includes(archetypeRaw as Archetype)) {
        bail(
          `Invalid archetype "${archetypeRaw}". Expected one of: ${ARCHETYPES.join(", ")}`
        );
      }
      const archetype = archetypeRaw as Archetype;

      // Domain.
      const defaultDomain = `${projectName}.${orgProfile.defaultDomain}`;
      const domain = await promptIfMissing<string>(flags.domain, async () =>
        p.text({
          message: "Domain?",
          initialValue: defaultDomain,
          placeholder: defaultDomain,
        })
      );

      // Database.
      let dbRaw = flags.db;
      if (!dbRaw && !yes) {
        const allowed =
          archetype === "solo-cf-worker" ? DATABASES : (["neon"] as const);
        const v = await p.select({
          message: "Database?",
          options: allowed.map((d) => ({ value: d, label: d })),
          initialValue: "neon",
        });
        if (p.isCancel(v)) {
          bail("Cancelled.");
        }
        dbRaw = v as string;
      }
      dbRaw = dbRaw ?? "neon";
      if (!DATABASES.includes(dbRaw as Database)) {
        bail(
          `Invalid database "${dbRaw}". Expected one of: ${DATABASES.join(", ")}`
        );
      }
      if (dbRaw === "turso" && archetype !== "solo-cf-worker") {
        bail("Turso is only supported with the solo-cf-worker archetype.");
      }
      const database = dbRaw as Database;

      // Envs.
      let envsRaw = flags.envs;
      if (!envsRaw && !yes) {
        const v = await p.select({
          message: "Environments?",
          options: ENV_SCOPES.map((e) => ({ value: e, label: e })),
          initialValue: "prd",
        });
        if (p.isCancel(v)) {
          bail("Cancelled.");
        }
        envsRaw = v as string;
      }
      envsRaw = envsRaw ?? "prd";
      if (!ENV_SCOPES.includes(envsRaw as EnvScope)) {
        bail(
          `Invalid envs "${envsRaw}". Expected one of: ${ENV_SCOPES.join(", ")}`
        );
      }
      const envs = envsRaw as EnvScope;

      // Booleans.
      const trigger = await resolveBool(
        flags.trigger,
        true,
        yes,
        "Enable Trigger.dev?"
      );
      const access = await resolveBool(
        flags.access,
        false,
        yes,
        "Protect with Cloudflare Access?"
      );
      const hookdeck = await resolveBool(
        flags.hookdeck,
        false,
        yes,
        "Add Hookdeck inbound webhooks?"
      );

      const hookdeckApiKey = hookdeck
        ? await resolveHookdeckApiKey({
            flagValue: flags["hookdeck-api-key"],
            orgName,
            projectName,
            yes,
          })
        : undefined;

      await ensureZoneForDomain(orgProfile, domain, yes);

      const decisions: InitDecisions = {
        org: orgName,
        projectName,
        archetype,
        domain,
        database,
        envs,
        trigger,
        access,
        hookdeck,
        ...(hookdeckApiKey ? { hookdeckApiKey } : {}),
      };

      await runInit(decisions, { cwd, yes });
    } catch (err) {
      p.log.error(`init failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

function apexFor(domain: string): string {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length <= 2) {
    return parts.join(".");
  }
  return parts.slice(-2).join(".");
}

async function ensureZoneForDomain(
  org: OrgProfile,
  domain: string,
  yes: boolean
): Promise<void> {
  const resolved = resolveZoneForDomain(domain, org.cloudflareZones);
  if (resolved) {
    return;
  }
  const apex = apexFor(domain);
  const missingMsg = `No Cloudflare zone registered for the apex of "${domain}" under org "${org.name}".\nAvailable apexes: ${
    Object.keys(org.cloudflareZones).length > 0
      ? Object.keys(org.cloudflareZones).join(", ")
      : "(none)"
  }\nRegister via:\n  t-stack org zone add ${org.name} <apex> <zoneId>\nOr auto-discover (requires CF token with Zone:Read):\n  t-stack org zone discover ${org.name} <apex>`;

  if (yes) {
    bail(missingMsg);
  }

  const discover = await p.confirm({
    message: `No zone registered for ${apex}. Auto-discover via Cloudflare API?`,
    initialValue: true,
  });
  if (p.isCancel(discover)) {
    bail("Cancelled.");
  }

  const store = createOrgsStore();
  if (discover) {
    try {
      const tokens = await loadTokens(org.name);
      const zoneId = await discoverZoneViaCfApi({
        apex,
        accountId: org.cloudflareAccountId,
        cloudflareApiToken: tokens.cloudflareApiToken,
      });
      if (zoneId) {
        await store.add({
          ...org,
          cloudflareZones: { ...org.cloudflareZones, [apex]: zoneId },
        });
        org.cloudflareZones = { ...org.cloudflareZones, [apex]: zoneId };
        p.log.success(`Registered ${apex} → ${zoneId} for org "${org.name}".`);
        return;
      }
      p.log.warn(`Cloudflare API returned no zone matching "${apex}".`);
    } catch (err) {
      p.log.warn(`Auto-discovery failed: ${(err as Error).message}`);
    }
  }

  const manual = await p.text({
    message: `Enter Cloudflare zoneId for ${apex} (or leave blank to abort):`,
    placeholder: "",
  });
  if (p.isCancel(manual)) {
    bail("Cancelled.");
  }
  const zoneId = `${manual ?? ""}`.trim();
  if (!zoneId) {
    bail(missingMsg);
  }
  await store.add({
    ...org,
    cloudflareZones: { ...org.cloudflareZones, [apex]: zoneId },
  });
  org.cloudflareZones = { ...org.cloudflareZones, [apex]: zoneId };
  p.log.success(`Registered ${apex} → ${zoneId} for org "${org.name}".`);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

async function fetchExistingHookdeckKey(
  orgName: string,
  projectName: string
): Promise<string | undefined> {
  const scope = dopplerOrgScope(orgName);
  const projectSlug = slugify(projectName);
  try {
    const { stdout } = await execa(
      "doppler",
      [
        "secrets",
        "download",
        `--project=${projectSlug}`,
        "--config=prd",
        "--format=json",
        "--no-file",
        `--scope=${scope}`,
      ],
      { stdio: "pipe" }
    );
    const parsed = JSON.parse(stdout) as Record<string, string>;
    const v = parsed.HOOKDECK_API_KEY;
    return typeof v === "string" && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

interface ResolveHookdeckArgs {
  flagValue: string | undefined;
  orgName: string;
  projectName: string;
  yes: boolean;
}

async function resolveHookdeckApiKey(
  args: ResolveHookdeckArgs
): Promise<string> {
  // 1. CLI flag wins.
  if (args.flagValue && args.flagValue.length > 0) {
    return args.flagValue;
  }
  // 2. Env var.
  const fromEnv = process.env.HOOKDECK_API_KEY;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  // 3. Already-seeded per-project Doppler config (re-run case).
  const fromDoppler = await fetchExistingHookdeckKey(
    args.orgName,
    args.projectName
  );
  if (fromDoppler) {
    return fromDoppler;
  }

  if (args.yes) {
    bail(
      `Hookdeck is enabled but no API key was provided. Hookdeck keys are per-project. Either:\n  • Pass --hookdeck-api-key <key>\n  • Or export HOOKDECK_API_KEY before re-running.\nCreate a Hookdeck project at https://dashboard.hookdeck.com/projects/create (recommended name: ${args.projectName}).`
    );
  }

  p.log.info(
    `Hookdeck API keys are project-scoped (one per Hookdeck project).\nCreate a project at https://dashboard.hookdeck.com/projects/create — recommended name: ${args.projectName} — and paste its API key below.`
  );
  const v = await p.password({
    message: "Paste the Hookdeck API key for this project",
  });
  if (p.isCancel(v)) {
    bail("Cancelled.");
  }
  const key = `${v}`.trim();
  if (!key) {
    bail("Hookdeck is enabled but no API key was provided.");
  }
  return key;
}

async function resolveBool(
  flagValue: boolean | undefined,
  defaultValue: boolean,
  yes: boolean,
  message: string
): Promise<boolean> {
  // Citty handles --no-X natively by setting the flag to false; explicit --X
  // sets to true; absent flag leaves it undefined.
  if (flagValue === true) {
    return true;
  }
  if (flagValue === false) {
    return false;
  }
  if (yes) {
    return defaultValue;
  }
  const v = await p.confirm({ message, initialValue: defaultValue });
  if (p.isCancel(v)) {
    bail("Cancelled.");
  }
  return Boolean(v);
}

export default initCommand;

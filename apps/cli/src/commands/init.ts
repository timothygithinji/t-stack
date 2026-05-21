import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import {
  type Archetype,
  type FieldMeta,
  type InitDecisions,
  fieldsForArchetype,
  initSchema,
} from "@t-stack/schema";
import { defineCommand } from "citty";
import { execa } from "execa";
import { isAbsolute, join, resolve } from "pathe";
import type { z } from "zod";
import { createOrgsStore } from "../core/orgs.js";
import type { OrgProfile } from "../core/preset.ts";
import {
  buildCittyArgs,
  defaultResolver,
  kebabName,
  matchesVisibleIf,
} from "../core/schema-runtime.js";
import { loadTokens } from "../core/tokens.js";
import { discoverZoneViaCfApi, resolveZoneForDomain } from "../core/zones.js";
import { orgScope as dopplerOrgScope } from "../plugins/doppler.js";
import { runDeploy } from "./deploy.js";
import { runProvision } from "./provision.js";
import { runScaffold } from "./scaffold.js";

const ARCHETYPES = [
  "solo-cf-worker",
  "monorepo-cf",
] as const satisfies readonly Archetype[];

function bail(msg: string): never {
  p.cancel(msg);
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
  if (!(opts.yes || provisioned)) {
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
  p.log.info(
    `Resume any failed step:  t-stack provision --cwd ${projectDir}\n` +
      `Audit cloud state:       t-stack doctor --cwd ${projectDir}`
  );
  p.outro(`Ready · https://${decisions.domain}`);
}

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Bootstrap a new t-stack project (scaffold + provision).",
  },
  args: buildCittyArgs(),
  async run({ args }) {
    try {
      const yes = Boolean(args.yes);
      const cwd = (args.cwd as string | undefined) ?? process.cwd();
      p.intro("t-stack init");

      // org and archetype are resolved up-front: org because it sources from
      // a non-zod store (orgs.toml) and seeds the domain default; archetype
      // because it selects which schema variant to iterate.
      const orgName = await pickOrg(args.org as string | undefined);
      const orgs = createOrgsStore();
      const orgProfile = await orgs.get(orgName);
      if (!orgProfile) {
        bail(`Org "${orgName}" not found.`);
      }
      const archetype = await pickArchetype(
        args.archetype as string | undefined,
        yes
      );

      // Schema-driven loop: walk every field declared on the active variant
      // and resolve via the runtime helper (flag → defaultFrom → schema default
      // → prompt). Pre-seed `org` / `projectName` so the loop's defaultFrom
      // templates can reference them.
      const projectNameFlag =
        (args.name as string | undefined) ??
        (args._?.[0] as string | undefined);
      const values: Record<string, unknown> = {
        archetype,
        org: orgName,
        // `org` object exposed only to defaultFrom templates (not validated by schema).
      };

      for (const field of fieldsForArchetype(archetype)) {
        if (
          field.meta.visibleIf &&
          !matchesVisibleIf(field.meta.visibleIf, values)
        ) {
          continue;
        }
        // Pre-resolved fields skip the prompt loop.
        if (field.name === "org") {
          continue;
        }
        const flagValue = readFlag(field, args, projectNameFlag);
        values[field.name] = await resolveField({
          field,
          flagValue,
          orgProfile,
          orgName,
          yes,
          values,
        });
      }

      const domain = String(values.domain ?? "");
      await ensureZoneForDomain(orgProfile, domain, yes);

      const decisions = initSchema.parse(values);
      await runInit(decisions, { cwd, yes });
    } catch (err) {
      p.cancel(`init failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

interface ResolveFieldArgs {
  field: { name: string; schema: z.ZodTypeAny; meta: FieldMeta };
  flagValue: unknown;
  orgProfile: OrgProfile;
  orgName: string;
  yes: boolean;
  values: Record<string, unknown>;
}

async function resolveField(args: ResolveFieldArgs): Promise<unknown> {
  // Special case: hookdeck-api-key has a multi-source fallback chain
  // (flag → env → Doppler → prompt). The schema's `source` meta marks the
  // env step but can't express the chain alone.
  if (args.field.name === "hookdeckApiKey" && args.values.hookdeck) {
    return await resolveHookdeckApiKey({
      flagValue: args.flagValue as string | undefined,
      orgName: args.orgName,
      projectName: String(args.values.projectName ?? ""),
      yes: args.yes,
    });
  }

  return defaultResolver({
    name: args.field.name,
    schema: args.field.schema,
    meta: args.field.meta,
    flagValue: args.flagValue,
    // `org.defaultDomain` is referenced by the `domain` field's defaultFrom
    // template — expose the org profile under the `org` key for that lookup.
    values: { ...args.values, org: args.orgProfile },
    nonInteractive: args.yes,
  });
}

function readFlag(
  field: { name: string },
  args: Record<string, unknown>,
  projectNameFlag: string | undefined
): unknown {
  if (field.name === "projectName") {
    return projectNameFlag;
  }
  return args[kebabName(field.name)];
}

async function pickArchetype(
  flagValue: string | undefined,
  yes: boolean
): Promise<Archetype> {
  if (flagValue) {
    if (!ARCHETYPES.includes(flagValue as Archetype)) {
      bail(
        `Invalid archetype "${flagValue}". Expected one of: ${ARCHETYPES.join(", ")}`
      );
    }
    return flagValue as Archetype;
  }
  if (yes) {
    return "solo-cf-worker";
  }
  const v = await p.select({
    message: "Archetype?",
    options: ARCHETYPES.map((a) => ({ value: a, label: a })),
    initialValue: "solo-cf-worker",
  });
  if (p.isCancel(v)) {
    bail("Cancelled.");
  }
  return v as Archetype;
}

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
    return;
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

export default initCommand;

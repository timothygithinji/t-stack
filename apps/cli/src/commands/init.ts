import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import {
  type FieldMeta,
  type InitDecisions,
  initSchema,
  validateDecisions,
  walkFields,
} from "@t-stack/schema";
import { defineCommand } from "citty";
import { execa } from "execa";
import { isAbsolute, join, resolve } from "pathe";
import type { z } from "zod";
import { createOrgsStore } from "../core/orgs.js";
import type { OrgProfile, PresetDef } from "../core/preset.ts";
import {
  buildCittyArgs,
  defaultResolver,
  kebabName,
} from "../core/schema-runtime.js";
import { loadTokens } from "../core/tokens.js";
import { discoverZoneViaCfApi, resolveZoneForDomain } from "../core/zones.js";
import { orgScope as dopplerOrgScope } from "../plugins/doppler.js";
import { findCliRoot, listPresetIds, loadPreset } from "./_ctx.js";
import { runDeploy } from "./deploy.js";
import { runProvision } from "./provision.js";
import { runScaffold } from "./scaffold.js";

function bail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}

interface SummaryGroup {
  title: string;
  rows: [string, string][];
}

function fmtValue(v: unknown): string {
  if (v === undefined || v === null || v === "") {
    return "(unset)";
  }
  if (Array.isArray(v)) {
    return v.length > 0 ? v.join(", ") : "(none)";
  }
  if (typeof v === "boolean") {
    return v ? "yes" : "no";
  }
  return String(v);
}

function renderDecisionsSummary(
  decisions: InitDecisions,
  orgName: string
): string {
  const groups: SummaryGroup[] = [
    {
      title: "Project",
      rows: [
        ["Name", decisions.projectName],
        ["Org", orgName],
        ["Domain", decisions.domain],
      ],
    },
    {
      title: "Structure & infra",
      rows: [
        ["Structure", decisions.structure],
        ["Cloud", decisions.cloudProvider],
        ["IaC", decisions.iac],
      ],
    },
    {
      title: "Runtime & app",
      rows: [
        ["Runtime", decisions.runtime],
        ["Frontend", decisions.frontend],
        ["Backend", decisions.backend],
        ["Docs", decisions.docs],
        ["API", decisions.api],
      ],
    },
    {
      title: "Data",
      rows: [
        ["Database", decisions.database],
        ["Host", decisions.databaseHost],
        ["ORM", decisions.orm],
      ],
    },
    {
      title: "Features",
      rows: [
        ["Auth", decisions.auth],
        ["Storage", decisions.storage],
        ["Payments", decisions.payments],
        ["Addons", fmtValue(decisions.addons)],
      ],
    },
    {
      title: "Tooling",
      rows: [
        ["Package manager", decisions.packageManager],
        ["Git", fmtValue(decisions.git)],
        ["Install", fmtValue(decisions.install)],
      ],
    },
    {
      title: "Legacy",
      rows: [
        ["Envs", decisions.envs],
        ["Trigger.dev", fmtValue(decisions.trigger)],
        ["CF Access", fmtValue(decisions.access)],
        ["Hookdeck", fmtValue(decisions.hookdeck)],
      ],
    },
  ];

  const lines: string[] = [];
  for (const g of groups) {
    lines.push(g.title);
    for (const [k, v] of g.rows) {
      lines.push(`  ${k.padEnd(16)} ${fmtValue(v)}`);
    }
  }
  return lines.join("\n");
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
    message: "Which org owns this project?",
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
  /** Resolved preset bundle (carries the id used for state.json + provision). */
  preset?: PresetDef;
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
  const scaffoldResult = await runScaffold({
    cwd: projectDir,
    decisions,
    preset: opts.preset,
  });
  p.log.success(
    `Scaffolded ${scaffoldResult.filesWritten} files into ${projectDir}`
  );

  // 2. Provision.
  let provisioned = false;
  if (opts.yes) {
    await runProvision({
      cwd: projectDir,
      decisions,
      preset: opts.preset,
    });
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
      await runProvision({
        cwd: projectDir,
        decisions,
        preset: opts.preset,
      });
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
      await runProvision({
        cwd: projectDir,
        only: "github",
        preset: opts.preset,
      });
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

      // Resolve preset BEFORE the prompt loop so its defaults seed `values`.
      // CLI flags applied during the prompt loop still override these defaults.
      const cliRoot = findCliRoot();
      const preset = await pickPreset({
        presetFlag: args.preset as string | undefined,
        yes,
        cliRoot,
      });

      // Pre-resolve org & projectName up-front: org sources from a non-zod
      // store (orgs.toml) and seeds the `domain` defaultFrom template;
      // projectName accepts a positional.
      const orgName = await pickOrg(args.org as string | undefined);
      const orgs = createOrgsStore();
      const orgProfile = await orgs.get(orgName);
      if (!orgProfile) {
        bail(`Org "${orgName}" not found.`);
      }

      const projectNameFlag =
        (args.name as string | undefined) ??
        (args._?.[0] as string | undefined);

      // Seed prompt-loop state with the preset's bundled defaults. CLI flag
      // overrides are applied per-field inside the loop, so flags still win.
      const values: Record<string, unknown> = {
        ...(preset?.defaults ?? {}),
        org: orgName,
      };

      if (projectNameFlag && projectNameFlag.length > 0) {
        values.projectName = projectNameFlag;
      }

      // Predicate-aware loop. Re-walk every iteration so visibility flips
      // (e.g., docs hidden when structure=single) take effect mid-flow.
      // Mark preset-supplied defaults as resolved so the loop won't re-prompt
      // for them (but flag values are still honoured below — see readFlag).
      const resolved = new Set<string>([
        "org",
        ...Object.keys(preset?.defaults ?? {}),
      ]);
      // Cap to a safe upper bound — schema has ~25 fields.
      for (let i = 0; i < 200; i += 1) {
        const visible = walkFields(values);
        const next = visible.find((f) => !resolved.has(f.name));
        if (!next) {
          break;
        }
        const flagValue = readFlag(next, args, projectNameFlag);
        values[next.name] = await resolveField({
          field: next,
          flagValue,
          orgProfile,
          orgName,
          yes,
          values,
        });
        resolved.add(next.name);
      }

      // Apply flag overrides for any preset-default field (so --frontend=astro
      // still wins even when the preset preloaded a different frontend).
      if (preset) {
        const argsBag = args as Record<string, unknown>;
        for (const fieldName of Object.keys(preset.defaults)) {
          const flag = argsBag[kebabName(fieldName)];
          if (flag === undefined || flag === null || flag === "") {
            continue;
          }
          if (fieldName === "addons" && typeof flag === "string") {
            const csv = flag;
            values[fieldName] =
              csv.length > 0
                ? csv
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [];
          } else {
            values[fieldName] = flag;
          }
        }
      }

      const domain = String(values.domain ?? "");
      await ensureZoneForDomain(orgProfile, domain, yes);

      const decisions = initSchema.parse(values);

      const violations = validateDecisions(initSchema, decisions);
      if (violations.length > 0) {
        const msg = violations
          .map((v) => `  • ${v.field}=${String(v.value)}: ${v.conflict}`)
          .join("\n");
        bail(`Decision conflicts detected:\n${msg}`);
      }

      if (!yes) {
        p.note(renderDecisionsSummary(decisions, orgName), "Review");
        const proceed = await p.confirm({
          message: "Proceed with these settings?",
          initialValue: true,
        });
        if (p.isCancel(proceed) || !proceed) {
          bail("Cancelled.");
        }
      }
      await runInit(decisions, { cwd, yes, preset: preset ?? undefined });
    } catch (err) {
      p.log.info("Hint: t-stack doctor — verify token health and try again");
      p.cancel(`init failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

interface PickPresetArgs {
  presetFlag: string | undefined;
  yes: boolean;
  cliRoot: string;
}

/**
 * Resolve the preset bundle for this run. Honour `--preset` if supplied;
 * default to `single-cloudflare` in `--yes` mode; otherwise prompt the user.
 *
 * Returns `null` when the user explicitly picks "custom" — the prompt loop
 * then runs without any preloaded defaults.
 */
async function pickPreset(args: PickPresetArgs): Promise<PresetDef | null> {
  const available = await listPresetIds(args.cliRoot);

  if (args.presetFlag) {
    if (!available.includes(args.presetFlag)) {
      bail(
        `Unknown preset "${args.presetFlag}". Available: ${
          available.length > 0 ? available.join(", ") : "(none)"
        }`
      );
    }
    return await loadPreset(args.presetFlag, args.cliRoot);
  }

  if (args.yes) {
    return await loadPreset("single-cloudflare", args.cliRoot);
  }

  const presets = await Promise.all(
    available.map(async (id) => await loadPreset(id, args.cliRoot))
  );
  const choice = await p.select({
    message: "Pick a preset",
    options: [
      ...presets.map((preset) => ({
        value: preset.id,
        label: `${preset.name} — ${preset.description}`,
      })),
      {
        value: "custom",
        label: "custom — no preset, prompt for every field",
      },
    ],
  });
  if (p.isCancel(choice)) {
    bail("Cancelled.");
  }
  if (choice === "custom") {
    return null;
  }
  return await loadPreset(choice as string, args.cliRoot);
}

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
  field: { name: string; meta: FieldMeta },
  args: Record<string, unknown>,
  projectNameFlag: string | undefined
): unknown {
  if (field.name === "projectName") {
    return projectNameFlag;
  }
  const flag = args[kebabName(field.name)];
  if (flag === undefined) {
    return;
  }
  if (field.meta.ui === "multiselect" && typeof flag === "string") {
    // Allow `--addons biome,husky` as a CSV shortcut.
    return flag.length > 0
      ? flag
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  }
  return flag;
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

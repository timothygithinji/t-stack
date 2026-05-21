import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import { createOrgsStore } from "../core/orgs.js";
import type { OrgProfile } from "../core/preset.ts";
import { loadTokens } from "../core/tokens.js";
import { discoverZoneViaCfApi } from "../core/zones.js";
import { listOrgs as listTriggerOrgs } from "../plugins/trigger.js";

function bail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}

function requireString(value: unknown, flag: string): string {
  if (typeof value !== "string" || value.length === 0) {
    bail(`Missing required --${flag}`);
  }
  return value;
}

function parseCfZoneFlag(
  raw: string | string[] | undefined
): Record<string, string> {
  if (!raw) {
    return {};
  }
  const tokens = Array.isArray(raw) ? raw : [raw];
  const out: Record<string, string> = {};
  for (const tok of tokens) {
    for (const entry of tok.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq <= 0 || eq === trimmed.length - 1) {
        bail(
          `Invalid --cf-zone value "${trimmed}". Expected "<apex>=<zoneId>".`
        );
      }
      const apex = trimmed.slice(0, eq).trim();
      const zoneId = trimmed.slice(eq + 1).trim();
      if (!(apex && zoneId)) {
        bail(
          `Invalid --cf-zone value "${trimmed}". Expected "<apex>=<zoneId>".`
        );
      }
      out[apex] = zoneId;
    }
  }
  return out;
}

const addSub = defineCommand({
  meta: {
    name: "add",
    description: "Add an org profile to ~/.t-stack/orgs.toml",
  },
  args: {
    name: {
      type: "positional",
      required: true,
      description: "Org name (slug used in config)",
    },
    "cf-account": { type: "string", description: "Cloudflare account id" },
    "cf-zone": {
      type: "string",
      description:
        "Cloudflare zone mapping <apex>=<zoneId> (comma-separated for multiple)",
    },
    "default-domain": { type: "string", description: "Default apex domain" },
    "github-owner": { type: "string", description: "GitHub login or org" },
    "doppler-workplace": {
      type: "string",
      description: 'Doppler workplace name (e.g. "Personal")',
    },
    "doppler-oidc-identity": {
      type: "string",
      description: "Doppler OIDC Identity ID (optional, set later by login)",
    },
    "pulumi-org": { type: "string", description: "Pulumi org slug (optional)" },
    "neon-org-id": {
      type: "string",
      description: "Neon org id (e.g. org-dry-lab-12345678)",
    },
    "trigger-org-slug": {
      type: "string",
      description: "Trigger.dev org slug (e.g. personal-108a)",
    },
  },
  async run({ args }) {
    const name = args.name as string;
    p.intro(`t-stack org add · ${name}`);
    try {
      const cloudflareZones = parseCfZoneFlag(
        args["cf-zone"] as string | string[] | undefined
      );
      const profile: OrgProfile = {
        name,
        cloudflareAccountId: requireString(args["cf-account"], "cf-account"),
        defaultDomain: requireString(args["default-domain"], "default-domain"),
        cloudflareZones,
        githubOwner: requireString(args["github-owner"], "github-owner"),
        dopplerWorkplaceName: requireString(
          args["doppler-workplace"],
          "doppler-workplace"
        ),
      };
      const pulumiOrg = args["pulumi-org"];
      if (typeof pulumiOrg === "string" && pulumiOrg.length > 0) {
        profile.pulumiOrg = pulumiOrg;
      }
      const neonOrgId = args["neon-org-id"];
      if (typeof neonOrgId === "string" && neonOrgId.length > 0) {
        profile.neonOrgId = neonOrgId;
      }
      const dopplerIdentity = args["doppler-oidc-identity"];
      if (typeof dopplerIdentity === "string" && dopplerIdentity.length > 0) {
        profile.dopplerOidcIdentityId = dopplerIdentity;
      }
      const triggerOrgSlug = args["trigger-org-slug"];
      if (typeof triggerOrgSlug === "string" && triggerOrgSlug.length > 0) {
        profile.triggerOrgSlug = triggerOrgSlug;
      }

      await createOrgsStore().add(profile);
      p.outro(`Added org "${name}"`);
    } catch (err) {
      p.cancel(`org add failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

const listSub = defineCommand({
  meta: { name: "list", description: "List configured orgs." },
  async run() {
    const orgs = await createOrgsStore().list();
    p.intro("t-stack org list");
    if (orgs.length === 0) {
      p.outro("No orgs configured. Add one with `t-stack org add <name>`.");
      return;
    }
    for (const o of orgs) {
      p.log.info(`${o.name} — ${o.defaultDomain}`);
    }
    p.outro(`${orgs.length} org${orgs.length === 1 ? "" : "s"}`);
  },
});

const showSub = defineCommand({
  meta: { name: "show", description: "Print one org profile." },
  args: { name: { type: "positional", required: true } },
  async run({ args }) {
    p.intro(`t-stack org show · ${args.name}`);
    const org = await createOrgsStore().get(args.name as string);
    if (!org) {
      bail(`Org "${args.name}" not found.`);
    }
    p.log.info(JSON.stringify(org, null, 2));
    p.outro(args.name as string);
  },
});

const removeSub = defineCommand({
  meta: { name: "remove", description: "Remove an org from orgs.toml." },
  args: {
    name: { type: "positional", required: true },
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
  },
  async run({ args }) {
    const name = args.name as string;
    p.intro(`t-stack org remove · ${name}`);
    if (!args.yes) {
      const confirm = await p.confirm({
        message: `Remove org "${name}" from orgs.toml? (Cloud resources are not touched.)`,
        initialValue: false,
      });
      if (p.isCancel(confirm) || !confirm) {
        p.cancel("Aborted.");
        return;
      }
    }
    await createOrgsStore().remove(name);
    p.outro(`Removed org "${name}"`);
  },
});

async function loadOrgOrBail(orgName: string): Promise<OrgProfile> {
  const org = await createOrgsStore().get(orgName);
  if (!org) {
    bail(`Org "${orgName}" not found.`);
  }
  return org;
}

const zoneAddSub = defineCommand({
  meta: {
    name: "add",
    description: "Register a Cloudflare apex → zoneId mapping for an org.",
  },
  args: {
    org: { type: "positional", required: true, description: "Org slug" },
    apex: {
      type: "positional",
      required: true,
      description: "Apex domain (e.g. example.com)",
    },
    "zone-id": {
      type: "positional",
      required: true,
      description: "Cloudflare zone id",
    },
  },
  async run({ args }) {
    const orgName = args.org as string;
    const apex = args.apex as string;
    p.intro(`t-stack org zone add · ${orgName} ${apex}`);
    try {
      const zoneId = args["zone-id"] as string;
      const org = await loadOrgOrBail(orgName);
      const next: OrgProfile = {
        ...org,
        cloudflareZones: { ...org.cloudflareZones, [apex]: zoneId },
      };
      await createOrgsStore().add(next);
      p.outro(`Registered ${apex} → ${zoneId}`);
    } catch (err) {
      p.cancel(`zone add failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

const zoneDiscoverSub = defineCommand({
  meta: {
    name: "discover",
    description:
      "Auto-discover the Cloudflare zoneId for an apex via the CF API (requires Zone:Read).",
  },
  args: {
    org: { type: "positional", required: true, description: "Org slug" },
    apex: {
      type: "positional",
      required: true,
      description: "Apex domain (e.g. example.com)",
    },
  },
  async run({ args }) {
    const orgName = args.org as string;
    const apex = args.apex as string;
    p.intro(`t-stack org zone discover · ${orgName} ${apex}`);
    try {
      const org = await loadOrgOrBail(orgName);
      const tokens = await loadTokens(orgName);
      const zoneId = await discoverZoneViaCfApi({
        apex,
        accountId: org.cloudflareAccountId,
        cloudflareApiToken: tokens.cloudflareApiToken,
      });
      if (!zoneId) {
        bail(
          `No zone named "${apex}" found in Cloudflare account ${org.cloudflareAccountId}.`
        );
      }
      const next: OrgProfile = {
        ...org,
        cloudflareZones: { ...org.cloudflareZones, [apex]: zoneId },
      };
      await createOrgsStore().add(next);
      p.outro(`Discovered ${apex} → ${zoneId}`);
    } catch (err) {
      p.cancel(`zone discover failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

const zoneListSub = defineCommand({
  meta: {
    name: "list",
    description: "List Cloudflare zone mappings for an org.",
  },
  args: {
    org: { type: "positional", required: true, description: "Org slug" },
  },
  async run({ args }) {
    const orgName = args.org as string;
    p.intro(`t-stack org zone list · ${orgName}`);
    const org = await loadOrgOrBail(orgName);
    const entries = Object.entries(org.cloudflareZones);
    if (entries.length === 0) {
      p.outro(`No zones registered for org "${orgName}"`);
      return;
    }
    for (const [apex, zoneId] of entries) {
      p.log.info(`${apex}  ${zoneId}`);
    }
    p.outro(`${entries.length} zone${entries.length === 1 ? "" : "s"}`);
  },
});

const zoneRemoveSub = defineCommand({
  meta: {
    name: "remove",
    description: "Remove a Cloudflare zone mapping from an org.",
  },
  args: {
    org: { type: "positional", required: true, description: "Org slug" },
    apex: {
      type: "positional",
      required: true,
      description: "Apex domain to drop",
    },
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
  },
  async run({ args }) {
    const orgName = args.org as string;
    const apex = args.apex as string;
    p.intro(`t-stack org zone remove · ${orgName} ${apex}`);
    try {
      const org = await loadOrgOrBail(orgName);
      if (!(apex in org.cloudflareZones)) {
        p.outro(`No mapping for "${apex}" on org "${orgName}"`);
        return;
      }
      if (!args.yes) {
        const confirm = await p.confirm({
          message: `Remove ${apex} (${org.cloudflareZones[apex]}) from org "${orgName}"?`,
          initialValue: false,
        });
        if (p.isCancel(confirm) || !confirm) {
          p.cancel("Aborted.");
          return;
        }
      }
      const { [apex]: _dropped, ...rest } = org.cloudflareZones;
      const next: OrgProfile = { ...org, cloudflareZones: rest };
      await createOrgsStore().add(next);
      p.outro(`Removed ${apex} from org "${orgName}"`);
    } catch (err) {
      p.cancel(`zone remove failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

const zoneCommand = defineCommand({
  meta: {
    name: "zone",
    description: "Manage Cloudflare apex → zoneId mappings for an org.",
  },
  subCommands: {
    add: zoneAddSub,
    discover: zoneDiscoverSub,
    list: zoneListSub,
    remove: zoneRemoveSub,
  },
});

const triggerListSub = defineCommand({
  meta: {
    name: "list",
    description: "List Trigger.dev orgs visible to this org's PAT.",
  },
  args: {
    org: { type: "positional", required: true, description: "Org slug" },
  },
  async run({ args }) {
    const orgName = args.org as string;
    p.intro(`t-stack org trigger list · ${orgName}`);
    try {
      await loadOrgOrBail(orgName);
      const tokens = await loadTokens(orgName);
      const orgs = await listTriggerOrgs(tokens.triggerAccessToken);
      if (orgs.length === 0) {
        p.outro(
          "No Trigger.dev orgs visible to this PAT (no projects yet, or PAT lacks access)."
        );
        return;
      }
      for (const o of orgs) {
        p.log.info(`${o.slug}  ${o.title}`);
      }
      p.outro(`${orgs.length} org${orgs.length === 1 ? "" : "s"}`);
    } catch (err) {
      p.cancel(`trigger list failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

const triggerDiscoverSub = defineCommand({
  meta: {
    name: "discover",
    description:
      "Pick a Trigger.dev org for this t-stack org from the PAT's visible list and save its slug.",
  },
  args: {
    org: { type: "positional", required: true, description: "Org slug" },
  },
  async run({ args }) {
    const orgName = args.org as string;
    p.intro(`t-stack org trigger discover · ${orgName}`);
    try {
      const org = await loadOrgOrBail(orgName);
      const tokens = await loadTokens(orgName);
      const orgs = await listTriggerOrgs(tokens.triggerAccessToken);
      if (orgs.length === 0) {
        bail(
          "No Trigger.dev orgs visible to this PAT. Create a project in the Trigger.dev dashboard first, then retry."
        );
      }
      const pick = await p.select({
        message: `Pick a Trigger.dev org to map to "${orgName}"`,
        options: orgs.map((o) => ({
          value: o.slug,
          label: `${o.title} (${o.slug})`,
        })),
      });
      if (p.isCancel(pick)) {
        p.cancel("Aborted.");
        return;
      }
      const next: OrgProfile = { ...org, triggerOrgSlug: pick as string };
      await createOrgsStore().add(next);
      p.outro(`Set triggerOrgSlug=${pick} for org "${orgName}"`);
    } catch (err) {
      p.cancel(`trigger discover failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

const triggerSetSub = defineCommand({
  meta: {
    name: "set",
    description: "Explicitly set the Trigger.dev org slug for an org.",
  },
  args: {
    org: { type: "positional", required: true, description: "Org slug" },
    slug: {
      type: "positional",
      required: true,
      description: "Trigger.dev org slug",
    },
  },
  async run({ args }) {
    const orgName = args.org as string;
    const slug = args.slug as string;
    p.intro(`t-stack org trigger set · ${orgName} ${slug}`);
    try {
      const org = await loadOrgOrBail(orgName);
      const next: OrgProfile = { ...org, triggerOrgSlug: slug };
      await createOrgsStore().add(next);
      p.outro(`Set triggerOrgSlug=${slug} for org "${orgName}"`);
    } catch (err) {
      p.cancel(`trigger set failed: ${(err as Error).message}`);
      process.exit(1);
    }
  },
});

const triggerCommand = defineCommand({
  meta: {
    name: "trigger",
    description: "Manage the Trigger.dev org binding for a t-stack org.",
  },
  subCommands: {
    list: triggerListSub,
    discover: triggerDiscoverSub,
    set: triggerSetSub,
  },
});

export const orgCommand = defineCommand({
  meta: {
    name: "org",
    description: "Manage org profiles in ~/.t-stack/orgs.toml.",
  },
  subCommands: {
    add: addSub,
    list: listSub,
    show: showSub,
    remove: removeSub,
    zone: zoneCommand,
    trigger: triggerCommand,
  },
});

export default orgCommand;

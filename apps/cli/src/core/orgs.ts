import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "pathe";
import { parse, stringify } from "smol-toml";
import type { OrgProfile } from "./preset.ts";

export interface OrgsStore {
  list(): Promise<OrgProfile[]>;
  get(name: string): Promise<OrgProfile | undefined>;
  add(profile: OrgProfile): Promise<void>;
  remove(name: string): Promise<void>;
}

interface OrgEntryToml {
  cloudflare_account_id?: string;
  default_domain?: string;
  cloudflare_zones?: Record<string, string>;
  github_owner?: string;
  doppler_workplace_name?: string;
  pulumi_org?: string;
  neon_org_id?: string;
  trigger_org_slug?: string;
  /**
   * Legacy field from the OIDC era. Read-only — when found, we silently drop
   * it on the next write. Kept here so smol-toml's strict parse doesn't
   * complain on existing user files that still carry it.
   */
  doppler_oidc_identity_id?: string;
}

interface OrgsFile {
  orgs?: Record<string, OrgEntryToml>;
}

function orgsFilePath(): string {
  return join(homedir(), ".t-stack", "orgs.toml");
}

async function readFileOrEmpty(filePath: string): Promise<OrgsFile> {
  try {
    const raw = await readFile(filePath, "utf8");
    return parse(raw) as OrgsFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { orgs: {} };
    }
    throw err;
  }
}

async function writeOrgsFile(filePath: string, data: OrgsFile): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, stringify(data as Record<string, unknown>), "utf8");
}

function toProfile(name: string, entry: OrgEntryToml): OrgProfile {
  const profile: OrgProfile = {
    name,
    cloudflareAccountId: entry.cloudflare_account_id ?? "",
    defaultDomain: entry.default_domain ?? "",
    cloudflareZones: entry.cloudflare_zones ?? {},
    githubOwner: entry.github_owner ?? "",
    dopplerWorkplaceName: entry.doppler_workplace_name ?? "",
  };
  if (entry.pulumi_org) {
    profile.pulumiOrg = entry.pulumi_org;
  }
  if (entry.neon_org_id) {
    profile.neonOrgId = entry.neon_org_id;
  }
  if (entry.trigger_org_slug) {
    profile.triggerOrgSlug = entry.trigger_org_slug;
  }
  // doppler_oidc_identity_id is intentionally ignored — OIDC was dropped in
  // favor of service tokens; the field is left in `OrgEntryToml` only so
  // existing files don't break on parse, and it's omitted from the next write.
  return profile;
}

function fromProfile(profile: OrgProfile): OrgEntryToml {
  const entry: OrgEntryToml = {
    cloudflare_account_id: profile.cloudflareAccountId,
    default_domain: profile.defaultDomain,
    github_owner: profile.githubOwner,
    doppler_workplace_name: profile.dopplerWorkplaceName,
    cloudflare_zones: profile.cloudflareZones ?? {},
  };
  if (profile.pulumiOrg) {
    entry.pulumi_org = profile.pulumiOrg;
  }
  if (profile.neonOrgId) {
    entry.neon_org_id = profile.neonOrgId;
  }
  if (profile.triggerOrgSlug) {
    entry.trigger_org_slug = profile.triggerOrgSlug;
  }
  return entry;
}

export function createOrgsStore(): OrgsStore {
  const filePath = orgsFilePath();

  return {
    async list() {
      const data = await readFileOrEmpty(filePath);
      const entries = data.orgs ?? {};
      return Object.entries(entries).map(([name, entry]) =>
        toProfile(name, entry)
      );
    },
    async get(name) {
      const data = await readFileOrEmpty(filePath);
      const entry = data.orgs?.[name];
      return entry ? toProfile(name, entry) : undefined;
    },
    async add(profile) {
      const data = await readFileOrEmpty(filePath);
      const orgs = data.orgs ?? {};
      orgs[profile.name] = fromProfile(profile);
      await writeOrgsFile(filePath, { orgs });
    },
    async remove(name) {
      const data = await readFileOrEmpty(filePath);
      const orgs = data.orgs ?? {};
      delete orgs[name];
      await writeOrgsFile(filePath, { orgs });
    },
  };
}

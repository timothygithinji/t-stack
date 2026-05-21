import type { Archetype, InitDecisions } from "@t-stack/schema";
import type { Logger } from "./log.ts";
import type { StateStore } from "./state.ts";
import type { TokenBag } from "./tokens.ts";

export type {
  Archetype,
  Database,
  EnvScope,
  InitDecisions,
} from "@t-stack/schema";

export interface OrgProfile {
  name: string;
  cloudflareAccountId: string;
  defaultDomain: string;
  /** apex (e.g. "timothygithinji.com") → Cloudflare zone id. Empty map allowed. */
  cloudflareZones: Record<string, string>;
  githubOwner: string;
  /** Display name of the Doppler workplace that holds this org's `t-stack` project (e.g. "Personal", "Fanya Labs"). */
  dopplerWorkplaceName: string;
  /** OIDC identity id used by GitHub Actions to auth into this org's Doppler workplace. */
  dopplerOidcIdentityId?: string;
  pulumiOrg?: string;
  neonOrgId?: string;
  /** Trigger.dev org slug to scope projects under (e.g. "personal-108a"). Required only when trigger=true. */
  triggerOrgSlug?: string;
}

export interface Paths {
  /** Repo root for the scaffolded project. */
  cwd: string;
  /** CLI source repo (templates live here). */
  cliRoot: string;
  /** ~/.t-stack */
  userConfig: string;
  /** state.json path inside cwd. */
  stateFile: string;
}

export interface Ctx {
  org: OrgProfile;
  projectName: string;
  archetype: Archetype;
  decisions: InitDecisions;
  paths: Paths;
  logger: Logger;
  state: StateStore;
  tokens: TokenBag;
  /** Read a prompt answer by id. */
  choice<T = unknown>(id: string): T;
  /** True when --yes was passed. */
  nonInteractive: boolean;
}

export interface PresetDef {
  id: string;
  description: string;
  templates: readonly string[];
  run: (ctx: Ctx) => Promise<void>;
}

export function definePreset(def: PresetDef): PresetDef {
  return def;
}

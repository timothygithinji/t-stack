import type { InitDecisions } from "@t-stack/schema";
import type { Logger } from "./log.ts";
import type { StateStore } from "./state.ts";
import type { TokenBag } from "./tokens.ts";

export type { EnvScope, InitDecisions } from "@t-stack/schema";

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
  /** The preset bundle in effect for this run (resolved by init / loaded from state). */
  preset: PresetDef;
  decisions: InitDecisions;
  paths: Paths;
  logger: Logger;
  state: StateStore;
  tokens: TokenBag;
  /** Read a prompt answer by id. */
  choice<T = unknown>(id: string): T;
  /** True when --yes was passed. */
  nonInteractive: boolean;
  /**
   * Set by the plugin-graph runner before invoking a step's `run` when the
   * user has asked for a forced re-creation via the verify-on-skip prompt.
   *
   *   - "adopt" — the plugin must locate an existing resource by name; if
   *     none is found, it should throw rather than create a fresh one.
   *   - "new"   — the plugin should skip its adopt path entirely and create
   *     a brand-new resource even if a same-named one exists.
   *
   * `undefined` means "default": plugins behave as they always have
   * (lookup-first, create if missing). Plugins should treat this field as
   * a per-step input and not assume it sticks across step boundaries.
   */
  recreateMode?: "adopt" | "new";
}

export interface PresetDef {
  id: string;
  /** Human-friendly label (e.g., "Solo CF Worker"). */
  name: string;
  description: string;
  /**
   * Preloaded values that bypass schema defaults. Merged into the prompt-loop
   * initial state before any user input or CLI flag is applied, so flags still
   * win when they conflict.
   */
  defaults: Partial<InitDecisions>;
  templates: readonly string[];
  /** Phase 5 will rewrite this to be declarative. */
  run: (ctx: Ctx) => Promise<void>;
}

export function definePreset(def: PresetDef): PresetDef {
  return def;
}

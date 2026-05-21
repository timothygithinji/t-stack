import type { InitDecisions } from "@t-stack/schema";

/**
 * The web app's working copy of a stack config. Mirrors `InitDecisions`
 * exactly — every axis is required and starts at the schema default so the
 * form never has to deal with an "undecided" state. Cross-field validity is
 * surfaced at render time via the predicate registry, not on the type.
 */
export type DraftStack = InitDecisions;

/**
 * Hard-coded defaults that mirror `initSchema`'s per-field `.default()`
 * declarations. Kept inline (instead of parsing the schema) because Zod's
 * `parse({})` would also fill in defaults but throw on the required string
 * fields (`org`, `domain`) before reaching the enums — so we'd still need
 * to spell those out. Cheaper to just list them.
 */
export const DEFAULT_STACK: DraftStack = {
  projectName: "my-app",
  org: "",
  domain: "",
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
  orm: "drizzle",
  auth: "better-auth",
  storage: "none",
  payments: "none",
  addons: [],
  packageManager: "bun",
  git: true,
  install: true,
  envs: "prd",
  trigger: true,
  access: false,
  hookdeck: false,
  hookdeckApiKey: undefined,
};

/** Identity helper kept for ergonomic call sites — shape is identical. */
export function asInitDecisions(d: DraftStack): InitDecisions {
  return d;
}

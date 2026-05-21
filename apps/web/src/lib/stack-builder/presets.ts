import type { DraftStack } from "./types";

/**
 * Quick-apply preset configurations surfaced in the Actions section.
 * Each preset overrides any subset of fields on the current draft —
 * fields the preset omits stay as the user had them (so applying a
 * "Solo + Trigger" preset over an existing draft keeps the project
 * name, org, domain the user already typed).
 *
 * Slugs mirror the CLI's `apps/cli/presets/*.ts` definitions so the
 * shareable URL ↔ CLI flag mapping stays 1:1.
 */
export interface StackPreset {
  id: string;
  name: string;
  description: string;
  patch: Partial<DraftStack>;
}

export const STACK_PRESETS: readonly StackPreset[] = [
  {
    id: "minimal-solo",
    name: "Minimal Solo",
    description: "Single CF Worker, Neon Postgres, prod-only. No add-ons.",
    patch: {
      structure: "single",
      cloudProvider: "cloudflare",
      iac: "pulumi",
      runtime: "workers",
      frontend: "tanstack-router",
      backend: "hono",
      api: "orpc",
      database: "postgres",
      databaseHost: "neon",
      orm: "drizzle",
      auth: "better-auth",
      storage: "none",
      payments: "none",
      addons: [],
      envs: "prd",
      trigger: false,
      access: false,
      hookdeck: false,
    },
  },
  {
    id: "solo-trigger",
    name: "Solo + Trigger.dev",
    description: "Single worker with background jobs + dev/prod split.",
    patch: {
      structure: "single",
      cloudProvider: "cloudflare",
      iac: "pulumi",
      runtime: "workers",
      frontend: "tanstack-router",
      backend: "hono",
      api: "orpc",
      database: "postgres",
      databaseHost: "neon",
      orm: "drizzle",
      auth: "better-auth",
      envs: "dev+prd",
      trigger: true,
      access: false,
      hookdeck: false,
    },
  },
  {
    id: "solo-webhooks",
    name: "Solo + Webhooks",
    description: "Single worker + Hookdeck inbound webhooks + Trigger.",
    patch: {
      structure: "single",
      cloudProvider: "cloudflare",
      iac: "pulumi",
      runtime: "workers",
      frontend: "tanstack-router",
      backend: "hono",
      api: "orpc",
      database: "postgres",
      databaseHost: "neon",
      orm: "drizzle",
      auth: "better-auth",
      envs: "dev+prd",
      trigger: true,
      access: false,
      hookdeck: true,
    },
  },
  {
    id: "solo-turso-edge",
    name: "Solo Edge (Turso)",
    description: "Single worker on Turso for SQLite-at-the-edge.",
    patch: {
      structure: "single",
      cloudProvider: "cloudflare",
      iac: "pulumi",
      runtime: "workers",
      frontend: "tanstack-router",
      backend: "hono",
      api: "orpc",
      database: "sqlite",
      databaseHost: "turso",
      orm: "drizzle",
      auth: "better-auth",
      envs: "prd",
      trigger: false,
      access: false,
      hookdeck: false,
    },
  },
  {
    id: "default-mono",
    name: "Default Monorepo",
    description: "Bun + Turbo monorepo, Neon Postgres, dev/prod, Trigger on.",
    patch: {
      structure: "monorepo",
      cloudProvider: "cloudflare",
      iac: "pulumi",
      runtime: "workers",
      frontend: "tanstack-router",
      backend: "hono",
      docs: "starlight",
      api: "orpc",
      database: "postgres",
      databaseHost: "neon",
      orm: "drizzle",
      auth: "better-auth",
      addons: ["turborepo", "biome"],
      envs: "dev+prd",
      trigger: true,
      access: false,
      hookdeck: false,
    },
  },
  {
    id: "full-mono",
    name: "Full Monorepo",
    description: "Monorepo with three envs, Trigger, Access, Hookdeck.",
    patch: {
      structure: "monorepo",
      cloudProvider: "cloudflare",
      iac: "pulumi",
      runtime: "workers",
      frontend: "tanstack-router",
      backend: "hono",
      docs: "starlight",
      api: "orpc",
      database: "postgres",
      databaseHost: "neon",
      orm: "drizzle",
      auth: "better-auth",
      storage: "r2",
      addons: ["turborepo", "biome", "husky", "commitlint"],
      envs: "dev+stg+prd",
      trigger: true,
      access: true,
      hookdeck: true,
    },
  },
];

/**
 * Build a random stack patch. Picks a coherent combination — turso/sqlite
 * stay paired, d1 requires cloudflare, etc.
 */
export function randomStackPatch(): Partial<DraftStack> {
  const structure = pick(["single", "monorepo"] as const);
  const dbCombo = pick([
    { database: "postgres", databaseHost: "neon" },
    { database: "sqlite", databaseHost: "turso" },
    { database: "sqlite", databaseHost: "d1" },
  ] as const);

  return {
    structure,
    cloudProvider: "cloudflare",
    iac: "pulumi",
    runtime: "workers",
    frontend: pick(["tanstack-router", "tanstack-start", "astro"] as const),
    backend: "hono",
    docs: structure === "monorepo" ? "starlight" : "none",
    api: "orpc",
    database: dbCombo.database,
    databaseHost: dbCombo.databaseHost,
    orm: "drizzle",
    auth: "better-auth",
    storage: pick(["none", "r2"] as const),
    payments: pick(["none", "stripe"] as const),
    addons: structure === "monorepo" ? ["turborepo", "biome"] : ["biome"],
    envs: pick(["prd", "dev+prd", "dev+stg+prd"] as const),
    trigger: Math.random() > 0.3,
    access: Math.random() > 0.7,
    hookdeck: Math.random() > 0.6,
  };
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

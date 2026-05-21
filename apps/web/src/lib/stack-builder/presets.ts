import type { DraftStack } from "./types";

/**
 * Quick-apply preset configurations surfaced in the Actions section.
 * Each preset overrides any subset of fields on the current draft —
 * fields the preset omits stay as the user had them (so applying a
 * "Solo + Trigger" preset over an existing draft keeps the project
 * name, org, domain the user already typed).
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
    description: "Single CF Worker, Neon, prod-only. No add-ons.",
    patch: {
      archetype: "solo-cf-worker",
      database: "neon",
      envs: "prd",
      trigger: false,
      access: false,
      hookdeck: false,
    },
  },
  {
    id: "solo-trigger",
    name: "Solo + Trigger.dev",
    description: "Solo worker with background jobs + dev/prod split.",
    patch: {
      archetype: "solo-cf-worker",
      database: "neon",
      envs: "dev+prd",
      trigger: true,
      access: false,
      hookdeck: false,
    },
  },
  {
    id: "solo-webhooks",
    name: "Solo + Webhooks",
    description: "Solo worker + Hookdeck inbound webhooks + Trigger.",
    patch: {
      archetype: "solo-cf-worker",
      database: "neon",
      envs: "dev+prd",
      trigger: true,
      access: false,
      hookdeck: true,
    },
  },
  {
    id: "solo-turso-edge",
    name: "Solo Edge (Turso)",
    description: "Solo worker on Turso for SQLite-at-the-edge.",
    patch: {
      archetype: "solo-cf-worker",
      database: "turso",
      envs: "prd",
      trigger: false,
      access: false,
      hookdeck: false,
    },
  },
  {
    id: "default-mono",
    name: "Default Monorepo",
    description: "Bun + Turbo monorepo, Neon, dev/prod, Trigger on.",
    patch: {
      archetype: "monorepo-cf",
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
      archetype: "monorepo-cf",
      envs: "dev+stg+prd",
      trigger: true,
      access: true,
      hookdeck: true,
    },
  },
];

/**
 * Build a random stack patch. Picks a coherent combination — turso only
 * pairs with solo-cf-worker, etc.
 */
export function randomStackPatch(): Partial<DraftStack> {
  const archetype = pick(["solo-cf-worker", "monorepo-cf"] as const);
  const database =
    archetype === "solo-cf-worker" ? pick(["neon", "turso"] as const) : "neon";
  return {
    archetype,
    database,
    envs: pick(["prd", "dev+prd", "dev+stg+prd"] as const),
    trigger: Math.random() > 0.3,
    access: Math.random() > 0.7,
    hookdeck: Math.random() > 0.6,
  };
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

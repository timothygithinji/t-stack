/**
 * Static preset metadata, shared by the CLI and the stack-builder web UI.
 * The actual provisioning logic (each preset's `run()` function) lives in
 * apps/cli/presets/ — it imports cloud plugins (Pulumi, Doppler, Octokit)
 * that have no place in a browser bundle.
 */

export interface PresetMeta {
  /** Archetype slug; matches the `archetype` discriminator in @t-stack/schema. */
  id: "solo-cf-worker" | "monorepo-cf";
  /** Short, human-readable headline shown in the preset cards. */
  name: string;
  /** One-line description for the preset card / dropdown. */
  description: string;
  /** Longer pitch shown on hover / details panel. Web-only. */
  details: string;
  /**
   * Ordered list of template directories under packages/templates/files
   * that get rendered into the scaffolded project, base first.
   */
  templates: readonly string[];
}

export const PRESETS: readonly PresetMeta[] = [
  {
    id: "solo-cf-worker",
    name: "Solo CF Worker",
    description: "Single Vite + CF Workers app",
    details:
      "One Vite + TanStack Start app deployed to a single Cloudflare Worker. " +
      "Pick neon or turso for the database. Optional Trigger.dev, Cloudflare " +
      "Access, and Hookdeck webhooks. Fastest path from scaffold to live URL.",
    templates: ["_base", "solo-cf-worker"],
  },
  {
    id: "monorepo-cf",
    name: "Monorepo (Cloudflare)",
    description: "Bun workspaces + Turbo monorepo",
    details:
      "Bun workspaces with apps/web, apps/server, apps/trigger and shared " +
      "packages (db, ui, types). Always uses Neon for Postgres. Same optional " +
      "Trigger.dev / Cloudflare Access / Hookdeck add-ons as the solo preset.",
    templates: ["_base", "monorepo-cf"],
  },
] as const;

export function getPreset(id: PresetMeta["id"]): PresetMeta {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) {
    throw new Error(`Unknown preset id: ${id}`);
  }
  return preset;
}

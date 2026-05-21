import type { Archetype, InitDecisions } from "@t-stack/schema";

/**
 * The web app's working copy of a stack config. Loosely typed by design —
 * the user can have invalid in-progress state (e.g. an empty domain).
 * Validation against initSchema happens when rendering the command and the
 * file preview.
 */
export type DraftStack = {
  archetype: Archetype;
  projectName: string;
  org: string;
  domain: string;
  database: "neon" | "turso";
  envs: "prd" | "dev+prd" | "dev+stg+prd";
  trigger: boolean;
  access: boolean;
  hookdeck: boolean;
};

export const DEFAULT_STACK: DraftStack = {
  archetype: "solo-cf-worker",
  projectName: "my-app",
  org: "",
  domain: "",
  database: "neon",
  envs: "prd",
  trigger: true,
  access: false,
  hookdeck: false,
};

/** Helper to project the draft onto the strict InitDecisions union. */
export function asInitDecisions(d: DraftStack): InitDecisions {
  if (d.archetype === "monorepo-cf") {
    return {
      archetype: "monorepo-cf",
      projectName: d.projectName,
      org: d.org,
      domain: d.domain,
      envs: d.envs,
      trigger: d.trigger,
      access: d.access,
      hookdeck: d.hookdeck,
    };
  }
  return {
    archetype: "solo-cf-worker",
    projectName: d.projectName,
    org: d.org,
    domain: d.domain,
    database: d.database,
    envs: d.envs,
    trigger: d.trigger,
    access: d.access,
    hookdeck: d.hookdeck,
  };
}

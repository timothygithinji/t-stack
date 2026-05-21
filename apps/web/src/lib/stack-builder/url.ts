import { type DraftStack, DEFAULT_STACK } from "./types";

/**
 * Shorthand keys keep the shareable URL compact:
 *   ?a=s&n=my-app&db=neon&e=prd&t=1
 * Long form (`archetype`) still parses for backwards-compat / readability.
 */
const KEY_MAP: Record<keyof DraftStack, string> = {
  archetype: "a",
  projectName: "n",
  org: "o",
  domain: "d",
  database: "db",
  envs: "e",
  trigger: "t",
  access: "ac",
  hookdeck: "h",
};

const ARCHETYPE_SHORT: Record<DraftStack["archetype"], string> = {
  "solo-cf-worker": "s",
  "monorepo-cf": "m",
};
const ARCHETYPE_LONG = Object.fromEntries(
  Object.entries(ARCHETYPE_SHORT).map(([k, v]) => [v, k])
) as Record<string, DraftStack["archetype"]>;

export function encodeStack(stack: DraftStack): string {
  const params = new URLSearchParams();
  // Only emit fields that differ from defaults — keeps URLs short.
  for (const [field, short] of Object.entries(KEY_MAP) as [
    keyof DraftStack,
    string,
  ][]) {
    const value = stack[field];
    const def = DEFAULT_STACK[field];
    if (value === def) {
      continue;
    }
    if (field === "archetype") {
      params.set(short, ARCHETYPE_SHORT[stack.archetype]);
    } else if (typeof value === "boolean") {
      params.set(short, value ? "1" : "0");
    } else if (value !== "") {
      params.set(short, String(value));
    }
  }
  return params.toString();
}

export function decodeStack(search: string): DraftStack {
  const params = new URLSearchParams(search);
  const stack: DraftStack = { ...DEFAULT_STACK };

  const archShort = params.get("a") ?? params.get("archetype");
  if (archShort) {
    const long =
      ARCHETYPE_LONG[archShort] ?? (archShort as DraftStack["archetype"]);
    if (long === "solo-cf-worker" || long === "monorepo-cf") {
      stack.archetype = long;
    }
  }

  const lookup = (field: keyof DraftStack) => {
    const short = KEY_MAP[field];
    return params.get(short) ?? params.get(field);
  };

  const projectName = lookup("projectName");
  if (projectName) {
    stack.projectName = projectName;
  }
  const org = lookup("org");
  if (org) {
    stack.org = org;
  }
  const domain = lookup("domain");
  if (domain) {
    stack.domain = domain;
  }
  const db = lookup("database");
  if (db === "neon" || db === "turso") {
    stack.database = db;
  }
  const envs = lookup("envs");
  if (envs === "prd" || envs === "dev+prd" || envs === "dev+stg+prd") {
    stack.envs = envs;
  }
  const trigger = lookup("trigger");
  if (trigger !== null) {
    stack.trigger = trigger === "1" || trigger === "true";
  }
  const access = lookup("access");
  if (access !== null) {
    stack.access = access === "1" || access === "true";
  }
  const hookdeck = lookup("hookdeck");
  if (hookdeck !== null) {
    stack.hookdeck = hookdeck === "1" || hookdeck === "true";
  }

  return stack;
}

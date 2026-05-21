import { type DraftStack, DEFAULT_STACK } from "./types";

/**
 * Shareable URL serialisation. Each axis gets a 1-3 char query param so the
 * full stack fits comfortably in a single URL:
 *   ?st=monorepo&fe=tanstack-router&db=sqlite&dh=turso
 *
 * Only fields that differ from `DEFAULT_STACK` are emitted, so the common
 * case (the default stack) produces an empty query string. Pre-release we
 * don't carry the old `?a=…` archetype URLs forward — they just decode to
 * defaults.
 */
const KEY_MAP: Record<keyof DraftStack, string> = {
  projectName: "n",
  org: "o",
  domain: "d",
  structure: "st",
  cloudProvider: "cp",
  iac: "iac",
  runtime: "rt",
  frontend: "fe",
  backend: "be",
  docs: "dc",
  api: "api",
  database: "db",
  databaseHost: "dh",
  orm: "orm",
  auth: "au",
  storage: "sto",
  payments: "pay",
  addons: "ad",
  packageManager: "pm",
  git: "g",
  install: "i",
  envs: "e",
  trigger: "t",
  access: "ac",
  hookdeck: "h",
  hookdeckApiKey: "hk",
};

// Per-field enum allow-lists. Duplicated from `packages/schema` on purpose:
// the web is a different package and the schema's runtime introspection
// helpers (enumChoicesForField) live next door but we want the URL parser
// to stay statically typed without a Zod walk on every page load.
const ENUM_VALUES = {
  structure: ["single", "monorepo"],
  cloudProvider: ["cloudflare", "none"],
  iac: ["pulumi", "none"],
  runtime: ["workers", "node", "bun", "none"],
  frontend: ["tanstack-start", "tanstack-router", "astro", "none"],
  backend: ["hono", "tanstack-start", "none"],
  docs: ["starlight", "none"],
  api: ["orpc", "none"],
  database: ["postgres", "sqlite", "none"],
  databaseHost: ["neon", "turso", "d1", "none"],
  orm: ["drizzle", "none"],
  auth: ["better-auth", "none"],
  storage: ["r2", "tigris", "none"],
  payments: ["stripe", "none"],
  packageManager: ["bun", "pnpm"],
  envs: ["prd", "dev+prd", "dev+stg+prd"],
} as const satisfies Partial<Record<keyof DraftStack, readonly string[]>>;

const ADDON_VALUES = [
  "biome",
  "husky",
  "turborepo",
  "fallow",
  "commitlint",
  "release-it",
  "ultracite",
] as const;

const BOOLEAN_FIELDS = new Set<keyof DraftStack>([
  "git",
  "install",
  "trigger",
  "access",
  "hookdeck",
]);

const STRING_FIELDS = new Set<keyof DraftStack>([
  "projectName",
  "org",
  "domain",
  "hookdeckApiKey",
]);

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-field encoding requires branching by kind (array | bool | string | enum).
export function encodeStack(stack: DraftStack): string {
  const params = new URLSearchParams();

  for (const [rawField, short] of Object.entries(KEY_MAP) as [
    keyof DraftStack,
    string,
  ][]) {
    const value = stack[rawField];
    const def = DEFAULT_STACK[rawField];

    if (rawField === "addons") {
      const next = (value as string[]) ?? [];
      const prev = (def as string[]) ?? [];
      if (arraysEqual(next, prev)) {
        continue;
      }
      // Sort on the wire so two equivalent stacks produce the same URL.
      // Empty array represented as a single empty value so the decoder can
      // distinguish "user cleared addons" from "field not in URL".
      params.set(short, [...next].sort().join(","));
      continue;
    }

    if (value === def) {
      continue;
    }

    if (BOOLEAN_FIELDS.has(rawField)) {
      params.set(short, value ? "1" : "0");
      continue;
    }

    if (STRING_FIELDS.has(rawField)) {
      if (value === "" || value === undefined) {
        continue;
      }
      params.set(short, String(value));
      continue;
    }

    // Enum fields.
    if (typeof value === "string" && value !== "") {
      params.set(short, value);
    }
  }

  return params.toString();
}

export function decodeStack(search: string): DraftStack {
  const params = new URLSearchParams(search);
  const stack: DraftStack = {
    ...DEFAULT_STACK,
    addons: [...DEFAULT_STACK.addons],
  };

  const lookup = (field: keyof DraftStack) => {
    const short = KEY_MAP[field];
    return params.get(short) ?? params.get(field);
  };

  // Free-text strings.
  for (const field of STRING_FIELDS) {
    const raw = lookup(field);
    if (raw === null || raw === undefined) {
      continue;
    }
    (stack as Record<string, unknown>)[field] = raw;
  }

  // Enums.
  for (const [field, values] of Object.entries(ENUM_VALUES) as [
    keyof typeof ENUM_VALUES,
    readonly string[],
  ][]) {
    const raw = lookup(field);
    if (raw === null || raw === undefined) {
      continue;
    }
    if (values.includes(raw)) {
      (stack as Record<string, unknown>)[field] = raw;
    }
  }

  // Addons (multi-select).
  const addonsRaw = lookup("addons");
  if (addonsRaw !== null && addonsRaw !== undefined) {
    const requested = addonsRaw.length === 0 ? [] : addonsRaw.split(",");
    const filtered = requested.filter((v): v is (typeof ADDON_VALUES)[number] =>
      (ADDON_VALUES as readonly string[]).includes(v)
    );
    stack.addons = filtered;
  }

  // Booleans.
  for (const field of BOOLEAN_FIELDS) {
    const raw = lookup(field);
    if (raw === null || raw === undefined) {
      continue;
    }
    (stack as Record<string, unknown>)[field] =
      raw === "1" || raw.toLowerCase() === "true";
  }

  return stack;
}

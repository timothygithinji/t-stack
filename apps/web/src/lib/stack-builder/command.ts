import { DEFAULT_STACK, type DraftStack } from "./types";

/**
 * Render the `t-stack init` command the user copies. Only fields that
 * differ from the schema defaults are emitted, keeping the line short.
 *
 * `org` is always emitted as a placeholder if the user hasn't set it, since
 * the CLI rejects --yes without an org. We surface it explicitly so the
 * pasted command is obviously incomplete (instead of silently picking the
 * first org from orgs.toml).
 *
 * Field names map to CLI flags by kebab-casing the camelCase axis name
 * (e.g. `databaseHost` → `--database-host`).
 */

const camelToKebab = (s: string) =>
  s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

// Boolean fields use `--flag` / `--no-flag` instead of `--flag=value`.
const BOOLEAN_FIELDS = new Set<keyof DraftStack>([
  "git",
  "install",
  "trigger",
  "access",
  "hookdeck",
]);

// Free-text fields with their own positional / leading flags.
const SKIP_IN_LOOP = new Set<keyof DraftStack>([
  "projectName",
  "org",
  "hookdeckApiKey",
]);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-field flag emission requires branching by kind.
export function generateCommand(stack: DraftStack): string {
  const parts: string[] = ["bunx", "@timothygithinji/t-stack", "init"];
  parts.push(stack.projectName || "<project-name>");

  // Org is always emitted — required by the CLI in non-interactive use.
  parts.push(`--org=${stack.org || "<your-org>"}`);

  for (const field of Object.keys(DEFAULT_STACK) as (keyof DraftStack)[]) {
    if (SKIP_IN_LOOP.has(field)) {
      continue;
    }

    const value = stack[field];
    const def = DEFAULT_STACK[field];

    if (field === "addons") {
      const addons = (value as string[]) ?? [];
      const defAddons = (def as string[]) ?? [];
      if (
        addons.length === defAddons.length &&
        addons.every((v, i) => v === defAddons[i])
      ) {
        continue;
      }
      if (addons.length === 0) {
        parts.push("--addons=");
      } else {
        parts.push(`--addons=${addons.join(",")}`);
      }
      continue;
    }

    if (BOOLEAN_FIELDS.has(field)) {
      if (value === def) {
        continue;
      }
      parts.push(
        value ? `--${camelToKebab(field)}` : `--no-${camelToKebab(field)}`
      );
      continue;
    }

    if (value === def) {
      continue;
    }
    if (value === undefined || value === "") {
      continue;
    }
    parts.push(`--${camelToKebab(field)}=${String(value)}`);
  }

  return parts.join(" ");
}

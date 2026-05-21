import type { DraftStack } from "./types";

/**
 * Render the `t-stack init` command the user copies. Only fields that
 * differ from the schema defaults are emitted, keeping the line short.
 *
 * `org` is always emitted as a placeholder if the user hasn't set it, since
 * the CLI rejects --yes without an org. We surface it explicitly so the
 * pasted command is obviously incomplete (instead of silently picking the
 * first org from orgs.toml).
 */
export function generateCommand(stack: DraftStack): string {
  const parts: string[] = ["bunx", "@timothygithinji/t-stack", "init"];
  parts.push(stack.projectName || "<project-name>");

  const flag = (k: string, v?: string) => {
    if (!v) {
      return;
    }
    parts.push(`--${k}=${v}`);
  };

  flag("org", stack.org || "<your-org>");
  flag("archetype", stack.archetype);
  if (stack.domain) {
    flag("domain", stack.domain);
  }
  if (stack.archetype === "solo-cf-worker" && stack.database !== "neon") {
    flag("database", stack.database);
  }
  if (stack.envs !== "prd") {
    flag("envs", stack.envs);
  }
  // Booleans: emit only the deviation from default. trigger defaults true,
  // access/hookdeck default false.
  if (!stack.trigger) {
    parts.push("--no-trigger");
  }
  if (stack.access) {
    parts.push("--access");
  }
  if (stack.hookdeck) {
    parts.push("--hookdeck");
  }

  return parts.join(" ");
}

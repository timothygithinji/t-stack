import { z } from "zod";

/**
 * Metadata attached to every schema field via the `fieldMeta` registry.
 * Both the CLI and the web app read this — adding a new field to the schema
 * automatically makes it available to both consumers.
 *
 * - `ui` selects the renderer in the web app and the clack prompt type in
 *   the CLI.
 * - `source` tells the CLI where to look for a runtime default (org list
 *   from orgs.toml, env var, Doppler config). The web app ignores it.
 * - `secret: true` causes the web app to render a "set at the CLI prompt"
 *   note instead of an input — the value never appears in the URL or the
 *   generated command.
 * - `visibleIf` is a shallow equality predicate against sibling fields
 *   (e.g. `{ hookdeck: true }`). When the predicate fails, the field is
 *   hidden entirely from the flow.
 * - `defaultFrom` is a brace-placeholder template the CLI resolves
 *   server-side (e.g. `"{projectName}.{org.defaultDomain}"`).
 * - `valueRules` declares per-value compatibility rules: for each enum
 *   value of THIS field, list required (`dependencies`) or forbidden
 *   (`incompatibilities`) values on other fields. When a rule fails the
 *   value is presented as disabled with the rule's `reason`.
 */
export interface FieldValueRule {
  dependencies?: Record<string, readonly string[]>;
  incompatibilities?: Record<string, readonly string[]>;
  reason?: string;
}

export interface FieldMeta {
  ui: "text" | "select" | "toggle" | "secret" | "multiselect";
  label: string;
  description?: string;
  secret?: boolean;
  visibleIf?: Record<string, unknown>;
  defaultFrom?: string;
  source?: "orgsToml" | "doppler" | `env:${string}` | `doppler:${string}`;
  valueRules?: Record<string, FieldValueRule>;
}

export const fieldMeta = z.registry<FieldMeta>();

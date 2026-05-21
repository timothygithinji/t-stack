/**
 * Glue between @t-stack/schema and the CLI's interactive flow.
 *
 * - Derives citty args from the schema so adding a field to the schema
 *   automatically extends the CLI.
 * - Walks schema fields and prompts for each via clack, honouring meta.ui /
 *   meta.visibleIf / meta.defaultFrom / meta.source / meta.valueRules.
 *
 * Resolution priority for each field's value:
 *   1. CLI flag (kebab-cased from the field name) — bypasses predicate filtering.
 *   2. meta.source (env var, etc.)
 *   3. meta.defaultFrom (template against already-resolved fields)
 *   4. schema-level default()  (substituted to first ENABLED value when default is disabled)
 *   5. interactive prompt with disabled values filtered + logged.
 */
import * as p from "@clack/prompts";
import {
  type FieldMeta,
  fieldMeta,
  evaluateField,
  walkFields,
} from "@t-stack/schema";
import type { ArgsDef } from "citty";
import { z } from "zod";

/** kebab-case the camelCase field name for CLI flags. */
export function kebabName(field: string): string {
  return field.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Generate citty args from the schema. Includes positional/global flags
 * (`name`, `yes`, `cwd`, `preset`) plus one flag per declared field.
 */
export function buildCittyArgs(): ArgsDef {
  const args: ArgsDef = {
    name: { type: "positional", required: false, description: "Project name" },
    preset: {
      type: "string",
      description:
        "Preset id bundle (e.g., solo-cf-worker, monorepo-cf, custom).",
    },
    yes: {
      type: "boolean",
      description: "Non-interactive — require all args via flags",
    },
    cwd: { type: "string", description: "Parent directory (default: cwd)" },
  };

  // Union the walks across known toggle-visibility states so conditional
  // fields (e.g., hookdeckApiKey behind hookdeck=true, docs behind structure=monorepo)
  // still get a flag. Phase 3 will replace this with a registry walk that ignores visibleIf.
  const seen = new Set<string>(["projectName"]);
  const passes: Record<string, unknown>[] = [
    {},
    { hookdeck: true },
    { structure: "monorepo" },
  ];
  for (const seed of passes) {
    for (const { name, schema, meta } of walkFields(seed)) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      args[kebabName(name)] = {
        type: cittyArgType(schema, meta),
        description: meta.description ?? meta.label,
      };
    }
  }
  return args;
}

function cittyArgType(
  schema: z.ZodTypeAny,
  meta: FieldMeta
): "string" | "boolean" {
  if (meta.ui === "toggle") {
    return "boolean";
  }
  if (schema instanceof z.ZodBoolean) {
    return "boolean";
  }
  return "string";
}

/**
 * Resolve a `{path.parts}` template against a context object. Missing
 * paths render as empty strings.
 */
export function resolveDefaultFrom(
  template: string,
  context: Record<string, unknown>
): string {
  return template.replace(/\{([^}]+)\}/g, (_, path) => {
    const parts = (path as string).split(".");
    let cursor: unknown = context;
    for (const part of parts) {
      if (cursor && typeof cursor === "object" && part in cursor) {
        cursor = (cursor as Record<string, unknown>)[part];
      } else {
        return "";
      }
    }
    return cursor == null ? "" : String(cursor);
  });
}

/** True when every key in `predicate` matches the corresponding `values` entry. */
export function matchesVisibleIf(
  predicate: Record<string, unknown>,
  values: Record<string, unknown>
): boolean {
  return Object.entries(predicate).every(([k, v]) => values[k] === v);
}

/** Read the schema-level default for a field, if any. */
export function defaultOf<T>(schema: z.ZodTypeAny): T | undefined {
  const meta = fieldMeta.get(schema);
  void meta;
  const def = schema._zod?.def;
  if (def && def.type === "default") {
    const wrapped = (def as { defaultValue?: T }).defaultValue;
    return typeof wrapped === "function" ? (wrapped as () => T)() : wrapped;
  }
  return;
}

/**
 * Enum members for a zod enum (handles both `.enum()` and `.enum().default()`,
 * plus `z.array(z.enum(...))` for multiselects).
 */
export function enumChoices(
  schema: z.ZodTypeAny
): readonly string[] | undefined {
  let cursor = schema;
  for (let i = 0; i < 5; i += 1) {
    const def = cursor._zod?.def;
    if (!def) {
      return;
    }
    if (def.type === "enum") {
      const entries = (def as unknown as { entries: Record<string, string> })
        .entries;
      return Object.values(entries);
    }
    if (def.type === "default" || def.type === "optional") {
      cursor = (def as unknown as { innerType: z.ZodTypeAny }).innerType;
      continue;
    }
    if (def.type === "array") {
      cursor = (def as unknown as { element: z.ZodTypeAny }).element;
      continue;
    }
    return;
  }
  return;
}

export type FieldResolver = (input: {
  name: string;
  schema: z.ZodTypeAny;
  meta: FieldMeta;
  flagValue: unknown;
  values: Record<string, unknown>;
  nonInteractive: boolean;
}) => Promise<unknown>;

/**
 * Default resolver: handles flag → defaultFrom → schema default →
 * interactive prompt. Predicate-aware: filters disabled values from
 * select/multiselect prompts and logs the reason. In non-interactive mode,
 * substitutes the schema default with the first enabled value when the default
 * itself is disabled.
 *
 * Explicit flag values bypass predicate filtering — the user gets what they
 * asked for, and `validateDecisions` catches genuine conflicts after the loop.
 */
export const defaultResolver: FieldResolver = async ({
  name,
  schema,
  meta,
  flagValue,
  values,
  nonInteractive,
}) => {
  if (flagValue !== undefined && flagValue !== null && flagValue !== "") {
    return flagValue;
  }
  const computedDefault = meta.defaultFrom
    ? resolveDefaultFrom(meta.defaultFrom, values)
    : undefined;
  const schemaDefault = defaultOf<unknown>(schema);
  const initial = computedDefault ?? schemaDefault;

  // Predicate-aware enum availability (used by select/multiselect rendering
  // and by non-interactive default substitution).
  const choices = enumChoices(schema);
  const availability =
    choices && (meta.ui === "select" || meta.ui === "multiselect")
      ? evaluateField(meta, choices, values)
      : undefined;

  if (nonInteractive) {
    // For enum fields, substitute the schema default with the first enabled
    // value if the default itself is disabled in the current context.
    if (availability && typeof initial === "string") {
      const initialEntry = availability.find((a) => a.value === initial);
      if (initialEntry && !initialEntry.enabled) {
        const fallback = availability.find((a) => a.enabled);
        if (fallback) {
          p.log.info(
            `Substituting --${kebabName(name)}=${fallback.value} (default ${initial} disabled${initialEntry.reason ? `: ${initialEntry.reason}` : ""})`
          );
          return fallback.value;
        }
      }
    }
    if (initial !== undefined && initial !== "") {
      return initial;
    }
    if (meta.ui === "multiselect") {
      return [];
    }
    throw new Error(
      `--yes mode requires --${kebabName(name)} (no default available).`
    );
  }

  // Interactive: render the appropriate clack prompt.
  if (meta.ui === "select") {
    if (!availability) {
      throw new Error(
        `Cannot prompt for select field "${name}": no enum choices found.`
      );
    }
    const enabled = availability.filter((a) => a.enabled);
    const disabled = availability.filter((a) => !a.enabled);
    if (disabled.length > 0) {
      for (const d of disabled) {
        p.log.info(
          `Hiding ${name}=${d.value}${d.reason ? ` (reason: ${d.reason})` : ""}`
        );
      }
    }
    if (enabled.length === 0) {
      throw new Error(
        `No selectable values for "${name}" given current decisions.`
      );
    }
    let initialValue: string | undefined;
    if (
      typeof initial === "string" &&
      enabled.some((e) => e.value === initial)
    ) {
      initialValue = initial;
    } else {
      initialValue = enabled[0]?.value;
    }
    const v = await p.select({
      message: meta.label,
      options: enabled.map((e) => ({ value: e.value, label: e.value })),
      initialValue,
    });
    if (p.isCancel(v)) {
      throw new Error("Cancelled.");
    }
    return v;
  }
  if (meta.ui === "multiselect") {
    if (!availability) {
      throw new Error(
        `Cannot prompt for multiselect field "${name}": no enum choices found.`
      );
    }
    const enabled = availability.filter((a) => a.enabled);
    const disabled = availability.filter((a) => !a.enabled);
    if (disabled.length > 0) {
      for (const d of disabled) {
        p.log.info(
          `Hiding ${name}=${d.value}${d.reason ? ` (reason: ${d.reason})` : ""}`
        );
      }
    }
    const initialValues = Array.isArray(initial)
      ? (initial as string[]).filter((iv) =>
          enabled.some((e) => e.value === iv)
        )
      : [];
    const v = await p.multiselect({
      message: meta.label,
      options: enabled.map((e) => ({ value: e.value, label: e.value })),
      initialValues,
      required: false,
    });
    if (p.isCancel(v)) {
      throw new Error("Cancelled.");
    }
    return v;
  }
  if (meta.ui === "toggle") {
    const v = await p.confirm({
      message: meta.label,
      initialValue: typeof initial === "boolean" ? initial : false,
    });
    if (p.isCancel(v)) {
      throw new Error("Cancelled.");
    }
    return v;
  }
  if (meta.ui === "secret") {
    const v = await p.password({ message: meta.label });
    if (p.isCancel(v)) {
      throw new Error("Cancelled.");
    }
    return v;
  }
  // text
  const v = await p.text({
    message: meta.label,
    initialValue: typeof initial === "string" ? initial : undefined,
    placeholder: meta.description,
  });
  if (p.isCancel(v)) {
    throw new Error("Cancelled.");
  }
  return v;
};

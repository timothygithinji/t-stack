/**
 * Glue between @t-stack/schema and the CLI's interactive flow.
 *
 * - Derives citty args from the schema so adding a field to the schema
 *   automatically extends the CLI.
 * - Walks schema fields and prompts for each via clack, honouring meta.ui /
 *   meta.visibleIf / meta.defaultFrom / meta.source.
 *
 * Resolution priority for each field's value:
 *   1. CLI flag (kebab-cased from the field name)
 *   2. meta.source (env var, etc.)
 *   3. meta.defaultFrom (template against already-resolved fields)
 *   4. schema-level default()
 *   5. interactive prompt (skipped when --yes)
 */
import * as p from "@clack/prompts";
import {
  type Archetype,
  type FieldMeta,
  fieldMeta,
  fieldsForArchetype,
} from "@t-stack/schema";
import type { ArgsDef } from "citty";
import { z } from "zod";

const ARCHETYPES = [
  "solo-cf-worker",
  "monorepo-cf",
] as const satisfies readonly Archetype[];

/** kebab-case the camelCase field name for CLI flags. */
export function kebabName(field: string): string {
  return field.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Generate citty args from the schema. Includes positional/global flags
 * (`name`, `yes`, `cwd`) plus one flag per declared field.
 */
export function buildCittyArgs(): ArgsDef {
  const args: ArgsDef = {
    name: { type: "positional", required: false, description: "Project name" },
    archetype: { type: "string", description: ARCHETYPES.join(" | ") },
    yes: {
      type: "boolean",
      description: "Non-interactive — require all args via flags",
    },
    cwd: { type: "string", description: "Parent directory (default: cwd)" },
  };

  // Union both archetype variants so every possible flag is documented.
  const seen = new Set<string>(["archetype"]);
  for (const archetype of ARCHETYPES) {
    for (const { name, schema, meta } of fieldsForArchetype(archetype)) {
      if (seen.has(name) || name === "projectName") {
        // projectName is the positional "name" arg.
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
 * Enum members for a zod enum (handles both `.enum()` and `.enum().default()`).
 */
export function enumChoices(
  schema: z.ZodTypeAny
): readonly string[] | undefined {
  let cursor = schema;
  for (let i = 0; i < 4; i += 1) {
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
 * interactive prompt. Callers can override for special cases
 * (e.g. multi-source fallback chains).
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

  if (nonInteractive) {
    if (initial !== undefined && initial !== "") {
      return initial;
    }
    throw new Error(
      `--yes mode requires --${kebabName(name)} (no default available).`
    );
  }

  // Interactive: render the appropriate clack prompt.
  if (meta.ui === "select") {
    const choices = enumChoices(schema);
    if (!choices) {
      throw new Error(
        `Cannot prompt for select field "${name}": no enum choices found.`
      );
    }
    const v = await p.select({
      message: meta.label,
      options: choices.map((c) => ({ value: c, label: c })),
      initialValue: typeof initial === "string" ? initial : undefined,
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

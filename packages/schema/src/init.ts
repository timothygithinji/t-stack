import { z } from "zod";
import { type FieldMeta, fieldMeta } from "./meta.js";

const projectName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes only")
  .register(fieldMeta, {
    ui: "text",
    label: "Project name",
    description: "lowercase letters, digits, and dashes only",
  });

const org = z.string().min(1).register(fieldMeta, {
  ui: "select",
  label: "Org",
  description: "Org slug from ~/.t-stack/orgs.toml",
  source: "orgsToml",
});

const domain = z.string().min(1).register(fieldMeta, {
  ui: "text",
  label: "Domain",
  description:
    "Fully-qualified domain. Defaults to <name>.<org.defaultDomain>.",
  defaultFrom: "{projectName}.{org.defaultDomain}",
});

const envs = z
  .enum(["prd", "dev+prd", "dev+stg+prd"])
  .default("prd")
  .register(fieldMeta, {
    ui: "select",
    label: "Environments",
  });

const trigger = z.boolean().default(true).register(fieldMeta, {
  ui: "toggle",
  label: "Enable Trigger.dev?",
});

const access = z.boolean().default(false).register(fieldMeta, {
  ui: "toggle",
  label: "Protect with Cloudflare Access?",
});

const hookdeck = z.boolean().default(false).register(fieldMeta, {
  ui: "toggle",
  label: "Add Hookdeck for webhooks?",
});

const hookdeckApiKey = z
  .string()
  .optional()
  .register(fieldMeta, {
    ui: "secret",
    label: "Hookdeck API key",
    description:
      "Per-project. CLI falls back to $HOOKDECK_API_KEY, then Doppler.",
    secret: true,
    visibleIf: { hookdeck: true },
    source: "env:HOOKDECK_API_KEY",
  });

const soloDatabase = z
  .enum(["neon", "turso"])
  .default("neon")
  .register(fieldMeta, {
    ui: "select",
    label: "Database",
  });

const soloSchema = z.object({
  archetype: z.literal("solo-cf-worker"),
  projectName,
  org,
  domain,
  database: soloDatabase,
  envs,
  trigger,
  access,
  hookdeck,
  hookdeckApiKey,
});

const monoSchema = z.object({
  archetype: z.literal("monorepo-cf"),
  projectName,
  org,
  domain,
  envs,
  trigger,
  access,
  hookdeck,
  hookdeckApiKey,
});

export const initSchema = z.discriminatedUnion("archetype", [
  soloSchema,
  monoSchema,
]);

export type InitDecisions = z.infer<typeof initSchema>;
export type Archetype = InitDecisions["archetype"];
export type EnvScope = z.infer<typeof envs>;
export type Database = z.infer<typeof soloDatabase>;

/**
 * Returns the database for any archetype. Mono is implicitly neon — the schema
 * doesn't carry a `database` field on it, but downstream code (template vars,
 * scaffold.ts) needs a value either way.
 */
export function effectiveDatabase(d: InitDecisions): Database {
  if (d.archetype === "monorepo-cf") {
    return "neon";
  }
  return d.database;
}

/**
 * Walk the schema and return every field's [path, zod schema, meta] tuple,
 * in declaration order. Used by the CLI to build citty args / clack prompts,
 * and by the web app to render form fields.
 *
 * The walk respects the active archetype: when `archetype` is `solo-cf-worker`
 * the result includes `database`, otherwise it doesn't.
 */
export function fieldsForArchetype(archetype: Archetype): Array<{
  name: string;
  schema: z.ZodTypeAny;
  meta: FieldMeta;
}> {
  const variant = archetype === "solo-cf-worker" ? soloSchema : monoSchema;
  const shape = variant.shape;
  const result: Array<{
    name: string;
    schema: z.ZodTypeAny;
    meta: FieldMeta;
  }> = [];
  for (const [name, schema] of Object.entries(shape)) {
    if (name === "archetype") {
      continue;
    }
    const meta = fieldMeta.get(schema as z.ZodTypeAny);
    if (!meta) {
      continue;
    }
    result.push({ name, schema: schema as z.ZodTypeAny, meta });
  }
  return result;
}

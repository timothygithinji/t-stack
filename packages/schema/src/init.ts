import { z } from "zod";
import { fieldMeta } from "./meta.js";
import { isFieldVisible } from "./predicates.js";

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

const structure = z
  .enum(["single", "monorepo"])
  .default("single")
  .register(fieldMeta, {
    ui: "select",
    label: "Project structure",
    description: "Single app or monorepo with multiple workspaces.",
  });

const cloudProvider = z
  .enum(["cloudflare", "none"])
  .default("cloudflare")
  .register(fieldMeta, {
    ui: "select",
    label: "Cloud provider",
    valueRules: {
      cloudflare: {
        dependencies: { runtime: ["workers"] },
        reason: "Cloudflare cloud provider requires Workers runtime.",
      },
    },
  });

const iac = z
  .enum(["pulumi", "none"])
  .default("pulumi")
  .register(fieldMeta, {
    ui: "select",
    label: "Infrastructure as code",
    valueRules: {
      pulumi: {
        dependencies: { cloudProvider: ["cloudflare"] },
        reason: "Pulumi needs a cloud provider.",
      },
    },
  });

const runtime = z
  .enum(["workers", "node", "bun", "none"])
  .default("workers")
  .register(fieldMeta, {
    ui: "select",
    label: "Runtime",
    valueRules: {
      workers: {
        dependencies: { cloudProvider: ["cloudflare"] },
        reason: "Workers runtime requires Cloudflare.",
      },
    },
  });

const frontend = z
  .enum(["tanstack-start", "tanstack-router", "astro", "none"])
  .default("none")
  .register(fieldMeta, {
    ui: "select",
    label: "Frontend",
  });

const backend = z
  .enum(["hono", "tanstack-start", "none"])
  .default("hono")
  .register(fieldMeta, {
    ui: "select",
    label: "Backend",
    valueRules: {
      hono: {
        incompatibilities: { runtime: ["none"] },
        reason: "Hono needs a non-none runtime.",
      },
      "tanstack-start": {
        dependencies: { frontend: ["tanstack-start"] },
        reason: "tanstack-start backend requires the tanstack-start frontend.",
      },
    },
  });

const docs = z
  .enum(["starlight", "none"])
  .default("none")
  .register(fieldMeta, {
    ui: "select",
    label: "Docs site",
    visibleIf: { structure: "monorepo" },
    valueRules: {
      starlight: {
        dependencies: { structure: ["monorepo"] },
        reason: "Docs site lives at apps/docs in monorepo.",
      },
    },
  });

const api = z
  .enum(["orpc", "none"])
  .default("none")
  .register(fieldMeta, {
    ui: "select",
    label: "API style",
    valueRules: {
      orpc: {
        dependencies: { backend: ["hono", "tanstack-start"] },
        reason: "API style requires a backend.",
      },
    },
  });

const database = z
  .enum(["postgres", "sqlite", "none"])
  .default("postgres")
  .register(fieldMeta, {
    ui: "select",
    label: "Database",
  });

const databaseHost = z
  .enum(["neon", "turso", "d1", "none"])
  .default("neon")
  .register(fieldMeta, {
    ui: "select",
    label: "Database host",
    valueRules: {
      neon: {
        dependencies: { database: ["postgres"] },
        reason: "Neon hosts Postgres.",
      },
      turso: {
        dependencies: { database: ["sqlite"] },
        reason: "Turso hosts SQLite.",
      },
      d1: {
        dependencies: {
          database: ["sqlite"],
          cloudProvider: ["cloudflare"],
        },
        reason: "D1 is a Cloudflare SQLite service.",
      },
    },
  });

const databaseRegion = z
  .string()
  .default("aws-us-east-1")
  .register(fieldMeta, {
    ui: "select",
    label: "Database region",
    description: "Neon region for the project (fetched live)",
    visibleIf: { databaseHost: "neon" },
    source: "neon:regions",
  });

const orm = z
  .enum(["drizzle", "none"])
  .default("drizzle")
  .register(fieldMeta, {
    ui: "select",
    label: "ORM",
    valueRules: {
      drizzle: {
        dependencies: { database: ["postgres", "sqlite"] },
        reason: "Drizzle needs a database.",
      },
    },
  });

const auth = z
  .enum(["better-auth", "none"])
  .default("better-auth")
  .register(fieldMeta, {
    ui: "select",
    label: "Auth",
    valueRules: {
      "better-auth": {
        dependencies: {
          database: ["postgres", "sqlite"],
          orm: ["drizzle"],
        },
        reason: "Better Auth needs a database + ORM.",
      },
    },
  });

const storage = z
  .enum(["r2", "tigris", "none"])
  .default("none")
  .register(fieldMeta, {
    ui: "select",
    label: "Object storage",
    valueRules: {
      r2: {
        dependencies: { cloudProvider: ["cloudflare"] },
        reason: "R2 is a Cloudflare service.",
      },
    },
  });

const payments = z
  .enum(["stripe", "none"])
  .default("none")
  .register(fieldMeta, {
    ui: "select",
    label: "Payments",
  });

const addons = z
  .array(
    z.enum([
      "biome",
      "husky",
      "turborepo",
      "fallow",
      "commitlint",
      "release-it",
      "ultracite",
    ])
  )
  .default([])
  .register(fieldMeta, {
    ui: "multiselect",
    label: "Addons",
    valueRules: {
      turborepo: {
        dependencies: { structure: ["monorepo"] },
        reason: "Turborepo is for monorepos.",
      },
    },
  });

const packageManager = z
  .enum(["bun", "pnpm"])
  .default("bun")
  .register(fieldMeta, {
    ui: "select",
    label: "Package manager",
  });

const git = z.boolean().default(true).register(fieldMeta, {
  ui: "toggle",
  label: "Initialize git repo?",
});

const install = z.boolean().default(true).register(fieldMeta, {
  ui: "toggle",
  label: "Install dependencies?",
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

export const initSchema = z.object({
  projectName,
  org,
  domain,
  structure,
  cloudProvider,
  iac,
  runtime,
  frontend,
  backend,
  docs,
  api,
  database,
  databaseHost,
  databaseRegion,
  orm,
  auth,
  storage,
  payments,
  addons,
  packageManager,
  git,
  install,
  envs,
  trigger,
  access,
  hookdeck,
  hookdeckApiKey,
});

export type InitDecisions = z.infer<typeof initSchema>;
export type EnvScope = z.infer<typeof envs>;

/**
 * Walk the schema and return every visible field's [name, zod schema, meta]
 * tuple, in declaration order. Fields whose `visibleIf` predicate fails
 * against `decisions` are skipped.
 */
export function walkFields(decisions: Record<string, unknown>): Array<{
  name: string;
  schema: z.ZodTypeAny;
  meta: import("./meta.js").FieldMeta;
}> {
  const result: Array<{
    name: string;
    schema: z.ZodTypeAny;
    meta: import("./meta.js").FieldMeta;
  }> = [];
  for (const [name, schema] of Object.entries(initSchema.shape)) {
    const meta = fieldMeta.get(schema as z.ZodTypeAny);
    if (!meta) {
      continue;
    }
    if (!isFieldVisible(meta, decisions)) {
      continue;
    }
    result.push({ name, schema: schema as z.ZodTypeAny, meta });
  }
  return result;
}

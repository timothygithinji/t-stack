import { describe, expect, it } from "vitest";
import {
  evaluateField,
  fieldMeta,
  initSchema,
  isFieldVisible,
  validateDecisions,
  walkFields,
} from "../src/index.js";

const CLOUDFLARE_REASON_RE = /Cloudflare/i;
const POSTGRES_REASON_RE = /Postgres/i;

const basePayload = {
  projectName: "my-app",
  org: "personal",
  domain: "my-app.example.com",
  structure: "single" as const,
  cloudProvider: "cloudflare" as const,
  iac: "pulumi" as const,
  runtime: "workers" as const,
  frontend: "none" as const,
  backend: "hono" as const,
  docs: "none" as const,
  api: "none" as const,
  database: "postgres" as const,
  databaseHost: "neon" as const,
  orm: "drizzle" as const,
  auth: "better-auth" as const,
  storage: "none" as const,
  payments: "none" as const,
  addons: [],
  packageManager: "bun" as const,
  git: true,
  install: true,
  envs: "prd" as const,
  trigger: true,
  access: false,
  hookdeck: false,
};

describe("initSchema", () => {
  it("parses a valid full payload", () => {
    const parsed = initSchema.parse(basePayload);
    expect(parsed.projectName).toBe("my-app");
    expect(parsed.runtime).toBe("workers");
    expect(parsed.databaseHost).toBe("neon");
  });

  it("rejects an invalid project name", () => {
    const result = initSchema.safeParse({
      ...basePayload,
      projectName: "Has Spaces",
    });
    expect(result.success).toBe(false);
  });

  it("applies enum defaults when fields are omitted", () => {
    const parsed = initSchema.parse({
      projectName: "my-app",
      org: "personal",
      domain: "my-app.example.com",
    });
    expect(parsed.structure).toBe("single");
    expect(parsed.runtime).toBe("workers");
    expect(parsed.database).toBe("postgres");
    expect(parsed.addons).toEqual([]);
  });
});

describe("walkFields", () => {
  it("returns visible fields in declaration order", () => {
    const names = walkFields(basePayload).map((f) => f.name);
    expect(names[0]).toBe("projectName");
    const structureIdx = names.indexOf("structure");
    const runtimeIdx = names.indexOf("runtime");
    expect(structureIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeGreaterThan(structureIdx);
  });

  it("attaches ui+label meta to every field", () => {
    for (const { name, meta } of walkFields(basePayload)) {
      expect(meta.ui, `field ${name} missing ui`).toBeTruthy();
      expect(meta.label, `field ${name} missing label`).toBeTruthy();
    }
  });
});

describe("isFieldVisible", () => {
  it("hides docs when structure=single", () => {
    const docsSchema = initSchema.shape.docs;
    const meta = fieldMeta.get(docsSchema);
    expect(meta).toBeDefined();
    if (!meta) {
      return;
    }
    expect(isFieldVisible(meta, { structure: "single" })).toBe(false);
    expect(isFieldVisible(meta, { structure: "monorepo" })).toBe(true);
  });

  it("keeps hookdeckApiKey visibleIf {hookdeck: true}", () => {
    const schema = initSchema.shape.hookdeckApiKey;
    const meta = fieldMeta.get(schema);
    expect(meta?.visibleIf).toEqual({ hookdeck: true });
  });
});

describe("evaluateField", () => {
  it("disables runtime=workers when cloudProvider=none", () => {
    const meta = fieldMeta.get(initSchema.shape.runtime);
    expect(meta).toBeDefined();
    if (!meta) {
      return;
    }
    const availability = evaluateField(
      meta,
      ["workers", "node", "bun", "none"],
      { cloudProvider: "none" }
    );
    const workers = availability.find((a) => a.value === "workers");
    expect(workers?.enabled).toBe(false);
    expect(workers?.reason).toMatch(CLOUDFLARE_REASON_RE);
    const node = availability.find((a) => a.value === "node");
    expect(node?.enabled).toBe(true);
  });

  it("treats undecided dependent fields as satisfied", () => {
    const meta = fieldMeta.get(initSchema.shape.runtime);
    if (!meta) {
      throw new Error("missing runtime meta");
    }
    const availability = evaluateField(
      meta,
      ["workers", "node", "bun", "none"],
      {}
    );
    expect(availability.every((a) => a.enabled)).toBe(true);
  });

  it("disables turborepo addon when structure=single", () => {
    const meta = fieldMeta.get(initSchema.shape.addons);
    if (!meta) {
      throw new Error("missing addons meta");
    }
    const availability = evaluateField(meta, ["biome", "turborepo", "husky"], {
      structure: "single",
    });
    const turbo = availability.find((a) => a.value === "turborepo");
    expect(turbo?.enabled).toBe(false);
  });
});

describe("validateDecisions", () => {
  it("flags databaseHost=neon with database=sqlite", () => {
    const violations = validateDecisions(initSchema, {
      ...basePayload,
      database: "sqlite",
      databaseHost: "neon",
    });
    const v = violations.find(
      (x) => x.field === "databaseHost" && x.value === "neon"
    );
    expect(v).toBeDefined();
    expect(v?.conflict).toMatch(POSTGRES_REASON_RE);
  });

  it("returns no violations for a self-consistent payload", () => {
    const violations = validateDecisions(initSchema, basePayload);
    expect(violations).toEqual([]);
  });

  it("flags backend=tanstack-start with runtime=workers", () => {
    const violations = validateDecisions(initSchema, {
      ...basePayload,
      backend: "tanstack-start",
      runtime: "workers",
    });
    expect(
      violations.some(
        (v) => v.field === "backend" && v.value === "tanstack-start"
      )
    ).toBe(true);
  });
});

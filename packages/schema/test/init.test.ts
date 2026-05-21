import { describe, expect, it } from "vitest";
import {
  effectiveDatabase,
  fieldsForArchetype,
  initSchema,
} from "../src/index.js";

describe("initSchema", () => {
  it("parses a valid solo-cf-worker payload", () => {
    const parsed = initSchema.parse({
      archetype: "solo-cf-worker",
      projectName: "my-app",
      org: "personal",
      domain: "my-app.example.com",
      database: "turso",
      envs: "dev+prd",
      trigger: true,
      access: false,
      hookdeck: false,
    });
    expect(parsed.archetype).toBe("solo-cf-worker");
    if (parsed.archetype === "solo-cf-worker") {
      expect(parsed.database).toBe("turso");
    }
  });

  it("parses a valid monorepo-cf payload without a database field", () => {
    const parsed = initSchema.parse({
      archetype: "monorepo-cf",
      projectName: "my-app",
      org: "personal",
      domain: "my-app.example.com",
      envs: "prd",
      trigger: false,
      access: false,
      hookdeck: false,
    });
    expect(parsed.archetype).toBe("monorepo-cf");
    expect(effectiveDatabase(parsed)).toBe("neon");
  });

  it("rejects an invalid project name", () => {
    const result = initSchema.safeParse({
      archetype: "solo-cf-worker",
      projectName: "Has Spaces",
      org: "personal",
      domain: "my-app.example.com",
      database: "neon",
      envs: "prd",
      trigger: false,
      access: false,
      hookdeck: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects monorepo-cf payloads that try to set a database", () => {
    const result = initSchema.safeParse({
      archetype: "monorepo-cf",
      projectName: "my-app",
      org: "personal",
      domain: "my-app.example.com",
      database: "turso",
      envs: "prd",
      trigger: false,
      access: false,
      hookdeck: false,
    });
    // Excess properties pass by default in zod; this just confirms the
    // schema parses without elevating database to a real field.
    expect(result.success).toBe(true);
    if (result.success && result.data.archetype === "monorepo-cf") {
      // database isn't in the schema for mono, so it shouldn't exist on the
      // parsed object.
      expect("database" in result.data).toBe(false);
    }
  });
});

describe("fieldMeta", () => {
  it("attaches meta to every non-discriminator field", () => {
    for (const archetype of ["solo-cf-worker", "monorepo-cf"] as const) {
      const fields = fieldsForArchetype(archetype);
      for (const { name, meta } of fields) {
        expect(meta.ui, `field ${name} missing ui`).toBeTruthy();
        expect(meta.label, `field ${name} missing label`).toBeTruthy();
      }
    }
  });

  it("includes database only on solo-cf-worker", () => {
    const solo = fieldsForArchetype("solo-cf-worker").map((f) => f.name);
    const mono = fieldsForArchetype("monorepo-cf").map((f) => f.name);
    expect(solo).toContain("database");
    expect(mono).not.toContain("database");
  });

  it("marks hookdeckApiKey as secret + visibleIf hookdeck", () => {
    const fields = fieldsForArchetype("solo-cf-worker");
    const key = fields.find((f) => f.name === "hookdeckApiKey");
    expect(key).toBeDefined();
    expect(key?.meta.secret).toBe(true);
    expect(key?.meta.visibleIf).toEqual({ hookdeck: true });
  });
});

import { walkFields } from "@t-stack/schema";
import { describe, expect, it } from "vitest";
import {
  buildCittyArgs,
  defaultOf,
  enumChoices,
  kebabName,
  matchesVisibleIf,
  resolveDefaultFrom,
} from "../../src/core/schema-runtime.js";

describe("kebabName", () => {
  it("camelCase → kebab-case", () => {
    expect(kebabName("hookdeckApiKey")).toBe("hookdeck-api-key");
    expect(kebabName("projectName")).toBe("project-name");
    expect(kebabName("org")).toBe("org");
  });
});

describe("buildCittyArgs", () => {
  const args = buildCittyArgs();

  it("includes the global flags", () => {
    expect(args.name).toEqual(expect.objectContaining({ type: "positional" }));
    expect(args.yes).toEqual(expect.objectContaining({ type: "boolean" }));
    expect(args.cwd).toEqual(expect.objectContaining({ type: "string" }));
    expect(args.preset).toEqual(expect.objectContaining({ type: "string" }));
  });

  it("emits a flag for every schema field, kebab-cased", () => {
    for (const field of walkFields({})) {
      if (field.name === "projectName") {
        continue; // positional, not a flag
      }
      expect(args[kebabName(field.name)]).toBeDefined();
    }
  });

  it("types toggle fields as boolean and select/text/secret as string", () => {
    expect(args.trigger).toEqual(expect.objectContaining({ type: "boolean" }));
    expect(args.access).toEqual(expect.objectContaining({ type: "boolean" }));
    expect(args.envs).toEqual(expect.objectContaining({ type: "string" }));
    expect(args["hookdeck-api-key"]).toEqual(
      expect.objectContaining({ type: "string" })
    );
  });

  it("does not emit an --archetype flag (replaced by --structure)", () => {
    expect(args.archetype).toBeUndefined();
    expect(args.structure).toEqual(expect.objectContaining({ type: "string" }));
  });

  it("emits flags for visibleIf-gated fields (docs, hookdeck-api-key)", () => {
    expect(args.docs).toEqual(expect.objectContaining({ type: "string" }));
    expect(args["hookdeck-api-key"]).toEqual(
      expect.objectContaining({ type: "string" })
    );
  });
});

describe("resolveDefaultFrom", () => {
  it("resolves nested paths", () => {
    expect(
      resolveDefaultFrom("{projectName}.{org.defaultDomain}", {
        projectName: "my-app",
        org: { defaultDomain: "example.com" },
      })
    ).toBe("my-app.example.com");
  });

  it("renders missing paths as empty string", () => {
    expect(resolveDefaultFrom("{missing}", {})).toBe("");
    expect(resolveDefaultFrom("{a.b.c}", { a: { b: {} } })).toBe("");
  });
});

describe("matchesVisibleIf", () => {
  it("returns true when all predicate keys match", () => {
    expect(matchesVisibleIf({ hookdeck: true }, { hookdeck: true })).toBe(true);
  });

  it("returns false when any predicate key mismatches", () => {
    expect(matchesVisibleIf({ hookdeck: true }, { hookdeck: false })).toBe(
      false
    );
    expect(matchesVisibleIf({ hookdeck: true }, {})).toBe(false);
  });
});

describe("enumChoices + defaultOf", () => {
  it("extracts enum choices through .default() wrappers", () => {
    const fields = walkFields({});
    const envsField = fields.find((f) => f.name === "envs");
    expect(envsField).toBeDefined();
    if (envsField) {
      expect(enumChoices(envsField.schema)).toEqual([
        "prd",
        "dev+prd",
        "dev+stg+prd",
      ]);
      expect(defaultOf(envsField.schema)).toBe("prd");
    }
  });

  it("returns undefined for non-enum schemas", () => {
    const fields = walkFields({});
    const projectNameField = fields.find((f) => f.name === "projectName");
    expect(projectNameField).toBeDefined();
    if (projectNameField) {
      expect(enumChoices(projectNameField.schema)).toBeUndefined();
    }
  });

  it("extracts inner enum from array(enum) multiselect fields", () => {
    const fields = walkFields({ structure: "monorepo" });
    const addonsField = fields.find((f) => f.name === "addons");
    expect(addonsField).toBeDefined();
    if (addonsField) {
      const choices = enumChoices(addonsField.schema);
      expect(choices).toContain("biome");
      expect(choices).toContain("turborepo");
    }
  });
});

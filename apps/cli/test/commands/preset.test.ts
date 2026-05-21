import { resolve } from "pathe";
import { describe, expect, it } from "vitest";
import { listPresetIds, loadPreset } from "../../src/commands/_ctx.js";

const CLI_ROOT = resolve(import.meta.dirname, "..", "..");

describe("loadPreset", () => {
  it("loads single-cloudflare with the expected defaults", async () => {
    const preset = await loadPreset("single-cloudflare", CLI_ROOT);
    expect(preset.id).toBe("single-cloudflare");
    expect(preset.name).toBe("Single (Cloudflare)");
    expect(preset.defaults.structure).toBe("single");
    expect(preset.defaults.cloudProvider).toBe("cloudflare");
    expect(preset.defaults.runtime).toBe("workers");
    expect(preset.defaults.databaseHost).toBe("neon");
    expect(typeof preset.run).toBe("function");
  });

  it("loads monorepo-cloudflare with the expected defaults", async () => {
    const preset = await loadPreset("monorepo-cloudflare", CLI_ROOT);
    expect(preset.id).toBe("monorepo-cloudflare");
    expect(preset.name).toBe("Monorepo (Cloudflare)");
    expect(preset.defaults.structure).toBe("monorepo");
    expect(preset.defaults.docs).toBe("starlight");
    expect(preset.defaults.addons).toEqual(
      expect.arrayContaining(["turborepo", "biome"])
    );
  });

  it("throws with the available presets when the id is unknown", async () => {
    await expect(loadPreset("does-not-exist", CLI_ROOT)).rejects.toThrow(
      /does-not-exist.*Available: monorepo-cloudflare, single-cloudflare/s
    );
  });
});

describe("listPresetIds", () => {
  it("returns the known preset ids in sorted order, skipping _base", async () => {
    const ids = await listPresetIds(CLI_ROOT);
    expect(ids).toEqual(["monorepo-cloudflare", "single-cloudflare"]);
    expect(ids).not.toContain("_base");
  });
});

describe("preset defaults precede prompt-loop initial state", () => {
  it("preset.defaults supplies initial values that the prompt loop reads as 'already resolved'", async () => {
    // Sanity check: confirms the prompt-loop seeding rule documented in init.ts.
    // We don't import the entire init command (it pulls in clack/citty side
    // effects); instead we replicate the seeding logic.
    const preset = await loadPreset("single-cloudflare", CLI_ROOT);
    const values: Record<string, unknown> = {
      ...(preset.defaults ?? {}),
      org: "fanya-labs",
    };
    expect(values.structure).toBe("single");
    expect(values.frontend).toBe("tanstack-router");
    expect(values.api).toBe("orpc");
    // Marking preset-supplied keys as resolved should pre-skip them.
    const resolvedKeys = new Set([
      "org",
      ...Object.keys(preset.defaults ?? {}),
    ]);
    expect(resolvedKeys.has("structure")).toBe(true);
    expect(resolvedKeys.has("api")).toBe(true);
    expect(resolvedKeys.has("projectName")).toBe(false);
  });
});

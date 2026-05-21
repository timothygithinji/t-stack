import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "pathe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub execa so any `bun install` in scaffold is a no-op even when not skipped.
const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
}));
vi.mock("execa", () => ({ execa: execaMock }));

// Provide an in-memory orgs store so we don't depend on ~/.t-stack/orgs.toml.
const { listMock, getMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getMock: vi.fn(),
}));
vi.mock("../../src/core/orgs.js", () => ({
  createOrgsStore: () => ({
    list: listMock,
    get: getMock,
    add: vi.fn(),
    remove: vi.fn(),
  }),
}));

import { runScaffold } from "../../src/commands/scaffold.js";
import { defaultDecisions, defaultOrg, makeTempDir } from "../_helpers.js";

const CLI_ROOT = resolve(import.meta.dirname, "..", "..");

describe("runScaffold fragment composition", () => {
  beforeEach(() => {
    execaMock.mockReset();
    execaMock.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    listMock.mockReset();
    getMock.mockReset();
    const org = defaultOrg();
    listMock.mockResolvedValue([org]);
    getMock.mockImplementation(async (name: string) =>
      name === org.name ? org : undefined
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("storage=none produces no docker-compose.yml", async () => {
    const cwd = await makeTempDir("scaffold-frag-storage-none-");
    const decisions = defaultDecisions({
      projectName: "no-storage",
      storage: "none",
      hookdeck: false,
      trigger: false,
    });

    const { destDir, filesWritten } = await runScaffold({
      cwd,
      decisions,
      presetId: "solo-cf-worker",
      cliRoot: CLI_ROOT,
      skipInstall: true,
    });

    expect(filesWritten).toBeGreaterThan(0);
    expect(existsSync(join(destDir, "docker-compose.yml"))).toBe(false);
  });

  it("storage=r2 lays down docker-compose.yml with MinIO from the storage/r2 fragment", async () => {
    const cwd = await makeTempDir("scaffold-frag-storage-r2-");
    const decisions = defaultDecisions({
      projectName: "with-r2",
      storage: "r2",
      hookdeck: false,
      trigger: false,
    });

    const { destDir } = await runScaffold({
      cwd,
      decisions,
      presetId: "solo-cf-worker",
      cliRoot: CLI_ROOT,
      skipInstall: true,
    });

    const composePath = join(destDir, "docker-compose.yml");
    expect(existsSync(composePath)).toBe(true);
    const content = await readFile(composePath, "utf8");
    expect(content).toMatch(/minio/i);
    // Templated projectName is interpolated.
    expect(content).toContain("with-r2-minio");
  });

  it("storage=tigris lays down the tigris fragment (README stub, no docker-compose)", async () => {
    const cwd = await makeTempDir("scaffold-frag-storage-tigris-");
    const decisions = defaultDecisions({
      projectName: "with-tigris",
      storage: "tigris",
      hookdeck: false,
      trigger: false,
    });

    const { destDir } = await runScaffold({
      cwd,
      decisions,
      presetId: "solo-cf-worker",
      cliRoot: CLI_ROOT,
      skipInstall: true,
    });

    expect(existsSync(join(destDir, "docker-compose.yml"))).toBe(false);
    // Tigris fragment ships a placeholder README at the project root.
    expect(existsSync(join(destDir, "README.md"))).toBe(true);
  });

  it("hookdeck=true emits infra/hookdeck/* from the fragment (not the legacy programmatic copy)", async () => {
    const cwd = await makeTempDir("scaffold-frag-hookdeck-on-");
    const decisions = defaultDecisions({
      projectName: "with-hd",
      hookdeck: true,
      storage: "none",
      trigger: false,
    });

    const { destDir } = await runScaffold({
      cwd,
      decisions,
      presetId: "solo-cf-worker",
      cliRoot: CLI_ROOT,
      skipInstall: true,
    });

    expect(existsSync(join(destDir, "infra", "hookdeck", "package.json"))).toBe(
      true
    );
    expect(existsSync(join(destDir, "infra", "hookdeck", "Pulumi.yaml"))).toBe(
      true
    );
    expect(
      existsSync(join(destDir, "infra", "hookdeck", "src", "index.ts"))
    ).toBe(true);
    // SDK was previously copied programmatically from templates/_assets; it
    // now ships inside the hookdeck/true fragment.
    expect(
      existsSync(
        join(destDir, "infra", "hookdeck", "sdks", "hookdeck", "index.ts")
      )
    ).toBe(true);
    // Project name is interpolated into the fragment files.
    const pkg = await readFile(
      join(destDir, "infra", "hookdeck", "package.json"),
      "utf8"
    );
    expect(pkg).toContain("with-hd-hookdeck-infra");
  });

  it("hookdeck=false produces no infra/hookdeck/ tree", async () => {
    const cwd = await makeTempDir("scaffold-frag-hookdeck-off-");
    const decisions = defaultDecisions({
      projectName: "no-hd",
      hookdeck: false,
      storage: "none",
      trigger: false,
    });

    const { destDir } = await runScaffold({
      cwd,
      decisions,
      presetId: "solo-cf-worker",
      cliRoot: CLI_ROOT,
      skipInstall: true,
    });

    expect(existsSync(join(destDir, "infra", "hookdeck", "package.json"))).toBe(
      false
    );
    expect(
      existsSync(join(destDir, "infra", "hookdeck", "sdks", "hookdeck"))
    ).toBe(false);
  });

  it("trigger=true emits trigger.config.ts at the project root via the trigger/true fragment", async () => {
    const cwd = await makeTempDir("scaffold-frag-trigger-on-");
    const decisions = defaultDecisions({
      projectName: "trg",
      hookdeck: false,
      storage: "none",
      trigger: true,
    });

    const { destDir } = await runScaffold({
      cwd,
      decisions,
      presetId: "solo-cf-worker",
      cliRoot: CLI_ROOT,
      skipInstall: true,
    });

    const triggerPath = join(destDir, "trigger.config.ts");
    expect(existsSync(triggerPath)).toBe(true);
    const content = await readFile(triggerPath, "utf8");
    expect(content).toContain('project: "trg"');
  });

  it("trigger=false produces no trigger.config.ts", async () => {
    const cwd = await makeTempDir("scaffold-frag-trigger-off-");
    const decisions = defaultDecisions({
      projectName: "no-trg",
      hookdeck: false,
      storage: "none",
      trigger: false,
    });

    const { destDir } = await runScaffold({
      cwd,
      decisions,
      presetId: "solo-cf-worker",
      cliRoot: CLI_ROOT,
      skipInstall: true,
    });

    expect(existsSync(join(destDir, "trigger.config.ts"))).toBe(false);
  });

  it("hookdeck=true + storage=r2 + trigger=true composes all three fragments", async () => {
    const cwd = await makeTempDir("scaffold-frag-all-");
    const decisions = defaultDecisions({
      projectName: "kitchen-sink",
      hookdeck: true,
      storage: "r2",
      trigger: true,
    });

    const { destDir, filesWritten } = await runScaffold({
      cwd,
      decisions,
      presetId: "solo-cf-worker",
      cliRoot: CLI_ROOT,
      skipInstall: true,
    });

    expect(existsSync(join(destDir, "docker-compose.yml"))).toBe(true);
    expect(existsSync(join(destDir, "trigger.config.ts"))).toBe(true);
    expect(existsSync(join(destDir, "infra", "hookdeck", "Pulumi.yaml"))).toBe(
      true
    );
    // Should have written a non-trivial number of files (base + preset + 3
    // fragments). Use a soft floor that won't break on small _base churn.
    expect(filesWritten).toBeGreaterThan(20);
  });
});

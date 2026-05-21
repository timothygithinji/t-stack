import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub execa BEFORE any imports below so doppler/loadTokens helpers see the mock.
const { execaMock } = vi.hoisted(() => ({
  execaMock:
    vi.fn<
      (
        bin: string,
        args?: string[],
        opts?: unknown
      ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
    >(),
}));
vi.mock("execa", () => ({ execa: execaMock }));

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

import { buildCtx } from "../../src/commands/_ctx.js";
import { defaultDecisions, defaultOrg, makeTempDir } from "../_helpers.js";

interface DopplerCallShape {
  project?: string;
  config?: string;
}

function parseSecretsDownload(args: string[] | undefined): DopplerCallShape {
  if (!args) {
    return {};
  }
  const out: DopplerCallShape = {};
  for (const a of args) {
    if (a.startsWith("--project=")) {
      out.project = a.slice("--project=".length);
    }
    if (a.startsWith("--config=")) {
      out.config = a.slice("--config=".length);
    }
  }
  return out;
}

describe("buildCtx Hookdeck wiring", () => {
  beforeEach(() => {
    execaMock.mockReset();
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

  it("uses decisions.hookdeckApiKey when provided (init flow)", async () => {
    execaMock.mockImplementation(async (_bin, args) => {
      const shape = parseSecretsDownload(args);
      if (shape.project === "t-stack") {
        return {
          stdout: JSON.stringify({
            CLOUDFLARE_API_TOKEN: "cf",
            TRIGGER_ACCESS_TOKEN: "trg",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error(`unexpected execa call: ${args?.join(" ")}`);
    });

    const cwd = await makeTempDir();
    const decisions = defaultDecisions({
      projectName: "neo",
      hookdeck: true,
      hookdeckApiKey: "hd-from-init",
    });

    const ctx = await buildCtx({ cwd, decisions, nonInteractive: true });
    expect(ctx.tokens.hookdeckApiKey).toBe("hd-from-init");

    // No per-project doppler call should have been issued because the key
    // came from decisions.
    const perProjectCall = execaMock.mock.calls.find((c) => {
      const a = c[1] as string[] | undefined;
      const shape = parseSecretsDownload(a);
      return shape.project === "neo";
    });
    expect(perProjectCall).toBeUndefined();
  });

  it("falls back to per-project Doppler config when decisions has no key", async () => {
    execaMock.mockImplementation(async (_bin, args) => {
      const shape = parseSecretsDownload(args);
      if (shape.project === "t-stack") {
        return {
          stdout: JSON.stringify({
            CLOUDFLARE_API_TOKEN: "cf",
            TRIGGER_ACCESS_TOKEN: "trg",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (shape.project === "neo" && shape.config === "prd") {
        return {
          stdout: JSON.stringify({
            HOOKDECK_API_KEY: "hd-from-doppler",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error(`unexpected execa call: ${args?.join(" ")}`);
    });

    const cwd = await makeTempDir();
    const decisions = defaultDecisions({
      projectName: "neo",
      hookdeck: true,
    });

    const ctx = await buildCtx({ cwd, decisions, nonInteractive: true });
    expect(ctx.tokens.hookdeckApiKey).toBe("hd-from-doppler");
  });

  it("throws when hookdeck=true but no key is available anywhere", async () => {
    execaMock.mockImplementation(async (_bin, args) => {
      const shape = parseSecretsDownload(args);
      if (shape.project === "t-stack") {
        return {
          stdout: JSON.stringify({
            CLOUDFLARE_API_TOKEN: "cf",
            TRIGGER_ACCESS_TOKEN: "trg",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      // Simulate missing per-project secret.
      return { stdout: "{}", stderr: "", exitCode: 0 };
    });

    const cwd = await makeTempDir();
    const decisions = defaultDecisions({
      projectName: "neo",
      hookdeck: true,
    });

    await expect(
      buildCtx({ cwd, decisions, nonInteractive: true })
    ).rejects.toThrow(/HOOKDECK_API_KEY/);
  });

  it("skips Hookdeck lookup entirely when hookdeck=false", async () => {
    execaMock.mockImplementation(async (_bin, args) => {
      const shape = parseSecretsDownload(args);
      if (shape.project === "t-stack") {
        return {
          stdout: JSON.stringify({
            CLOUDFLARE_API_TOKEN: "cf",
            TRIGGER_ACCESS_TOKEN: "trg",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error(`unexpected per-project execa call: ${args?.join(" ")}`);
    });

    const cwd = await makeTempDir();
    const decisions = defaultDecisions({
      projectName: "neo",
      hookdeck: false,
    });

    const ctx = await buildCtx({ cwd, decisions, nonInteractive: true });
    expect(ctx.tokens.hookdeckApiKey).toBeUndefined();
  });
});

import { describe, expect, it, vi } from "vitest";

// The `libsodium-wrappers` ESM build references a sibling that isn't published;
// stub the API surface so transitive imports through commands -> plugins/github
// don't break module loading.
vi.mock("libsodium-wrappers", () => {
  const api = {
    ready: Promise.resolve(),
    base64_variants: { ORIGINAL: 1 },
    from_base64: () => new Uint8Array(),
    from_string: () => new Uint8Array(),
    crypto_box_seal: () => new Uint8Array(),
    to_base64: () => "",
  };
  return { default: api, ...api };
});

// Intercept runMain so importing `src/cli.ts` doesn't try to actually parse argv.
// We capture the root command definition that the CLI hands to runMain, then
// inspect its subCommands map.
const captured: { root?: { subCommands?: Record<string, unknown> } } = {};
vi.mock("citty", async () => {
  const real = await vi.importActual<typeof import("citty")>("citty");
  return {
    ...real,
    runMain: (cmd: { subCommands?: Record<string, unknown> }) => {
      captured.root = cmd;
    },
  };
});

describe("cli root command", () => {
  it("registers all expected subcommands", async () => {
    await import("../src/cli.js");
    expect(captured.root).toBeDefined();
    const subs = captured.root?.subCommands ?? {};
    const names = Object.keys(subs).sort();
    expect(names).toEqual(
      [
        "deploy",
        "destroy",
        "doctor",
        "init",
        "login",
        "org",
        "provision",
        "scaffold",
        "secrets",
      ].sort()
    );
  });

  it("each subcommand looks like a citty command def", async () => {
    await import("../src/cli.js");
    const subs = captured.root?.subCommands ?? {};
    for (const [, def] of Object.entries(subs)) {
      expect(def).toBeTruthy();
      expect(typeof def).toBe("object");
    }
  });
});

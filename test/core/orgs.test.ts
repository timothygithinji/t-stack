import { readFile } from "node:fs/promises";
import { join } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOrgsStore } from "../../src/core/orgs.js";
import type { OrgProfile } from "../../src/core/preset.ts";
import { makeTempDir } from "../_helpers.js";

const ORIGINAL_HOME = process.env.HOME;

describe("OrgsStore", () => {
  let home: string;

  beforeEach(async () => {
    home = await makeTempDir("orgs-home-");
    process.env.HOME = home;
  });

  afterEach(() => {
    if (ORIGINAL_HOME === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = ORIGINAL_HOME;
    }
  });

  it("add then list round-trips", async () => {
    const store = createOrgsStore();
    const profile: OrgProfile = {
      name: "fanya-labs",
      cloudflareAccountId: "cf-acct",
      defaultDomain: "fanyalabs.dev",
      cloudflareZones: {},
      githubOwner: "fanya-labs",
      dopplerWorkplaceName: "fanya-labs",
    };
    await store.add(profile);

    const orgs = await store.list();
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.name).toBe("fanya-labs");
    expect(orgs[0]?.cloudflareAccountId).toBe("cf-acct");
    expect(orgs[0]?.cloudflareZones).toEqual({});
  });

  it("round-trips cloudflareZones map", async () => {
    const store = createOrgsStore();
    const profile: OrgProfile = {
      name: "multi",
      cloudflareAccountId: "cf-acct",
      defaultDomain: "primary.dev",
      cloudflareZones: {
        "primary.dev": "zone-a",
        "secondary.io": "zone-b",
      },
      githubOwner: "multi",
      dopplerWorkplaceName: "multi",
    };
    await store.add(profile);
    const fetched = await store.get("multi");
    expect(fetched?.cloudflareZones).toEqual({
      "primary.dev": "zone-a",
      "secondary.io": "zone-b",
    });
  });

  it("hydrates missing cloudflare_zones as empty map", async () => {
    const store = createOrgsStore();
    const profile: OrgProfile = {
      name: "no-zones",
      cloudflareAccountId: "cf-acct",
      defaultDomain: "nz.dev",
      cloudflareZones: {},
      githubOwner: "nz",
      dopplerWorkplaceName: "nz",
    };
    await store.add(profile);
    const fetched = await store.get("no-zones");
    expect(fetched?.cloudflareZones).toEqual({});
  });

  it("get returns undefined for missing org", async () => {
    const store = createOrgsStore();
    expect(await store.get("ghost")).toBeUndefined();
  });

  it("round-trips triggerOrgSlug and stores it as snake_case", async () => {
    const store = createOrgsStore();
    const profile: OrgProfile = {
      name: "with-trigger",
      cloudflareAccountId: "cf-acct",
      defaultDomain: "wt.dev",
      cloudflareZones: {},
      githubOwner: "wt",
      dopplerWorkplaceName: "wt",
      triggerOrgSlug: "personal-108a",
    };
    await store.add(profile);

    const fetched = await store.get("with-trigger");
    expect(fetched?.triggerOrgSlug).toBe("personal-108a");

    const raw = await readFile(join(home, ".t-stack", "orgs.toml"), "utf8");
    expect(raw).toContain("trigger_org_slug");
    expect(raw).toContain("personal-108a");
    expect(raw).not.toContain("triggerOrgSlug");
  });

  it("omits triggerOrgSlug when unset", async () => {
    const store = createOrgsStore();
    const profile: OrgProfile = {
      name: "no-trigger",
      cloudflareAccountId: "cf-acct",
      defaultDomain: "nt.dev",
      cloudflareZones: {},
      githubOwner: "nt",
      dopplerWorkplaceName: "nt",
    };
    await store.add(profile);
    const fetched = await store.get("no-trigger");
    expect(fetched?.triggerOrgSlug).toBeUndefined();
  });

  it("remove deletes only the named org", async () => {
    const store = createOrgsStore();
    const a: OrgProfile = {
      name: "alpha",
      cloudflareAccountId: "a",
      defaultDomain: "alpha.dev",
      cloudflareZones: {},
      githubOwner: "alpha",
      dopplerWorkplaceName: "alpha",
    };
    const b: OrgProfile = {
      name: "beta",
      cloudflareAccountId: "b",
      defaultDomain: "beta.dev",
      cloudflareZones: {},
      githubOwner: "beta",
      dopplerWorkplaceName: "beta",
    };
    await store.add(a);
    await store.add(b);

    await store.remove("alpha");
    const remaining = await store.list();
    expect(remaining.map((o) => o.name)).toEqual(["beta"]);
    expect(await store.get("alpha")).toBeUndefined();
    expect(await store.get("beta")).toBeDefined();
  });
});

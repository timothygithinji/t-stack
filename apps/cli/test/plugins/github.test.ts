import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Stub `gh auth token` via execa BEFORE importing the plugin module.
const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn<
    (
      bin: string,
      args?: string[],
      opts?: unknown
    ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  >(async () => ({
    stdout: "ghp_test_token",
    stderr: "",
    exitCode: 0,
  })),
}));
vi.mock("execa", () => ({
  execa: execaMock,
}));

import { Octokit } from "@octokit/rest";
import sodium from "libsodium-wrappers";
import {
  configureDopplerDeployToken,
  createRepo,
  setRepoSecret,
} from "../../src/plugins/github.js";
import { makeTestCtx } from "../_helpers.js";

const GH = "https://api.github.com";
const DOPPLER = "https://api.doppler.com/v3";

interface RepoRow {
  owner: { login: string };
  name: string;
  html_url: string;
  ssh_url: string;
}

let repos: Map<string, RepoRow>;
let createPostCount: number;
let putSecretByName: Map<string, Record<string, unknown>>;
let putSecretBody: Record<string, unknown> | undefined;
let variablesByName: Map<string, string>;
let patchedNames: string[];
let testPublicKeyB64: string;
let dopplerTokenListCalls: number;
let dopplerTokenDeletedSlugs: string[];
let dopplerTokenCreateBody: Record<string, unknown> | undefined;

function repoKey(owner: string, name: string) {
  return `${owner}/${name}`.toLowerCase();
}

const server = setupServer(
  http.get(`${GH}/user`, () => HttpResponse.json({ login: "someuser" })),
  http.post(`${GH}/orgs/:org/repos`, async ({ params, request }) => {
    createPostCount += 1;
    const org = String(params.org);
    const body = (await request.json()) as { name: string };
    const key = repoKey(org, body.name);
    if (repos.has(key)) {
      return new HttpResponse(
        JSON.stringify({
          message: "Validation Failed",
          errors: [
            { code: "custom", message: "name already exists on this account" },
          ],
        }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }
    const row: RepoRow = {
      owner: { login: org },
      name: body.name,
      html_url: `https://github.com/${org}/${body.name}`,
      ssh_url: `git@github.com:${org}/${body.name}.git`,
    };
    repos.set(key, row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.get(`${GH}/repos/:owner/:repo`, ({ params }) => {
    const key = repoKey(String(params.owner), String(params.repo));
    const row = repos.get(key);
    if (!row) {
      return new HttpResponse(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return HttpResponse.json(row);
  }),
  http.get(`${GH}/repos/:owner/:repo/actions/secrets/public-key`, () =>
    HttpResponse.json({
      key: testPublicKeyB64,
      key_id: "test-key-id",
    })
  ),
  http.put(
    `${GH}/repos/:owner/:repo/actions/secrets/:name`,
    async ({ params, request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      putSecretBody = body;
      putSecretByName.set(String(params.name), body);
      return new HttpResponse(null, { status: 201 });
    }
  ),
  http.patch(
    `${GH}/repos/:owner/:repo/actions/variables/:name`,
    async ({ params, request }) => {
      const body = (await request.json()) as { value: string };
      const name = String(params.name);
      patchedNames.push(name);
      variablesByName.set(name, body.value);
      return new HttpResponse(null, { status: 204 });
    }
  ),
  http.get(`${DOPPLER}/configs/tokens`, () => {
    dopplerTokenListCalls += 1;
    return HttpResponse.json({
      tokens: [
        {
          name: "github-actions-deploy",
          slug: "existing-slug",
          access: "read",
        },
      ],
    });
  }),
  http.delete(`${DOPPLER}/configs/tokens/token`, async ({ request }) => {
    const body = (await request.json()) as { slug?: string };
    if (body.slug) {
      dopplerTokenDeletedSlugs.push(body.slug);
    }
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${DOPPLER}/configs/tokens`, async ({ request }) => {
    dopplerTokenCreateBody = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      name: dopplerTokenCreateBody.name,
      slug: "new-token-slug",
      key: "dp.st.prd.fresh-secret-key",
      access: dopplerTokenCreateBody.access,
      expires_at: null,
    });
  })
);

beforeAll(async () => {
  await sodium.ready;
  const kp = sodium.crypto_box_keypair();
  testPublicKeyB64 = sodium.to_base64(
    kp.publicKey,
    sodium.base64_variants.ORIGINAL
  );
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

beforeEach(() => {
  repos = new Map();
  createPostCount = 0;
  putSecretBody = undefined;
  putSecretByName = new Map();
  variablesByName = new Map();
  patchedNames = [];
  dopplerTokenListCalls = 0;
  dopplerTokenDeletedSlugs = [];
  dopplerTokenCreateBody = undefined;
  execaMock.mockClear();
  execaMock.mockResolvedValue({
    stdout: "dp.pt.test_doppler_pat",
    stderr: "",
    exitCode: 0,
  } as never);
});

describe("github.createRepo", () => {
  it("returns identical refs across two calls when repo already exists", async () => {
    const ctx = await makeTestCtx({
      projectName: "scout",
      org: { githubOwner: "fanya-labs", name: "fanya-labs" },
    });

    const first = await createRepo(ctx);
    expect(first.owner).toBe("fanya-labs");
    expect(first.name).toBe("scout");
    expect(first.sshUrl).toBe("git@github.com:fanya-labs/scout.git");

    const second = await createRepo(ctx);
    expect(second).toEqual(first);
    expect(createPostCount).toBe(2); // both attempts hit POST; second got 422
  });
});

describe("github.setRepoSecret", () => {
  it("PUTs an encrypted secret with key_id from the public-key endpoint", async () => {
    const ctx = await makeTestCtx({
      projectName: "scout",
      org: { githubOwner: "fanya-labs", name: "fanya-labs" },
    });
    const gh = new Octokit({ auth: "ghp_test_token" });
    await setRepoSecret(ctx, gh, "DATABASE_URL", "postgres://hello");

    expect(putSecretBody).toBeDefined();
    expect(putSecretBody?.key_id).toBe("test-key-id");
    expect(typeof putSecretBody?.encrypted_value).toBe("string");
    expect((putSecretBody?.encrypted_value as string).length).toBeGreaterThan(
      0
    );
  });
});

describe("github.configureDopplerDeployToken", () => {
  it("mints a Doppler service token and pushes it as the DOPPLER_TOKEN repo secret", async () => {
    const ctx = await makeTestCtx({
      projectName: "scout",
      org: {
        githubOwner: "fanya-labs",
        name: "fanya-labs",
        dopplerWorkplaceName: "fanya-labs",
      },
    });
    const gh = new Octokit({ auth: "ghp_test_token" });
    await configureDopplerDeployToken(ctx, gh);

    expect(dopplerTokenListCalls).toBe(1);
    expect(dopplerTokenDeletedSlugs).toEqual(["existing-slug"]);
    expect(dopplerTokenCreateBody).toMatchObject({
      project: "scout",
      config: "prd",
      name: "github-actions-deploy",
      access: "read",
    });
    const dopplerSecret = putSecretByName.get("DOPPLER_TOKEN");
    expect(dopplerSecret).toBeDefined();
    expect(dopplerSecret?.key_id).toBe("test-key-id");
    expect(typeof dopplerSecret?.encrypted_value).toBe("string");
  });
});

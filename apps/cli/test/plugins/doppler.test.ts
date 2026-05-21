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

// Stub execa BEFORE importing the plugin so its top-level imports are intercepted.
const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn<
    (
      bin: string,
      args?: string[],
      opts?: unknown
    ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  >(async () => ({
    stdout: "stub-doppler-token",
    stderr: "",
    exitCode: 0,
  })),
}));
vi.mock("execa", () => ({
  execa: execaMock,
}));

import {
  createProject,
  ensureConfig,
  setSecret,
  verifyProjectExists,
} from "../../src/plugins/doppler.js";
import { makeTestCtx } from "../_helpers.js";

const DOPPLER = "https://api.doppler.com/v3";

interface ProjectShape {
  id: string;
  slug: string;
  name: string;
}

// Per-test in-memory state for the mock server.
let projects: ProjectShape[];
let configsByProject: Map<string, string[]>;
let secretsByConfig: Map<string, Record<string, string>>;
let lastSecretsBody:
  | { project?: string; config?: string; secrets?: Record<string, unknown> }
  | undefined;
let postProjectCount: number;
let postConfigCount: number;

const server = setupServer(
  http.post(`${DOPPLER}/projects`, async ({ request }) => {
    postProjectCount += 1;
    const body = (await request.json()) as {
      name: string;
      description?: string;
    };
    const slug = body.name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    const existing = projects.find((p) => p.slug === slug);
    if (existing) {
      return new HttpResponse(
        JSON.stringify({ messages: ["already exists"], success: false }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }
    const project: ProjectShape = {
      id: `prj_${Math.random().toString(36).slice(2, 10)}`,
      slug,
      name: body.name,
    };
    projects.push(project);
    return HttpResponse.json({ project }, { status: 201 });
  }),
  http.get(`${DOPPLER}/projects`, () => HttpResponse.json({ projects })),
  http.get(`${DOPPLER}/configs`, ({ request }) => {
    const url = new URL(request.url);
    const project = url.searchParams.get("project") ?? "";
    const names = configsByProject.get(project) ?? [];
    const configs = names.map((name) => ({
      name,
      project,
      environment: name,
      root: true,
      locked: false,
    }));
    return HttpResponse.json({ configs });
  }),
  http.post(`${DOPPLER}/configs`, async ({ request }) => {
    postConfigCount += 1;
    const body = (await request.json()) as {
      project: string;
      name: string;
      environment: string;
    };
    const list = configsByProject.get(body.project) ?? [];
    if (list.includes(body.name)) {
      return new HttpResponse(
        JSON.stringify({ messages: ["exists"], success: false }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }
    list.push(body.name);
    configsByProject.set(body.project, list);
    return HttpResponse.json({
      config: {
        name: body.name,
        project: body.project,
        environment: body.environment,
        root: true,
        locked: false,
      },
    });
  }),
  http.post(`${DOPPLER}/configs/config/secrets`, async ({ request }) => {
    const body = (await request.json()) as {
      project?: string;
      config?: string;
      secrets?: Record<string, string>;
    };
    lastSecretsBody = body;
    const key = `${body.project}/${body.config}`;
    const merged = {
      ...(secretsByConfig.get(key) ?? {}),
      ...(body.secrets ?? {}),
    };
    secretsByConfig.set(key, merged);
    return HttpResponse.json({ success: true });
  })
);

beforeAll(() => {
  process.env.DOPPLER_TOKEN = "stub-doppler-token";
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  delete process.env.DOPPLER_TOKEN;
  server.close();
});

beforeEach(async () => {
  projects = [];
  configsByProject = new Map();
  secretsByConfig = new Map();
  lastSecretsBody = undefined;
  postProjectCount = 0;
  postConfigCount = 0;
  execaMock.mockClear();
  execaMock.mockResolvedValue({
    stdout: "stub-doppler-token",
    stderr: "",
    exitCode: 0,
  } as never);
  const m = await import("../../src/plugins/doppler.js");
  m.clearCachedToken();
});

describe("doppler.createProject", () => {
  it("is idempotent — second call returns the same slug", async () => {
    const ctx = await makeTestCtx({ projectName: "scout" });

    const first = await createProject(ctx);
    expect(first.slug).toBe("scout");
    expect(first.name).toBe("scout");

    const second = await createProject(ctx);
    expect(second.slug).toBe(first.slug);
    expect(second.name).toBe(first.name);
    expect(postProjectCount).toBe(2); // both POSTs went out; second got 409
  });
});

describe("doppler.ensureConfig", () => {
  it("is a no-op when the config already exists", async () => {
    const ctx = await makeTestCtx({ projectName: "scout" });
    const { slug } = await createProject(ctx);
    configsByProject.set(slug, ["dev"]);

    await expect(ensureConfig(ctx, slug, "dev")).resolves.toBeUndefined();
    expect(postConfigCount).toBe(0);
  });

  it("creates the config when missing", async () => {
    const ctx = await makeTestCtx({ projectName: "scout" });
    const { slug } = await createProject(ctx);

    await expect(ensureConfig(ctx, slug, "stg")).resolves.toBeUndefined();
    expect(postConfigCount).toBe(1);
    expect(configsByProject.get(slug)).toContain("stg");
  });
});

describe("doppler.setSecret", () => {
  it("POSTs the secret via REST without exposing the value in argv", async () => {
    const ctx = await makeTestCtx({ projectName: "scout" });
    await setSecret(ctx, "scout", "prd", "DATABASE_URL", "postgres://x");

    expect(lastSecretsBody).toBeDefined();
    expect(lastSecretsBody?.project).toBe("scout");
    expect(lastSecretsBody?.config).toBe("prd");
    expect(lastSecretsBody?.secrets).toEqual({ DATABASE_URL: "postgres://x" });

    // Ensure no `doppler secrets set` execa call ever ran with the value inline.
    const argvWithValue = execaMock.mock.calls.find(
      (c) =>
        Array.isArray(c[1]) &&
        (c[1] as string[]).some((a) => a.includes("postgres://x"))
    );
    expect(argvWithValue).toBeUndefined();
  });
});

describe("doppler.verifyProjectExists", () => {
  it("returns true when a project with the slugified projectName exists", async () => {
    const ctx = await makeTestCtx({ projectName: "demo-app" });
    await createProject(ctx);
    const alive = await verifyProjectExists(ctx, {});
    expect(alive).toBe(true);
  });

  it("returns false when no Doppler project matches the slug", async () => {
    const ctx = await makeTestCtx({ projectName: "demo-app" });
    const alive = await verifyProjectExists(ctx, {});
    expect(alive).toBe(false);
  });
});

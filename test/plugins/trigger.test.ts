import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createProject,
  listOrgs,
  listProjects,
} from "../../src/plugins/trigger.js";
import { makeTestCtx } from "../_helpers.js";

const PROJECTS_URL = "https://api.trigger.dev/api/v1/projects";
const KEYS_URL = "https://api.trigger.dev/api/v1/projects/:ref/keys";

const PROJECT_LIST_TWO_ORGS = [
  {
    id: "cmp46rqlc01zllt0hrgdg3qft",
    externalRef: "proj_mrpjzrejegcqeenqdnsf",
    name: "Scout",
    slug: "scout-dqsT",
    organization: {
      id: "cmp46rmqx01w8n50imj6anvpx",
      title: "Timothy Githinji",
      slug: "personal-108a",
    },
  },
  {
    id: "cmp99uploader",
    externalRef: "proj_uploader",
    name: "Uploader",
    slug: "uploader-eyIx",
    organization: {
      id: "cmp99sideproject",
      title: "Side Project Co",
      slug: "timothy-githinji-d0f4",
    },
  },
];

function keysResponse() {
  return HttpResponse.json({
    keys: [{ type: "secret", environment: "prod", key: "tr_prod_secret_xxx" }],
  });
}

const server = setupServer();

describe("trigger plugin (org-scoped)", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it("listProjects returns the projects array from the live shape", async () => {
    server.use(
      http.get(PROJECTS_URL, () => HttpResponse.json(PROJECT_LIST_TWO_ORGS))
    );
    const got = await listProjects("tr_pat_xxx");
    expect(got).toHaveLength(2);
    expect(got[0]?.organization?.slug).toBe("personal-108a");
  });

  it("listOrgs derives the unique set of orgs from projects", async () => {
    server.use(
      http.get(PROJECTS_URL, () => HttpResponse.json(PROJECT_LIST_TWO_ORGS))
    );
    const orgs = await listOrgs("tr_pat_xxx");
    expect(orgs.map((o) => o.slug).sort()).toEqual([
      "personal-108a",
      "timothy-githinji-d0f4",
    ]);
  });

  it("createProject POSTs name + organizationSlug and returns auto-generated slug", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(PROJECTS_URL, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          id: "cmpNEWID",
          externalRef: "proj_new",
          name: "demo",
          slug: "demo-aBcD",
          organization: {
            id: "cmp46rmqx01w8n50imj6anvpx",
            title: "Timothy Githinji",
            slug: "personal-108a",
          },
        });
      }),
      http.get(KEYS_URL, () => keysResponse())
    );

    const ctx = await makeTestCtx({
      projectName: "demo",
      org: { triggerOrgSlug: "personal-108a" },
    });
    const refs = await createProject(ctx);

    expect(capturedBody).toEqual({
      name: "demo",
      organizationSlug: "personal-108a",
    });
    expect(refs.slug).toBe("demo-aBcD");
    expect(refs.projectRef).toBe("proj_new");
    expect(refs.secretKey).toBe("tr_prod_secret_xxx");
  });

  it("createProject falls back to find-by-name on 409 within the active org only", async () => {
    server.use(
      http.post(PROJECTS_URL, () =>
        HttpResponse.json({ message: "conflict" }, { status: 409 })
      ),
      http.get(PROJECTS_URL, () =>
        HttpResponse.json([
          {
            id: "cmp_other_uploader",
            externalRef: "proj_uploader",
            name: "Uploader",
            slug: "uploader-eyIx",
            organization: {
              id: "cmp99sideproject",
              title: "Side Project Co",
              slug: "timothy-githinji-d0f4",
            },
          },
          {
            id: "cmp_mine_uploader",
            externalRef: "proj_uploader_mine",
            name: "Uploader",
            slug: "uploader-zZzZ",
            organization: {
              id: "cmp46rmqx01w8n50imj6anvpx",
              title: "Timothy Githinji",
              slug: "personal-108a",
            },
          },
        ])
      ),
      http.get(KEYS_URL, () => keysResponse())
    );

    const ctx = await makeTestCtx({
      projectName: "Uploader",
      org: { triggerOrgSlug: "personal-108a" },
    });
    const refs = await createProject(ctx);

    expect(refs.slug).toBe("uploader-zZzZ");
    expect(refs.projectRef).toBe("proj_uploader_mine");
  });

  it("createProject falls back to find-by-name on 422", async () => {
    server.use(
      http.post(PROJECTS_URL, () =>
        HttpResponse.json({ message: "validation" }, { status: 422 })
      ),
      http.get(PROJECTS_URL, () =>
        HttpResponse.json([
          {
            id: "cmp_demo",
            externalRef: "proj_demo",
            name: "demo",
            slug: "demo-xyZ1",
            organization: {
              id: "cmp46rmqx01w8n50imj6anvpx",
              title: "Timothy Githinji",
              slug: "personal-108a",
            },
          },
        ])
      ),
      http.get(KEYS_URL, () => keysResponse())
    );

    const ctx = await makeTestCtx({
      projectName: "demo",
      org: { triggerOrgSlug: "personal-108a" },
    });
    const refs = await createProject(ctx);
    expect(refs.slug).toBe("demo-xyZ1");
  });

  it("createProject falls back to find-by-name on 404/405 (create endpoint unavailable)", async () => {
    server.use(
      http.post(PROJECTS_URL, () =>
        HttpResponse.json({ message: "not found" }, { status: 404 })
      ),
      http.get(PROJECTS_URL, () =>
        HttpResponse.json([
          {
            id: "cmp_demo",
            externalRef: "proj_demo",
            name: "demo",
            slug: "demo-pre1",
            organization: {
              id: "cmp46rmqx01w8n50imj6anvpx",
              title: "Timothy Githinji",
              slug: "personal-108a",
            },
          },
        ])
      ),
      http.get(KEYS_URL, () => keysResponse())
    );

    const ctx = await makeTestCtx({
      projectName: "demo",
      org: { triggerOrgSlug: "personal-108a" },
    });
    const refs = await createProject(ctx);
    expect(refs.slug).toBe("demo-pre1");
  });

  it("createProject throws helpful error when triggerOrgSlug is missing", async () => {
    const ctx = await makeTestCtx({
      projectName: "demo",
      org: { triggerOrgSlug: undefined },
    });
    await expect(createProject(ctx)).rejects.toThrow(/no triggerOrgSlug/);
  });

  it("createProject throws when 404 lookup finds no matching project in the active org", async () => {
    server.use(
      http.post(PROJECTS_URL, () =>
        HttpResponse.json({ message: "not found" }, { status: 404 })
      ),
      http.get(PROJECTS_URL, () =>
        HttpResponse.json([
          {
            id: "cmp_other",
            externalRef: "proj_other",
            name: "demo",
            slug: "demo-other",
            organization: {
              id: "cmp_other_org",
              title: "Other",
              slug: "some-other-org",
            },
          },
        ])
      )
    );

    const ctx = await makeTestCtx({
      projectName: "demo",
      org: { triggerOrgSlug: "personal-108a" },
    });
    await expect(createProject(ctx)).rejects.toThrow(
      /not found in Trigger\.dev org "personal-108a"/
    );
  });
});

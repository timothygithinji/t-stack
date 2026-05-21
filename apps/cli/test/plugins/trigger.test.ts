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
const ORGS_URL = "https://api.trigger.dev/api/v1/orgs";
const CREATE_URL = "https://api.trigger.dev/api/v1/orgs/:slug/projects";
const PROD_KEY_URL = "https://api.trigger.dev/api/v1/projects/:ref/prod";

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

const ORGS_LIST = [
  {
    id: "cmp46rmqx01w8n50imj6anvpx",
    title: "Timothy Githinji",
    slug: "personal-108a",
  },
  {
    id: "cmp99sideproject",
    title: "Side Project Co",
    slug: "timothy-githinji-d0f4",
  },
];

function prodKeyResponse(apiKey = "tr_prod_secret_xxx") {
  return HttpResponse.json({
    apiKey,
    name: "demo",
    apiUrl: "https://api.trigger.dev",
    projectId: "cmpfsuh3k01ioo50jtael7qcl",
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

  it("listOrgs fetches /orgs directly so PATs with no projects still see orgs", async () => {
    server.use(http.get(ORGS_URL, () => HttpResponse.json(ORGS_LIST)));
    const orgs = await listOrgs("tr_pat_xxx");
    expect(orgs.map((o) => o.slug).sort()).toEqual([
      "personal-108a",
      "timothy-githinji-d0f4",
    ]);
  });

  it("createProject reuses an existing project in the active org without POSTing", async () => {
    let postCalled = false;
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json([
          {
            id: "cmp_existing",
            externalRef: "proj_existing",
            name: "demo",
            slug: "demo-existing",
            organization: {
              id: "cmp46rmqx01w8n50imj6anvpx",
              title: "Timothy Githinji",
              slug: "personal-108a",
            },
          },
        ])
      ),
      http.post(CREATE_URL, () => {
        postCalled = true;
        return HttpResponse.json({}, { status: 500 });
      }),
      http.get(PROD_KEY_URL, () => prodKeyResponse())
    );

    const ctx = await makeTestCtx({
      projectName: "demo",
      org: { triggerOrgSlug: "personal-108a" },
    });
    const refs = await createProject(ctx);

    expect(postCalled).toBe(false);
    expect(refs.slug).toBe("demo-existing");
    expect(refs.projectRef).toBe("proj_existing");
    expect(refs.secretKey).toBe("tr_prod_secret_xxx");
  });

  it("createProject matches existing project names case-insensitively", async () => {
    let postCalled = false;
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json([
          {
            id: "cmp_existing",
            externalRef: "proj_existing",
            name: "GAFF",
            slug: "gaff-XYZ",
            organization: {
              id: "cmp46rmqx01w8n50imj6anvpx",
              title: "Timothy Githinji",
              slug: "personal-108a",
            },
          },
        ])
      ),
      http.post(CREATE_URL, () => {
        postCalled = true;
        return HttpResponse.json({}, { status: 500 });
      }),
      http.get(PROD_KEY_URL, () => prodKeyResponse())
    );

    const ctx = await makeTestCtx({
      projectName: "gaff",
      org: { triggerOrgSlug: "personal-108a" },
    });
    const refs = await createProject(ctx);

    expect(postCalled).toBe(false);
    expect(refs.projectRef).toBe("proj_existing");
  });

  it("createProject scopes the lookup to the active org only", async () => {
    let postBody: unknown;
    let postUrl = "";
    server.use(
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
      ),
      http.post(CREATE_URL, async ({ request }) => {
        postUrl = request.url;
        postBody = await request.json();
        return HttpResponse.json({
          id: "cmp_new",
          externalRef: "proj_new",
          name: "demo",
          slug: "demo-new",
          organization: {
            id: "cmp46rmqx01w8n50imj6anvpx",
            title: "Timothy Githinji",
            slug: "personal-108a",
          },
        });
      }),
      http.get(PROD_KEY_URL, () => prodKeyResponse())
    );

    const ctx = await makeTestCtx({
      projectName: "demo",
      org: { triggerOrgSlug: "personal-108a" },
    });
    const refs = await createProject(ctx);

    expect(postUrl).toBe(
      "https://api.trigger.dev/api/v1/orgs/personal-108a/projects"
    );
    expect(postBody).toEqual({ name: "demo" });
    expect(refs.projectRef).toBe("proj_new");
  });

  it("createProject POSTs to the org-scoped URL with only {name} when no match exists", async () => {
    let postUrl = "";
    let postBody: unknown;
    server.use(
      http.get(PROJECTS_URL, () => HttpResponse.json([])),
      http.post(CREATE_URL, async ({ request }) => {
        postUrl = request.url;
        postBody = await request.json();
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
      http.get(PROD_KEY_URL, () => prodKeyResponse())
    );

    const ctx = await makeTestCtx({
      projectName: "demo",
      org: { triggerOrgSlug: "personal-108a" },
    });
    const refs = await createProject(ctx);

    expect(postUrl).toBe(
      "https://api.trigger.dev/api/v1/orgs/personal-108a/projects"
    );
    expect(postBody).toEqual({ name: "demo" });
    expect(refs.slug).toBe("demo-aBcD");
    expect(refs.projectRef).toBe("proj_new");
    expect(refs.secretKey).toBe("tr_prod_secret_xxx");
  });

  it("createProject throws helpful error when triggerOrgSlug is missing", async () => {
    const ctx = await makeTestCtx({
      projectName: "demo",
      org: { triggerOrgSlug: undefined },
    });
    await expect(createProject(ctx)).rejects.toThrow(/no triggerOrgSlug/);
  });

  it("createProject surfaces a clear error when the prod env has no apiKey", async () => {
    server.use(
      http.get(PROJECTS_URL, () => HttpResponse.json([])),
      http.post(CREATE_URL, () =>
        HttpResponse.json({
          id: "cmpNEWID",
          externalRef: "proj_new",
          name: "demo",
          slug: "demo-aBcD",
        })
      ),
      http.get(PROD_KEY_URL, () =>
        HttpResponse.json({
          apiKey: "",
          name: "demo",
          apiUrl: "https://api.trigger.dev",
          projectId: "p",
        })
      )
    );

    const ctx = await makeTestCtx({
      projectName: "demo",
      org: { triggerOrgSlug: "personal-108a" },
    });
    await expect(createProject(ctx)).rejects.toThrow(
      /no production secret key/
    );
  });
});

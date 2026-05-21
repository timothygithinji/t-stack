import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { verifyExists } from "../../src/plugins/cloudflare.js";
import { makeTestCtx } from "../_helpers.js";

const CF = "https://api.cloudflare.com/client/v4";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("cloudflare.verifyExists", () => {
  it("returns true when the KV namespace probe succeeds", async () => {
    server.use(
      http.get(`${CF}/accounts/:accountId/storage/kv/namespaces/:id`, () =>
        HttpResponse.json({ success: true, result: { id: "ns-1" } })
      )
    );
    const ctx = await makeTestCtx({
      projectName: "scout",
      org: { cloudflareAccountId: "acct-123" },
      tokens: { cloudflareApiToken: "tok-xyz" },
    });
    const alive = await verifyExists(ctx, { kvNamespaceId: "ns-1" });
    expect(alive).toBe(true);
  });

  it("returns false on 404 (stack torn down out-of-band)", async () => {
    server.use(
      http.get(`${CF}/accounts/:accountId/storage/kv/namespaces/:id`, () =>
        HttpResponse.json(
          { success: false, errors: [{ message: "not found" }] },
          { status: 404 }
        )
      )
    );
    const ctx = await makeTestCtx({
      projectName: "scout",
      org: { cloudflareAccountId: "acct-123" },
      tokens: { cloudflareApiToken: "tok-xyz" },
    });
    const alive = await verifyExists(ctx, { kvNamespaceId: "ns-gone" });
    expect(alive).toBe(false);
  });

  it("returns false when refs / token / account id are missing", async () => {
    const ctx = await makeTestCtx({
      projectName: "scout",
      org: { cloudflareAccountId: "acct-123" },
      tokens: { cloudflareApiToken: "tok-xyz" },
    });
    expect(await verifyExists(ctx, {})).toBe(false);
  });

  it("re-throws non-404 failures so the gate trusts state", async () => {
    server.use(
      http.get(`${CF}/accounts/:accountId/storage/kv/namespaces/:id`, () =>
        HttpResponse.json(
          { success: false, errors: [{ message: "boom" }] },
          { status: 500 }
        )
      )
    );
    const ctx = await makeTestCtx({
      projectName: "scout",
      org: { cloudflareAccountId: "acct-123" },
      tokens: { cloudflareApiToken: "tok-xyz" },
    });
    await expect(
      verifyExists(ctx, { kvNamespaceId: "ns-1" })
    ).rejects.toThrow();
  });
});

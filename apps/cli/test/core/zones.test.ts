import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  discoverZoneViaCfApi,
  resolveZoneForDomain,
} from "../../src/core/zones.js";

describe("resolveZoneForDomain", () => {
  it("returns undefined when zones map is empty", () => {
    expect(resolveZoneForDomain("app.example.com", {})).toBeUndefined();
  });

  it("returns undefined when no apex matches", () => {
    expect(
      resolveZoneForDomain("app.example.com", { "other.com": "z1" })
    ).toBeUndefined();
  });

  it("matches an exact apex (single-segment lookup)", () => {
    expect(
      resolveZoneForDomain("example.com", { "example.com": "z1" })
    ).toEqual({ apex: "example.com", zoneId: "z1" });
  });

  it("matches a suffix apex", () => {
    expect(
      resolveZoneForDomain("app.example.com", { "example.com": "z1" })
    ).toEqual({ apex: "example.com", zoneId: "z1" });
  });

  it("longest-suffix wins when multiple match", () => {
    expect(
      resolveZoneForDomain("app.foo.bar.com", {
        "bar.com": "z1",
        "foo.bar.com": "z2",
      })
    ).toEqual({ apex: "foo.bar.com", zoneId: "z2" });
  });

  it("handles a single-segment domain", () => {
    expect(resolveZoneForDomain("localhost", { localhost: "z1" })).toEqual({
      apex: "localhost",
      zoneId: "z1",
    });
  });

  it("returns undefined for empty fqdn", () => {
    expect(resolveZoneForDomain("", { "example.com": "z1" })).toBeUndefined();
  });
});

const server = setupServer();

describe("discoverZoneViaCfApi", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it("returns the zone id on a successful match", async () => {
    let capturedUrl: URL | undefined;
    let capturedAuth: string | null = null;
    server.use(
      http.get("https://api.cloudflare.com/client/v4/zones", ({ request }) => {
        capturedUrl = new URL(request.url);
        capturedAuth = request.headers.get("authorization");
        return HttpResponse.json({
          success: true,
          result: [{ id: "zone-found", name: "example.com" }],
        });
      })
    );

    const id = await discoverZoneViaCfApi({
      apex: "example.com",
      accountId: "acct-1",
      cloudflareApiToken: "tok-xyz",
    });

    expect(id).toBe("zone-found");
    expect(capturedUrl?.searchParams.get("name")).toBe("example.com");
    expect(capturedUrl?.searchParams.get("account.id")).toBe("acct-1");
    expect(capturedAuth).toBe("Bearer tok-xyz");
  });

  it("returns undefined when the result list is empty", async () => {
    server.use(
      http.get("https://api.cloudflare.com/client/v4/zones", () =>
        HttpResponse.json({ success: true, result: [] })
      )
    );
    const id = await discoverZoneViaCfApi({
      apex: "absent.io",
      accountId: "acct-1",
      cloudflareApiToken: "tok-xyz",
    });
    expect(id).toBeUndefined();
  });

  it("returns undefined when success is false", async () => {
    server.use(
      http.get("https://api.cloudflare.com/client/v4/zones", () =>
        HttpResponse.json({
          success: false,
          result: [{ id: "ignored", name: "x" }],
        })
      )
    );
    const id = await discoverZoneViaCfApi({
      apex: "absent.io",
      accountId: "acct-1",
      cloudflareApiToken: "tok-xyz",
    });
    expect(id).toBeUndefined();
  });
});

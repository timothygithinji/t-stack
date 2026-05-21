import { ofetch } from "ofetch";

export interface ResolvedZone {
  apex: string;
  zoneId: string;
}

/**
 * Walk the FQDN from longest suffix to shortest, returning the first apex
 * that matches a key in `zones`. e.g. for "app.foo.bar.com" with zones
 * { "bar.com": "z1", "foo.bar.com": "z2" }, returns { apex: "foo.bar.com", zoneId: "z2" }
 * (longest match wins).
 */
export function resolveZoneForDomain(
  fqdn: string,
  zones: Record<string, string>
): ResolvedZone | undefined {
  if (!fqdn) {
    return undefined;
  }
  const parts = fqdn.split(".");
  for (let i = 0; i < parts.length; i += 1) {
    const candidate = parts.slice(i).join(".");
    const zoneId = zones[candidate];
    if (zoneId) {
      return { apex: candidate, zoneId };
    }
  }
  return undefined;
}

interface CloudflareZonesResponse {
  success: boolean;
  result?: Array<{ id: string; name: string }>;
}

/**
 * Query Cloudflare for a zone matching `apex` in the given account.
 * Requires the CF API token to have Zone:Read scope.
 * Returns zoneId on success, undefined if not found.
 */
export async function discoverZoneViaCfApi(args: {
  apex: string;
  accountId: string;
  cloudflareApiToken: string;
}): Promise<string | undefined> {
  const res = await ofetch<CloudflareZonesResponse>(
    "https://api.cloudflare.com/client/v4/zones",
    {
      headers: { Authorization: `Bearer ${args.cloudflareApiToken}` },
      query: { name: args.apex, "account.id": args.accountId },
    }
  );
  if (!res.success) {
    return undefined;
  }
  const first = res.result?.[0];
  return first?.id;
}

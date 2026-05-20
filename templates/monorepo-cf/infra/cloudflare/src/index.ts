import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const accountId = config.require("accountId");
const domain = "{{domain}}";

// Shared KV namespace used by both the web and server Workers.
const kv = new cloudflare.WorkersKvNamespace("{{projectName}}-kv", {
  accountId,
  title: "{{projectName}}-kv",
});

// Shared R2 bucket used by both Workers.
const bucket = new cloudflare.R2Bucket("{{projectName}}", {
  accountId,
  name: "{{projectName}}",
});

{{#if access}}// Cloudflare Access protects the web app behind {{org.defaultDomain}} SSO.
const accessApp = new cloudflare.ZeroTrustAccessApplication("{{projectName}}-web-access", {
  accountId,
  name: "{{projectName}} web",
  domain,
  type: "self_hosted",
  sessionDuration: "24h",
});

new cloudflare.ZeroTrustAccessPolicy("{{projectName}}-web-policy", {
  accountId,
  applicationId: accessApp.id,
  name: "Allow {{org.defaultDomain}} emails",
  precedence: 1,
  decision: "allow",
  includes: [
    {
      emailDomains: ["{{org.defaultDomain}}"],
    },
  ],
});

{{/if}}export const kvNamespaceId = kv.id;
export const kvNamespaceTitle = kv.title;
export const r2BucketName = bucket.name;
export const webUrl = pulumi.interpolate`https://${domain}`;
export const serverUrl = pulumi.interpolate`https://api.${domain}`;

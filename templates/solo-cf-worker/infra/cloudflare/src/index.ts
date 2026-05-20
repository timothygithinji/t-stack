import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

const config = new pulumi.Config();
const accountId = config.require("accountId");

const projectName = "{{projectName}}";
const domain = "{{domain}}";

// KV namespace bound to the worker as `KV`.
const kv = new cloudflare.WorkersKvNamespace(`${projectName}-kv`, {
  accountId,
  title: `${projectName}-kv`,
});

// R2 bucket bound to the worker as `BUCKET`.
// R2 names must be lowercase with no underscores.
const bucket = new cloudflare.R2Bucket(`${projectName}-r2`, {
  accountId,
  name: projectName,
  location: "WNAM",
});

{{#if access}}
// Cloudflare Access — restrict the domain to members of the org email.
const accessApp = new cloudflare.ZeroTrustAccessApplication(`${projectName}-access-app`, {
  accountId,
  name: `${projectName}`,
  domain,
  type: "self_hosted",
  sessionDuration: "24h",
  autoRedirectToIdentity: false,
});

const accessPolicy = new cloudflare.ZeroTrustAccessPolicy(`${projectName}-access-policy`, {
  accountId,
  applicationId: accessApp.id,
  name: "Allow {{org.defaultDomain}}",
  precedence: 1,
  decision: "allow",
  includes: [
    {
      emailDomains: ["{{org.defaultDomain}}"],
    },
  ],
});

export const accessAppId = accessApp.id;
export const accessPolicyId = accessPolicy.id;
{{/if}}

export const kvNamespaceId = kv.id;
export const kvNamespaceTitle = kv.title;
export const r2BucketName = bucket.name;
export const workerUrl = `https://${domain}`;

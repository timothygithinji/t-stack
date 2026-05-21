import {
  type InMemoryFile,
  overlay,
  renderInMemory,
} from "@t-stack/templating/in-memory";
import { TEMPLATE_FILES } from "@/lib/generated/templates";
import type { DraftStack } from "./types";

// Templates come from a generated TS module rather than import.meta.glob
// because @cloudflare/vite-plugin's workerd runner tries to JSON.parse
// `.json` template files before Vite's `?raw` plugin can intervene.
// `apps/web/scripts/generate-templates.ts` regenerates the file from
// packages/templates/files on every dev/build.
const FILES: InMemoryFile[] = TEMPLATE_FILES;

/**
 * Synthetic values for fields the web app can't resolve locally (no
 * orgs.toml, no Cloudflare API access, etc.). Highlighted in the UI so the
 * user can see which strings will be replaced at scaffold time.
 */
export const PLACEHOLDERS = {
  cloudflareAccountId: "0123456789abcdef0123456789abcdef",
  cloudflareZoneId: "abcdef0123456789abcdef0123456789",
  cloudflareZoneApex: "example.com",
  dopplerWorkplaceName: "your-doppler-workplace",
  dopplerOidcIdentityId: "00000000-0000-4000-8000-000000000000",
  githubOwner: "your-github-handle",
  pulumiOrg: "your-pulumi-org",
  neonOrgId: "org-your-neon-id",
  triggerOrgSlug: "your-trigger-org",
} as const;

/**
 * Stitch a Handlebars context from the user's draft + synthetic placeholders.
 * Mirrors deriveVars() in apps/cli/src/commands/scaffold.ts but with web-safe
 * defaults instead of org/zone lookups.
 */
export function buildVars(stack: DraftStack): Record<string, unknown> {
  const database = stack.archetype === "monorepo-cf" ? "neon" : stack.database;
  return {
    org: {
      name: stack.org || "your-org",
      defaultDomain: PLACEHOLDERS.cloudflareZoneApex,
      cloudflareAccountId: PLACEHOLDERS.cloudflareAccountId,
      githubOwner: PLACEHOLDERS.githubOwner,
      dopplerWorkplaceName: PLACEHOLDERS.dopplerWorkplaceName,
      dopplerOidcIdentityId: PLACEHOLDERS.dopplerOidcIdentityId,
      pulumiOrg: PLACEHOLDERS.pulumiOrg,
      neonOrgId: PLACEHOLDERS.neonOrgId,
      triggerOrgSlug: PLACEHOLDERS.triggerOrgSlug,
    },
    orgName: stack.org || "your-org",
    projectName: stack.projectName || "my-app",
    archetype: stack.archetype,
    domain: stack.domain || `${stack.projectName || "my-app"}.example.com`,
    database,
    envs: stack.envs,
    trigger: stack.trigger,
    access: stack.access,
    hookdeck: stack.hookdeck,
    neon: database === "neon",
    turso: database === "turso",
    cloudflareZoneId: PLACEHOLDERS.cloudflareZoneId,
    cloudflareZoneApex: PLACEHOLDERS.cloudflareZoneApex,
    createdAt: "1970-01-01T00:00:00.000Z",
  };
}

/**
 * Render the full project for the given stack: `_base/` overlaid with the
 * archetype directory, plus the optional `_assets/hookdeck-sdk/` copy.
 */
export function renderProject(stack: DraftStack) {
  const vars = buildVars(stack);
  const base = renderInMemory(FILES, "_base/", vars);
  const archetypeDir = `${stack.archetype}/`;
  const archetypeLayer = renderInMemory(FILES, archetypeDir, vars);

  const layers = [archetypeLayer];

  if (stack.hookdeck) {
    // hookdeck-sdk is copied verbatim (no handlebars) into
    // infra/hookdeck/sdks/hookdeck/ — match the CLI behaviour.
    const sdkLayer: typeof archetypeLayer = [];
    const prefix = "_assets/hookdeck-sdk/";
    for (const f of FILES) {
      if (!f.path.startsWith(prefix)) {
        continue;
      }
      sdkLayer.push({
        path: `infra/hookdeck/sdks/hookdeck/${f.path.slice(prefix.length)}`,
        sourcePath: f.path,
        content: f.content,
      });
    }
    layers.push(sdkLayer);
  }

  return overlay(base, ...layers);
}

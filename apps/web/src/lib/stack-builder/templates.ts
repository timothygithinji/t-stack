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
 * Map the flat axis set back to the preset slug used as a template
 * directory name (and the Handlebars `archetype` var). The CLI's preset
 * registry is the source of truth — we mirror its `single`/`monorepo`
 * branch here. Other combinations fall back to `single-cloudflare` so the
 * preview still renders something useful.
 */
function presetIdFor(
  stack: DraftStack
): "single-cloudflare" | "monorepo-cloudflare" {
  return stack.structure === "monorepo"
    ? "monorepo-cloudflare"
    : "single-cloudflare";
}

/**
 * Map databaseHost back to the legacy template var (`neon` | `turso` |
 * `none`). Templates still consume `database` as a slug; the CLI does the
 * same in `deriveVars()` until templates migrate to read `databaseHost`
 * directly.
 */
function templateDatabaseSlug(stack: DraftStack): "neon" | "turso" | "none" {
  if (stack.databaseHost === "neon") {
    return "neon";
  }
  if (stack.databaseHost === "turso") {
    return "turso";
  }
  return "none";
}

/**
 * Stitch a Handlebars context from the user's draft + synthetic placeholders.
 * Mirrors deriveVars() in apps/cli/src/commands/scaffold.ts but with web-safe
 * defaults instead of org/zone lookups.
 */
export function buildVars(stack: DraftStack): Record<string, unknown> {
  const presetId = presetIdFor(stack);
  const databaseSlug = templateDatabaseSlug(stack);
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
    archetype: presetId,
    domain: stack.domain || `${stack.projectName || "my-app"}.example.com`,
    database: databaseSlug,
    envs: stack.envs,
    trigger: stack.trigger,
    access: stack.access,
    hookdeck: stack.hookdeck,
    neon: databaseSlug === "neon",
    turso: databaseSlug === "turso",
    cloudflareZoneId: PLACEHOLDERS.cloudflareZoneId,
    cloudflareZoneApex: PLACEHOLDERS.cloudflareZoneApex,
    createdAt: "1970-01-01T00:00:00.000Z",
    // Expose the full decisions under `d` so fragment templates can branch
    // on sibling axis state (e.g., {{#if (eq d.structure "monorepo")}}).
    d: stack,
  };
}

/**
 * Render the full project for the given stack: `_base/` overlaid with the
 * preset directory, then per-axis fragments, then the optional
 * `_assets/hookdeck-sdk/` copy.
 */
export function renderProject(stack: DraftStack) {
  const vars = buildVars(stack);
  const presetId = presetIdFor(stack);
  const base = renderInMemory(FILES, "_base/", vars);
  const presetLayer = renderInMemory(FILES, `${presetId}/`, vars);

  const layers = [presetLayer];

  // Per-axis fragments mirror the CLI's `renderFragments` in scaffold.ts.
  // Skip "none" / falsy values — those represent "don't add anything".
  const fragmentPairs: [string, string][] = [
    ["structure", stack.structure],
    ["cloudProvider", stack.cloudProvider],
    ["iac", stack.iac],
    ["runtime", stack.runtime],
    ["frontend", stack.frontend],
    ["backend", stack.backend],
    ["docs", stack.docs],
    ["api", stack.api],
    ["database", stack.database],
    ["databaseHost", stack.databaseHost],
    ["orm", stack.orm],
    ["auth", stack.auth],
    ["storage", stack.storage],
    ["payments", stack.payments],
    ["packageManager", stack.packageManager],
    ["envs", stack.envs],
    ["trigger", String(stack.trigger)],
    ["access", String(stack.access)],
    ["hookdeck", String(stack.hookdeck)],
    ["git", String(stack.git)],
    ["install", String(stack.install)],
  ];

  for (const [axis, value] of fragmentPairs) {
    if (!value || value === "none" || value === "false") {
      continue;
    }
    const layer = renderInMemory(FILES, `fragments/${axis}/${value}/`, vars);
    if (layer.length > 0) {
      layers.push(layer);
    }
  }

  for (const addon of stack.addons ?? []) {
    const layer = renderInMemory(FILES, `fragments/addons/${addon}/`, vars);
    if (layer.length > 0) {
      layers.push(layer);
    }
  }

  if (stack.hookdeck) {
    // hookdeck-sdk is copied verbatim (no handlebars) into
    // infra/hookdeck/sdks/hookdeck/ — match the CLI behaviour.
    const sdkLayer: Array<{
      path: string;
      sourcePath: string;
      content: string;
    }> = [];
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

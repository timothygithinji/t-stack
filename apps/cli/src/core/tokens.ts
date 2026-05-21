import { homedir } from "node:os";
import { execa } from "execa";
import { join } from "pathe";

export interface TokenBag {
  cloudflareApiToken: string;
  triggerAccessToken: string;
  /**
   * Hookdeck API key for a specific scaffolded project. Optional because
   * Hookdeck keys are project-scoped (one per Hookdeck project) and only
   * relevant when the scaffolded project enables Hookdeck. Populated at
   * runtime from per-project Doppler config (or directly from init flow).
   */
  hookdeckApiKey?: string;
}

const REQUIRED_KEYS = ["CLOUDFLARE_API_TOKEN", "TRIGGER_ACCESS_TOKEN"] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];

const META_PROJECT_SLUG = "t-stack";
const META_CONFIG = "prd";

function orgScope(orgName: string): string {
  return join(homedir(), ".t-stack", "orgs", orgName);
}

/**
 * Fetch workplace-wide meta tokens for `orgName` from its Doppler workplace's
 * `t-stack/prd` config. Caches them in `process.env` so child processes
 * (Pulumi, wrangler) inherit them.
 *
 * Note: HOOKDECK_API_KEY is intentionally NOT loaded here — Hookdeck API keys
 * are project-scoped (one per Hookdeck project) and live in the per-project
 * Doppler config. See `buildCtx` for how that gets wired up.
 */
export async function loadTokens(orgName: string): Promise<TokenBag> {
  const scope = orgScope(orgName);

  const { stdout } = await execa(
    "doppler",
    [
      "secrets",
      "download",
      `--project=${META_PROJECT_SLUG}`,
      `--config=${META_CONFIG}`,
      "--format=json",
      "--no-file",
      `--scope=${scope}`,
    ],
    { stdio: "pipe" }
  ).catch((err: Error) => {
    throw new Error(
      `Failed to fetch t-stack secrets for "${orgName}" via Doppler. Run \`doppler login --scope ${scope}\` and pick the right workplace. Then run \`t-stack login --org ${orgName}\` to bootstrap. (${err.message})`
    );
  });

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(stdout) as Record<string, string>;
  } catch (err) {
    throw new Error(
      `Doppler returned non-JSON output for t-stack/prd: ${(err as Error).message}`
    );
  }

  const missing: RequiredKey[] = REQUIRED_KEYS.filter((k) => !parsed[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required tokens in ${META_PROJECT_SLUG}/${META_CONFIG} for org "${orgName}": ${missing.join(", ")}. Run \`t-stack login --org ${orgName}\` to set them.`
    );
  }

  const cloudflareApiToken = parsed.CLOUDFLARE_API_TOKEN as string;
  const triggerAccessToken = parsed.TRIGGER_ACCESS_TOKEN as string;

  process.env.CLOUDFLARE_API_TOKEN = cloudflareApiToken;
  process.env.TRIGGER_ACCESS_TOKEN = triggerAccessToken;

  return { cloudflareApiToken, triggerAccessToken };
}

export function clearTokens(): void {
  for (const key of REQUIRED_KEYS) {
    delete process.env[key];
  }
  delete process.env.HOOKDECK_API_KEY;
}

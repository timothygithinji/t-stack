import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { parse as parseJsonc, stringify as stringifyJsonc } from "comment-json";
import { execa } from "execa";
import { join } from "pathe";
import {
  pulumiDestroy as adapterDestroy,
  pulumiUp as adapterUp,
} from "../adapters/pulumi.js";
import type { Ctx } from "../core/preset.ts";
import { resolveZoneForDomain } from "../core/zones.js";

export interface CloudflareOutputs {
  kvNamespaceId: string;
  kvNamespaceTitle: string;
  r2BucketName: string;
  /** Primary user-facing worker URL (solo's `workerUrl`, monorepo's `webUrl`). */
  workerUrl: string;
  /** Monorepo only: API worker URL. */
  serverUrl?: string;
  accessAppId?: string;
}

function infraDir(ctx: Ctx): string {
  return join(ctx.paths.cwd, "infra", "cloudflare");
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function resolveZoneIdForCtx(ctx: Ctx): string {
  const resolved = resolveZoneForDomain(
    ctx.decisions.domain,
    ctx.org.cloudflareZones
  );
  if (!resolved) {
    throw new Error(
      `No Cloudflare zone registered for the apex of "${ctx.decisions.domain}" under org "${ctx.org.name}". Run \`t-stack org zone add ${ctx.org.name} <apex> <zoneId>\` or \`t-stack org zone discover ${ctx.org.name} <apex>\`.`
    );
  }
  return resolved.zoneId;
}

export async function pulumiUp(ctx: Ctx): Promise<CloudflareOutputs> {
  ctx.logger.debug(`cloudflare.pulumiUp workDir=${infraDir(ctx)}`);
  const cloudflareZoneId = resolveZoneIdForCtx(ctx);
  const outputs = await adapterUp({
    workDir: infraDir(ctx),
    stackName: ctx.org.pulumiOrg
      ? `${ctx.org.pulumiOrg}/production`
      : "production",
    tokens: ctx.tokens,
    logger: ctx.logger,
    env: {
      CLOUDFLARE_ACCOUNT_ID: ctx.org.cloudflareAccountId,
      CLOUDFLARE_ZONE_ID: cloudflareZoneId,
    },
  });

  const kvNamespaceId = asString(outputs.kvNamespaceId);
  const kvNamespaceTitle = asString(outputs.kvNamespaceTitle);
  const r2BucketName = asString(outputs.r2BucketName);
  // Solo archetype exports `workerUrl`; monorepo exports `webUrl` + `serverUrl`.
  // The user-facing URL is whichever is available.
  const workerUrl = asString(outputs.workerUrl) ?? asString(outputs.webUrl);

  if (!kvNamespaceId || !kvNamespaceTitle || !r2BucketName || !workerUrl) {
    throw new Error(
      `Cloudflare Pulumi stack missing required outputs. Got keys: ${Object.keys(outputs).join(", ")}`
    );
  }

  const result: CloudflareOutputs = {
    kvNamespaceId,
    kvNamespaceTitle,
    r2BucketName,
    workerUrl,
  };
  const serverUrl = asString(outputs.serverUrl);
  if (serverUrl) {
    result.serverUrl = serverUrl;
  }
  const accessAppId = asString(outputs.accessAppId);
  if (accessAppId) {
    result.accessAppId = accessAppId;
  }
  return result;
}

interface WranglerConfig {
  name?: string;
  kv_namespaces?: Array<{ binding: string; id: string }>;
  r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  [key: string]: unknown;
}

function wranglerPaths(ctx: Ctx): string[] {
  const cwd = ctx.paths.cwd;
  const webPath = join(cwd, "apps", "web", "wrangler.jsonc");
  if (existsSync(webPath)) {
    const out = [webPath];
    const serverPath = join(cwd, "apps", "server", "wrangler.jsonc");
    if (existsSync(serverPath)) {
      out.push(serverPath);
    }
    return out;
  }
  return [join(cwd, "wrangler.jsonc")];
}

async function patchOne(
  ctx: Ctx,
  file: string,
  cfOut: CloudflareOutputs
): Promise<void> {
  ctx.logger.debug(`cloudflare.patchWrangler ${file}`);
  const raw = await readFile(file, "utf8");
  const parsed = parseJsonc(raw, undefined, false) as WranglerConfig | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Failed to parse ${file} as JSONC`);
  }
  parsed.kv_namespaces = [{ binding: "KV", id: cfOut.kvNamespaceId }];
  parsed.r2_buckets = [{ binding: "BUCKET", bucket_name: cfOut.r2BucketName }];
  const next = stringifyJsonc(parsed, null, 2);
  await writeFile(file, `${next}\n`, "utf8");
}

export async function patchWrangler(
  ctx: Ctx,
  cfOut: CloudflareOutputs
): Promise<void> {
  const files = wranglerPaths(ctx);
  for (const file of files) {
    if (!existsSync(file)) {
      ctx.logger.warn(`wrangler.jsonc not found at ${file}, skipping`);
      continue;
    }
    await patchOne(ctx, file, cfOut);
  }
}

function workerDirs(ctx: Ctx): string[] {
  const cwd = ctx.paths.cwd;
  const webPath = join(cwd, "apps", "web", "wrangler.jsonc");
  if (existsSync(webPath)) {
    const out = [join(cwd, "apps", "web")];
    const serverPath = join(cwd, "apps", "server", "wrangler.jsonc");
    if (existsSync(serverPath)) {
      out.push(join(cwd, "apps", "server"));
    }
    return out;
  }
  return [cwd];
}

export async function pushSecrets(
  ctx: Ctx,
  secrets: Record<string, string>
): Promise<void> {
  const dirs = workerDirs(ctx);
  const entries = Object.entries(secrets);
  if (entries.length === 0) {
    return;
  }

  for (const dir of dirs) {
    for (const [key, value] of entries) {
      ctx.logger.debug(`cloudflare.pushSecrets dir=${dir} key=${key}`);
      await execa("wrangler", ["secret", "put", key], {
        cwd: dir,
        input: value,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: ctx.tokens.cloudflareApiToken,
          CLOUDFLARE_ACCOUNT_ID: ctx.org.cloudflareAccountId,
        },
      });
    }
  }
}

export async function deployWorker(
  ctx: Ctx,
  cfOut: CloudflareOutputs
): Promise<{ url: string }> {
  const dirs = workerDirs(ctx);
  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: ctx.tokens.cloudflareApiToken,
    CLOUDFLARE_ACCOUNT_ID: ctx.org.cloudflareAccountId,
  };

  // Shell out to each app's `bun run deploy` so the package.json controls
  // any build-before-deploy step. Solo's script is `wrangler deploy` (no
  // build — main is `src/server.ts`); monorepo apps/web's script is
  // `bun run build && wrangler deploy` because the cloudflare-vite-plugin
  // generates the worker bundle + paired wrangler.json into `dist/` at
  // build time.
  if (dirs.length === 1) {
    ctx.logger.debug(`cloudflare.deployWorker (solo) dir=${dirs[0]}`);
    await execa("bun", ["run", "deploy"], {
      cwd: dirs[0],
      stdio: "pipe",
      env,
    });
  } else {
    ctx.logger.debug(
      `cloudflare.deployWorker (monorepo) dirs=${dirs.join(",")}`
    );
    await Promise.all(
      dirs.map((dir) =>
        execa("bun", ["run", "deploy"], { cwd: dir, stdio: "pipe", env })
      )
    );
  }

  return { url: cfOut.workerUrl };
}

export async function pulumiDestroy(ctx: Ctx): Promise<void> {
  ctx.logger.debug(`cloudflare.pulumiDestroy workDir=${infraDir(ctx)}`);
  const cloudflareZoneId = resolveZoneIdForCtx(ctx);
  await adapterDestroy({
    workDir: infraDir(ctx),
    stackName: ctx.org.pulumiOrg
      ? `${ctx.org.pulumiOrg}/production`
      : "production",
    tokens: ctx.tokens,
    logger: ctx.logger,
    env: {
      CLOUDFLARE_ACCOUNT_ID: ctx.org.cloudflareAccountId,
      CLOUDFLARE_ZONE_ID: cloudflareZoneId,
    },
  });
}

/**
 * Remove the deployed Worker(s) and their custom domains via `wrangler delete`.
 * Idempotent — soft-success when the worker is already gone.
 */
export async function deleteWorker(ctx: Ctx): Promise<void> {
  const dirs = workerDirs(ctx);
  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: ctx.tokens.cloudflareApiToken,
    CLOUDFLARE_ACCOUNT_ID: ctx.org.cloudflareAccountId,
  };
  for (const dir of dirs) {
    ctx.logger.debug(`cloudflare.deleteWorker dir=${dir}`);
    try {
      await execa("wrangler", ["delete", "--force"], {
        cwd: dir,
        stdio: "pipe",
        env,
      });
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      if (/not found|does not exist|10007/i.test(stderr)) {
        ctx.logger.debug(
          `cloudflare.deleteWorker worker already gone (${dir})`
        );
        continue;
      }
      throw err;
    }
  }
}

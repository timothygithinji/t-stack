import { execa } from "execa";
import type { Ctx } from "../core/preset.ts";
import * as doppler from "./doppler.js";

export interface TursoRefs {
  databaseName: string;
  url: string;
  authToken: string;
  connectionString: string;
}

const DEFAULT_GROUP = "default";

function tursoEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

async function getDbUrl(name: string): Promise<string> {
  const { stdout } = await execa("turso", ["db", "show", name, "--url"], {
    stdio: "pipe",
    env: tursoEnv(),
  });
  return stdout.trim();
}

/**
 * Probe whether a Turso db with `name` exists by attempting to read its URL.
 * Returns the URL when present, `undefined` when the CLI reports it missing,
 * and re-throws other failures (auth, network) so the caller can surface them.
 */
async function findExistingDb(name: string): Promise<string | undefined> {
  try {
    return await getDbUrl(name);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (/not found|does not exist|no such|could not find/i.test(stderr)) {
      return;
    }
    throw err;
  }
}

async function createAuthToken(name: string): Promise<string> {
  const { stdout } = await execa("turso", ["db", "tokens", "create", name], {
    stdio: "pipe",
    env: tursoEnv(),
  });
  return stdout.trim();
}

function buildConnectionString(url: string, authToken: string): string {
  // `turso db show --url` returns something like libsql://name-org.turso.io
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}authToken=${authToken}`;
}

export async function create(ctx: Ctx): Promise<TursoRefs> {
  const name = ctx.projectName;
  ctx.logger.debug(
    `turso.create name=${name} recreateMode=${ctx.recreateMode ?? "default"}`
  );

  // Lookup-first idempotency mirrors neon.create — Turso historically returned
  // "already exists" on duplicates but relying on stderr-pattern matching is
  // brittle across CLI versions. Probing first keeps the plugin honest.
  const skipLookup = ctx.recreateMode === "new";
  let url = skipLookup ? undefined : await findExistingDb(name);

  if (url) {
    ctx.logger.info(`turso.create: reusing existing db "${name}"`);
  } else {
    if (ctx.recreateMode === "adopt") {
      throw new Error(
        `turso.create asked to adopt an existing db "${name}" but none was found.`
      );
    }
    ctx.logger.info(`turso.create: creating new db "${name}"`);
    try {
      await execa(
        "turso",
        ["db", "create", name, "--group", DEFAULT_GROUP, "--output", "json"],
        { stdio: "pipe", env: tursoEnv() }
      );
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      if (/unknown flag.*output/i.test(stderr)) {
        // Older turso CLIs don't support --output json; retry without.
        await execa("turso", ["db", "create", name, "--group", DEFAULT_GROUP], {
          stdio: "pipe",
          env: tursoEnv(),
        });
      } else {
        throw err;
      }
    }
    url = await getDbUrl(name);
  }

  const authToken = await createAuthToken(name);
  const connectionString = buildConnectionString(url, authToken);

  // Keep Doppler in sync with the resource we just owned. Idempotent: writing
  // the same value is a cheap upsert. See neon.create for the same pattern.
  try {
    await doppler.setProjectSecret(ctx, "DATABASE_URL", connectionString);
  } catch (err) {
    ctx.logger.debug(
      `turso.create: pushing DATABASE_URL to Doppler failed: ${(err as Error).message}`
    );
  }

  return { databaseName: name, url, authToken, connectionString };
}

/**
 * Liveness check for the plugin-graph verify-on-skip flow. Returns false when
 * the Turso db recorded in state.json has been deleted out-of-band.
 */
export async function verifyExists(
  _ctx: Ctx,
  refs: Record<string, unknown>
): Promise<boolean> {
  const dbName = refs.databaseName;
  if (typeof dbName !== "string" || dbName.length === 0) {
    return false;
  }
  const url = await findExistingDb(dbName);
  return url !== undefined;
}

export async function destroy(ctx: Ctx, refs: TursoRefs): Promise<void> {
  ctx.logger.debug(`turso.destroy db=${refs.databaseName}`);
  await execa("turso", ["db", "destroy", refs.databaseName, "--yes"], {
    stdio: "pipe",
    env: tursoEnv(),
  });
}

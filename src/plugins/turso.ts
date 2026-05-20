import { execa } from "execa";
import type { Ctx } from "../core/preset.ts";

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
  ctx.logger.debug(`turso.create name=${name}`);

  let url: string;
  try {
    await execa(
      "turso",
      ["db", "create", name, "--group", DEFAULT_GROUP, "--output", "json"],
      { stdio: "pipe", env: tursoEnv() }
    );
    url = await getDbUrl(name);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (/already exists/i.test(stderr)) {
      ctx.logger.debug(`turso.create db ${name} already exists, fetching url`);
      url = await getDbUrl(name);
    } else {
      // Some turso CLI versions don't support --output json; fall back to no-flag.
      if (/unknown flag.*output/i.test(stderr)) {
        try {
          await execa(
            "turso",
            ["db", "create", name, "--group", DEFAULT_GROUP],
            {
              stdio: "pipe",
              env: tursoEnv(),
            }
          );
          url = await getDbUrl(name);
        } catch (err2) {
          const stderr2 = (err2 as { stderr?: string }).stderr ?? "";
          if (/already exists/i.test(stderr2)) {
            url = await getDbUrl(name);
          } else {
            throw err2;
          }
        }
      } else {
        throw err;
      }
    }
  }

  const authToken = await createAuthToken(name);
  const connectionString = buildConnectionString(url, authToken);
  return { databaseName: name, url, authToken, connectionString };
}

export async function destroy(ctx: Ctx, refs: TursoRefs): Promise<void> {
  ctx.logger.debug(`turso.destroy db=${refs.databaseName}`);
  await execa("turso", ["db", "destroy", refs.databaseName, "--yes"], {
    stdio: "pipe",
    env: tursoEnv(),
  });
}

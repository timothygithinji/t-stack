{{#if neon}}
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Database = ReturnType<typeof getDb>;

export function getDb(env: { DATABASE_URL: string }) {
  const sql = neon(env.DATABASE_URL);
  return drizzle(sql, { schema });
}

export * from "./schema";
{{/if}}
{{#if turso}}
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Database = ReturnType<typeof getDb>;

export function getDb(env: { DATABASE_URL: string; DATABASE_AUTH_TOKEN?: string }) {
  const client = createClient({
    url: env.DATABASE_URL,
    authToken: env.DATABASE_AUTH_TOKEN,
  });
  return drizzle(client, { schema });
}

export * from "./schema";
{{/if}}

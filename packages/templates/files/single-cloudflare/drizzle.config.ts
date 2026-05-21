import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
{{#if neon}}
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
{{/if}}
{{#if turso}}
  dialect: "sqlite",
  driver: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
{{/if}}
  verbose: true,
  strict: true,
});

import { Hono } from "hono";
import { getDb } from "@{{projectName}}/db";

export type Env = {
  DATABASE_URL: string;
  {{#if trigger}}TRIGGER_SECRET_KEY: string;
  {{/if}}{{#if hookdeck}}HOOKDECK_API_KEY: string;
  {{/if}}KV: KVNamespace;
  R2: R2Bucket;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));

app.get("/", (c) => {
  // Touch the db factory so the import is tree-shake-safe.
  const _db = getDb(c.env.DATABASE_URL);
  return c.json({ name: "{{projectName}}", service: "server" });
});

export default app;

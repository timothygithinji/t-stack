import { Hono } from "hono";
{{#if betterAuth}}
import { createAuth } from "./lib/auth";
{{/if}}

export type Env = {
  // Secrets
  DATABASE_URL: string;
{{#if betterAuth}}
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
{{/if}}
{{#if trigger}}
  TRIGGER_SECRET_KEY: string;
{{/if}}
{{#if hookdeck}}
  HOOKDECK_API_KEY: string;
{{/if}}

  // Bindings (populated by Pulumi via `t-stack provision`).
  KV: KVNamespace;
  BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("Hello from {{projectName}}"));

app.get("/health", (c) => c.json({ ok: true }));

{{#if betterAuth}}
// Better Auth handler — owns sign-in / sign-up / session / OAuth callback
// routes under /api/auth/*. Reconstructed per request so it picks up env
// bindings (Neon needs DATABASE_URL at call time).
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw)
);
{{/if}}

{{#if hookdeck}}
app.post("/webhooks/hookdeck", async (c) => {
  // Hookdeck retries on non-2xx, so acknowledge fast and process async.
  const payload = await c.req.json().catch(() => ({}));
  console.log("hookdeck webhook", payload);
  return c.json({ received: true });
});
{{/if}}

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;

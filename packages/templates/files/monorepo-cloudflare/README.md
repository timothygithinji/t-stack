# {{projectName}}

A `monorepo-cloudflare` t-stack project: Bun workspaces + Turbo, deployed to Cloudflare Workers.

## Apps

- `apps/web` — React 19 + Vite + TanStack Start on a Cloudflare Worker (`{{domain}}`)
- `apps/server` — Hono API on a Cloudflare Worker (`api.{{domain}}`)
{{#if trigger}}- `apps/trigger` — Trigger.dev background jobs
{{/if}}

## Packages

- `packages/db` — Drizzle ORM + Neon serverless driver
- `packages/ui` — Shared React components
- `packages/types` — Shared Zod schemas + inferred types
- `packages/tsconfig` — Shared TypeScript configs (base / worker / react)

## Infra

- `infra/cloudflare` — Pulumi project managing KV + R2 bindings for both Workers
{{#if hookdeck}}- `infra/hookdeck` — Pulumi project managing Hookdeck source/destination/connection
{{/if}}

## Develop

```bash
bun install
cp .dev.vars.example .dev.vars
bun dev
```

Turbo orchestrates `bun dev` across every workspace.

## Deploy

```bash
bun run build
bun run deploy
```

## Provision infrastructure

```bash
t-stack provision
```

Runs the Pulumi projects under `infra/` and writes resulting bindings back into each Worker's `wrangler.jsonc`.

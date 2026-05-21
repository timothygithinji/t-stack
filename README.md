# t-stack

Monorepo for [`@timothygithinji/t-stack`](./apps/cli) — a personal project bootstrapper that scaffolds, provisions, and deploys.

## Layout

```
apps/
  cli/          Published as @timothygithinji/t-stack on npm
  web/          Stack builder UI (t-stack.timothygithinji.com/new)
packages/
  schema/       Zod schema + meta-hint contract (single source of truth)
  presets/      Preset metadata (id, description, templates list)
  templates/    Handlebars template files
  templating/   Shared rendering logic
```

## Working in the monorepo

```bash
bun install            # installs everything
bun run build          # turbo: build all packages
bun run dev            # turbo: dev all packages
bun run test           # turbo: test all packages
bun run typecheck      # turbo: typecheck all packages
```

Per-package work: `bun --filter @timothygithinji/t-stack <script>`.

CLI docs live in [`apps/cli/README.md`](./apps/cli/README.md). Contributor docs in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

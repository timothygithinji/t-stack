# t-stack

> Personal project bootstrapper that goes beyond scaffolding — creates cloud resources, pushes secrets, deploys.

`create-better-t-stack` writes files. `t-stack` writes files **and** provisions Cloudflare bindings, Neon branches, Doppler projects, GitHub repos with OIDC, Pulumi stacks, and points a custom domain — then deploys the Worker and pushes the first commit.

## What it does

- **Scaffolds** a typed `t-stack.config.ts` + a full repo (Vite + TanStack Start, or Bun-workspace monorepo) from vendored templates
- **Provisions** Cloudflare (KV, R2, optional Access app), Neon Postgres, Doppler projects + envs, GitHub repo + Doppler-OIDC GHA vars, optional Trigger.dev + Hookdeck — all via Pulumi Automation API where it makes sense
- **Syncs secrets** from Doppler (`prd`) into Cloudflare Worker secrets, GitHub Actions OIDC vars, and Trigger.dev env vars
- **Deploys** the Worker via `wrangler` (custom domain wired automatically), then pushes the initial commit
- **Idempotent + resumable**: every step writes to a committed `.t-stack/state.json`, so re-running picks up where it left off

## Status

**v0.1** — single-org workflows on `solo-cf-worker` and `monorepo-cf` are proven via an automated end-to-end smoke test (create → HTTP 200 → destroy). Existing-repo adoption, multi-region preview envs, and Upstash Redis are deferred to v0.2.

## Quick start

```bash
# 1. Sanity-check the environment
bunx @timothygithinji/t-stack@latest doctor

# 2. Install the Doppler CLI and authenticate per org
#    https://docs.doppler.com/docs/install-cli
doppler login --scope ~/.t-stack/orgs/<orgName>

# 3. Make sure these CLIs are installed and authed:
gh auth status          # GitHub CLI
pulumi whoami           # Pulumi
neonctl me              # Neon CLI

# 4. Mint two API tokens (one-time per org):
#    - Cloudflare API token        → https://dash.cloudflare.com/profile/api-tokens
#                                     (Account: Workers Scripts:Edit, R2 Edit, Account Settings Read;
#                                      Zone: DNS Edit, Workers Routes Edit)
#    - Trigger.dev personal token  → https://cloud.trigger.dev/account/tokens

# 5. Register the org once
t-stack org add <name> \
  --cf-account <accountId> \
  --cf-zone <apex>=<zoneId> \
  --default-domain <apex> \
  --github-owner <login-or-org> \
  --doppler-workplace "Personal" \
  --pulumi-org <pulumi-org> \
  --neon-org-id org-xxx-xxxxxx \
  --trigger-org-slug <trigger-org-slug>

# 6. Bootstrap meta tokens into Doppler's t-stack project
t-stack login --org <name>

# 7. Verify everything is wired up
t-stack doctor

# 8. Scaffold + provision + deploy in one shot
t-stack init my-app
```

## Commands

| Command | Purpose |
| --- | --- |
| `t-stack init [name]` | Gated wizard: prompts → scaffold → provision? → deploy? → commit? |
| `t-stack scaffold` | Files only, no cloud calls |
| `t-stack provision [--only <plugin>]` | Runs preset steps; idempotent and resumable from `state.json` |
| `t-stack deploy [--target app\|infra\|all]` | Pulumi up + `wrangler deploy` |
| `t-stack destroy [--force] [--only <plugin>]` | Reverse-order teardown of cloud resources |
| `t-stack secrets sync [--env prd]` | Doppler → Cloudflare Worker + GHA OIDC vars + Trigger.dev |
| `t-stack secrets pull [--env dev]` | Doppler → local `.dev.vars` |
| `t-stack doctor` | Audits CLI auth, meta tokens, and state-vs-reality drift |
| `t-stack login --org <name>` | One-time meta-token bootstrap into Doppler |
| `t-stack org add\|list\|show\|remove` | Manage `~/.t-stack/orgs.toml` profiles |
| `t-stack org zone add\|list\|remove\|discover` | Manage Cloudflare apex → zoneId mappings |
| `t-stack org trigger list\|discover\|set` | Resolve and pin a Trigger.dev org slug |

## Archetypes

- **`solo-cf-worker`** — Vite + TanStack Start on Cloudflare Workers, single `package.json`, Drizzle + Neon (or Turso) optional.
- **`monorepo-cf`** — Bun workspaces: `apps/web` (Vite + TanStack Start) + `apps/server` (Hono on CF Workers) + `packages/{db,ui,types,tsconfig}`, optional `apps/trigger`.

Both archetypes ship a `_base` overlay with Biome + Ultracite, Husky, release-it, and reusable GHA `setup` / `fetch-secrets` actions wired for Doppler OIDC.

## Why

Every new project starts with 2–3 days of grunt work: copying configs from the last repo, creating CF bindings by hand, registering Hookdeck sources, setting up Doppler envs, pushing API keys into Cloudflare and Trigger.dev, wiring OIDC for Actions, pointing a custom domain. `t-stack` closes that gap for one person's specific stack so a fresh idea can go from `bunx ... init` to `https://my-app.example.com → 200` in a single command.

## Built on

[Citty](https://citty.unjs.io/) · [Clack](https://www.clack.cc/) · [Pulumi Automation API](https://www.pulumi.com/docs/iac/packages-and-automation/automation-api/) · [Bun](https://bun.com/) · [Doppler](https://www.doppler.com/) · [Cloudflare Workers](https://workers.cloudflare.com/) · [Neon](https://neon.tech/) · [GitHub](https://docs.github.com/en/rest) · [Trigger.dev](https://trigger.dev/) · [Hookdeck](https://hookdeck.com/)

## Development

```bash
bun install
bun run dev -- init my-app    # iterate against src/cli.ts
bun run test                  # vitest + MSW (88 tests)
bun run typecheck
bun run build                 # bundle to dist/cli.js
```

End-to-end smoke against a real org (creates → probes → destroys real cloud resources):

```bash
SMOKE_ORG=<org> SMOKE_APEX=<apex> bun run smoke
# SMOKE_ARCHETYPE=monorepo-cf to exercise the workspace archetype
# SMOKE_SKIP_DESTROY=1 to leave resources up for inspection
```

See [`scripts/smoke.ts`](./scripts/smoke.ts) for the full env-var contract.

## Releasing

Releases are driven by a manually-triggered GitHub Action — **never run from a developer's machine**. The workflow uses [release-it](https://github.com/release-it/release-it) + [Conventional Commits](https://www.conventionalcommits.org/) to bump the version, update `CHANGELOG.md`, tag, create a GitHub release, and publish to npm (with provenance).

**One-time setup:**
1. Create an [npm automation access token](https://docs.npmjs.com/creating-and-viewing-access-tokens) (granular, **publish** access to `@timothygithinji/t-stack`).
2. Store it in Doppler — project `t-stack`, config `prd`, key `NPM_TOKEN`.
3. Create a Doppler **Service Token** scoped to `t-stack/prd` (Doppler dashboard → project `t-stack` → `prd` config → Access tab → "Generate" service token; or `doppler configs tokens create release --project t-stack --config prd --plain`).
4. Add the service token as a repo secret: `gh secret set DOPPLER_TOKEN`.

Doppler stays the source of truth for `NPM_TOKEN` (and any future CI secrets). The release workflow uses the read-only, config-scoped service token to fetch them into `$GITHUB_ENV` at runtime, then publishes with npm provenance. The only long-lived credential in GitHub is the narrow Doppler service token — `NPM_TOKEN` itself never lives there.

> When you move to a Doppler Team plan, swap step 3/4 for an OIDC Identity (eliminates the long-lived service token).

**To release:**
1. Push your conventional-commit changes to `main`.
2. Go to **Actions → Release → Run workflow**. Leave "version bump" blank to auto-detect from commits, or pick `patch`/`minor`/`major`/`prerelease` explicitly.
3. Workflow lints, typechecks, tests, builds, then bumps + tags + publishes.

**Local preview** (no side effects):

```bash
bun run release:dry        # preview the version + CHANGELOG diff release-it would produce
```

Husky enforces locally:
- `commit-msg` → commitlint (conventional format)
- `pre-commit` → Biome (lint) + tsc (typecheck)
- `pre-push` → vitest

CI runs the same gates on every push/PR (`.github/workflows/ci.yml`) and again before any release (`.github/workflows/release.yml`).

## License

[MIT](./LICENSE) © Timothy Githinji

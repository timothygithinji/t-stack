# t-stack

> Personal project bootstrapper that goes beyond scaffolding — creates cloud resources, pushes secrets, deploys.

`create-better-t-stack` writes files. `t-stack` writes files **and** provisions Cloudflare bindings, Neon branches, Doppler projects, GitHub repos with OIDC, Pulumi stacks, and points a custom domain — then deploys the Worker and pushes the first commit.

```bash
bunx @timothygithinji/t-stack@latest init my-app
# → https://my-app.example.com returning 200 in one command
```

## What it does

- **Scaffolds** a typed `t-stack.config.ts` + a full repo (Vite + TanStack Start, or Bun-workspace monorepo) from vendored templates
- **Provisions** Cloudflare (KV, R2, optional Access app), Neon Postgres, Doppler projects + envs, GitHub repo + Doppler-OIDC GHA vars, optional Trigger.dev + Hookdeck — all via Pulumi Automation API where it makes sense
- **Syncs secrets** from Doppler (`prd`) into Cloudflare Worker secrets, GitHub Actions OIDC vars, and Trigger.dev env vars
- **Deploys** the Worker via `wrangler` (custom domain wired automatically), then pushes the initial commit
- **Idempotent + resumable**: every step writes to a committed `.t-stack/state.json`, so re-running picks up where it left off

## Running t-stack

You don't need to install anything — invoke via `bunx` (or `npx`) so you always get the latest published version:

```bash
bunx @timothygithinji/t-stack@latest <command>
# or
npx  @timothygithinji/t-stack@latest <command>
```

If you'll be running it more than a couple of times, drop this alias in your shell rc so the examples below stay short:

```bash
alias t-stack="bunx @timothygithinji/t-stack@latest"
```

(All examples in this README assume that alias. Without it, just prefix every command with `bunx @timothygithinji/t-stack@latest`.)

## Before you start

You need accounts for the cloud services t-stack drives, plus a handful of CLIs on your PATH. t-stack itself talks to remote APIs for everything else.

**Accounts**

- [Cloudflare](https://dash.cloudflare.com/) (account + at least one zone you control)
- [Doppler](https://dashboard.doppler.com/) (free tier is fine)
- [GitHub](https://github.com/) (user or org for the new repo)
- [Neon](https://console.neon.tech/) — only if you'll use Postgres
- [Pulumi Cloud](https://app.pulumi.com/) (free for individuals)
- [Trigger.dev](https://cloud.trigger.dev/) — optional
- [Hookdeck](https://dashboard.hookdeck.com/) — optional (per-project API key)

**CLIs** (`t-stack doctor` will tell you which are missing)

| CLI | Install | Why |
| --- | --- | --- |
| `doppler` | [docs](https://docs.doppler.com/docs/install-cli) | secrets backend |
| `gh` | `brew install gh` | repo creation, OIDC setup |
| `pulumi` | [docs](https://www.pulumi.com/docs/iac/download-install/) | IaC for CF/Neon/Trigger |
| `neonctl` | `npm i -g neonctl` | only if `--db neon` |
| `turso` | [docs](https://docs.turso.tech/cli/installation) | only if `--db turso` |
| `wrangler` | comes via `bunx wrangler` | Worker deploy |

Then authenticate each one (`gh auth login`, `pulumi login`, `neonctl auth`, etc.). `t-stack doctor` audits all of this in one shot.

## Quick start

```bash
# 1. Health-check your environment (works before any setup — tells you what's missing).
t-stack doctor

# 2. Authenticate the Doppler CLI against the workplace this org should write to.
doppler login --scope ~/.t-stack/orgs/<orgName>

# 3. Mint two API tokens (one-time per org):
#    - Cloudflare API token        → https://dash.cloudflare.com/profile/api-tokens
#                                     (Account: Workers Scripts:Edit, R2 Edit, Account Settings Read;
#                                      Zone: DNS Edit, Workers Routes Edit)
#    - Trigger.dev personal token  → https://cloud.trigger.dev/account/tokens

# 4. Register the org once. Picks up your Cloudflare account id, default apex,
#    Doppler workplace name, Pulumi org, Neon org id, Trigger.dev org slug.
t-stack org add <name> \
  --cf-account <accountId> \
  --cf-zone <apex>=<zoneId> \
  --default-domain <apex> \
  --github-owner <login-or-org> \
  --doppler-workplace "Personal" \
  --pulumi-org <pulumi-org> \
  --neon-org-id org-xxx-xxxxxx \
  --trigger-org-slug <trigger-org-slug>

# 5. Push the meta tokens into Doppler's t-stack project (one-time per org).
t-stack login --org <name>

# 6. Re-run doctor — everything should be green now.
t-stack doctor

# 7. Scaffold + provision + deploy in one shot.
t-stack init my-app
```

From here on, all you need for a new project is step 7. Steps 2–6 are one-time per org.

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

Every command accepts `--help` for full flag listings.

## When something breaks

- **A provision step fails partway through?** Re-run `t-stack provision --cwd ./my-app`. Each step records its outcome to `.t-stack/state.json`; completed steps are skipped on the next run.
- **Cloud state and local state look out of sync?** `t-stack doctor --cwd ./my-app` cross-checks zone ids, tokens, Doppler projects, and per-step status against reality.
- **Want to start over?** `t-stack destroy --cwd ./my-app` reverses every step in order. Re-run `init` after.

## Why

Every new project starts with 2–3 days of grunt work: copying configs from the last repo, creating CF bindings by hand, registering Hookdeck sources, setting up Doppler envs, pushing API keys into Cloudflare and Trigger.dev, wiring OIDC for Actions, pointing a custom domain. `t-stack` closes that gap for one person's specific stack so a fresh idea can go from `bunx ... init` to `https://my-app.example.com → 200` in a single command.

## Built on

[Citty](https://citty.unjs.io/) · [Clack](https://www.clack.cc/) · [Pulumi Automation API](https://www.pulumi.com/docs/iac/packages-and-automation/automation-api/) · [Bun](https://bun.com/) · [Doppler](https://www.doppler.com/) · [Cloudflare Workers](https://workers.cloudflare.com/) · [Neon](https://neon.tech/) · [GitHub](https://docs.github.com/en/rest) · [Trigger.dev](https://trigger.dev/) · [Hookdeck](https://hookdeck.com/)

## Contributing

Working on t-stack itself — running the source, smoke tests, or cutting a release — is covered in [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Timothy Githinji

---

*Published with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) — no tokens, OIDC end-to-end. Every release is cryptographically signed and traceable back to the exact GitHub Actions workflow run.*

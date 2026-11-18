# Contributing to t-stack

This file covers running t-stack from source, the smoke test, and the release pipeline. End-user documentation lives in [README.md](./README.md).

## Development

```bash
bun install
bun run dev -- init my-app    # iterate against src/cli.ts
bun run test                  # vitest + MSW
bun run typecheck
bun run build                 # bundle to dist/cli.js
```

Husky keeps local hooks fast:

- `commit-msg` → commitlint (conventional format)
- `pre-commit` → Biome on staged files

Lint, typecheck, tests and build run in CI (`.github/workflows/ci.yml`) on every PR and push to `main`, and again as the first job of every release (`.github/workflows/release.yml`).

`main` is protected: changes land via pull request, and the `CI` check must pass before merging. Force-pushes and branch deletion are blocked.

## Smoke test

End-to-end smoke against a real org (creates → probes → destroys real cloud resources):

```bash
SMOKE_ORG=<org> SMOKE_APEX=<apex> bun run smoke
# SMOKE_ARCHETYPE=monorepo-cloudflare to exercise the workspace archetype
# SMOKE_SKIP_DESTROY=1 to leave resources up for inspection
```

See [`scripts/smoke.ts`](./scripts/smoke.ts) for the full env-var contract.

## Releasing

Releases are driven by a manually-triggered GitHub Action — **never run from a developer's machine**. The workflow uses [release-it](https://github.com/release-it/release-it) + [Conventional Commits](https://www.conventionalcommits.org/) to work out the next version, tag it, create a GitHub release with generated notes, and publish to npm (with provenance).

There is no `CHANGELOG.md` and no release commit. Git tags (`vX.Y.Z`) are the source of truth for versions, and [GitHub Releases](https://github.com/timothygithinji/t-stack/releases) are the changelog. `apps/cli/package.json` stays at `0.0.0-development` in the repo; CI sets the real version just before publishing.

### One-time setup

Uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (no tokens, OIDC end-to-end, 2FA stays enforced for human flows):

1. On [npmjs.com/package/@timothygithinji/t-stack/access](https://www.npmjs.com/package/@timothygithinji/t-stack/access), under **Trusted Publishers**, click **Add trusted publisher** → **GitHub Actions** and fill in:
   - Organization or user: `timothygithinji`
   - Repository: `t-stack`
   - Workflow filename: `release.yml`
   - Environment: (leave blank)
2. (For the very first publish only, before the package exists on npm) publish v0.1.0 locally once: `npm publish --otp=<6-digit-code>` — then enable trusted publishing for subsequent releases.

No `NPM_TOKEN`, no Doppler service token, no long-lived secrets anywhere. The release workflow's `id-token: write` permission lets the npm CLI exchange a GitHub OIDC token for a short-lived npm publish credential at runtime. Provenance is automatic — every package version is cryptographically signed and traceable back to the exact CI run.

### Cutting a release

Merge a PR with conventional commits into `main`. The Release workflow runs on every push that touches shipped files and:

- exits cleanly if no `feat`/`fix`/`perf` commits since the last tag (so `docs`/`chore`/`refactor` pushes are no-ops)
- otherwise runs CI, computes the version (semver from commit types since the last tag), publishes to npm, pushes the tag, and creates the GitHub release

For an out-of-band release (e.g. CI was flaky and you want to re-run the release pipeline), trigger manually from **Actions → Release → Run workflow** — the workflow accepts an optional "reason" input that gets logged for the audit trail.

### Local preview (no side effects)

```bash
bun run release:dry        # preview the next version + release notes
```

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

Husky enforces locally:

- `commit-msg` → commitlint (conventional format)
- `pre-commit` → Biome (lint) + tsc (typecheck)
- `pre-push` → vitest

CI runs the same gates on every push/PR (`.github/workflows/ci.yml`) and again before any release (`.github/workflows/release.yml`).

## Smoke test

End-to-end smoke against a real org (creates → probes → destroys real cloud resources):

```bash
SMOKE_ORG=<org> SMOKE_APEX=<apex> bun run smoke
# SMOKE_ARCHETYPE=monorepo-cf to exercise the workspace archetype
# SMOKE_SKIP_DESTROY=1 to leave resources up for inspection
```

See [`scripts/smoke.ts`](./scripts/smoke.ts) for the full env-var contract.

## Releasing

Releases are driven by a manually-triggered GitHub Action — **never run from a developer's machine**. The workflow uses [release-it](https://github.com/release-it/release-it) + [Conventional Commits](https://www.conventionalcommits.org/) to bump the version, update `CHANGELOG.md`, tag, create a GitHub release, and publish to npm (with provenance).

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

Just push conventional-commit changes to `main`. The Release workflow runs on every push and:

- exits cleanly if no `feat`/`fix`/`perf` commits since the last tag (so `docs`/`chore`/`refactor` pushes are no-ops)
- otherwise bumps the version (semver from commit types), updates `CHANGELOG.md`, tags, creates the GitHub release, and publishes to npm

For an out-of-band release (e.g. CI was flaky and you want to re-run the release pipeline), trigger manually from **Actions → Release → Run workflow** — the workflow accepts an optional "reason" input that gets logged for the audit trail.

### Local preview (no side effects)

```bash
bun run release:dry        # preview the version + CHANGELOG diff release-it would produce
```

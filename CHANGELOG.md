# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-20

Initial public release. Single-org workflows on the `solo-cf-worker` and
`monorepo-cf` archetypes are proven end-to-end via the automated smoke test
(create → HTTP 200 over the custom domain → destroy).

The v0.1 architecture made one significant shift from the original plan:
**Doppler replaced Infisical** as the secrets backend, primarily because
Doppler's GitHub Actions OIDC story is first-class and its CLI scoping model
(`doppler configure --scope`) maps cleanly to t-stack's per-org config dirs.

### Added

- `t-stack init|scaffold|provision|deploy|destroy` command surface
- `t-stack secrets sync` (Doppler → Cloudflare Worker + GHA OIDC vars + Trigger.dev)
  and `secrets pull` (Doppler → `.dev.vars`)
- `t-stack doctor` — audits CLI installs, Doppler auth, meta tokens, and
  per-step state-vs-reality drift
- `t-stack login --org <name>` — bootstraps the `t-stack` Doppler project
  with Cloudflare and Trigger.dev tokens
- `t-stack org add|list|show|remove` plus `org zone add|list|remove|discover`
  and `org trigger list|discover|set` subcommands
- Pulumi Automation API adapter driving generated `infra/cloudflare/` and
  `infra/hookdeck/` projects (auto-installs deps, streams logs, persists outputs)
- Doppler OIDC integration for GitHub Actions out of the box, including
  reusable `setup` and `fetch-secrets` composite actions in `templates/_base/`
- End-to-end smoke script (`scripts/smoke.ts`) covering both archetypes,
  including dig-based DNS probing because Node's resolver doesn't see
  Cloudflare's edge-synthesised A records

### Changed

- **Secrets backend: Infisical → Doppler.** Touches `plugins/doppler.ts`,
  `commands/login.ts`, `commands/doctor.ts`, `commands/secrets.ts`, and the
  generated `_base` GHA composite actions
- State writer now redacts well-known secret keys (`*_TOKEN`, `*_KEY`,
  `*_SECRET`, connection strings, etc.) before persisting `.t-stack/state.json`
  so the file is safe to commit
- Spinner output is TTY-aware: non-interactive runs (CI, smoke) downgrade to
  plain log lines instead of spamming ANSI escapes; the Doppler-OIDC info line
  is now a `log.info` rather than a `log.success` since it's informational

### Fixed

- `libsodium-wrappers` ESM workaround so the bundled CLI loads under Node's
  ESM loader without a top-level-await deadlock
- `@pulumi/cloudflare` v5 config namespace migration — `cloudflare:apiToken`
  is now set on the correct provider config block
- `cloudflare.deleteWorker` step added to `destroy` so smoke teardown actually
  removes the Worker (Pulumi only managed bindings, not the Worker itself)
- Smoke probe rewritten to resolve via `dig @1.1.1.1` + `curl --resolve`
  because Node's DNS resolver can't see CF edge-synthesised records during
  initial propagation
- `neon destroy` no longer passes the removed `--confirm` flag on newer
  `neonctl` versions
- GitHub initial push uses the HTTPS remote so `gh auth`'s credential helper
  is picked up without requiring a configured SSH key

[0.1.0]: https://github.com/timothygithinji/t-stack/releases/tag/v0.1.0

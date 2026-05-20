# Changelog

## [0.1.2](https://github.com/timothygithinji/t-stack/compare/v0.1.1...v0.1.2) (2026-05-20)

### Build System

* **deps:** bump @biomejs/biome to 2.4.15 and ultracite to 7.7.0 ([da2bbfc](https://github.com/timothygithinji/t-stack/commit/da2bbfce909c78752b30b6c5fe8ae0a17d4fd020))
* **deps:** bump @clack/prompts to 1.4.0 ([a439b2c](https://github.com/timothygithinji/t-stack/commit/a439b2c2268b244bfacd83a3a7b82a83ec125cff))
* **deps:** bump @octokit/rest to 22.0.1 ([b79c4a2](https://github.com/timothygithinji/t-stack/commit/b79c4a2baa5bcf0c61e25e1aa9f4f6e0c3da625f))
* **deps:** bump @pulumi/cloudflare to 6.16.0 ([95aaaee](https://github.com/timothygithinji/t-stack/commit/95aaaeef50ea902e158da62fe598eed000a8bd9c))
* **deps:** bump citty 0.2.2, comment-json 5.0.0, pathe 2.0.3 ([4b81957](https://github.com/timothygithinji/t-stack/commit/4b819578c98e450104a13c4c59d6bb8d0ce40001))
* **deps:** bump commitlint 21, @types/node 25, msw 2.14, husky/types-proper-lockfile pinned ([fedd0a7](https://github.com/timothygithinji/t-stack/commit/fedd0a7e46a85d616d062ae38a39e96a5e0082de))
* **deps:** bump consola/execa/handlebars/ofetch/smol-toml + pin @pulumi/pulumi 3.242 ([f7ae5bf](https://github.com/timothygithinji/t-stack/commit/f7ae5bf4cb9fea8789c571575df4e3ed111d6f3a))
* **deps:** bump libsodium-wrappers to 0.8.4 ([63b82ce](https://github.com/timothygithinji/t-stack/commit/63b82cee670c1c6e3a5a6f340145edbc109e5459))
* **deps:** bump release-it 20.0.1 + @release-it/conventional-changelog 11.0.0 ([35c041d](https://github.com/timothygithinji/t-stack/commit/35c041df77233ad67781c785e0b5f66634f83b60))
* **deps:** bump typescript to 6.0.3 ([e8e7502](https://github.com/timothygithinji/t-stack/commit/e8e75026cad06160188f33cd697e683ec6f8b587))
* **deps:** bump vitest to 4.1.7 ([42c7176](https://github.com/timothygithinji/t-stack/commit/42c717668f2c90bd56bb0e3ad270442fa5e34f5e))
* **deps:** bump zod to 4.4.3 ([0ccf21e](https://github.com/timothygithinji/t-stack/commit/0ccf21e37366a51c04c0d19368e00e024ee73cfe))
* **deps:** pin release-it 17.11.0 + plugin 9.0.3; move GH release to separate workflow step ([6f054d2](https://github.com/timothygithinji/t-stack/commit/6f054d261540f1dc3bdb226b1428e8ef68e9fc58))
* **deps:** pin release-it@20.0.1 + plugin@11.0.0 (fixes GH release crash) ([f63eb15](https://github.com/timothygithinji/t-stack/commit/f63eb15c488f30335eeddd91efbb78bc5515b44e))

## <small>0.1.1 (2026-05-20)</small>

* ci(release): pin npm to 11.5.1 (avoids @latest self-upgrade brokenness) ([69cadb9](https://github.com/timothygithinji/t-stack/commit/69cadb9))
* ci(release): skip npm.whoami check (trusted publishing has no token to validate) ([71e9eb9](https://github.com/timothygithinji/t-stack/commit/71e9eb9))
* ci(release): switch to npm trusted publishing (OIDC, no tokens) ([4a00141](https://github.com/timothygithinji/t-stack/commit/4a00141))
* ci(release): upgrade npm to v11+ for trusted publishing support ([44a61e0](https://github.com/timothygithinji/t-stack/commit/44a61e0))
* docs(readme): note trusted publishing in footer ([730536d](https://github.com/timothygithinji/t-stack/commit/730536d))

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

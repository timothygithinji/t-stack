# Changelog



## [0.5.0](https://github.com/timothygithinji/t-stack/compare/v0.4.1...v0.5.0) (2026-05-21)

### Features

* **cli:** switch GitHub Actions Doppler auth from OIDC to service token ([a8a5fcb](https://github.com/timothygithinji/t-stack/commit/a8a5fcbf0f0c1a8e2f1e7472b2f155d2c01bc7a5))

## [0.4.1](https://github.com/timothygithinji/t-stack/compare/v0.4.0...v0.4.1) (2026-05-21)

### Bug Fixes

* **templating:** preserve GitHub Actions expressions ([248751d](https://github.com/timothygithinji/t-stack/commit/248751d3126604a436affdbcf8bf4094d4b7f94e))

## [0.4.0](https://github.com/timothygithinji/t-stack/compare/v0.3.7...v0.4.0) (2026-05-21)

### Features

* **cli:** prompt for Neon region during init with live region list ([101aeb3](https://github.com/timothygithinji/t-stack/commit/101aeb36a13c3ce4f24c375007ac3de0d7e69ec4))

## [0.3.7](https://github.com/timothygithinji/t-stack/compare/v0.3.6...v0.3.7) (2026-05-21)

### Bug Fixes

* **cli:** make neon.create idempotent and bootstrap Pulumi deps on demand ([365b97c](https://github.com/timothygithinji/t-stack/commit/365b97c94cbbcbd90060da28eaf914eb1313ad3a))

## [0.3.6](https://github.com/timothygithinji/t-stack/compare/v0.3.5...v0.3.6) (2026-05-21)

### Bug Fixes

* **templates:** write full decision set to scaffolded t-stack.config.ts ([6469a94](https://github.com/timothygithinji/t-stack/commit/6469a945235654dcebb3d3cf3574f400108a0514))

## [0.3.5](https://github.com/timothygithinji/t-stack/compare/v0.3.4...v0.3.5) (2026-05-21)

### Bug Fixes

* **cli:** use object-map shape for Trigger.dev envvar import ([3200fe9](https://github.com/timothygithinji/t-stack/commit/3200fe9960b1e50558beea45f33cd54b9eca7ee6))

## [0.3.4](https://github.com/timothygithinji/t-stack/compare/v0.3.3...v0.3.4) (2026-05-21)

### Bug Fixes

* **cli:** use correct Trigger.dev REST endpoints for project create + prod key ([c36d90e](https://github.com/timothygithinji/t-stack/commit/c36d90ebbfcdec0dcd6307d091cf6dd37798bc6b))
* **schema:** allow tanstack-start backend on Workers, gate on matching frontend ([a08a17f](https://github.com/timothygithinji/t-stack/commit/a08a17fa176125b3b419e9b5a267ca0a45f1bbb3))

### Maintenance

* rename presets to single-cloudflare / monorepo-cloudflare ([b223c0f](https://github.com/timothygithinji/t-stack/commit/b223c0f0819fa749be383550a4d4bcce206fee13))

## [0.3.3](https://github.com/timothygithinji/t-stack/compare/v0.3.2...v0.3.3) (2026-05-21)

### Bug Fixes

* **cli:** bundle built-in presets into cli.js instead of shipping raw .ts ([50c8e2b](https://github.com/timothygithinji/t-stack/commit/50c8e2be4d2fea7934228cb17066a401db1b9969))

## [0.3.2](https://github.com/timothygithinji/t-stack/compare/v0.3.1...v0.3.2) (2026-05-21)

### Bug Fixes

* **cli:** build dist/ during prepack so published tarball is runnable ([9b2887b](https://github.com/timothygithinji/t-stack/commit/9b2887b422d7affde442fbe45d8fd3c4cf883985))

## [0.3.1](https://github.com/timothygithinji/t-stack/compare/v0.3.0...v0.3.1) (2026-05-21)

### Bug Fixes

* **cli:** restore package.json after publish, not after pack ([e7df39e](https://github.com/timothygithinji/t-stack/commit/e7df39ea6a210240d7402bde7553011e1d6699b8))

### Documentation

* **cli:** drop stale Archetypes section ([4e51c24](https://github.com/timothygithinji/t-stack/commit/4e51c246678e9ffb2aedaa3edf1090cab8031825))

## [0.3.0](https://github.com/timothygithinji/t-stack/compare/v0.2.0...v0.3.0) (2026-05-21)

### Features

* **cli:** frame every command with intro/outro/cancel ([8974592](https://github.com/timothygithinji/t-stack/commit/89745929b73dcd9b00a5147342bfdc01ce22d210))
* **cli:** group subcommands in top-level help ([86deb4c](https://github.com/timothygithinji/t-stack/commit/86deb4c6d51d86fc5b84a944dfe22a894ac7d237))
* **cli:** polish help/init UX ([9cd64dc](https://github.com/timothygithinji/t-stack/commit/9cd64dc49bbed3428b23402be6b6878bf9e517cb))
* **cli:** remediation hints, --yes on destructive org subs, init review step ([4b1810e](https://github.com/timothygithinji/t-stack/commit/4b1810e05b057248224c94f46419494f3c58975c))
* flat per-axis schema with BTS-style compat + fragment templates ([81243a5](https://github.com/timothygithinji/t-stack/commit/81243a58046020a53457dfbbd71e67de7cbc3e29)), closes [#if](https://github.com/timothygithinji/t-stack/issues/if)

### CI/CD

* **deploy:** bump runner Node to 22 for wrangler 4 ([f180dfa](https://github.com/timothygithinji/t-stack/commit/f180dfa5a18798b3c711e1dfd3d7a664918f2922))
* rename web-deploy → deploy and pull CF creds from Doppler ([2646bbc](https://github.com/timothygithinji/t-stack/commit/2646bbc1630256b429d8b1cc6ebab628974f89fa))

### Maintenance

* drop cli dev script and switch turbo to tui ui ([6059815](https://github.com/timothygithinji/t-stack/commit/6059815e8e4f8a09eb955b4b5fb2217e8294b98d))
* drop orphaned predev hook and no-op echo build scripts ([be63103](https://github.com/timothygithinji/t-stack/commit/be63103f01c38dbfe09e96781ae73f14c7855aeb))
* standardize package.json key order and bump apps/web majors ([4b57e30](https://github.com/timothygithinji/t-stack/commit/4b57e30e47536f5785c852e2e56f5958de4c9e72))
* tighten biome/ultracite config and replace global rule disables with scoped overrides ([f8b8ee5](https://github.com/timothygithinji/t-stack/commit/f8b8ee5a3c9d8ee00f7b1336415d13777ea4de8d))
* **web:** drop unused biome-ignore on GithubIcon ([7559aad](https://github.com/timothygithinji/t-stack/commit/7559aadc84ed11e2af06fa3a73a39430c96ab333))

## [0.2.0](https://github.com/timothygithinji/t-stack/compare/v0.1.3...v0.2.0) (2026-05-21)

### Features

* **presets:** add @t-stack/presets with static preset metadata ([d5084eb](https://github.com/timothygithinji/t-stack/commit/d5084eb514aa62b24cf8297e9f1f1af6865c61b4))
* **schema:** add @t-stack/schema with discriminated-union init schema ([dc0c114](https://github.com/timothygithinji/t-stack/commit/dc0c114a8b8257910594fb676bb6b791c7a380cb))
* **web:** add a sticky Actions footer with presets + random + reset ([904fce0](https://github.com/timothygithinji/t-stack/commit/904fce0ca922388bde15255729b2716994bd3c95))
* **web:** add shadcn light/dark theme + toggle ([afc5a1c](https://github.com/timothygithinji/t-stack/commit/afc5a1c8cffce8a09181469b36b184c001880422))
* **web:** build the stack-builder UI (preset cards, form, URL state) ([cf74f0d](https://github.com/timothygithinji/t-stack/commit/cf74f0d60ae57dd82ebfd7e71083f48765b846d7))
* **web:** live template preview with file tree + Shiki code viewer ([3fe273e](https://github.com/timothygithinji/t-stack/commit/3fe273ebd61d97ae59c476bf3b77ff429d3deafd))
* **web:** scaffold TanStack Start app on Cloudflare Workers + Tailwind v4 ([51d5f05](https://github.com/timothygithinji/t-stack/commit/51d5f05590e348cde071d9bc45fbddd11c0fddd1))
* **web:** switch the form to category-grouped selection cards ([722c2b7](https://github.com/timothygithinji/t-stack/commit/722c2b78abb696b3f6821e84c389e1cf28de6361))

### Bug Fixes

* **web:** align sidebar category headers with the Output bar ([91e5c68](https://github.com/timothygithinji/t-stack/commit/91e5c689287fd3b0c0149b76c1365e1112916335))
* **web:** preview panel scroll + header polish ([5e6aa1b](https://github.com/timothygithinji/t-stack/commit/5e6aa1b789b851716c815f6f6e141fd1614d6821))
* **web:** stack Project inputs vertically instead of side-by-side ([7e6fed4](https://github.com/timothygithinji/t-stack/commit/7e6fed46366be5ee4e1b871afeec194624b83347))

### Refactoring

* **cli:** drive init from the @t-stack/schema source of truth ([92cd15a](https://github.com/timothygithinji/t-stack/commit/92cd15aa537cddc7984fa1d68c30f47296aaf341))

### Documentation

* drop Status section from README ([c8ca7f2](https://github.com/timothygithinji/t-stack/commit/c8ca7f229b05d78f442be97f14e10d0687f2d0fb))
* rewrite README for end users; move contributor docs to CONTRIBUTING.md ([b1fa448](https://github.com/timothygithinji/t-stack/commit/b1fa448df7e767f246d58a9e75fc078471f14f34))

### Build System

* convert repo to monorepo with bun workspaces + turbo ([d706810](https://github.com/timothygithinji/t-stack/commit/d7068106a90fd5ae2c46f7251ab0aa2b6cf0b93d))
* extract @t-stack/templates and @t-stack/templating packages ([490470d](https://github.com/timothygithinji/t-stack/commit/490470d19cd068e8649f8f572e17b289c6a4c209))
* tighten turbo graph + verify CLI publish flow ([dd5ab1a](https://github.com/timothygithinji/t-stack/commit/dd5ab1a93399ad909a9b5706b1a4a0a15d0809dc))

### CI/CD

* add web deploy workflow + custom-domain wrangler config ([ade8a4a](https://github.com/timothygithinji/t-stack/commit/ade8a4a8e08e7b79aa3b903f970ac778ae3c7035))
* fix template generator on Bun 1.1.38 and rename CI workflow → PR ([fb64db1](https://github.com/timothygithinji/t-stack/commit/fb64db1a117a561e56056ad83db160c95e6b6830)), closes [fs/promises#glob](https://github.com/fs/promises/issues/glob)
* **release:** tighten path filter to user-shipped files only ([8798cff](https://github.com/timothygithinji/t-stack/commit/8798cff33490d68215dc9db2b3e19442c4e8bdb5))
* **web:** trigger deploy from the Release workflow, not raw pushes ([6c3a789](https://github.com/timothygithinji/t-stack/commit/6c3a7893b160457e7e98d192a2e758dc8d5e9d7f))

### Maintenance

* **web:** add react-grab as a dev-only dependency ([8e8a6be](https://github.com/timothygithinji/t-stack/commit/8e8a6be271f2f60e1f2839a83b617a2a13dd20e7))

## [0.1.3](https://github.com/timothygithinji/t-stack/compare/v0.1.2...v0.1.3) (2026-05-21)

### CI/CD

* **release:** add bun run release script ([fb72640](https://github.com/timothygithinji/t-stack/commit/fb7264082ccc459dd465b562c98ec80bfb85fb24))
* **release:** trigger automatically on push to main; migrate config to .release-it.ts ([f90231c](https://github.com/timothygithinji/t-stack/commit/f90231c08ac8ea6a119d895faf8107de49c5ca9f))

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

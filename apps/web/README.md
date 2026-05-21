# @t-stack/web

Stack-builder UI for [`@timothygithinji/t-stack`](../cli). Lives at
[`t-stack.timothygithinji.com/new`](https://t-stack.timothygithinji.com/new) once deployed.

TanStack Start + Tailwind v4 + shadcn primitives, served by a Cloudflare
Worker via `@cloudflare/vite-plugin`.

## Local

```bash
bun --filter @t-stack/web dev      # http://localhost:3001
bun --filter @t-stack/web build    # production bundle in dist/
```

The `predev` / `prebuild` hooks regenerate
`src/lib/generated/templates.ts` from `packages/templates/files/` so the
preview panel matches whatever the CLI would scaffold.

## Deploy

`.github/workflows/deploy.yaml` chains off the Release workflow via
`workflow_run`: it fires after every successful `Release` run on `main`
and checks out the exact commit that was released, so the live site
stays in lockstep with the published CLI. Manual `workflow_dispatch`
is the escape hatch when you need to redeploy without a release.

The job runs:

```bash
bun --filter @t-stack/web build
doppler run -- bunx wrangler deploy   # from apps/web/
```

Cloudflare credentials are pulled from the same Doppler `t-stack/prd`
config the CLI reads from at scaffold time — `DOPPLER_TOKEN` is the
only GitHub Actions secret we maintain, so org-level rotations are
one-and-done.

### First-time setup

1. **Cloudflare zone.** `timothygithinji.com` must already be a zone in
   the target Cloudflare account. The Worker (`t-stack-web`) creates
   the `t-stack.timothygithinji.com` custom domain on first deploy.
2. **Doppler service token.** In the Doppler workplace that owns the
   target Cloudflare account, open the `t-stack/prd` config and create
   a Service Token. That config already has `CLOUDFLARE_API_TOKEN` from
   `t-stack login`. Add the Service Token as the `DOPPLER_TOKEN` repo
   secret on GitHub.
3. **First deploy from your laptop** (optional — to verify before CI
   wiring goes live):
   ```bash
   cd apps/web
   bunx wrangler login
   bunx wrangler deploy
   ```

## Surface

- `/` → redirects to `/new`.
- `/new` → the stack builder. Two columns: preset cards + schema-driven
  form on the left, copyable CLI command + live file preview on the
  right. State is URL-encoded so configs are shareable links.

The schema (`@t-stack/schema`) and the presets (`@t-stack/presets`)
drive both the form fields and the CLI flags — adding a field to the
schema automatically extends both surfaces.

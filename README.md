# SARO — monorepo

SARO ("one" in Bikol) is the single civic hazard and emergency reporting front
door for Legazpi City, Philippines. See [PRODUCT.md](PRODUCT.md) for the
product definition.

The system ships as **two independently deployable web apps** that share one
data layer.

## Layout

```
apps/
  resident-app/     mobile-first — residents and anonymous guests
  admin-app/        desktop-first — responders, coordinators, city admins
packages/
  shared/           types, API client, constants, validation, i18n, design tokens
  ui/               the few visual components both apps genuinely share
supabase/           migrations, Edge Functions, seed and admin scripts
tools/hazard/       fetches official hazard data and builds the PMTiles archive
```

Each app has its own README with its exact Vercel settings:
[resident-app](apps/resident-app/README.md) ·
[admin-app](apps/admin-app/README.md).

### Boundary rule

`apps/resident-app` and `apps/admin-app` never import from each other. The only
cross-app imports allowed are `@saro/shared` and `@saro/ui`. Anything that both
apps need goes into `packages/`; anything that will diverge stays in its app.

## Getting started

```bash
npm install                 # installs all workspaces from the repo root

npm run dev:resident        # http://localhost:5173
npm run dev:admin           # http://localhost:5174

npm run build               # builds both apps
npm run lint                # eslint across every workspace
```

Each app also builds standalone:

```bash
cd apps/resident-app && npm run build
cd apps/admin-app    && npm run build
```

## Deploying to Vercel

**Live:** resident <https://saro-resident.vercel.app> · operations
<https://saro-ops.vercel.app>. Both auto-deploy from `main`.

Two Vercel projects, one repository. Each sets its own **Root Directory** and
must have **"Include files outside the Root Directory"** switched on, because
both resolve `@saro/shared` and `@saro/ui` from `packages/`, which sits above
their roots.

| | resident-app | admin-app |
|---|---|---|
| Root Directory | `apps/resident-app` | `apps/admin-app` |
| Build Command | `npm run build` | `npm run build` |
| Output Directory | `dist` | `dist` |
| `VITE_SUPABASE_URL` | required | required |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | required | required |
| `VITE_VAPID_PUBLIC_KEY` | for Web Push | not used |
| `VITE_ADMIN_APP_URL` | optional link | — |
| `VITE_RESIDENT_APP_URL` | — | optional link |

**Those five are the complete list.** The Supabase secret key and the Gemini API
key are never set in Vercel and never appear in either bundle — they exist only
as Supabase secrets, read by Edge Functions at runtime. Verify with:

```bash
npm run build
grep -r "sb_secret_\|GEMINI_API_KEY" apps/*/dist    # must return nothing
```


## Auth email (custom SMTP)

Supabase's built-in email service only delivers to members of the project team.
Left on it, resident self-signup fails for every real address with *"Email
address is invalid"*. SARO uses Gmail SMTP instead, configured in
`supabase/config.toml` under `[auth.email.smtp]`.

Two prerequisites on the Google account:

1. **2-Step Verification must be on.** App Passwords do not exist without it.
2. **Generate an App Password** at <https://myaccount.google.com/apppasswords>.
   It is 16 characters; strip the spaces Google displays it with. The ordinary
   account password will be rejected.

Gmail rewrites the `From` header to the authenticated mailbox, so the sender
address is always `SARO_SMTP_USER` — setting a different one has no effect.

Push the config with both values in the environment. They are read at push time
and never written to a file:

```bash
export SARO_SMTP_USER='kimadrianpdeguzman@gmail.com'
export SARO_SMTP_PASSWORD='<16-char app password, spaces removed>'
supabase config push
```

Free Gmail allows roughly 500 recipients a day and throttles well below that per
hour. Two limits keep SARO under it: `[auth.rate_limit] email_sent = 30` caps
the project per hour, and `[auth.email] max_frequency = "60s"` caps how often a
single address can trigger one. Both are stated explicitly in `config.toml`
because an unset key pushes the CLI's default over whatever the project had —
the first push silently relaxed `max_frequency` from `1m0s` to `1s`, which is
enough for one address to drain the daily quota in minutes and lock everyone
else out of registering.

The project-wide `[storage] file_size_limit` is likewise left at the platform
default. Lowering it made `config push` attempt a storage update that the free
tier answers with `402 … upgrade the project to enable vector buckets`, aborting
the push. The limit that actually applies to uploads is on the `report-photos`
bucket (10MiB, images only), set in migration 06.

### Known sender caveat

Mail currently sends from a personal Gmail address, so residents see
confirmation email from a person rather than from the city, and replies land in
that personal inbox. Moving to a dedicated `saro.*@gmail.com` is a config change
and a new App Password — nothing in the code refers to the address.

### Deploy blocker

`site_url` and `additional_redirect_urls` still point at `localhost`. That is
deliberate rather than forgotten: there is no deployed domain yet, and a guessed
one would look configured while sending every resident a dead link. Confirmation
and password-reset links are both built from `site_url`, so until it changes
those emails only work on the machine running `npm run dev:resident`. Update it
and push again as part of the deploy step.

## Current state

Both apps run against the live Supabase project. Schema, RLS, storage and
realtime are in `supabase/migrations/`; the Gemini calls live in the
`gemini-proxy` Edge Function. The design system is documented in
[DESIGN.md](DESIGN.md).

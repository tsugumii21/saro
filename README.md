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
supabase/           migrations and Edge Functions (reserved — not populated yet)
```

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
npm run test:shared         # verifies the mock data layer
```

Each app also builds standalone:

```bash
cd apps/resident-app && npm run build
cd apps/admin-app    && npm run build
```

## Deploying to Vercel

Create **two** Vercel projects from this one repository.

| Setting | resident-app | admin-app |
|---|---|---|
| Root Directory | `apps/resident-app` | `apps/admin-app` |
| Include files outside Root Directory | **on** | **on** |
| Framework Preset | Vite | Vite |
| Build Command | `npm run build` (from `vercel.json`) | `npm run build` (from `vercel.json`) |
| Output Directory | `dist` | `dist` |

"Include files outside the Root Directory" is required — both apps resolve
`@saro/shared` and `@saro/ui` from `packages/`, which sits above the root
directory.

### Environment variables

Both apps ship only the Supabase URL and the **publishable** key to the browser.
The secret key and the Gemini key exist as Supabase secrets and nowhere else —
not in `.env.local`, not in Vercel, not in any committed file.

| Variable | App | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | both | Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | both | Anon/publishable key. Safe in the browser; RLS is what protects the data |
| `VITE_ADMIN_APP_URL` | resident | Where the "for city officials" link goes |
| `VITE_RESIDENT_APP_URL` | admin | Where "Back to public site" goes |

See each app's `.env.example`. Both `.env.local` files are gitignored.

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
export SARO_SMTP_USER='saro.legazpi@gmail.com'
export SARO_SMTP_PASSWORD='abcdefghijklmnop'
supabase config push
```

Free Gmail allows roughly 500 recipients a day and throttles well below that per
hour. `[auth.rate_limit] email_sent = 30` sits under it deliberately: enough for
real signups, not enough for someone to burn the daily quota and lock everyone
else out of registering.

**Before launch:** `site_url` and `additional_redirect_urls` in `config.toml`
still point at `localhost`. Confirmation links are built from `site_url`, so
they must be changed to the deployed resident-app domain or every confirmation
email will send residents to a dead link.

## Current state

Both apps run against the live Supabase project. Schema, RLS, storage and
realtime are in `supabase/migrations/`; the Gemini calls live in the
`gemini-proxy` Edge Function. The design system is documented in
[DESIGN.md](DESIGN.md).

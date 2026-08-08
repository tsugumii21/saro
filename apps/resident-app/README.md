# SARO — resident app

The public side of SARO. One door for reporting anything in Legazpi City:
Panic, Describe, tracking, the hazard map, and the grounded assistant.

Mobile-first, installable as a PWA, and usable with **no account at all** —
Panic and any emergency Describe file anonymously and never show a login prompt.

## Run it locally

From the **repo root** (not this folder — it is an npm workspace):

```bash
npm install
cp apps/resident-app/.env.example apps/resident-app/.env.local   # then fill it in
npm run dev:resident
```

Opens on <http://localhost:5173>.

`npm install` at the root links `@saro/shared` and `@saro/ui` from `packages/`.
Running `npm install` inside this folder instead will fail to resolve them.

## Environment variables

Set these in the Vercel project, and locally in `.env.local` (gitignored).
Everything prefixed `VITE_` is compiled into the JavaScript browsers download,
so only public-safe values belong here.

| Variable | Required | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | `sb_publishable_…` — public by design; RLS is what protects the data |
| `VITE_VAPID_PUBLIC_KEY` | for push | Public half of the Web Push pair. Without it the notifications toggle hides itself. |
| `VITE_ADMIN_APP_URL` | optional | Absolute URL of the deployed admin app, for the "for city officials" link |

**Never set here:** the Supabase secret key or the Gemini API key. Both live
only as Supabase secrets, used inside Edge Functions. If either ever appears in
this list, something has gone wrong — the browser bundle is world-readable.

## Vercel setup

Live at **<https://saro-resident.vercel.app>** (project `saro-resident`). This
is also Supabase's `site_url`, so every confirmation and password-reset link
returns here.

Create a Vercel project pointed at this repo, then:

| Setting | Value |
|---|---|
| Root Directory | `apps/resident-app` |
| Include files outside Root Directory | **on** (required — `packages/` sits above) |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | leave default |
| Node version | 20 or newer |

`vercel.json` in this folder already sets the SPA rewrite and the cache headers,
so those do not need configuring by hand.

The SPA rewrite sends every unmatched path to `index.html`, which is what makes
`/track?code=SR-XXXX` work on a cold load — the QR codes on saved tickets point
at exactly that URL.

## What ships in `public/`

- `sw.js` — service worker: offline shell, background sync for queued reports,
  Web Push. Served with `must-revalidate` so an update is picked up on the next
  visit rather than being cached for a year.
- `hazard/legazpi-hazards.pmtiles` — 0.93 MB of Mayon danger zones and Legazpi
  flood extents, precached for offline use. Regenerate with
  `node tools/hazard/fetch-hazards.mjs && node tools/hazard/build-pmtiles.mjs`.
- `manifest.json` and icons — PWA install.

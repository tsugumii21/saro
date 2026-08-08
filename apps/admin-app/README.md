# SARO — operations app

The staff side of SARO. Role-scoped dispatch queues, the status pipeline,
routing table, duplicate review, per-location evidence export, panic review and
the Mayon alert level.

Desktop-first: this is read for hours at a desk, so the dense views use the
available width rather than centring into a column.

## Who can sign in

Staff only. There is no public sign-up here — accounts are issued by the city
administrator or by `supabase/scripts/create-staff-users.mjs`.

| Role | Sees | Can write |
|---|---|---|
| `admin` | everything, city-wide | everything |
| `office` | reports assigned to their office | status changes on those reports |
| `barangay_official` | reports in their barangay, across every office | nothing — read-only |

Scope is enforced by Row Level Security in Postgres, not by this app. Hiding a
tab is a courtesy; the permission lives in the database.

## Run it locally

From the **repo root** (this is an npm workspace):

```bash
npm install
cp apps/admin-app/.env.example apps/admin-app/.env.local   # then fill it in
npm run dev:admin
```

Opens on <http://localhost:5174>.

## Environment variables

| Variable | Required | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | `sb_publishable_…` — public by design; RLS is the boundary |
| `VITE_RESIDENT_APP_URL` | optional | Absolute URL of the deployed resident app, for the "Public site" link |

**Never set here:** the Supabase secret key or the Gemini API key. This app is a
browser bundle like any other — a service-role key in it would hand every
visitor the ability to bypass RLS entirely. Both live only as Supabase secrets.

Note there is no `VITE_VAPID_PUBLIC_KEY` here. Staff do not subscribe to push;
this app only *triggers* sends, and it does that through an Edge Function that
holds the private key server-side.

## Vercel setup

A **separate** Vercel project from the resident app, pointed at the same repo.

| Setting | Value |
|---|---|
| Root Directory | `apps/admin-app` |
| Include files outside Root Directory | **on** (required — `packages/` sits above) |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | leave default |
| Node version | 20 or newer |

`vercel.json` in this folder sets the SPA rewrite and cache headers.

## Deployment note worth knowing

Status changes made **through this app** send a Web Push notification to the
resident. Status changes made directly in the Supabase dashboard or by raw SQL
do not — the notification is triggered by the client call, deliberately, so that
no service-role key has to live inside Postgres for pg_net to use.

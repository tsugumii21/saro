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

| Variable | App | Purpose |
|---|---|---|
| `VITE_ADMIN_APP_URL` | resident | Where the "for city officials" link goes |
| `VITE_RESIDENT_APP_URL` | admin | Where "Back to Public Portal" goes |
| `VITE_GEMINI_API_KEY` | resident | **Temporary.** Client-side FAQ assistant key; being moved to a Supabase Edge Function |

See each app's `.env.example`.

## Current state

The data layer is still the offline `localStorage` mock in
`packages/shared/src/api/`, which deliberately mirrors the Supabase tables and
RLS policies it will be replaced by. The mapping is documented in
[packages/shared/src/api/README.md](packages/shared/src/api/README.md).

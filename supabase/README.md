# supabase/

Reserved. Nothing here yet — this folder is a placeholder created during the
monorepo split so the next step has a home to land in.

Planned contents:

- `migrations/` — SQL migrations for `offices`, `categories`, `barangays`,
  `profiles`, `reports`, `report_media`, `report_status_history`,
  `assistant_logs`, `devices`, plus the RLS policies currently emulated in
  `packages/shared/src/api/index.js`.
- `functions/` — Edge Functions. The first one will be the SARO Assistant
  endpoint that takes over the Gemini call currently living client-side in
  `apps/resident-app/src/lib/gemini.js`.
- `config.toml` — local Supabase CLI configuration.

The authoritative description of the tables and policies to be recreated is
`packages/shared/src/api/README.md` (the mock-layer to Supabase mapping table)
and the JSDoc typedefs in `packages/shared/src/types.js`.

# supabase/

The SARO backend: schema, Row Level Security, storage, Realtime, and the one
Edge Function that talks to Gemini.

```
migrations/     ordered SQL — this is the source of truth for the schema
functions/      Deno Edge Functions
scripts/        one-off admin scripts (staff provisioning)
seed.sql        reference data + realistic sample reports
config.toml     local CLI configuration
```

## First-time setup

Nothing below is committed: the project ref lives in `supabase/.temp/`, and both
keys stay out of the repository entirely.

```bash
# 1. Link this folder to your Supabase project
supabase login
supabase link --project-ref <your-project-ref>

# 2. Apply the schema
supabase db push

# 3. Load reference data and sample reports
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f supabase/seed.sql
#    ...or for the linked remote project, use the connection string from
#    Dashboard > Project Settings > Database.

# 4. Store the Gemini key as a secret. It never appears in a file or in Vercel.
supabase secrets set GEMINI_API_KEY=<your-gemini-key>
supabase secrets set ALLOWED_ORIGINS="https://<resident>.vercel.app,https://<admin>.vercel.app"

# 5. Deploy the Edge Function
supabase functions deploy gemini-proxy

# 6. Create the staff accounts. The secret key is passed in the environment
#    for this one command and is not written anywhere.
SUPABASE_URL="https://<ref>.supabase.co" \
SUPABASE_SECRET_KEY="<your-secret-key>" \
node supabase/scripts/create-staff-users.mjs
```

Then put the project URL and the **publishable** key into
`apps/resident-app/.env.local` and `apps/admin-app/.env.local`.

## Running locally

```bash
supabase start                    # Postgres, Auth, Storage, Realtime on :54321
supabase db reset                 # re-apply migrations + seed.sql
supabase functions serve gemini-proxy --env-file supabase/.env
```

`supabase/.env` is gitignored. For local function work it needs one line:

```
GEMINI_API_KEY=...
```

### Testing the Edge Function

```bash
# Grounded assistant
curl -i -X POST http://localhost:54321/functions/v1/gemini-proxy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <publishable-key>" \
  -d '{"mode":"assistant","question":"Ano ang hotline ng CDRRMO?"}'

# Emergency tripwire — should short-circuit without calling Gemini
curl -s -X POST http://localhost:54321/functions/v1/gemini-proxy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <publishable-key>" \
  -d '{"mode":"assistant","question":"May sunog sa kabahayan!"}'

# Describe-flow structuring
curl -s -X POST http://localhost:54321/functions/v1/gemini-proxy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <publishable-key>" \
  -d '{"mode":"describe","description":"Malalim na lubak sa kanto, dalawang tricycle na ang nasira."}'
```

Against the deployed project, swap the host for
`https://<ref>.supabase.co/functions/v1/gemini-proxy`.

## Verifying RLS actually holds

Worth doing once by hand, because a policy that is subtly wrong looks identical
to one that is right until someone sees the wrong reports.

```sql
-- As anonymous: should return 0 rows, not an error, and not the table.
set role anon;
select count(*) from public.reports;                       -- expect: permission denied
select * from public.get_report_by_tracking_code('SR-8F2K'); -- expect: exactly 1 row
reset role;
```

For the role-scoped checks, sign in as each seeded staff account in the admin
app and confirm: the CDRRMO account sees only CDRRMO reports, the Bitano
barangay account sees Bitano reports across every office and cannot change a
status, and the admin account sees everything.

## Schema at a glance

| Table | Purpose |
|---|---|
| `offices` | Municipal offices reports route to |
| `barangays` | Barangay boundaries; drives automatic assignment |
| `routing_table` | Category → responsible office, SLA hours, one fallback row |
| `routing_table_changelog` | Trigger-written journal of every routing change |
| `profiles` | Staff accounts: role + office/barangay scope |
| `reports` | The central record |
| `report_status_history` | Append-only audit trail of transitions |
| `report_media` | Photos, as paths into the private bucket |
| `clusters` / `cluster_reports` | Corroborating reports grouped by space and time |
| `gap_log` | Assistant questions; unresolved ones are the admin gap log |
| `panic_flags` | Per-device panic-button rate limiting |

Every one of these has RLS enabled. The policies, with plain-language comments
explaining what each allows, are in
`migrations/20260807000500_rls_policies.sql`.

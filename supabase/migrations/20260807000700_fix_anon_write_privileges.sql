-- SARO 07 — repair: anonymous writes were blocked by privilege checks running
-- as the caller.
--
-- Found by testing the live guest path against the project rather than reading
-- the policies. An anonymous INSERT into reports failed with
-- "permission denied for table reports", because two pieces of SQL that the
-- insert depends on were executing as `anon`, which deliberately has no SELECT
-- on that table:
--
--   1. generate_tracking_code() is the DEFAULT for reports.tracking_code and
--      probes the table for collisions.
--   2. the report_media INSERT policy used an inline EXISTS against reports.
--
-- Both now run SECURITY DEFINER. This is the whole fix; no policy was widened
-- and no grant was added.
--
-- Migrations 01 and 05 carry the same definitions, so a database built from
-- scratch is correct without this file. It exists because THIS database was
-- already migrated, and re-applying an edited migration is not a thing.
-- Re-running it is harmless either way: both statements are CREATE OR REPLACE.

set search_path = public, extensions;

create or replace function public.generate_tracking_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
  i int;
begin
  loop
    candidate := 'SR-';
    for i in 1..4 loop
      candidate := candidate || substr(
        alphabet,
        1 + floor(random() * length(alphabet))::int,
        1
      );
    end loop;

    exit when not exists (
      select 1 from public.reports where tracking_code = candidate
    );
  end loop;

  return candidate;
end;
$$;

create or replace function public.report_accepts_evidence(p_report_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.reports r
    where r.id = p_report_id
      and r.created_at > now() - interval '10 minutes'
  );
$$;

revoke all on function public.report_accepts_evidence(uuid) from public;
grant execute on function public.report_accepts_evidence(uuid) to anon, authenticated;

-- Swap the report_media policy over to the function.
drop policy if exists "reporters attach photos to a report they just filed" on public.report_media;

create policy "reporters attach photos to a report they just filed"
  on public.report_media for insert
  to anon, authenticated
  with check (
    kind = 'evidence'
    and public.report_accepts_evidence(report_id)
  );

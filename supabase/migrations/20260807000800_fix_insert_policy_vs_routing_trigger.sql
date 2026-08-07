-- SARO 08 — repair: the insert policies fought the routing trigger.
--
-- Also found by testing the live guest path. Every anonymous insert failed with
-- "new row violates row-level security policy for table reports", even though
-- the payload was well formed.
--
-- Cause: the guest and resident INSERT policies asserted
-- `assigned_office_id is null`, meaning "you do not get to choose the office".
-- But apply_report_routing() is a BEFORE INSERT trigger that FILLS that column,
-- and Postgres evaluates WITH CHECK after BEFORE triggers. So the policy was
-- inspecting the trigger's own output and rejecting it. The clause could never
-- pass, for anybody.
--
-- Fix, in two halves:
--   1. apply_report_routing() now overwrites assigned_office_id on every insert
--      instead of only filling it when null. Caller input is discarded, so the
--      "you do not get to choose" guarantee moves into the trigger where it can
--      actually hold.
--   2. The clause comes out of both insert policies.
--
-- Net effect on what a caller can do: unchanged. A reporter still cannot pick
-- the receiving office; it is now enforced by overwrite rather than by a check
-- that never ran. Every other clamp (status, cluster_id, resolved_at, filed_by,
-- is_false_report, and the reporter identity columns) is untouched.

set search_path = public, extensions;

create or replace function public.apply_report_routing()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_office uuid;
begin
  select responsible_office_id into target_office
  from public.routing_table
  where category = new.category;

  if target_office is null then
    select responsible_office_id into target_office
    from public.routing_table
    where is_fallback
    limit 1;
  end if;

  new.assigned_office_id := target_office;

  if new.barangay_id is null then
    select b.id into new.barangay_id
    from public.barangays b
    where b.boundary is not null
      and extensions.ST_Covers(
            b.boundary,
            extensions.ST_SetSRID(extensions.ST_MakePoint(new.lng, new.lat), 4326)::extensions.geography
          )
    limit 1;
  end if;

  return new;
end;
$$;

drop policy if exists "guests may file a report anonymously" on public.reports;
drop policy if exists "residents may file under their own account" on public.reports;

create policy "guests may file a report anonymously"
  on public.reports for insert
  to anon, authenticated
  with check (
    reporter_device_id is not null
    and reporter_user_id is null
    and status = 'received'
    and not is_false_report
    and cluster_id is null
    and resolved_at is null
    and filed_by is null
  );

create policy "residents may file under their own account"
  on public.reports for insert
  to authenticated
  with check (
    public.is_resident()
    and reporter_user_id = auth.uid()
    and reporter_device_id is null
    and status = 'received'
    and not is_false_report
    and cluster_id is null
    and resolved_at is null
    and filed_by is null
  );

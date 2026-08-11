-- ── Coordinators: citywide sight of emergencies, nothing more ───────────────
--
-- Offices are scoped by assignment (20260807000500_rls_policies.sql), and that
-- scoping is also the hazard filter: routing_table decides which office holds
-- which category, so BFP only ever sees fire and PNP only ever sees public
-- order. That is correct and stays.
--
-- CDRRMO is the exception the schema did not have a word for. It coordinates a
-- citywide response, which means reading the fire that BFP holds and the crash
-- that 911 holds while a typhoon is running. What it must NOT gain is the
-- ability to act on them: coordinating is not closing somebody else's job.
--
-- So this adds a read-only widening, and only for hazards routing_table already
-- marks as emergencies. A pothole in another office's queue is not a
-- coordination problem, and the coordinator does not see it.

-- 1. The flag itself.
alter table public.profiles
  add column if not exists is_coordinator boolean not null default false;

comment on column public.profiles.is_coordinator is
  'Office accounts only. Grants read-only sight of every emergency-tier report citywide, for the office that coordinates the response (CDRRMO). Never grants write.';

-- 2. Privilege pinning. Without this a resident could set the flag on their own
--    row, because the profiles UPDATE policy exists for name and mobile edits
--    and WITH CHECK cannot tell which column changed.
create or replace function public.pin_privileged_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null or coalesce(public.is_admin(), false) then
    return new;
  end if;

  new.role           := old.role;
  new.office_id      := old.office_id;
  new.barangay_id    := old.barangay_id;
  new.is_active      := old.is_active;
  new.is_coordinator := old.is_coordinator;
  return new;
end;
$$;

-- 3. The app reads scope from this view, so the flag has to travel with it.
--    Dropped and recreated rather than replaced: CREATE OR REPLACE VIEW may only
--    append columns at the end, and is_coordinator belongs beside is_active
--    where the other scope columns are.
drop view if exists public.profiles_with_scope;

create view public.profiles_with_scope
with (security_invoker = on)
as
  select
    p.id,
    p.full_name,
    p.role,
    p.office_id,
    o.short_name as office_name,
    p.barangay_id,
    b.name       as barangay_name,
    p.mobile_number,
    p.is_active,
    p.is_coordinator,
    p.created_at,
    p.updated_at
  from public.profiles p
  left join public.offices   o on o.id = p.office_id
  left join public.barangays b on b.id = p.barangay_id;

comment on view public.profiles_with_scope is
  'profiles with office_name / barangay_name resolved, plus is_coordinator. Inherits the RLS of the underlying tables.';

-- 4. "Is the caller a coordinating office?" — SECURITY DEFINER for the same
--    reason auth_role() is: the policy has to read profiles without recursing
--    into the policies on profiles.
create or replace function public.auth_is_coordinator()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select p.is_coordinator and p.role = 'office'
       from public.profiles p
      where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.auth_is_coordinator() from public, anon;
grant execute on function public.auth_is_coordinator() to authenticated;

-- 5. The widening. SELECT only — there is deliberately no matching UPDATE
--    policy, so a coordinator reading BFP's fire report still cannot change its
--    status. Emergency membership is read from routing_table rather than a
--    hard-coded list, so re-classifying a category re-scopes this automatically.
drop policy if exists "coordinators read citywide emergencies" on public.reports;

create policy "coordinators read citywide emergencies"
  on public.reports for select
  to authenticated
  using (
    public.auth_is_coordinator()
    and exists (
      select 1
        from public.routing_table rt
       where rt.category = reports.category
         and rt.is_emergency
    )
  );

-- 6. CDRRMO is the coordinating office in Legazpi. Matched by short_name rather
--    than by a hard-coded uuid so this works against any seeded project; if no
--    CDRRMO office exists yet, this updates nothing and the flag stays false.
update public.profiles p
   set is_coordinator = true
  from public.offices o
 where o.id = p.office_id
   and p.role = 'office'
   and o.short_name = 'CDRRMO';

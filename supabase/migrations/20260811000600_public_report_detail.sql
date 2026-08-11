-- ── A public report detail that is not the tracking code ────────────────────
--
-- "View Full Report" on a public map pin had nothing to open: the map
-- projection returns no identity at all, so every pin read "Tracking
-- unavailable" and the button was dead.
--
-- The obvious fix — publish the tracking code — is the one thing that must not
-- happen. The code is a credential: confirm_report_resolution(code) and
-- dispute_report_resolution(code) authenticate on nothing else, so a published
-- code would let any visitor close or reopen somebody else's report.
--
-- So the map publishes the report's id instead. An id opens a read-only detail
-- and its status history; it closes nothing and disputes nothing. The code stays
-- with the person who filed the report.

-- 1. The map projection gains an id. Coordinates stay rounded to ~110 m and no
--    reporter, device or tracking code is exposed.
drop function if exists public.get_public_map_reports(integer);

create function public.get_public_map_reports(max_age_hours integer default 168)
returns table (
  id             uuid,
  category       text,
  category_label text,
  description    text,
  status         public.report_status,
  lat            double precision,
  lng            double precision,
  cluster_id     uuid,
  created_at     timestamptz
)
language sql
security definer
stable
set search_path = public, extensions
as $$
  select
    r.id,
    r.category,
    rt.label,
    r.description,
    r.status,
    round(r.lat::numeric, 3)::double precision,
    round(r.lng::numeric, 3)::double precision,
    r.cluster_id,
    r.created_at
  from public.reports r
  left join public.routing_table rt on rt.category = r.category
  where not r.is_false_report
    and r.created_at > now() - make_interval(hours => greatest(max_age_hours, 1))
  order by r.created_at desc
  limit 500;
$$;

comment on function public.get_public_map_reports is
  'Coarse public hazard map. Coordinates rounded to 3 decimal places (~110 m) so a pin cannot identify a household. Returns a report id for the read-only public detail view; never the tracking code, which is the credential for closing a report.';

-- 2. Read-only detail for one public pin, by id.
create or replace function public.get_public_report(report_id uuid)
returns table (
  id              uuid,
  category        text,
  category_label  text,
  description     text,
  status          public.report_status,
  lat             double precision,
  lng             double precision,
  barangay_name   text,
  assigned_office text,
  created_at      timestamptz,
  updated_at      timestamptz,
  resolved_at     timestamptz
)
language sql
security definer
stable
set search_path = public, extensions
as $$
  select
    r.id,
    r.category,
    rt.label,
    r.description,
    r.status,
    round(r.lat::numeric, 3)::double precision,
    round(r.lng::numeric, 3)::double precision,
    b.name,
    o.short_name,
    r.created_at,
    r.updated_at,
    r.resolved_at
  from public.reports r
  left join public.routing_table rt on rt.category = r.category
  left join public.barangays b on b.id = r.barangay_id
  left join public.offices o on o.id = r.assigned_office_id
  where r.id = report_id
    and not r.is_false_report
  limit 1;
$$;

comment on function public.get_public_report is
  'Read-only public detail for one report id, as shown from a map pin. Same fields the public map already publishes plus office and barangay. No tracking code, no reporter, no device id.';

-- 3. The same report's status history, by id.
create or replace function public.get_public_report_timeline(report_id uuid)
returns table (
  status      public.report_status,
  from_status public.report_status,
  note        text,
  changed_at  timestamptz
)
language sql
security definer
stable
set search_path = public, extensions
as $$
  select h.status, h.from_status, h.note, h.changed_at
  from public.report_status_history h
  join public.reports r on r.id = h.report_id
  where r.id = report_id
    and not r.is_false_report
  order by h.changed_at asc;
$$;

comment on function public.get_public_report_timeline is
  'Status history for one public report id. Never exposes changed_by — residents do not get staff identities.';

grant execute on function public.get_public_map_reports(integer)   to anon, authenticated;
grant execute on function public.get_public_report(uuid)           to anon, authenticated;
grant execute on function public.get_public_report_timeline(uuid)  to anon, authenticated;

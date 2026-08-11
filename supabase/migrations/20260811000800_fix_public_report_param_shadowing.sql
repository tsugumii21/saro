-- ── Name the parameter so it cannot be read as a column ─────────────────────
--
-- get_public_report_timeline(report_id uuid) filtered on `r.id = report_id`,
-- and report_status_history has a column called report_id. Postgres resolved
-- the unqualified name to that column, so the predicate silently became
-- `r.id = h.report_id` — the join condition, true for every row. Every report
-- returned the whole city's status history.
--
-- Parameter names cannot be changed in place, so both functions are dropped and
-- recreated with a p_ prefix, and their grants restored.

drop function if exists public.get_public_report_timeline(uuid);
drop function if exists public.get_public_report(uuid);

create function public.get_public_report(p_report_id uuid)
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
  where r.id = p_report_id
    and not r.is_false_report
  limit 1;
$$;

comment on function public.get_public_report is
  'Read-only public detail for one report id, as shown from a map pin. No tracking code, no reporter, no device id.';

create function public.get_public_report_timeline(p_report_id uuid)
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
  where h.report_id = p_report_id
    and not r.is_false_report
  order by h.changed_at asc;
$$;

comment on function public.get_public_report_timeline is
  'Status history for one public report id. Never exposes changed_by — residents do not get staff identities.';

grant execute on function public.get_public_report(uuid)          to anon, authenticated;
grant execute on function public.get_public_report_timeline(uuid) to anon, authenticated;

-- ── Public map projection: return the report's description ──────────────────
--
-- The public map pin popup is now the only place a report is described: the
-- separate detail panel that sat beside the map is gone, so whatever the popup
-- does not receive simply is not shown anywhere. Until now this projection
-- returned category, status and a coarse point, and every public pin fell
-- through to the popup's empty-description state.
--
-- What this changes, stated plainly: the text a resident types when filing is
-- now readable by anyone on the public map, alongside a point rounded to
-- ~110 m. Coordinates stay rounded and no id, photo or reporter is exposed, so
-- a pin still cannot be joined back to a report row or a household. The
-- description is free text, so it is the one field that can carry identifying
-- detail the reporter chose to include.
-- Adding a column to the returned row changes the function's return type, which
-- `create or replace` cannot do (42P13) — it has to be dropped first. Dropping
-- also drops its grants, so the anon/authenticated execute grant is restored at
-- the bottom of this file.
drop function if exists public.get_public_map_reports(integer);

create function public.get_public_map_reports(max_age_hours integer default 168)
returns table (
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

grant execute on function public.get_public_map_reports(integer) to anon, authenticated;

comment on function public.get_public_map_reports is
  'Coarse public hazard map. Coordinates rounded to 3 decimal places (~110 m) so a pin cannot identify a household. Returns the reporter description shown in the pin popup; no id, photo or reporter identity is exposed.';

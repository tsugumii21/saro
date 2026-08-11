-- ── The device "My Reports" list gains the report id ────────────────────────
--
-- The public map publishes a report id and never a tracking code (see
-- 20260811000600_public_report_detail.sql). That is what lets the resident app
-- decide whether a pin on the map is one the reader filed themselves: it can
-- only compare ids, and get_reports_by_device returned none.
--
-- Nothing new is exposed. The device id is already a bearer token for exactly
-- these rows — whoever holds it can read their tracking codes, which are far
-- more powerful than an id. The id only lets the reader recognise their own pin.

drop function if exists public.get_reports_by_device(text);

create function public.get_reports_by_device(device_id text)
returns table (
  id              uuid,
  tracking_code   text,
  category        text,
  category_label  text,
  status          public.report_status,
  assigned_office text,
  created_at      timestamptz,
  updated_at      timestamptz
)
language sql
security definer
stable
set search_path = public, extensions
as $$
  select
    r.id,
    r.tracking_code,
    r.category,
    rt.label,
    r.status,
    o.short_name,
    r.created_at,
    r.updated_at
  from public.reports r
  left join public.routing_table rt on rt.category = r.category
  left join public.offices o on o.id = r.assigned_office_id
  where r.reporter_device_id = device_id
    and length(btrim(coalesce(device_id, ''))) >= 12   -- refuse trivially guessable ids
  order by r.created_at desc
  limit 100;
$$;

comment on function public.get_reports_by_device is
  'Device-local "My Reports". Requires a >=12 character device id so the id space cannot be walked. Returns the report id so the app can recognise its own reports among public map pins.';

-- Same reach as before the drop: this is the anonymous product surface, and an
-- anonymous resident's own report list is the whole point of the device id.
grant execute on function public.get_reports_by_device(text) to anon, authenticated;

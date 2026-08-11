-- ── Accident-prone areas track the collisions actually reported ─────────────
--
-- The layer needs MIN_INCIDENTS_FOR_ACCIDENT_AREA (3) dated incidents inside a
-- 24-month window before it marks a road. Every seeded blackspot carried
-- exactly one dated incident — the conservative backfill in
-- 20260808001300 — so nothing has qualified since, the markers stopped drawing
-- and the red road segments went with them.
--
-- Two changes, so the layer stops depending on hand-entered fixtures:
--
--   1. A collision report filed near a blackspot records an incident against
--      it. `accident` only: an accident-prone marking must mean crashes, not
--      potholes, or three surface defects would brand a street dangerous.
--   2. Three collisions inside the window with no blackspot near them create
--      one, so a newly dangerous junction can appear on its own.
--
-- The radius is CLUSTER_RADIUS_METERS (150 m) — the same distance the rest of
-- the system already treats as "the same place".

-- Metres between two lat/lng pairs. Haversine rather than PostGIS: the schema
-- carries plain double precision columns, and this is the only distance test in
-- the database.
create or replace function public.distance_meters(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
set search_path = public, extensions
as $$
  select 2 * 6371000 * asin(
    least(1, sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lng2 - lng1) / 2), 2)
    ))
  );
$$;

create or replace function public.record_accident_incident()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nearby_id     uuid;
  nearby_count  integer;
  radius_m      constant double precision := 150;
  window_months constant integer := 24;
begin
  if new.category is distinct from 'accident' then
    return new;
  end if;
  if new.lat is null or new.lng is null or coalesce(new.is_false_report, false) then
    return new;
  end if;

  -- Nearest existing blackspot within the radius, if any.
  select b.id
    into nearby_id
    from public.accident_blackspots b
   where public.distance_meters(b.lat, b.lng, new.lat, new.lng) <= radius_m
   order by public.distance_meters(b.lat, b.lng, new.lat, new.lng) asc
   limit 1;

  if nearby_id is null then
    -- No marking here yet. Count collisions already reported nearby inside the
    -- window; the third one is what makes the area a blackspot.
    select count(*)
      into nearby_count
      from public.reports r
     where r.category = 'accident'
       and not coalesce(r.is_false_report, false)
       and r.lat is not null and r.lng is not null
       and r.created_at >= now() - make_interval(months => window_months)
       and public.distance_meters(r.lat, r.lng, new.lat, new.lng) <= radius_m;

    if nearby_count < 3 then
      return new;
    end if;

    insert into public.accident_blackspots (name, location_label, lat, lng, incident_count, severity, last_reported_at)
    values (
      'Reported accident cluster',
      'Marked automatically from ' || nearby_count || ' collision reports within 150 m',
      new.lat,
      new.lng,
      nearby_count,
      'high',
      new.created_at
    )
    returning id into nearby_id;

    -- Backfill the collisions that earned the marking so the windowed count
    -- reflects them rather than starting from one.
    insert into public.accident_incidents (blackspot_id, occurred_at, severity, report_id, notes)
    select nearby_id, r.created_at, 'moderate', r.id, 'Citizen collision report'
      from public.reports r
     where r.category = 'accident'
       and not coalesce(r.is_false_report, false)
       and r.lat is not null and r.lng is not null
       and r.created_at >= now() - make_interval(months => window_months)
       and public.distance_meters(r.lat, r.lng, new.lat, new.lng) <= radius_m
       and r.id <> new.id;
  end if;

  insert into public.accident_incidents (blackspot_id, occurred_at, severity, report_id, notes)
  values (nearby_id, new.created_at, 'moderate', new.id, 'Citizen collision report');

  update public.accident_blackspots
     set incident_count  = incident_count + 1,
         last_reported_at = greatest(coalesce(last_reported_at, new.created_at), new.created_at)
   where id = nearby_id;

  return new;
end;
$$;

drop trigger if exists record_accident_incident_on_report on public.reports;
create trigger record_accident_incident_on_report
  after insert on public.reports
  for each row execute function public.record_accident_incident();

comment on function public.record_accident_incident is
  'Files an accident_incidents row for each collision report within 150 m of a blackspot, and creates a blackspot once three collisions cluster inside the rolling window.';

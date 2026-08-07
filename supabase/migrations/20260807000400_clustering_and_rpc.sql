-- SARO 04 — server-side clustering, and the RPCs the anonymous apps call.

set search_path = public, extensions;

-- ── Clustering ──────────────────────────────────────────────────────────────

-- Port of the Turf.js rule the prototype ran in the browser: two reports
-- corroborate each other when they share a category, sit within 150 m, and
-- arrive within 60 minutes. Now it runs in Postgres, so it holds regardless of
-- which client submitted the report.
create or replace function public.assign_report_cluster()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  radius_meters  constant double precision := 150;
  window_minutes constant integer := 60;
  target_cluster uuid;
  nearest_meters double precision;
  member_count   integer;
begin
  -- 1. An existing cluster with a member close enough in space and time.
  select r.cluster_id,
         extensions.ST_Distance(r.location, new.location)
    into target_cluster, nearest_meters
  from public.reports r
  where r.id <> new.id
    and r.cluster_id is not null
    and r.category = new.category
    and r.created_at > new.created_at - make_interval(mins => window_minutes)
    and extensions.ST_DWithin(r.location, new.location, radius_meters)
  order by extensions.ST_Distance(r.location, new.location)
  limit 1;

  -- 2. Otherwise an unclustered neighbour — promote the pair into a new cluster.
  if target_cluster is null then
    declare
      neighbour_id uuid;
    begin
      select r.id, extensions.ST_Distance(r.location, new.location)
        into neighbour_id, nearest_meters
      from public.reports r
      where r.id <> new.id
        and r.cluster_id is null
        and r.category = new.category
        and r.created_at > new.created_at - make_interval(mins => window_minutes)
        and extensions.ST_DWithin(r.location, new.location, radius_meters)
      order by extensions.ST_Distance(r.location, new.location)
      limit 1;

      if neighbour_id is null then
        return new;                     -- genuinely isolated; no cluster
      end if;

      insert into public.clusters (category, centroid, confidence_score, report_count)
      values (new.category, new.location, 1, 1)
      returning id into target_cluster;

      update public.reports set cluster_id = target_cluster where id = neighbour_id;
      insert into public.cluster_reports (cluster_id, report_id, distance_meters)
      values (target_cluster, neighbour_id, 0)
      on conflict do nothing;
    end;
  end if;

  -- 3. Join the cluster and recompute its centroid and confidence.
  update public.reports set cluster_id = target_cluster where id = new.id;

  insert into public.cluster_reports (cluster_id, report_id, distance_meters)
  values (target_cluster, new.id, nearest_meters)
  on conflict do nothing;

  select count(*) into member_count
  from public.cluster_reports where cluster_id = target_cluster;

  update public.clusters c
  set report_count     = member_count,
      confidence_score = member_count,
      centroid = (
        select extensions.ST_Centroid(
                 extensions.ST_Collect(r.location::extensions.geometry)
               )::extensions.geography
        from public.reports r
        where r.cluster_id = target_cluster
      )
  where c.id = target_cluster;

  return new;
end;
$$;

create trigger reports_assign_cluster
  after insert on public.reports
  for each row execute function public.assign_report_cluster();

-- ═══════════════════════════════════════════════════════════════════════════
-- RPCs for anonymous callers
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Anonymous users never get SELECT on public.reports. Letting them read the
-- table would let anyone page through every report and photo in the city.
-- These SECURITY DEFINER functions are the only anonymous read paths, and each
-- one returns a deliberately narrow projection.

-- ── Tracking-code lookup ────────────────────────────────────────────────────

-- Returns ONE report's public status for a known tracking code.
-- Deliberately omitted: description, photo, callback number, device id,
-- reporter identity. Knowing a code proves you were handed it; it does not
-- entitle you to the reporter's details.
create or replace function public.get_report_by_tracking_code(code text)
returns table (
  tracking_code   text,
  category        text,
  category_label  text,
  status          public.report_status,
  assigned_office text,
  barangay        text,
  lat             double precision,
  lng             double precision,
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
    r.tracking_code,
    r.category,
    rt.label,
    r.status,
    o.short_name,
    b.name,
    r.lat,
    r.lng,
    r.created_at,
    r.updated_at,
    r.resolved_at
  from public.reports r
  left join public.routing_table rt on rt.category = r.category
  left join public.offices   o on o.id = r.assigned_office_id
  left join public.barangays b on b.id = r.barangay_id
  where r.tracking_code = upper(btrim(code))
  limit 1;
$$;

comment on function public.get_report_by_tracking_code is
  'Anonymous single-report status lookup. Returns no description, photo, contact number or device id.';

-- ── Status timeline for a tracking code ─────────────────────────────────────

create or replace function public.get_report_timeline(code text)
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
  where r.tracking_code = upper(btrim(code))
  order by h.changed_at asc;
$$;

comment on function public.get_report_timeline is
  'Anonymous status history for one tracking code. Never exposes changed_by — residents do not get staff identities.';

-- ── "My Reports" for an anonymous device ────────────────────────────────────

-- The device id is a random value the browser generated for itself. It is a
-- bearer token: whoever holds it sees those reports, which is exactly the
-- prototype's device-local list, now server-backed.
create or replace function public.get_reports_by_device(device_id text)
returns table (
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
  'Device-local "My Reports". Requires a >=12 character device id so the id space cannot be walked.';

-- ── Public map projection ───────────────────────────────────────────────────

-- What the resident public map is allowed to show: coarse location, category
-- and status. No description, no photo, no reporter. Coordinates are rounded
-- to ~110 m so a pin cannot identify a specific household.
create or replace function public.get_public_map_reports(max_age_hours integer default 168)
returns table (
  category       text,
  category_label text,
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
  'Coarse public hazard map. Coordinates rounded to 3 decimal places (~110 m) so a pin cannot identify a household.';

-- ── Panic flag counter ──────────────────────────────────────────────────────

create or replace function public.register_panic_flag(token text)
returns table (flag_count integer, is_blocked boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  result record;
begin
  if length(btrim(coalesce(token, ''))) < 12 then
    raise exception 'invalid device token';
  end if;

  insert into public.panic_flags (device_token, flag_count, last_flagged_at)
  values (token, 1, now())
  on conflict (device_token) do update
    set flag_count      = public.panic_flags.flag_count + 1,
        last_flagged_at = now(),
        -- More than 10 panic presses in a day gets the device throttled.
        is_blocked      = (public.panic_flags.flag_count + 1) > 10
                          and public.panic_flags.last_flagged_at > now() - interval '24 hours'
  returning public.panic_flags.flag_count, public.panic_flags.is_blocked into result;

  return query select result.flag_count, result.is_blocked;
end;
$$;

comment on function public.register_panic_flag is
  'Increments the per-device panic counter and reports whether the device is throttled.';

-- ── Execution grants ────────────────────────────────────────────────────────
-- SECURITY DEFINER functions must be granted explicitly; nothing else in the
-- public schema is reachable by anon.

revoke all on function public.get_report_by_tracking_code(text) from public;
revoke all on function public.get_report_timeline(text)         from public;
revoke all on function public.get_reports_by_device(text)       from public;
revoke all on function public.get_public_map_reports(integer)   from public;
revoke all on function public.register_panic_flag(text)         from public;

grant execute on function public.get_report_by_tracking_code(text) to anon, authenticated;
grant execute on function public.get_report_timeline(text)         to anon, authenticated;
grant execute on function public.get_reports_by_device(text)       to anon, authenticated;
grant execute on function public.get_public_map_reports(integer)   to anon, authenticated;
grant execute on function public.register_panic_flag(text)         to anon, authenticated;

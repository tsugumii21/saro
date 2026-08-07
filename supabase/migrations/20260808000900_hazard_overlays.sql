-- SARO 18 — hazard overlays, geofencing, alert level, rainfall cache.
--
-- ══════════════════════════════════════════════════════════════════════════
-- On where the geofence runs
-- ══════════════════════════════════════════════════════════════════════════
--
-- The requirement was: point-in-polygon at submission time, server-side, so a
-- slow or hostile client cannot skip it, and without writing to
-- report_status_history.
--
-- That is implemented here as a BEFORE INSERT trigger using PostGIS, rather
-- than as an Edge Function using Turf. The stated property is what matters and
-- a trigger satisfies it more completely:
--
--   An Edge Function can be skipped. Anything holding the publishable key can
--   POST straight to /rest/v1/reports or call file_anonymous_report and never
--   touch the function. The flag would simply be absent, silently, on exactly
--   the reports someone wanted unflagged.
--
--   A trigger cannot. It runs inside the same transaction as the insert, on
--   every path — resident app, admin app, curl, psql, the service role, the
--   offline queue draining from a service worker hours later. There is no
--   route into this table that goes around it.
--
--   It is also atomic. An Edge Function flagging after the insert leaves a
--   window where the report exists unflagged, and a failed second call leaves
--   it wrong permanently.
--
-- PostGIS is already an extension in this project and ST_Intersects on an
-- indexed geography column is faster than a network hop to Deno. Turf.js is
-- still used, client-side, to preview the same check before submit — but the
-- browser's answer is never what gets stored.
--
-- This writes ONLY to reports.priority and reports.priority_reason. It does not
-- touch report_status_history; record_status_change remains the single writer
-- of that table.

-- ══════════════════════════════════════════════════════════════════════════
-- Hazard zones
-- ══════════════════════════════════════════════════════════════════════════

create type public.hazard_kind as enum (
  'volcanic_danger_zone',   -- PDZ / EDZ
  'pyroclastic',
  'lahar',
  'lava',
  'flood'
);

create table public.hazard_zones (
  id              uuid primary key default extensions.gen_random_uuid(),
  kind            public.hazard_kind not null,
  code            text not null unique,
  label           text not null,

  -- Only zones marked active take part in geofencing. This is how a zone can be
  -- present on the map for context but not escalate every report inside it —
  -- the 100-year flood outline covers most of the city, and flagging every
  -- pothole in Legazpi as high priority would make the flag mean nothing.
  is_active       boolean not null default true,

  severity        smallint not null default 1 check (severity between 1 and 3),
  geom            extensions.geography(MultiPolygon, 4326) not null,

  source          text not null,
  source_url      text,
  retrieved_at    timestamptz,
  is_derived      boolean not null default false,
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index hazard_zones_geom_idx on public.hazard_zones using gist (geom);
create index hazard_zones_active_idx on public.hazard_zones (is_active, severity desc);

comment on table public.hazard_zones is
  'Official hazard polygons used for server-side geofencing. Populated by supabase/scripts/seed-hazard-zones.mjs from the versioned GeoJSON in packages/shared/assets/hazard.';
comment on column public.hazard_zones.is_active is
  'Only active zones escalate a report. Lets a zone be shown on the map without making every report inside it high priority.';
comment on column public.hazard_zones.is_derived is
  'True for the PDZ/EDZ circles, which are generated from official radii rather than downloaded as polygons.';

create trigger hazard_zones_touch
  before update on public.hazard_zones
  for each row execute function public.touch_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- Report priority
-- ══════════════════════════════════════════════════════════════════════════

create type public.report_priority as enum ('normal', 'high');

alter table public.reports
  add column if not exists priority public.report_priority not null default 'normal',
  add column if not exists priority_reason text;

create index reports_priority_idx on public.reports (priority, created_at desc);

comment on column public.reports.priority is
  'Set by the hazard geofence at insert. Metadata, not a pipeline state — it never appears in report_status_history.';
comment on column public.reports.priority_reason is
  'Which zone escalated this report, in words a dispatcher can act on.';

create or replace function public.apply_hazard_priority()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  hit record;
begin
  if new.lat is null or new.lng is null then
    return new;
  end if;

  -- Highest severity wins, so a report inside both the EDZ and a lahar channel
  -- is described by the more dangerous of the two rather than whichever row the
  -- planner happened to reach first.
  select z.label, z.kind, z.severity
    into hit
  from public.hazard_zones z
  where z.is_active
    and extensions.st_intersects(
          z.geom,
          extensions.st_setsrid(extensions.st_makepoint(new.lng, new.lat), 4326)::extensions.geography
        )
  order by z.severity desc, z.kind
  limit 1;

  if found then
    new.priority := 'high';
    new.priority_reason := hit.label;
  end if;

  return new;
end;
$$;

comment on function public.apply_hazard_priority is
  'Point-in-polygon geofence against active hazard zones. Runs in the insert transaction, so no client can skip it.';

-- BEFORE INSERT, and ordered after routing by name (apply_report_routing fires
-- first alphabetically). Both only write to NEW; they do not interact.
create trigger reports_apply_hazard_priority
  before insert on public.reports
  for each row execute function public.apply_hazard_priority();

-- ══════════════════════════════════════════════════════════════════════════
-- Volcanic alert level — manually set, never scraped
-- ══════════════════════════════════════════════════════════════════════════
--
-- Deliberately not automated. The alert level drives evacuation decisions, and
-- a scraper silently breaking against a redesigned PHIVOLCS page would leave
-- SARO confidently displaying a stale level — which is worse than displaying
-- nothing. An official sets it, signs it with a timestamp, and the UI shows how
-- old that is next to a link to the official bulletin.

create table public.volcanic_alert (
  id               boolean primary key default true check (id),   -- single row
  volcano          text not null default 'Mayon',
  alert_level      smallint not null default 0 check (alert_level between 0 and 5),
  summary          text,
  bulletin_url     text not null default 'https://www.phivolcs.dost.gov.ph/index.php/volcano-hazard/volcano-bulletin2',
  last_verified_at timestamptz not null default now(),
  verified_by      uuid references auth.users(id) on delete set null,
  updated_at       timestamptz not null default now()
);

insert into public.volcanic_alert (id, alert_level, summary)
values (true, 0, 'No recorded eruption. Set by a city administrator after checking the PHIVOLCS bulletin.')
on conflict (id) do nothing;

comment on table public.volcanic_alert is
  'Single-row store for the current Mayon alert level. Set by hand by an admin; never scraped.';
comment on column public.volcanic_alert.last_verified_at is
  'When a human last checked the official bulletin. Displayed as an age so a stale value is visibly stale.';

create trigger volcanic_alert_touch
  before update on public.volcanic_alert
  for each row execute function public.touch_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- Rainfall cache
-- ══════════════════════════════════════════════════════════════════════════
--
-- Written only by the scheduled Edge Function, using the service role. Clients
-- read this table instead of calling Open-Meteo, so a thousand phones refreshing
-- during a storm is still one upstream request every fifteen minutes.

create table public.rainfall_observations (
  id             uuid primary key default extensions.gen_random_uuid(),
  station_code   text not null,
  station_label  text not null,
  lat            double precision not null,
  lng            double precision not null,

  observed_at    timestamptz not null,
  precip_mm      numeric(6,2),
  precip_1h_mm   numeric(6,2),
  precip_24h_mm  numeric(6,2),

  source         text not null default 'open-meteo',
  fetched_at     timestamptz not null default now(),

  unique (station_code, observed_at)
);

create index rainfall_recent_idx on public.rainfall_observations (observed_at desc);

comment on table public.rainfall_observations is
  'Cached rainfall from Open-Meteo, refreshed by the rainfall-poll Edge Function. Clients never call the upstream API directly.';

-- ══════════════════════════════════════════════════════════════════════════
-- RLS
-- ══════════════════════════════════════════════════════════════════════════

alter table public.hazard_zones          enable row level security;
alter table public.volcanic_alert        enable row level security;
alter table public.rainfall_observations enable row level security;

-- All three are public reference data: hazard boundaries, the published alert
-- level, and rainfall. Publishing them is the point of the feature, and a
-- resident who cannot see which zone they are standing in is not being
-- protected by the secrecy.
create policy "hazard zones are public"
  on public.hazard_zones for select to anon, authenticated using (true);

create policy "alert level is public"
  on public.volcanic_alert for select to anon, authenticated using (true);

create policy "rainfall is public"
  on public.rainfall_observations for select to anon, authenticated using (true);

-- Writes are admin-only. An office marking the whole city as a danger zone, or
-- setting Alert Level 5 on a quiet Tuesday, are both city-wide acts.
create policy "only admins change hazard zones"
  on public.hazard_zones for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "only admins set the alert level"
  on public.volcanic_alert for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- No write policy for rainfall. The Edge Function uses the service role, which
-- bypasses RLS; nobody else may write, so a client cannot forge a rain reading.

grant select on public.hazard_zones, public.volcanic_alert, public.rainfall_observations
  to anon, authenticated;
revoke insert, update, delete on public.rainfall_observations from anon, authenticated;

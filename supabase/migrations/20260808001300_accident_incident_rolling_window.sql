-- Migration: per-incident dates for accident blackspots, and a windowed count.
--
-- `accident_blackspots.incident_count` is an all-time scalar. A tally that can
-- only ever grow cannot answer "is this junction dangerous *now*" — a site fixed
-- by a new signal in 2023 stays branded accident-prone forever on the strength
-- of crashes its redesign already solved.
--
-- This adds the incident-level dates the rolling window needs. Nothing is
-- deleted and `incident_count` keeps its all-time meaning; the window is applied
-- at read time, so widening it brings excluded history straight back.

create table if not exists public.accident_incidents (
  id            uuid primary key default extensions.gen_random_uuid(),
  blackspot_id  uuid not null references public.accident_blackspots (id) on delete cascade,
  occurred_at   timestamptz not null,
  severity      text,
  -- Optional link back to the citizen report this incident came from, when it
  -- originated in SARO rather than from a city road-safety record.
  report_id     uuid references public.reports (id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists accident_incidents_blackspot_occurred_idx
  on public.accident_incidents (blackspot_id, occurred_at desc);

alter table public.accident_incidents enable row level security;

create policy "Accident incidents are readable by everyone"
  on public.accident_incidents for select
  using (true);

create policy "Accident incidents editable by staff/admin"
  on public.accident_incidents for all
  using (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('admin', 'office')
    )
  );

-- ── Windowed read ───────────────────────────────────────────────────────────
--
-- Returns every blackspot with `recent_incident_count`: incidents inside the
-- trailing window only. `incident_count` is passed through untouched so the
-- all-time figure stays available to staff views.
--
-- window_months defaults to 24, matching ACCIDENT_ROLLING_WINDOW_MONTHS in
-- packages/shared/src/constants.js. Change both together.
create or replace function public.get_accident_blackspots_windowed(window_months integer default 24)
returns table (
  id                    uuid,
  name                  text,
  location_label        text,
  lat                   double precision,
  lng                   double precision,
  incident_count        integer,
  recent_incident_count integer,
  severity              text,
  last_reported_at      timestamptz,
  created_at            timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    b.id,
    b.name,
    b.location_label,
    b.lat,
    b.lng,
    b.incident_count,
    coalesce(
      (
        select count(*)
        from public.accident_incidents i
        where i.blackspot_id = b.id
          and i.occurred_at >= now() - make_interval(months => window_months)
      ),
      0
    )::integer as recent_incident_count,
    b.severity,
    b.last_reported_at,
    b.created_at
  from public.accident_blackspots b;
$$;

grant execute on function public.get_accident_blackspots_windowed(integer) to anon, authenticated;

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Existing rows carry only a scalar and a `last_reported_at`. Rather than invent
-- plausible-looking dates for crashes nobody recorded, each seeded blackspot
-- gets a single incident row at its known last-reported timestamp. The windowed
-- count therefore starts conservative — under the threshold — and rises as real
-- dated incidents are entered. `incident_count` is left exactly as it was.
insert into public.accident_incidents (blackspot_id, occurred_at, severity, notes)
select
  b.id,
  b.last_reported_at,
  b.severity,
  'Backfilled from accident_blackspots.last_reported_at during migration 20260808001300. '
    || 'Historic all-time total was ' || b.incident_count || ' incidents, dates unrecorded.'
from public.accident_blackspots b
where not exists (
  select 1 from public.accident_incidents i where i.blackspot_id = b.id
);

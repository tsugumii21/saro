-- Migration: Evacuation Centers & Accident Blackspots for SARO
create table if not exists public.evacuation_centers (
  id                uuid primary key default extensions.gen_random_uuid(),
  name              text not null,
  address           text not null,
  lat               double precision not null,
  lng               double precision not null,
  capacity          integer not null default 100,
  current_occupancy integer not null default 0,
  status            text not null default 'ready', -- 'ready' | 'open' | 'full' | 'closed'
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- RLS Policies for evacuation_centers
alter table public.evacuation_centers enable row level security;

create policy "Evacuation centers are readable by everyone"
  on public.evacuation_centers for select
  using (true);

create policy "Evacuation centers editable by staff/admin"
  on public.evacuation_centers for all
  using (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role in ('admin', 'office')
    )
  );

-- Seed Official Legazpi Evacuation Centers
insert into public.evacuation_centers (name, address, lat, lng, capacity, current_occupancy, status, notes)
values
  ('Legazpi City Evacuation Center (Ibalong Center)', 'Bitano, Legazpi City', 13.1425, 123.7485, 800, 0, 'ready', 'Primary multi-purpose disaster shelter equipped with generator and water supply.'),
  ('Rawis Multi-Purpose Evacuation Center', 'Barangay Rawis, Legazpi City', 13.1610, 123.7540, 500, 0, 'ready', 'Barangay disaster resilience hall with medical triage room.'),
  ('Banquerohan Disaster Operations Center', 'Banquerohan, Legazpi City', 13.1180, 123.7220, 650, 0, 'ready', 'High-ground shelter for Mayon southeast sector evacuees.'),
  ('Tapo-Tapo Elementary Shelter', 'Barangay Tapo-Tapo, Legazpi City', 13.1350, 123.7150, 350, 0, 'ready', 'Secondary designated evacuation site with emergency provisions.')
on conflict do nothing;

-- Accident Blackspots Table
create table if not exists public.accident_blackspots (
  id                uuid primary key default extensions.gen_random_uuid(),
  name              text not null,
  location_label    text not null,
  lat               double precision not null,
  lng               double precision not null,
  incident_count    integer not null default 1,
  severity          text not null default 'high', -- 'moderate' | 'high' | 'critical'
  last_reported_at  timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

-- RLS Policies for accident_blackspots
alter table public.accident_blackspots enable row level security;

create policy "Accident blackspots are readable by everyone"
  on public.accident_blackspots for select
  using (true);

create policy "Accident blackspots editable by staff/admin"
  on public.accident_blackspots for all
  using (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role in ('admin', 'office')
    )
  );

-- Seed Official PNP/DPWH Blackspots
insert into public.accident_blackspots (name, location_label, lat, lng, incident_count, severity, last_reported_at)
values
  ('Yawa Bridge Intersection Blackspot', 'Yawa Bridge, Rawis Highway', 13.1550, 123.7480, 14, 'critical', now() - interval '2 hours'),
  ('Legazpi Port-Tahao Road Curve', 'Tahao Road, Barangay 15', 13.1385, 123.7410, 9, 'high', now() - interval '1 day'),
  ('Washington Drive Junction', 'Washington Drive, Bitano', 13.1460, 123.7380, 6, 'moderate', now() - interval '3 days')
on conflict do nothing;

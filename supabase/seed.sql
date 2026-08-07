-- SARO seed data.
--
-- Runs automatically on `supabase db reset` (local). To load it into the
-- linked remote project:  supabase db push && psql "$DB_URL" -f supabase/seed.sql
--
-- Contains reference data (offices, barangays, routing table) and a spread of
-- realistic reports: mixed statuses, mixed ages, two natural clusters, one
-- false report, one proxy report. Staff accounts are NOT seeded here — they
-- need auth.users rows, which is what scripts/create-staff-users.mjs is for.
--
-- Safe to re-run: everything is idempotent on a natural key.

set search_path = public, extensions;

-- ── Offices ─────────────────────────────────────────────────────────────────

insert into public.offices (short_name, full_name, hotline) values
  ('CDRRMO',              'City Disaster Risk Reduction and Management Office',   '(052) 480-3333'),
  ('Legazpi 911',         'Legazpi 911 Emergency Command Center',                 '911'),
  ('City Engineering',    'City Engineering Office',                              '(052) 742-0102'),
  ('Public Safety Office','Public Safety Office (PSO)',                           '(052) 742-0155'),
  ('BFP Legazpi',         'Bureau of Fire Protection - Legazpi Station',          '(052) 480-6222'),
  ('PNP Legazpi',         'Philippine National Police - Legazpi City Station',    '(052) 820-6144'),
  ('City Health Office',  'City Health Office (CHO)',                             '(052) 742-0188'),
  ('Coast Guard Station', 'Philippine Coast Guard - Legazpi Station',             '(052) 480-1888')
on conflict (short_name) do nothing;

-- ── Barangays ───────────────────────────────────────────────────────────────

-- Boundaries are small squares around each barangay centre. Good enough for
-- point-in-polygon assignment in a prototype; replace with the city's real
-- shapefile before this goes anywhere near production.
insert into public.barangays (name, is_coastal, boundary)
select
  v.name,
  v.is_coastal,
  extensions.ST_SetSRID(
    extensions.ST_MakeEnvelope(v.lng - 0.006, v.lat - 0.006, v.lng + 0.006, v.lat + 0.006),
    4326
  )::extensions.geography
from (values
  ('Bitano',          false, 13.1438, 123.7448),
  ('Rawis',           true,  13.1610, 123.7510),
  ('Gogon',           false, 13.1490, 123.7380),
  ('Em''s Barrio',    false, 13.1415, 123.7410),
  ('Puro',            true,  13.1320, 123.7560),
  ('Victory Village', true,  13.1420, 123.7540),
  ('Taysan',          false, 13.1200, 123.7100),
  ('Bonot',           true,  13.1500, 123.7490),
  ('Cruzada',         false, 13.1360, 123.7330),
  ('Homapon',         false, 13.1180, 123.7250),
  ('Dap-Dap',         true,  13.1650, 123.7420),
  ('Oro Site',        false, 13.1395, 123.7465)
) as v(name, is_coastal, lat, lng)
on conflict (name) do nothing;

-- ── Routing table ───────────────────────────────────────────────────────────

insert into public.routing_table
  (category, label, label_bikol, label_tagalog, responsible_office_id, is_emergency, is_fallback, sla_hours)
select
  v.category, v.label, v.label_bikol, v.label_tagalog,
  o.id, v.is_emergency, v.is_fallback, v.sla_hours
from (values
  ('flood',                'Flooding & Water Inundation',            'Baha o Tubig sa Kalsada',              'Baha sa Daan',                     'CDRRMO',               true,  true,   1),
  ('landslide',            'Landslide & Soil Erosion',               'Guba nin Lupa o Anod',                 'Pagguho ng Lupa',                  'CDRRMO',               true,  false,  2),
  ('typhoon_debris',       'Typhoon Debris & Structural Damage',     'Guba sa Bagyo o Basura sa Kalsada',    'Basura o Sira galing Bagyo',       'CDRRMO',               false, false, 24),
  ('medical',              'Medical Emergency & Injury',             'Emergency sa Salud o Disgrasya',       'Emergency sa Kalusugan',           'Legazpi 911',          true,  false,  1),
  ('accident',             'Vehicular Collision & Road Crash',       'Disgrasya sa Kalsada',                 'Aksidente sa Daan',                'Legazpi 911',          true,  false,  1),
  ('pothole',              'Road Pothole & Surface Damage',          'Luwag o Rara sa Kalsada',              'Lubak sa Kalsada',                 'City Engineering',     false, false, 72),
  ('open_drain',           'Uncovered Drain & Broken Manhole',       'Open Canal o Nahulog na Takop',        'Bukas o Sirang Kanal',             'City Engineering',     false, false, 24),
  ('bridge_damage',        'Bridge & Seawall Damage',                'Guba sa Tulay o Seawall',              'Sira sa Tulay o Seawall',          'City Engineering',     true,  false, 12),
  ('traffic_obstruction',  'Road Obstruction & Signal Malfunction',  'Bara sa Kalsada o Sira na Traffic Light','Bara sa Daan o Sirang Ilaw',     'Public Safety Office', false, false, 12),
  ('fire',                 'Fire Outbreak & Structural Fire',        'Cayo o Uswag nin Apoy',                'Sunog',                            'BFP Legazpi',          true,  false,  1),
  ('gas_leak',             'Gas Leak & Chemical Spill',              'Singaw nin Gas o Kemikal',             'Kagipitan sa Gas o Kemikal',       'BFP Legazpi',          true,  false,  1),
  ('crime',                'Public Order & Crime Incident',          'Kagubot o Krimen',                     'Gulo o Krimen',                    'PNP Legazpi',          true,  false,  1),
  ('water_contam',         'Water Contamination & Health Hazard',    'Dumi sa Tubig Inomon',                 'Maduming Tubig Inumin',            'City Health Office',   false, false, 24),
  ('coastal_hazard',       'Coastal Storm Surge & Marine Emergency', 'Baha sa Baybayon o Emergency sa Dagat','Emergency sa Baybayin',            'Coast Guard Station',  true,  false,  2)
) as v(category, label, label_bikol, label_tagalog, office_short_name, is_emergency, is_fallback, sla_hours)
join public.offices o on o.short_name = v.office_short_name
on conflict (category) do nothing;

-- ── Reports ─────────────────────────────────────────────────────────────────
--
-- Inserted oldest first so the clustering trigger sees the same arrival order
-- it would in production. Routing, barangay assignment, status history and
-- clustering are all produced by triggers — nothing below sets them by hand.

do $$
declare
  r record;
  new_id uuid;
begin
  if exists (select 1 from public.reports limit 1) then
    raise notice 'reports already seeded, skipping';
    return;
  end if;

  for r in
    select * from (values
      -- category,        description,                                                                              lat,      lng,       age_hours, final_status,   device
      ('flood',           'Flooding near Bitano market line. Water level rising fast by the bakery.',                13.1438,  123.7448,  96,  'resolved',    'dev_seed_a1b2c3d4e5f6'),
      ('pothole',         'Deep pothole on the northbound lane, two tricycles already damaged.',                     13.1490,  123.7380,  80,  'resolved',    'dev_seed_b2c3d4e5f6a1'),
      ('open_drain',      'Manhole cover missing outside the elementary school gate.',                               13.1415,  123.7410,  62,  'in_progress', 'dev_seed_c3d4e5f6a1b2'),
      ('typhoon_debris',  'Fallen acacia branch blocking half the road after last night''s wind.',                   13.1395,  123.7465,  50,  'in_progress', 'dev_seed_d4e5f6a1b2c3'),
      ('water_contam',    'Tap water running brown since yesterday morning, whole street affected.',                 13.1360,  123.7330,  44,  'assigned',    'dev_seed_e5f6a1b2c3d4'),
      ('bridge_damage',   'Crack widening on the seawall walkway near the pier.',                                    13.1320,  123.7560,  30,  'assigned',    'dev_seed_f6a1b2c3d4e5'),
      ('traffic_obstruction','Traffic light at the junction stuck on red in all directions.',                        13.1420,  123.7540,  26,  'assigned',    'dev_seed_a1b2c3d4e5f7'),
      ('landslide',       'Soil slipping down the cut slope above the barangay road.',                               13.1180,  123.7250,  20,  'in_progress', 'dev_seed_b2c3d4e5f6a8'),
      ('coastal_hazard',  'Storm surge pushing over the breakwater at high tide.',                                   13.1650, 123.7420,  14,  'assigned',    'dev_seed_c3d4e5f6a1b9'),
      ('medical',         'Elderly neighbour collapsed at home, breathing but unresponsive.',                        13.1500,  123.7490,   9,  'resolved',    'dev_seed_d4e5f6a1b2ca'),
      ('accident',        'Motorcycle and jeepney collision at the corner, one rider on the ground.',                13.1200,  123.7100,   6,  'in_progress', 'dev_seed_e5f6a1b2c3db'),
      ('crime',           'Group fighting outside the sari-sari store, one person holding a bottle.',                13.1610,  123.7510,   4,  'assigned',    'dev_seed_f6a1b2c3d4ec'),
      -- Cluster 1: three independent reports of the same fire, minutes apart, same block.
      ('fire',            'Smoke coming from the second floor of the corner house.',                                 13.1444,  123.7452,   3,  'in_progress', 'dev_seed_a1b2c3d4e5fd'),
      ('fire',            'House on fire near the bakery, flames visible from the street now.',                      13.1445,  123.7453,   3,  'in_progress', 'dev_seed_b2c3d4e5f6ae'),
      ('fire',            'Big fire two houses down from us, please send help.',                                     13.1443,  123.7451,   3,  'in_progress', 'dev_seed_c3d4e5f6a1bf'),
      -- Cluster 2: two reports of the same flooded underpass.
      ('flood',           'Underpass completely flooded, cars turning back.',                                        13.1489,  123.7381,   2,  'assigned',    'dev_seed_d4e5f6a1b2cg'),
      ('flood',           'Water up to knee height at the underpass, nobody can pass.',                              13.1490,  123.7382,   2,  'assigned',    'dev_seed_e5f6a1b2c3dh'),
      -- Fresh, untriaged.
      ('gas_leak',        'Strong LPG smell along the alley, cannot tell which house.',                              13.1365,  123.7335,   1,  'received',    'dev_seed_f6a1b2c3d4ei'),
      ('pothole',         'Sunken patch forming after the rain, getting deeper each day.',                           13.1210,  123.7110,   1,  'received',    'dev_seed_a1b2c3d4e5fj')
    ) as t(category, description, lat, lng, age_hours, final_status, device)
  loop
    insert into public.reports (category, description, lat, lng, reporter_device_id, created_at)
    values (r.category, r.description, r.lat, r.lng, r.device, now() - make_interval(hours => r.age_hours))
    returning id into new_id;

    -- Walk the report forward through the pipeline so status history is real
    -- rather than a single synthetic row.
    if r.final_status in ('assigned', 'in_progress', 'resolved') then
      update public.reports set status = 'assigned' where id = new_id;
    end if;
    if r.final_status in ('in_progress', 'resolved') then
      update public.reports set status = 'in_progress' where id = new_id;
    end if;
    if r.final_status = 'resolved' then
      update public.reports set status = 'resolved' where id = new_id;
    end if;
  end loop;

  -- One report filed at the barangay hall on a resident's behalf.
  --
  -- Seeded with a device id rather than a user id because no staff accounts
  -- exist yet when this file runs. A real File on Behalf sets reporter_user_id
  -- to the barangay official, which is what the RLS policy requires and what
  -- makes it show as verified.
  insert into public.reports (category, description, lat, lng, is_proxy_report, callback_number, reporter_device_id, created_at)
  values (
    'open_drain',
    'Reported in person at the barangay hall: broken drain cover on the corner, resident has no phone.',
    13.1362, 123.7332, true, '09170001234', 'dev_seed_brgyhall0001', now() - interval '5 hours'
  );

  -- One report an office has since verified as false.
  insert into public.reports (category, description, lat, lng, reporter_device_id, created_at)
  values (
    'fire',
    'Smoke near the plaza.',
    13.1400, 123.7440, 'dev_seed_falsereport01', now() - interval '36 hours'
  )
  returning id into new_id;
  update public.reports set is_false_report = true, status = 'resolved' where id = new_id;
end $$;

-- ── Assistant gap log ───────────────────────────────────────────────────────

insert into public.gap_log (question, was_answered, topic_cluster, resolved, created_at)
values
  ('Saino kaya pwede mag-report nin sirang street light sa Rizal street?', false, 'street_lighting', false, now() - interval '48 hours'),
  ('Paano mag-report ng sirang ilaw sa kalsada?',                          false, 'street_lighting', false, now() - interval '30 hours'),
  ('Sirang street light sa may plaza, sino ang tatawagan?',                false, 'street_lighting', false, now() - interval '12 hours'),
  ('May bayad po ba ang pag-report ng baha?',                              true,  'fees',            true,  now() - interval '26 hours'),
  ('Ano ang hotline ng CDRRMO?',                                           true,  'hotlines',        true,  now() - interval '20 hours'),
  ('Pwede po ba mag-report kung wala akong account?',                      true,  'accounts',        true,  now() - interval '18 hours'),
  ('Gaano katagal bago ma-resolve ang report sa lubak?',                   false, 'sla_expectations',false, now() - interval '8 hours'),
  ('Saan ko makikita ang status ng report ko?',                            true,  'tracking',        true,  now() - interval '3 hours')
on conflict do nothing;

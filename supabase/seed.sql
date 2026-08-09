-- SARO seed data.
--
-- Runs automatically on `supabase db reset` (local). To load it into the
-- linked remote project:  supabase db push && psql "$DB_URL" -f supabase/seed.sql
--
-- Contains reference data (offices, barangays, routing table), evacuation centers,
-- accident blackspots, gap log entries, and a comprehensive spread of realistic reports
-- across every connected office, barangay, and pipeline status.

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

-- ── Evacuation Centers ───────────────────────────────────────────────────────

insert into public.evacuation_centers (name, address, lat, lng, capacity, current_occupancy, status, notes)
values
  ('Legazpi City Evacuation Center (Ibalong Center)', 'Bitano, Legazpi City', 13.1425, 123.7485, 800, 45, 'open', 'Primary multi-purpose disaster shelter equipped with generator and water supply.'),
  ('Rawis Multi-Purpose Evacuation Center', 'Barangay Rawis, Legazpi City', 13.1610, 123.7540, 500, 0, 'ready', 'Barangay disaster resilience hall with medical triage room.'),
  ('Banquerohan Disaster Operations Center', 'Banquerohan, Legazpi City', 13.1180, 123.7220, 650, 0, 'ready', 'High-ground shelter for Mayon southeast sector evacuees.'),
  ('Tapo-Tapo Elementary Shelter', 'Barangay Tapo-Tapo, Legazpi City', 13.1350, 123.7150, 350, 0, 'ready', 'Secondary designated evacuation site with emergency provisions.'),
  ('Oro Site National High School Evacuation Gym', 'Oro Site, Legazpi City', 13.1390, 123.7460, 400, 0, 'ready', 'Equipped with medical station and sanitation facilities.')
on conflict do nothing;

-- ── Accident Blackspots ──────────────────────────────────────────────────────

insert into public.accident_blackspots (name, location_label, lat, lng, incident_count, severity, last_reported_at)
values
  ('Yawa Bridge Intersection Blackspot', 'Yawa Bridge, Rawis Highway', 13.1550, 123.7480, 14, 'critical', now() - interval '2 hours'),
  ('Legazpi Port-Tahao Road Curve', 'Tahao Road, Barangay 15', 13.1385, 123.7410, 9, 'high', now() - interval '1 day'),
  ('Washington Drive Junction', 'Washington Drive, Bitano', 13.1460, 123.7380, 6, 'moderate', now() - interval '3 days'),
  ('Rizal St. & Quezon Ave. Intersection', 'Rizal Street Corner Quezon Ave', 13.1410, 123.7440, 11, 'critical', now() - interval '5 hours'),
  ('Daraga-Legazpi Boundary Junction', 'Maharlika Highway, Daraga Border', 13.1300, 123.7280, 8, 'high', now() - interval '12 hours')
on conflict do nothing;

-- ── Reports ─────────────────────────────────────────────────────────────────

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
      -- CDRRMO
      ('flood',                'Flooding near Bitano market line. Water level rising fast by the bakery.',                13.1438,  123.7448,  96,  'closed_confirmed', 'dev_seed_a1'),
      ('landslide',            'Soil slipping down the cut slope above the barangay road in Homapon.',                   13.1180,  123.7250,  20,  'in_progress',      'dev_seed_a2'),
      ('typhoon_debris',       'Fallen acacia branch blocking half the road after last night''s wind in Oro Site.',      13.1395,  123.7465,  50,  'in_progress',      'dev_seed_a3'),
      -- Legazpi 911
      ('medical',              'Elderly neighbour collapsed at home, breathing but unresponsive in Bonot.',               13.1500,  123.7490,   9,  'resolved',         'dev_seed_b1'),
      ('accident',             'Motorcycle and jeepney collision at Taysan corner, one rider injured.',                   13.1200,  123.7100,   6,  'in_progress',      'dev_seed_b2'),
      -- City Engineering
      ('pothole',              'Deep pothole on the northbound lane in Gogon, two tricycles damaged.',                    13.1490,  123.7380,  80,  'resolved',         'dev_seed_c1'),
      ('open_drain',           'Manhole cover missing outside the elementary school gate in Em''s Barrio.',               13.1415,  123.7410,  62,  'reopened',         'dev_seed_c2'),
      ('bridge_damage',        'Crack widening on the seawall walkway near Puro pier.',                                   13.1320,  123.7560,  30,  'assigned',         'dev_seed_c3'),
      -- Public Safety Office
      ('traffic_obstruction',  'Traffic light at Victory Village junction stuck on red in all directions.',              13.1420,  123.7540,  26,  'assigned',         'dev_seed_d1'),
      -- BFP Legazpi (Cluster 1: 3 fire reports at same spot in Bitano)
      ('fire',                 'Smoke coming from the second floor of the corner house in Bitano.',                      13.1444,  123.7452,   3,  'in_progress',      'dev_seed_e1'),
      ('fire',                 'House on fire near the bakery in Bitano, flames visible from street.',                    13.1445,  123.7453,   3,  'in_progress',      'dev_seed_e2'),
      ('fire',                 'Big fire two houses down from us in Bitano, please send BFP trucks.',                    13.1443,  123.7451,   3,  'in_progress',      'dev_seed_e3'),
      ('gas_leak',             'Strong LPG smell along alley in Cruzada, cannot tell which house.',                       13.1365,  123.7335,   1,  'received',         'dev_seed_e4'),
      -- PNP Legazpi
      ('crime',                'Group fighting outside the sari-sari store in Rawis, bottle broken.',                     13.1610,  123.7510,   4,  'assigned',         'dev_seed_f1'),
      -- City Health Office
      ('water_contam',         'Tap water running brown since yesterday in Cruzada, whole street affected.',             13.1360,  123.7330,  44,  'assigned',         'dev_seed_g1'),
      -- Coast Guard Station
      ('coastal_hazard',       'Storm surge pushing over the breakwater at Dap-Dap during high tide.',                    13.1650,  123.7420,  14,  'assigned',         'dev_seed_h1'),
      -- Cluster 2: Underpass Flooding in Gogon (2 reports)
      ('flood',                'Gogon underpass completely flooded, cars turning back.',                                 13.1489,  123.7381,   2,  'assigned',         'dev_seed_i1'),
      ('flood',                'Water up to knee height at Gogon underpass, zero access.',                               13.1490,  123.7382,   2,  'assigned',         'dev_seed_i2'),
      -- Fresh received report
      ('pothole',              'Sunken pavement patch forming after heavy rain near Taysan boundary.',                    13.1210,  123.7110,   1,  'received',         'dev_seed_j1'),
      -- Closed Unconfirmed report
      ('traffic_obstruction',  'Illegal parking blocking fire lane near Bonot commercial complex.',                       13.1510,  123.7495,  36,  'closed_unconfirmed','dev_seed_k1')
    ) as t(category, description, lat, lng, age_hours, final_status, device)
  loop
    insert into public.reports (category, description, lat, lng, reporter_device_id, created_at)
    values (r.category, r.description, r.lat, r.lng, r.device, now() - make_interval(hours => r.age_hours))
    returning id into new_id;

    if r.final_status in ('assigned', 'in_progress', 'resolved', 'closed_confirmed', 'closed_unconfirmed', 'reopened') then
      update public.reports set status = 'assigned' where id = new_id;
    end if;
    if r.final_status in ('in_progress', 'resolved', 'closed_confirmed', 'closed_unconfirmed', 'reopened') then
      update public.reports set status = 'in_progress' where id = new_id;
    end if;
    if r.final_status in ('resolved', 'closed_confirmed', 'closed_unconfirmed') then
      update public.reports set status = 'resolved' where id = new_id;
    end if;
    if r.final_status = 'closed_confirmed' then
      update public.reports set status = 'closed_confirmed' where id = new_id;
    elsif r.final_status = 'closed_unconfirmed' then
      update public.reports set status = 'closed_unconfirmed' where id = new_id;
    elsif r.final_status = 'reopened' then
      update public.reports set status = 'reopened' where id = new_id;
    end if;
  end loop;

  -- Recurring spot history: Market Entrance Drain in Em's Barrio (multiple occurrences over time)
  insert into public.reports (category, description, lat, lng, reporter_device_id, created_at)
  values (
    'open_drain',
    'Recurring issue: Drain cover broken again at Em''s Barrio school gate following heavy truck delivery.',
    13.1415, 123.7410, 'dev_seed_recurring01', now() - interval '120 hours'
  ) returning id into new_id;
  update public.reports set status = 'resolved' where id = new_id;

  -- False report entry
  insert into public.reports (category, description, lat, lng, reporter_device_id, created_at)
  values (
    'fire',
    'False alarm: Smoke reported near plaza was controlled trash burning.',
    13.1400, 123.7440, 'dev_seed_falsereport01', now() - interval '36 hours'
  ) returning id into new_id;
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
  ('Saan ko makikita ang status ng report ko?',                            true,  'tracking',        true,  now() - interval '3 hours'),
  ('Saan ang pinakamalapit na evacuation center sa Rawis pag bumaha?',      false, 'evacuation',      false, now() - interval '5 hours'),
  ('Sino ang namamahala sa pag-aayos ng nabasag na seawall sa Puro?',       false, 'infrastructure',  false, now() - interval '2 hours')
on conflict do nothing;

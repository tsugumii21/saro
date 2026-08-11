-- ── Seeded city activity ────────────────────────────────────────────────────
--
-- Reports live in the database rather than in a client-side array, so one set of
-- rows serves every surface: the resident map reads them through
-- get_public_map_reports, the routing trigger assigns each one to an office, and
-- the admin queue and the agency's own scoped view pick them up from there.
-- Nothing here is special-cased for a demo.
--
-- The collision reports are deliberately placed near the three seeded
-- blackspots. record_accident_incident() files an incident for each, which is
-- what carries those areas back over the three-in-24-months threshold — the
-- accident-prone markings and their red road segments come back through the
-- same path a real report would take, not by editing counters.
--
-- Idempotent: every row is keyed by reporter_device_id and skipped if present.
do $$
declare
  fixture record;
  new_id  uuid;
begin
  for fixture in
    select * from (values
      -- Collisions near Yawa Bridge Intersection (13.155, 123.748)
      ('accident', 'Two motorcycles collided at the Yawa bridge approach; one rider is sitting on the kerb with a hurt leg.',
       13.1552, 123.7481, 'seed_yawa_crash_01', 40),
      ('accident', 'Jeepney clipped a tricycle turning onto the bridge. Nobody trapped but the lane is blocked.',
       13.1548, 123.7478, 'seed_yawa_crash_02', 20),
      ('accident', 'Van hit the bridge railing at the intersection. Driver is out and walking, debris on the road.',
       13.1551, 123.7483, 'seed_yawa_crash_03', 6),

      -- Collisions near Legazpi Port-Tahao Road Curve (13.1385, 123.741)
      ('accident', 'Delivery truck slid on the Tahao road curve and stopped across both lanes.',
       13.1386, 123.7412, 'seed_tahao_crash_01', 33),
      ('accident', 'Motorcycle down on the curve near the port turn, rider has a scraped arm.',
       13.1383, 123.7408, 'seed_tahao_crash_02', 14),
      ('accident', 'Car and tricycle collision on the same curve; traffic is backing up towards the port.',
       13.1387, 123.7409, 'seed_tahao_crash_03', 3),

      -- Collisions near Washington Drive Junction (13.146, 123.738)
      ('accident', 'Sideswipe at Washington Drive junction, both vehicles pulled over but glass is on the road.',
       13.1461, 123.7382, 'seed_washington_crash_01', 27),
      ('accident', 'Tricycle overturned at the junction after braking hard for a turning van.',
       13.1458, 123.7378, 'seed_washington_crash_02', 11),
      ('accident', 'Two cars collided at the Washington Drive corner during the school run.',
       13.1462, 123.7381, 'seed_washington_crash_03', 2),

      -- Ordinary city activity, spread across offices and barangays
      ('flood', 'Water rising past the kerb along the Bitano market access road after an hour of rain.',
       13.1436, 123.7451, 'seed_bitano_flood_01', 5),
      ('open_drain', 'Drain cover missing beside the covered court in Em''s Barrio; the hole is wide enough for a child.',
       13.1418, 123.7412, 'seed_ems_drain_01', 16),
      ('pothole', 'Pothole deepening on the Gogon northbound lane; jeepneys are swerving into the opposite side.',
       13.1492, 123.7383, 'seed_gogon_pothole_01', 29),
      ('water_contam', 'Tap water in Cruzada is running cloudy and smells of chlorine since this morning.',
       13.1362, 123.7332, 'seed_cruzada_water_01', 9),
      ('typhoon_debris', 'Galvanised roofing sheet blown onto the sidewalk in Oro Site, still moving in the wind.',
       13.1397, 123.7463, 'seed_orosite_debris_01', 7),
      ('bridge_damage', 'New crack across the seawall walkway near Puro pier, wider than last week.',
       13.1322, 123.7562, 'seed_puro_bridge_01', 21)
    ) as t(category, description, lat, lng, device_id, age_hours)
  loop
    if exists (select 1 from public.reports where reporter_device_id = fixture.device_id) then
      continue;
    end if;

    insert into public.reports (category, description, lat, lng, reporter_device_id, created_at)
    values (
      fixture.category,
      fixture.description,
      fixture.lat,
      fixture.lng,
      fixture.device_id,
      now() - make_interval(hours => fixture.age_hours)
    )
    returning id into new_id;

    -- A spread of statuses so the queue, the filters and the map legend all have
    -- something real to show. The oldest rows have been worked on the longest.
    if fixture.age_hours >= 24 then
      update public.reports set status = 'assigned'    where id = new_id;
      update public.reports set status = 'in_progress' where id = new_id;
    elsif fixture.age_hours >= 8 then
      update public.reports set status = 'assigned'    where id = new_id;
    end if;
  end loop;
end $$;

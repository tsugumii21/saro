-- ── Seeded reports read like reports, not like fixtures ─────────────────────
--
-- Three resolved fixtures carried a "Resolved demo:" prefix in their
-- description. That text is now the first thing a resident reads in a map pin
-- popup, where it makes a real city report look like scaffolding. The incident
-- wording is kept; only the label in front of it goes.
--
-- Runs after the fixtures are seeded, so it corrects both an existing database
-- and a freshly seeded one.
update public.reports
   set description = 'Patient assessed and transported from Bonot to the city hospital.'
 where reporter_device_id = 'demo_resolved_medical_2026';

update public.reports
   set description = 'Minor collision cleared at Taysan; injured rider endorsed to Ambulance 2.'
 where reporter_device_id = 'demo_resolved_accident_2026';

update public.reports
   set description = 'Rawis public disturbance attended and entered in the police blotter.'
 where reporter_device_id = 'demo_resolved_crime_2026';

-- Catch-all for any other seeded row that still announces itself as a demo.
update public.reports
   set description = btrim(regexp_replace(description, '^\s*(Resolved\s+)?demo\s*:\s*', '', 'i'))
 where description ~* '^\s*(resolved\s+)?demo\s*:';

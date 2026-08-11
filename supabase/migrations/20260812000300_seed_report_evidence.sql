-- ── Evidence for the seeded reports ─────────────────────────────────────────
--
-- The photo strip in a pin popup was reading from a client-side array of stock
-- images — including, embarrassingly, a portrait of a person standing in for
-- typhoon debris. Evidence now comes from the database like everything else.
--
-- The objects live under reports/public/ and were uploaded by
-- supabase/scripts/seed-report-photos.mjs. They are generated diagrams stamped
-- SAMPLE, not photographs of anyone's property, which is what makes the read
-- policy below safe.

insert into public.report_media (report_id, object_path, kind)
select r.id, fixture.object_path, 'evidence'
  from (values
    ('seed_bitano_flood_01',   'reports/public/seed-bitano-flood.png'),
    ('seed_gogon_pothole_01',  'reports/public/seed-gogon-pothole.png'),
    ('seed_orosite_debris_01', 'reports/public/seed-orosite-debris.png'),
    ('seed_ems_drain_01',      'reports/public/seed-ems-drain.png')
  ) as fixture(device_id, object_path)
  join public.reports r on r.reporter_device_id = fixture.device_id
 where not exists (
   select 1 from public.report_media m
    where m.report_id = r.id and m.object_path = fixture.object_path
 );

-- ── Read access, scoped to the seeded prefix only ───────────────────────────
--
-- Real evidence keeps the existing rule: readable only by staff who can already
-- see the report, through a short-lived signed URL. This adds one narrow
-- exception so the public map can show the seeded samples, and it is deliberately
-- written against the literal folder rather than against report_media, so no
-- resident's photograph can ever fall into it.
drop policy if exists "anyone may read seeded sample evidence" on storage.objects;
create policy "anyone may read seeded sample evidence"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'report-photos'
    and name like 'reports/public/seed-%'
  );

comment on table public.report_media is
  'Photos attached to a report. object_path points into the private report-photos bucket; only the generated samples under reports/public/seed-% are readable without staff access.';

-- ── The seeded evidence rows are readable, the real ones are not ────────────
--
-- 20260812000300 opened storage reads for objects under reports/public/seed-%,
-- but a client still has to find the object path before it can ask for a signed
-- URL, and report_media itself carries no anon select policy. Without this the
-- public map knows a report has evidence and can never show it.
--
-- Scoped to the same literal prefix, so a resident's own photograph is still
-- invisible to anyone outside the office handling their report.
drop policy if exists "anyone may read seeded sample evidence rows" on public.report_media;
create policy "anyone may read seeded sample evidence rows"
  on public.report_media for select
  to anon, authenticated
  using (object_path like 'reports/public/seed-%');

grant select on public.report_media to anon;

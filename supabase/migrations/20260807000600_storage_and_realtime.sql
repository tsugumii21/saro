-- SARO 06 — private photo storage, and Realtime on the operational tables.

set search_path = public, extensions;

-- ═══════════════════════════════════════════════════════════════════════════
-- Storage: report-photos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PRIVATE bucket. Report photos routinely contain things that must not sit on
-- a guessable public URL: crime scenes, injuries, the inside of someone's
-- house, vehicle plates, faces of minors. A public bucket would make every one
-- of those world-readable forever to anyone who learns the object path, with
-- no audit trail and no way to revoke.
--
-- Reads therefore happen through short-lived signed URLs minted by a caller
-- that has already passed RLS.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-photos',
  'report-photos',
  false,
  10485760,                                   -- 10 MiB; client compresses to ~1280px JPEG
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── Upload ──────────────────────────────────────────────────────────────────

create policy "anyone may upload a report photo"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = 'reports'
  );
-- A resident filing a hazard report is usually not signed in, so the upload
-- has to be open to anon. It is constrained to one bucket and one folder
-- prefix, the bucket rejects anything that is not an image, and 10 MiB caps
-- the damage. This is the widest grant in the schema — see the summary.

-- ── Read ────────────────────────────────────────────────────────────────────

create policy "staff read photos for reports they can see"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'report-photos'
    and (
      exists (
        select 1
        from public.report_media m
        join public.reports r on r.id = m.report_id
        where m.object_path = storage.objects.name
      )
      or exists (
        select 1 from public.reports r
        where r.photo_url = storage.objects.name
      )
    )
  );
-- The EXISTS clauses read public.reports, which is under RLS, so photo
-- visibility inherits report visibility exactly: an office sees photos on its
-- own queue, a barangay official sees photos from their barangay, an admin
-- sees all, and an orphaned object nobody has linked to a report is readable
-- by nobody. Signing a URL requires passing this policy first, so a signed
-- link can only ever be minted by someone already entitled to the photo.

-- There is no anonymous SELECT policy. A resident cannot re-download their own
-- photo, by design: the tracking-code lookup deliberately returns no media.

-- ── Update / delete ─────────────────────────────────────────────────────────

create policy "admins manage stored photos"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'report-photos' and public.is_admin())
  with check (bucket_id = 'report-photos' and public.is_admin());
-- Deleting evidence is an admin action, for takedown requests and retention.
-- Offices cannot delete photos from their own queue.

-- ═══════════════════════════════════════════════════════════════════════════
-- Realtime
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Realtime respects RLS: a subscriber receives a change only if they could
-- have SELECTed the row. Anonymous clients have no SELECT policy on reports,
-- so they receive nothing here even though the table is published.

alter publication supabase_realtime add table public.reports;
alter publication supabase_realtime add table public.clusters;
alter publication supabase_realtime add table public.report_status_history;

-- UPDATE events carry the previous row as well as the new one, so the admin
-- dashboard can show "received -> assigned" without a re-fetch.
alter table public.reports               replica identity full;
alter table public.clusters              replica identity full;
alter table public.report_status_history replica identity full;

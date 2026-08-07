-- SARO 03 — reports, status history, media, clusters, gap log, panic flags.

set search_path = public, extensions;

-- ── Reports ─────────────────────────────────────────────────────────────────

create table public.reports (
  id                 uuid primary key default extensions.gen_random_uuid(),
  tracking_code      text not null unique default public.generate_tracking_code(),

  category           text not null references public.routing_table(category) on update cascade,
  description        text not null check (length(btrim(description)) > 0),

  -- lat/lng are the source of truth (that is what the browser produces).
  -- `location` is derived so PostGIS can do distance work for clustering.
  lat                double precision not null check (lat between -90 and 90),
  lng                double precision not null check (lng between -180 and 180),
  location           extensions.geography(Point, 4326)
                     generated always as (
                       extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326)::extensions.geography
                     ) stored,

  barangay_id        uuid references public.barangays(id) on delete set null,

  photo_url          text,          -- storage object path, NOT a public URL
  status             public.report_status not null default 'received',
  assigned_office_id uuid references public.offices(id) on delete restrict,

  -- Exactly one of these two identifies the reporter.
  --
  -- reporter_device_id: an anonymous guest. A random value held in the browser.
  -- It is not an account and never links to a person. This is the Panic path
  -- and the emergency Describe path, and it must stay open to everyone.
  --
  -- reporter_user_id: a signed-in resident. Standard non-emergency reports go
  -- here, which is what buys residents cross-device history.
  reporter_device_id text,
  reporter_user_id   uuid references auth.users(id) on delete set null,

  -- Set when a barangay official files on someone else's behalf.
  filed_by           uuid references auth.users(id) on delete set null,
  callback_number    text,
  is_proxy_report    boolean not null default false,

  -- Did this come from a confirmed identity? Generated, so it can never drift
  -- from the column it describes and no client can assert it.
  filed_by_verified  boolean generated always as (reporter_user_id is not null) stored,

  cluster_id         uuid,          -- FK added in the clusters section below
  is_false_report    boolean not null default false,
  resolved_at        timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Exactly one reporter identity. Never both, never neither.
  --
  -- Note for File on Behalf: when a barangay official files for a walk-in
  -- resident who has neither an account nor the app, reporter_user_id is set
  -- to the OFFICIAL's id. They are the reporter of record — the person who can
  -- be asked what they saw — and the report is additionally flagged
  -- is_proxy_report with filed_by naming them. Leaving both null would be more
  -- literal but would break this invariant and leave the report unattributable.
  constraint reports_exactly_one_reporter check (
    (reporter_device_id is null) <> (reporter_user_id is null)
  )
);

create index reports_status_idx        on public.reports (status, created_at desc);
create index reports_reporter_user_idx on public.reports (reporter_user_id, created_at desc)
  where reporter_user_id is not null;
create index reports_verified_idx      on public.reports (filed_by_verified, created_at desc);
create index reports_office_idx        on public.reports (assigned_office_id, created_at desc);
create index reports_barangay_idx      on public.reports (barangay_id, created_at desc);
create index reports_device_idx        on public.reports (reporter_device_id, created_at desc)
  where reporter_device_id is not null;
create index reports_tracking_code_idx on public.reports (tracking_code);
create index reports_location_idx      on public.reports using gist (location);
create index reports_cluster_idx       on public.reports (cluster_id) where cluster_id is not null;

create trigger reports_touch_updated_at
  before update on public.reports
  for each row execute function public.touch_updated_at();

comment on table public.reports is 'Civic hazard reports. Anonymous users may INSERT but never SELECT — lookup goes through get_report_by_tracking_code().';
comment on column public.reports.photo_url is 'Object path inside the private report-photos bucket. Never a public URL; callers request a short-lived signed URL.';

-- Route a new report to the office named by the routing table, falling back to
-- the single is_fallback row. Also stamps the barangay from the geometry.
create or replace function public.apply_report_routing()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_office uuid;
begin
  -- Routing is decided here on EVERY insert, and whatever the caller sent in
  -- assigned_office_id is discarded. That is what stops a reporter choosing
  -- which office receives their report, and it is why the insert policies do
  -- not try to assert `assigned_office_id is null` — WITH CHECK is evaluated
  -- after BEFORE triggers, so such a clause would test this trigger's output
  -- and reject every insert.
  select responsible_office_id into target_office
  from public.routing_table
  where category = new.category;

  if target_office is null then
    select responsible_office_id into target_office
    from public.routing_table
    where is_fallback
    limit 1;
  end if;

  new.assigned_office_id := target_office;

  if new.barangay_id is null then
    select b.id into new.barangay_id
    from public.barangays b
    where b.boundary is not null
      and extensions.ST_Covers(
            b.boundary,
            extensions.ST_SetSRID(extensions.ST_MakePoint(new.lng, new.lat), 4326)::extensions.geography
          )
    limit 1;
  end if;

  return new;
end;
$$;

create trigger reports_apply_routing
  before insert on public.reports
  for each row execute function public.apply_report_routing();

-- ── Status history ──────────────────────────────────────────────────────────

-- Append-only. Confirm / Dispute / Reopen will write here too, so a report's
-- past is never overwritten by its present.
create table public.report_status_history (
  id          uuid primary key default extensions.gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  from_status public.report_status,
  status      public.report_status not null,
  -- null when the actor was the system (routing, triggers) or an anonymous
  -- resident action rather than a signed-in official.
  changed_by  uuid references auth.users(id) on delete set null,
  note        text,
  changed_at  timestamptz not null default now()
);

create index report_status_history_report_idx on public.report_status_history (report_id, changed_at);

comment on table public.report_status_history is 'Append-only audit trail of every status transition. changed_by is null for system and resident actions.';

-- Record the opening state, and every later transition, without the
-- application having to remember to.
create or replace function public.record_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.report_status_history (report_id, from_status, status, changed_by, note)
    values (new.id, null, new.status, auth.uid(), 'Report submitted.');
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.report_status_history (report_id, from_status, status, changed_by, note)
    values (new.id, old.status, new.status, auth.uid(), null);

    if new.status = 'resolved' and new.resolved_at is null then
      new.resolved_at := now();
    end if;
  end if;

  return new;
end;
$$;

create trigger reports_record_status_insert
  after insert on public.reports
  for each row execute function public.record_status_change();

create trigger reports_record_status_update
  before update of status on public.reports
  for each row execute function public.record_status_change();

-- ── Report media ────────────────────────────────────────────────────────────

create table public.report_media (
  id          uuid primary key default extensions.gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  object_path text not null,                     -- path in the private bucket
  kind        public.media_kind not null default 'evidence',
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index report_media_report_idx on public.report_media (report_id, kind);

comment on table public.report_media is 'Photos attached to a report. object_path points into the private report-photos bucket.';

-- ── Clusters ────────────────────────────────────────────────────────────────

-- Near-duplicate reports of the same hazard: same category, within 150 m,
-- within 60 minutes. Corroboration, not deduplication — every report survives.
create table public.clusters (
  id               uuid primary key default extensions.gen_random_uuid(),
  category         text not null references public.routing_table(category) on update cascade,
  centroid         extensions.geography(Point, 4326) not null,
  confidence_score integer not null default 1 check (confidence_score >= 1),
  report_count     integer not null default 1 check (report_count >= 1),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index clusters_centroid_idx on public.clusters using gist (centroid);
create index clusters_category_idx on public.clusters (category, created_at desc);

create trigger clusters_touch_updated_at
  before update on public.clusters
  for each row execute function public.touch_updated_at();

alter table public.reports
  add constraint reports_cluster_id_fkey
  foreign key (cluster_id) references public.clusters(id) on delete set null;

-- Join table. A report belongs to at most one cluster today, but the join
-- table keeps the option of overlapping clusters open and carries the distance
-- that justified the match.
create table public.cluster_reports (
  cluster_id     uuid not null references public.clusters(id) on delete cascade,
  report_id      uuid not null references public.reports(id) on delete cascade,
  distance_meters double precision,
  joined_at      timestamptz not null default now(),
  primary key (cluster_id, report_id)
);

create index cluster_reports_report_idx on public.cluster_reports (report_id);

comment on table public.clusters is 'Groups of corroborating reports. confidence_score is the member count — higher means more independent witnesses.';

-- ── Assistant gap log ───────────────────────────────────────────────────────

-- Questions the assistant could not answer from the knowledge base. This is
-- the input to the admin gap-log viewer: it shows what residents keep asking
-- that the city has not published an answer for.
create table public.gap_log (
  id            uuid primary key default extensions.gen_random_uuid(),
  question      text not null check (length(btrim(question)) > 0),
  was_answered  boolean not null default false,
  matched_doc   text,
  topic_cluster text,
  resolved      boolean not null default false,
  resolved_by   uuid references auth.users(id) on delete set null,
  resolved_at   timestamptz,
  -- Anonymous device id, for rate limiting only.
  device_id     text,
  created_at    timestamptz not null default now()
);

create index gap_log_unresolved_idx on public.gap_log (resolved, created_at desc) where not resolved;
create index gap_log_topic_idx      on public.gap_log (topic_cluster) where topic_cluster is not null;

comment on table public.gap_log is 'Every assistant question. Unanswered + unresolved rows are the admin gap-log queue.';

-- ── Panic flags ─────────────────────────────────────────────────────────────

-- Abuse counter for the panic button, keyed on a browser-local device token.
-- Deliberately not linked to any account or to the reports themselves.
create table public.panic_flags (
  device_token    text primary key,
  flag_count      integer not null default 1 check (flag_count >= 0),
  last_flagged_at timestamptz not null default now(),
  is_blocked      boolean not null default false,
  created_at      timestamptz not null default now()
);

create index panic_flags_recent_idx on public.panic_flags (last_flagged_at desc);

comment on table public.panic_flags is 'Per-device panic-button rate limiting. device_token is a random browser-local value, not an identity.';

-- ── Push subscriptions ──────────────────────────────────────────────────────
--
-- Schema only. The service worker, the VAPID keys and the send path are not
-- built yet — this exists so the resident/guest distinction is settled in the
-- data model rather than retrofitted later.
--
-- The distinction is the point:
--   subscriber_user_id set  -> tied to the ACCOUNT. Survives a lost phone: sign
--                              in on the replacement and updates resume.
--   subscriber_device_id set -> tied to ONE browser. Lose the device and the
--                              subscription is gone, because there is nothing
--                              else it could have been attached to.
create table public.push_subscriptions (
  id                   uuid primary key default extensions.gen_random_uuid(),
  subscriber_user_id   uuid references auth.users(id) on delete cascade,
  subscriber_device_id text,

  endpoint             text not null unique,
  p256dh               text not null,
  auth_key             text not null,
  user_agent           text,

  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),

  -- Same exactly-one rule as reports, for the same reason.
  constraint push_subscriptions_exactly_one_subscriber check (
    (subscriber_device_id is null) <> (subscriber_user_id is null)
  )
);

create index push_subscriptions_user_idx on public.push_subscriptions (subscriber_user_id)
  where subscriber_user_id is not null;
create index push_subscriptions_device_idx on public.push_subscriptions (subscriber_device_id)
  where subscriber_device_id is not null;

comment on table public.push_subscriptions is
  'Web Push endpoints. Account-tied subscriptions survive a device change; device-tied ones do not, by design.';

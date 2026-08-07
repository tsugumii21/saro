-- SARO 01 — extensions, enums, and the tracking-code generator.
--
-- Everything lives in the `public` schema. Extensions go in `extensions` so
-- they are not dropped by schema-level operations on public.

create schema if not exists extensions;

create extension if not exists "pgcrypto"  with schema extensions;  -- gen_random_uuid()
create extension if not exists "postgis"   with schema extensions;  -- geography(Point) + clustering

-- ── Enums ───────────────────────────────────────────────────────────────────

-- The report lifecycle. Confirm / Dispute / Reopen will extend this later via
-- `alter type report_status add value '...'`; history is kept separately so no
-- transition is ever lost.
create type public.report_status as enum (
  'received',
  'assigned',
  'in_progress',
  'resolved'
);

-- Who a person is. Scope (which office, which barangay) lives on profiles.
--   resident          self-registered member of the public; sees only their own
--                     reports. The only role obtainable through public signup.
--   admin             city-wide, read and write everything
--   office            one municipal office, its own queue only
--   barangay_official one barangay, read-only, plus File on Behalf
--
-- Order matters for readability only; RLS never compares these by ordinality.
create type public.user_role as enum (
  'resident',
  'admin',
  'office',
  'barangay_official'
);

create type public.media_kind as enum (
  'evidence',
  'resolution'
);

-- ── Tracking codes ──────────────────────────────────────────────────────────

-- Human-shareable, read-aloud-safe report handle: "SR-8F2K".
-- The alphabet excludes 0/O/1/I because these get dictated over the phone.
-- SECURITY DEFINER is load-bearing, not decoration. This runs as the DEFAULT
-- for reports.tracking_code, so it executes as whoever is inserting — and an
-- anonymous guest has no SELECT on reports by design. Without this the
-- uniqueness probe below fails with "permission denied for table reports" and
-- every guest report is rejected, which is the one path that must never break.
create or replace function public.generate_tracking_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
  i int;
begin
  loop
    candidate := 'SR-';
    for i in 1..4 loop
      candidate := candidate || substr(
        alphabet,
        1 + floor(random() * length(alphabet))::int,
        1
      );
    end loop;

    exit when not exists (
      select 1 from public.reports where tracking_code = candidate
    );
  end loop;

  return candidate;
end;
$$;

comment on function public.generate_tracking_code is
  'Returns an unused SR-XXXX tracking code. Ambiguous glyphs excluded so codes survive being read aloud.';

-- ── Shared updated_at trigger ───────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

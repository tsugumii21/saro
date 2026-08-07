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
--   admin             city-wide, read and write everything
--   office            one municipal office, its own queue only
--   barangay_official one barangay, read-only, plus File on Behalf
create type public.user_role as enum (
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
create or replace function public.generate_tracking_code()
returns text
language plpgsql
volatile
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

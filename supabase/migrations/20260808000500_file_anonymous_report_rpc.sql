-- SARO 14 — let an anonymous report return its own tracking code.
--
-- ── The bug ─────────────────────────────────────────────────────────────────
--
-- createReport() in the shared client does this:
--
--     supabase.from("reports").insert(row).select("id, tracking_code, ...").single()
--
-- Chaining .select() makes supabase-js send `Prefer: return=representation`,
-- and PostgREST requires SELECT privilege on the table to satisfy it. anon has
-- INSERT and nothing else, by design — a blanket SELECT would expose every
-- report in Legazpi to anyone holding the publishable key.
--
-- So the insert succeeded and the response failed:
--
--     HTTP 201 with Prefer: return=minimal
--     HTTP 403 42501 "permission denied for table reports" with .select()
--
-- Which means every anonymous report — Panic, and every emergency Describe —
-- was written to the database and then reported to the resident as a failure,
-- with no tracking code. The row was there; the person was told it was not.
-- That is the worst failure mode this product has: it looks exactly like the
-- alert never sent, so the sensible response is to press Panic again, which
-- files a duplicate and tells you it failed again.
--
-- It survived earlier testing because the anonymous path was verified with a
-- raw REST insert, which defaults to `return=minimal` and therefore never
-- needed the privilege the real client needs.
--
-- ── The fix ─────────────────────────────────────────────────────────────────
--
-- Not `grant select on reports to anon`, which is what the Postgres error hint
-- suggests and would hand every report to the public. Instead one SECURITY
-- DEFINER function that inserts and returns exactly the four fields the client
-- needs back, for the row it just created and no other. It cannot be used to
-- read anything: there is no code path through it that returns a row the caller
-- did not just write.

create or replace function public.file_anonymous_report(
  p_category        text,
  p_description     text,
  p_lat             double precision,
  p_lng             double precision,
  p_device_id       text,
  p_barangay_id     uuid    default null,
  p_callback_number text    default null,
  p_is_proxy        boolean default false,
  p_photo_url       text    default null
)
returns table (
  id            uuid,
  tracking_code text,
  category      text,
  status        public.report_status,
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_id uuid;
begin
  -- Same length floor the other device-keyed RPCs use. A short or empty device
  -- id would satisfy the exactly-one-reporter constraint while being trivially
  -- guessable, which would let anyone enumerate somebody else's reports through
  -- get_reports_by_device.
  if length(btrim(coalesce(p_device_id, ''))) < 12 then
    raise exception 'invalid device id';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'location is required';
  end if;

  -- Note what is NOT accepted as a parameter: status, assigned_office_id,
  -- cluster_id, is_false_report, filed_by, reporter_user_id. Those are decided
  -- by triggers and by staff. A SECURITY DEFINER function runs as the owner and
  -- bypasses RLS, so anything it lets a caller set is effectively unprotected —
  -- the parameter list IS the security boundary here.
  insert into public.reports (
    category, description, lat, lng,
    reporter_device_id, barangay_id, callback_number, is_proxy_report, photo_url
  )
  values (
    p_category,
    btrim(coalesce(p_description, '')),
    p_lat, p_lng,
    btrim(p_device_id),
    p_barangay_id,
    nullif(btrim(coalesce(p_callback_number, '')), ''),
    coalesce(p_is_proxy, false),
    p_photo_url
  )
  returning reports.id into new_id;

  return query
    select r.id, r.tracking_code, r.category, r.status, r.created_at
    from public.reports r
    where r.id = new_id;
end;
$$;

comment on function public.file_anonymous_report is
  'Files a device-attributed report and returns its tracking code. Exists because anon has no SELECT on reports, so a plain insert cannot return the code it just generated.';

revoke all on function public.file_anonymous_report(
  text, text, double precision, double precision, text, uuid, text, boolean, text
) from public, authenticated;

-- Granted to both roles. A signed-in resident pressing Panic files through here
-- too: urgent reports are attributed to the device rather than the account, so
-- that filing fast never means attaching your name to it.
grant execute on function public.file_anonymous_report(
  text, text, double precision, double precision, text, uuid, text, boolean, text
) to anon, authenticated;

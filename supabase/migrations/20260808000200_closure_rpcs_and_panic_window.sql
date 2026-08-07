-- SARO 11 — closure RPCs, auto-close, and the panic soft-flag window.
--
-- Uses the enum values added in migration 10, which is why it is a separate
-- file. See the header there.

-- ════════════════════════════════════════════════════════════════════════════
-- Confirm / Dispute
-- ════════════════════════════════════════════════════════════════════════════
--
-- Both are SECURITY DEFINER and both are callable by `anon`, and that needs
-- justifying rather than assuming.
--
-- The tracking code IS the credential. SARO's premise is "one code, one place
-- to check": a person files anonymously, is handed a code, and that code is the
-- only thing tying them to the report. Requiring an account or a matching
-- device id to answer the Confirm / Dispute prompt would strand exactly the
-- people the anonymous path exists for — someone who filed from a borrowed
-- phone, or who cleared their browser, or who was handed the code by the
-- neighbour who actually filed it.
--
-- What that means in practice: anyone holding a valid code can confirm or
-- dispute that report. The exposure is bounded and deliberate. A code is 4
-- characters from a 32-glyph alphabet, so guessing one blind is ~1 in a
-- million per attempt, and the prize for winning is the ability to say "this
-- was not actually fixed" about a stranger's pothole. That reopens work; it
-- does not read anyone's data, and neither function returns any field the
-- lookup RPC would not already have shown. Compare that against the cost of the
-- alternative — a resident who genuinely was not helped having no way to say so
-- — and the trade is not close.
--
-- Neither function reveals whether an unknown code exists: both raise the same
-- generic exception for "no such code" and "wrong status", so they cannot be
-- used to enumerate valid codes.

create or replace function public.confirm_report_resolution(code text)
returns table (tracking_code text, status public.report_status)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target public.reports%rowtype;
begin
  select * into target
  from public.reports
  where reports.tracking_code = upper(btrim(code))
  limit 1;

  -- One message for both failure modes. "That code cannot be confirmed right
  -- now" leaks nothing; "no such report" would confirm which codes are real.
  if not found or target.status <> 'resolved' then
    raise exception 'not confirmable';
  end if;

  update public.reports
     set status = 'closed_confirmed'
   where id = target.id;

  -- The status trigger already wrote the transition row. This annotates it, so
  -- the audit trail says who closed it and on what basis rather than leaving a
  -- bare state change.
  update public.report_status_history
     set note = 'Resident confirmed the work was done.'
   where report_id = target.id
     and status = 'closed_confirmed'
     and note is null;

  return query
    select r.tracking_code, r.status from public.reports r where r.id = target.id;
end;
$$;

comment on function public.confirm_report_resolution is
  'Resident closes a resolved report as confirmed, using the tracking code as the credential.';

-- Dispute performs BOTH transitions: resolved → reopened → in_progress.
--
-- Two history rows, not one, and that is the point. 'reopened' must appear in
-- the permanent record because "this was called resolved once and the resident
-- said otherwise" is precisely the fact an SLA summary must not be able to
-- launder. Landing on 'in_progress' rather than parking in 'reopened' means the
-- report is back in the office's working queue immediately, without waiting for
-- anyone to notice a new state and act on it — a disputed report that sits
-- unseen is the same failure the dispute was reporting.
--
-- The pipeline is never restarted. created_at, the original routing and every
-- earlier transition are untouched, so the clock on this report still runs from
-- when the resident first asked for help.
create or replace function public.dispute_report_resolution(code text, reason text default null)
returns table (tracking_code text, status public.report_status)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target public.reports%rowtype;
  clean_reason text;
begin
  select * into target
  from public.reports
  where reports.tracking_code = upper(btrim(code))
  limit 1;

  if not found or target.status not in ('resolved', 'closed_unconfirmed') then
    raise exception 'not disputable';
  end if;

  clean_reason := nullif(btrim(coalesce(reason, '')), '');
  if length(clean_reason) > 500 then
    clean_reason := left(clean_reason, 500);
  end if;

  update public.reports set status = 'reopened' where id = target.id;

  update public.report_status_history
     set note = coalesce(
           'Resident disputed the resolution: ' || clean_reason,
           'Resident disputed the resolution. No reason given.')
   where report_id = target.id
     and status = 'reopened'
     and note is null;

  update public.reports set status = 'in_progress' where id = target.id;

  update public.report_status_history
     set note = 'Returned to the assigned office after a resident dispute.'
   where report_id = target.id
     and status = 'in_progress'
     and note is null;

  -- resolved_at belonged to a resolution the resident rejected. Leaving it set
  -- would let the next auto-close sweep immediately re-close the report the
  -- resident just reopened.
  update public.reports set resolved_at = null where id = target.id;

  return query
    select r.tracking_code, r.status from public.reports r where r.id = target.id;
end;
$$;

comment on function public.dispute_report_resolution is
  'Resident rejects a resolution. Writes resolved -> reopened -> in_progress, keeping the full history, and clears resolved_at.';

-- ════════════════════════════════════════════════════════════════════════════
-- Auto-close after 7 days
-- ════════════════════════════════════════════════════════════════════════════
--
-- A resolved report the resident never answers becomes closed_unconfirmed, not
-- closed_confirmed. The city gets its queue back; the record still says plainly
-- that nobody verified the work. Seven days covers someone away for a week, off
-- the app, or without signal after a storm — the cases where silence means
-- absence rather than agreement.
--
-- closed_unconfirmed remains disputable (see dispute_report_resolution's status
-- check), so returning after nine days and finding the drain still blocked is
-- not a dead end.

create or replace function public.close_stale_resolved_reports()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  closed_count integer;
begin
  with swept as (
    update public.reports
       set status = 'closed_unconfirmed'
     where status = 'resolved'
       and resolved_at is not null
       and resolved_at < now() - interval '7 days'
    returning id
  )
  select count(*) into closed_count from swept;

  update public.report_status_history
     set note = 'Closed automatically: no resident response within 7 days of resolution.'
   where status = 'closed_unconfirmed'
     and note is null;

  return closed_count;
end;
$$;

comment on function public.close_stale_resolved_reports is
  'Sweeps resolved reports older than 7 days into closed_unconfirmed. Scheduled nightly via pg_cron.';

-- Scheduling is best-effort. If pg_cron is unavailable the function still
-- exists and can be called by an admin or an Edge Function on a schedule; the
-- migration must not fail over it.
do $$
begin
  create extension if not exists pg_cron with schema extensions;

  perform extensions.cron.unschedule('saro-close-stale-resolved')
  where exists (
    select 1 from extensions.cron.job where jobname = 'saro-close-stale-resolved'
  );

  perform extensions.cron.schedule(
    'saro-close-stale-resolved',
    '17 3 * * *',                                  -- 03:17 daily, off the hour
    $cron$ select public.close_stale_resolved_reports(); $cron$
  );
exception when others then
  raise notice 'pg_cron unavailable (%); close_stale_resolved_reports must be driven externally.', sqlerrm;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Panic soft flag — 15 minute window
-- ════════════════════════════════════════════════════════════════════════════
--
-- The rule changed. The old function throttled a device after 10 presses in a
-- day and reported is_blocked back to the client. Blocking is wrong here: the
-- one thing a panic control must never do is refuse. A person pressing it
-- repeatedly is more likely to be genuinely desperate than abusive, and a
-- system that decides which of those it is has chosen the wrong side of the
-- error.
--
-- So the flag is now purely an admin-side signal. is_blocked is pinned false
-- forever; the client is not told anything it could act on; the call and the
-- report both proceed unconditionally. What a dispatcher sees instead is
-- rapid_repeat_count — presses that arrived inside 15 minutes of the previous
-- one — which is information they can use to notice either a device stuck in a
-- loop or somebody in real trouble pressing again because nothing came.

alter table public.panic_flags
  add column if not exists rapid_repeat_count integer not null default 0,
  add column if not exists last_rapid_repeat_at timestamptz;

comment on column public.panic_flags.rapid_repeat_count is
  'Presses that arrived within 15 minutes of the previous press from the same device. Advisory only.';
comment on column public.panic_flags.is_blocked is
  'Always false. Retained so existing admin queries do not break; SARO never blocks a panic press.';

-- Dropped rather than replaced: the OUT columns change from
-- (flag_count, is_blocked) to (flag_count, rapid_repeat), and `create or
-- replace` cannot change a function's return type — it fails with 42P13.
drop function if exists public.register_panic_flag(text);

create function public.register_panic_flag(token text)
returns table (flag_count integer, rapid_repeat boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  previous_at timestamptz;
  is_rapid    boolean;
  result      record;
begin
  if length(btrim(coalesce(token, ''))) < 12 then
    raise exception 'invalid device token';
  end if;

  select last_flagged_at into previous_at
  from public.panic_flags where device_token = token;

  is_rapid := previous_at is not null and previous_at > now() - interval '15 minutes';

  insert into public.panic_flags
    (device_token, flag_count, last_flagged_at, rapid_repeat_count, last_rapid_repeat_at)
  values
    (token, 1, now(), 0, null)
  on conflict (device_token) do update
    set flag_count           = public.panic_flags.flag_count + 1,
        last_flagged_at      = now(),
        rapid_repeat_count   = public.panic_flags.rapid_repeat_count + (case when is_rapid then 1 else 0 end),
        last_rapid_repeat_at = case when is_rapid then now() else public.panic_flags.last_rapid_repeat_at end,
        is_blocked           = false
  returning public.panic_flags.flag_count into result;

  return query select result.flag_count, is_rapid;
end;
$$;

comment on function public.register_panic_flag is
  'Records a panic press and reports whether it repeated inside 15 minutes. Advisory only — never blocks.';

-- ════════════════════════════════════════════════════════════════════════════
-- Grants
-- ════════════════════════════════════════════════════════════════════════════

revoke all on function public.confirm_report_resolution(text)       from public;
revoke all on function public.dispute_report_resolution(text, text) from public;
revoke all on function public.close_stale_resolved_reports()        from public;
revoke all on function public.register_panic_flag(text)             from public;

grant execute on function public.confirm_report_resolution(text)       to anon, authenticated;
grant execute on function public.dispute_report_resolution(text, text) to anon, authenticated;
grant execute on function public.register_panic_flag(text)             to anon, authenticated;

-- Deliberately NOT granted to anon or authenticated. The sweep runs as the cron
-- job owner or via the service role; a resident must never be able to trigger a
-- bulk close.
grant execute on function public.close_stale_resolved_reports() to postgres;

-- SARO 15 — fix the OUT-parameter / column collision in the closure RPCs.
--
-- Both functions in migration 11 declare `returns table (tracking_code text,
-- status public.report_status)`. In PL/pgSQL those OUT columns become variables
-- in scope for the whole body, so every bare `status` and `tracking_code` in a
-- statement that also touches a table with those columns is ambiguous:
--
--     ERROR 42702: column reference "status" is ambiguous
--     It could refer to either a PL/pgSQL variable or a table column.
--
-- Both were affected. `dispute_report_resolution` failed at its first UPDATE.
-- `confirm_report_resolution` had the identical defect and only appeared to
-- work because the tests hit its guard clause and returned before reaching the
-- statement that would have raised.
--
-- Postgres raises this at RUNTIME, not at CREATE FUNCTION time, so it survived
-- a clean migration apply — which is exactly why the closure flow got exercised
-- against the live database rather than read.
--
-- `#variable_conflict use_column` tells PL/pgSQL to resolve an ambiguous bare
-- name to the column, which is what every one of these statements wants. The
-- guard clauses that genuinely need the parameter use it under its own name
-- (`code`), which never collides.

create or replace function public.confirm_report_resolution(code text)
returns table (tracking_code text, status public.report_status)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  target_id uuid;
  target_status public.report_status;
begin
  select r.id, r.status into target_id, target_status
  from public.reports r
  where r.tracking_code = upper(btrim(code))
  limit 1;

  -- One message for both failure modes: "no such code" and "wrong status" must
  -- be indistinguishable, or this becomes a way to test which codes are real.
  if target_id is null or target_status <> 'resolved' then
    raise exception 'not confirmable';
  end if;

  update public.reports r
     set status = 'closed_confirmed'
   where r.id = target_id;

  update public.report_status_history h
     set note = 'Resident confirmed the work was done.'
   where h.report_id = target_id
     and h.status = 'closed_confirmed'
     and h.note is null;

  return query
    select r.tracking_code, r.status from public.reports r where r.id = target_id;
end;
$$;

comment on function public.confirm_report_resolution is
  'Resident closes a resolved report as confirmed, using the tracking code as the credential.';

create or replace function public.dispute_report_resolution(code text, reason text default null)
returns table (tracking_code text, status public.report_status)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  target_id     uuid;
  target_status public.report_status;
  clean_reason  text;
begin
  select r.id, r.status into target_id, target_status
  from public.reports r
  where r.tracking_code = upper(btrim(code))
  limit 1;

  if target_id is null or target_status not in ('resolved', 'closed_unconfirmed') then
    raise exception 'not disputable';
  end if;

  clean_reason := left(nullif(btrim(coalesce(reason, '')), ''), 500);

  -- Two transitions, both recorded. 'reopened' has to appear in the permanent
  -- history because "this was called resolved and the resident said otherwise"
  -- is the one fact an SLA summary must not be able to launder. Landing on
  -- 'in_progress' rather than parking in 'reopened' puts it straight back in the
  -- office's working queue — a disputed report nobody notices is the same
  -- failure the dispute was reporting.
  update public.reports r set status = 'reopened' where r.id = target_id;

  update public.report_status_history h
     set note = coalesce(
           'Resident disputed the resolution: ' || clean_reason,
           'Resident disputed the resolution. No reason given.')
   where h.report_id = target_id
     and h.status = 'reopened'
     and h.note is null;

  update public.reports r set status = 'in_progress' where r.id = target_id;

  update public.report_status_history h
     set note = 'Returned to the assigned office after a resident dispute.'
   where h.report_id = target_id
     and h.status = 'in_progress'
     and h.note is null;

  -- resolved_at belonged to a resolution the resident rejected. Left set, the
  -- next nightly sweep would immediately re-close the report they just reopened.
  update public.reports r set resolved_at = null where r.id = target_id;

  return query
    select r.tracking_code, r.status from public.reports r where r.id = target_id;
end;
$$;

comment on function public.dispute_report_resolution is
  'Resident rejects a resolution. Writes resolved -> reopened -> in_progress, keeps the full history, and clears resolved_at.';

-- Recreating a function drops its grants.
grant execute on function public.confirm_report_resolution(text)       to anon, authenticated;
grant execute on function public.dispute_report_resolution(text, text) to anon, authenticated;

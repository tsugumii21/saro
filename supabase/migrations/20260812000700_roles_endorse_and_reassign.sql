-- ── Three jobs, not three sizes of one job ──────────────────────────────────
--
-- Until now `admin` meant "an office with every queue": the same dispatch
-- screen, the same status buttons, just no filter. That is not what a city
-- director does. This migration gives each role the write it actually needs.
--
--   admin              governs. Reassigns a misrouted report to the right
--                      office, with a reason, recorded. Does not resolve.
--   office             dispatches its own queue. Unchanged.
--   barangay official  endorses: confirms a report in their barangay is real
--                      and adds what they know locally. Does not resolve.
--
-- Admin status writes are not revoked in Postgres. The policy "admins change
-- any report" stays, because a city EOC at 2am needs a break-glass and the
-- audit trail already records who used it. What changes is that the admin UI
-- no longer offers status buttons, so using it is now a deliberate act rather
-- than the default one.

-- ── 1. A barangay official may annotate reports in their barangay ───────────
--
-- Their only write before this was File on Behalf. Endorsement is an insert
-- into the append-only trail with the status left where it is: a note, signed,
-- from the person who stood in the street and looked.
--
-- `status = (select r.status ...)` is what keeps this an annotation rather than
-- a transition. A barangay official cannot move a report along the pipeline by
-- writing a history row that claims it moved.
create policy "barangay officials endorse reports in their barangay"
  on public.report_status_history for insert
  to authenticated
  with check (
    changed_by = auth.uid()
    and public.auth_role() = 'barangay_official'
    and exists (
      select 1 from public.reports r
       where r.id = report_id
         and r.barangay_id = public.auth_barangay_id()
         and r.status = report_status_history.status
    )
  );

comment on policy "barangay officials endorse reports in their barangay"
  on public.report_status_history is
  'Endorsement: a signed note on a report inside the official''s own barangay, with the status unchanged. Pipeline transitions stay with the handling office.';

-- ── 2. Reassignment, and the reason it happened ─────────────────────────────
--
-- Moving a report between offices is the city director's real power: it is how
-- a misrouted fire stops sitting in the engineering queue. It is also the one
-- act with no natural paper trail — the status does not change, so
-- record_status_change() writes nothing, and afterwards nobody can tell the
-- report was ever anywhere else.
--
-- So the reason is not optional, and the trail is written by the same function
-- that does the move rather than by the caller remembering to.
create or replace function public.reassign_report(
  p_report_id uuid,
  p_office_id uuid,
  p_reason    text
)
returns public.reports
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_report      public.reports;
  v_from_office text;
  v_to_office   text;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only a city administrator may reassign a report';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 8 then
    raise exception 'A reassignment needs a reason of at least 8 characters';
  end if;

  select * into v_report from public.reports where id = p_report_id;
  if not found then
    raise exception 'Report not found';
  end if;

  if v_report.assigned_office_id is not distinct from p_office_id then
    raise exception 'That report is already with this office';
  end if;

  select short_name into v_from_office from public.offices where id = v_report.assigned_office_id;
  select short_name into v_to_office   from public.offices where id = p_office_id;

  if p_office_id is not null and v_to_office is null then
    raise exception 'Unknown office';
  end if;

  update public.reports
     set assigned_office_id = p_office_id,
         updated_at         = now()
   where id = p_report_id
  returning * into v_report;

  -- Same status in and out: this is a note on the record, not a transition.
  insert into public.report_status_history (report_id, from_status, status, changed_by, note)
  values (
    p_report_id,
    v_report.status,
    v_report.status,
    auth.uid(),
    format(
      'Reassigned from %s to %s by city administrator. Reason: %s',
      coalesce(v_from_office, 'unrouted'),
      coalesce(v_to_office, 'unrouted'),
      btrim(p_reason)
    )
  );

  return v_report;
end;
$$;

comment on function public.reassign_report is
  'Admin-only. Moves a report to another office and writes the reason into the append-only history, because a reassignment changes no status and would otherwise leave no trace.';

revoke all on function public.reassign_report(uuid, uuid, text) from public, anon;
grant execute on function public.reassign_report(uuid, uuid, text) to authenticated;

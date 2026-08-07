-- SARO 17 — remove File on Behalf.
--
-- The feature let a barangay official or an admin file a report for a walk-in
-- resident. It is being removed entirely, not merely left unbuilt.
--
-- ── What goes ───────────────────────────────────────────────────────────────
--
--   the insert policy that admitted it
--   reports.filed_by, which existed only to name the official who typed it
--
-- ── What deliberately STAYS, and why ────────────────────────────────────────
--
-- Two columns look like they belong to this feature and do not. Both predate
-- it and both still have live consumers, so removing them would break working
-- behaviour under cover of a cleanup.
--
--   reports.filed_by_verified
--       A GENERATED column: (reporter_user_id is not null). It distinguishes a
--       report filed from a confirmed resident account from one filed
--       anonymously off a device, which is the provenance badge staff see in
--       the queue. It came in with the resident role, before File on Behalf
--       existed, and 4 of 21 live reports are currently verified through the
--       ordinary resident path. Untouched.
--
--   reports.is_proxy_report
--       The RESIDENT-side "I am reporting for someone else" toggle — a
--       neighbour filing for a neighbour from the resident app. Different
--       feature, same-sounding name. It is still on the resident form, still
--       forces a callback number through validateReportDraft, and one seeded
--       report uses it. Untouched.
--
-- ── Data ────────────────────────────────────────────────────────────────────
--
-- filed_by is null on every one of the 21 live reports — the feature never
-- successfully wrote a row, because the client set filed_by without
-- reporter_user_id and failed both the policy and the exactly-one-reporter
-- CHECK. So this drop destroys nothing. Verified before writing this file
-- rather than assumed.

-- ── 1. The policy ───────────────────────────────────────────────────────────
--
-- This was barangay_official's only INSERT on reports. Dropping it returns
-- that role to strictly read-only, which is what the original spec described.

drop policy if exists "barangay officials file on behalf of residents" on public.reports;

-- ── 2. Policies that merely REFERENCE the column ────────────────────────────
--
-- The two resident-facing insert policies each carry `and filed_by is null` as
-- a clamp — they were stopping a resident from claiming an official had filed
-- for them. Postgres refuses to drop a column any policy depends on, so these
-- are recreated without the clause before the drop. Every other clamp is kept
-- exactly as it was.

drop policy if exists "guests may file a report anonymously" on public.reports;
drop policy if exists "residents may file under their own account" on public.reports;

create policy "guests may file a report anonymously"
  on public.reports for insert
  to anon, authenticated
  with check (
    reporter_device_id is not null
    and reporter_user_id is null
    and status = 'received'
    and not is_false_report
    and cluster_id is null
    and resolved_at is null
  );

create policy "residents may file under their own account"
  on public.reports for insert
  to authenticated
  with check (
    public.is_resident()
    and reporter_user_id = auth.uid()
    and reporter_device_id is null
    and status = 'received'
    and not is_false_report
    and cluster_id is null
    and resolved_at is null
  );

-- ── 3. The column ───────────────────────────────────────────────────────────

alter table public.reports drop column if exists filed_by;

comment on column public.reports.is_proxy_report is
  'Resident filed this for someone else (a neighbour without a phone). Requires a callback number. Unrelated to the removed File on Behalf feature.';

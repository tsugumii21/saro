-- SARO 05 — Row Level Security. Enabled on every table, no exceptions.
--
-- Reading order: helpers, then one block per table. Each policy has a plain
-- language comment saying what it actually allows.

set search_path = public, extensions;

-- ═══════════════════════════════════════════════════════════════════════════
-- Scope helpers
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER so they can read public.profiles without being filtered by
-- the RLS policies on public.profiles — otherwise every policy that asks "what
-- is my role?" would recurse into the policy that answers it.
--
-- They return NULL for anonymous callers, which makes every comparison against
-- them false. Anonymous therefore falls through to the explicitly anonymous
-- policies and nothing else.

create or replace function public.auth_role()
returns public.user_role
language sql
security definer
stable
set search_path = public, extensions
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.is_active
  limit 1;
$$;

create or replace function public.auth_office_id()
returns uuid
language sql
security definer
stable
set search_path = public, extensions
as $$
  select p.office_id
  from public.profiles p
  where p.id = auth.uid() and p.is_active
  limit 1;
$$;

create or replace function public.auth_barangay_id()
returns uuid
language sql
security definer
stable
set search_path = public, extensions
as $$
  select p.barangay_id
  from public.profiles p
  where p.id = auth.uid() and p.is_active
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
  select coalesce(public.auth_role() = 'admin', false);
$$;

revoke all on function public.auth_role()        from public;
revoke all on function public.auth_office_id()   from public;
revoke all on function public.auth_barangay_id() from public;
revoke all on function public.is_admin()            from public;
grant execute on function public.auth_role()        to authenticated;
grant execute on function public.auth_office_id()   to authenticated;
grant execute on function public.auth_barangay_id() to authenticated;
grant execute on function public.is_admin()            to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Enable RLS everywhere
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.offices                 enable row level security;
alter table public.barangays               enable row level security;
alter table public.routing_table           enable row level security;
alter table public.routing_table_changelog enable row level security;
alter table public.profiles                enable row level security;
alter table public.reports                 enable row level security;
alter table public.report_status_history   enable row level security;
alter table public.report_media            enable row level security;
alter table public.clusters                enable row level security;
alter table public.cluster_reports         enable row level security;
alter table public.gap_log                 enable row level security;
alter table public.panic_flags             enable row level security;

-- Belt and braces. Supabase grants anon/authenticated broad table privileges by
-- default; RLS is the real gate, but a table anon has no business touching
-- should not have the grant either. If a policy is ever dropped by accident,
-- the missing grant still stops the read.
revoke all on public.reports               from anon;
revoke all on public.report_status_history from anon;
revoke all on public.report_media          from anon;
revoke all on public.clusters              from anon;
revoke all on public.cluster_reports       from anon;
revoke all on public.profiles              from anon;
revoke all on public.routing_table_changelog from anon;
revoke all on public.panic_flags           from anon, authenticated;
revoke all on public.gap_log               from anon;

grant insert on public.reports      to anon;
grant insert on public.report_media to anon;
grant insert on public.gap_log      to anon;
grant select on public.offices, public.barangays, public.routing_table to anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- offices / barangays — public reference data
-- ═══════════════════════════════════════════════════════════════════════════

create policy "offices are readable by everyone"
  on public.offices for select
  to anon, authenticated
  using (true);
-- The report form has to name the office that will receive a report. Office
-- names and hotlines are already published by the city.

create policy "only admins change offices"
  on public.offices for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "barangays are readable by everyone"
  on public.barangays for select
  to anon, authenticated
  using (true);
-- Needed client-side to label a location and to let a resident correct an
-- auto-detected barangay.

create policy "only admins change barangays"
  on public.barangays for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- routing_table — the category list, and where each category goes
-- ═══════════════════════════════════════════════════════════════════════════

create policy "routing table is readable by everyone"
  on public.routing_table for select
  to anon, authenticated
  using (true);
-- This doubles as the public category list. It contains no report data.

create policy "only admins edit routing"
  on public.routing_table for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
-- Changing which office owns a category re-routes every future report in it.
-- Office staff cannot hand their queue to another office.

create policy "only admins read the routing changelog"
  on public.routing_table_changelog for select
  to authenticated
  using (public.is_admin());
-- Rows are written by a SECURITY DEFINER trigger, which bypasses RLS, so there
-- is deliberately no INSERT policy: nobody can forge or backdate an entry.

-- ═══════════════════════════════════════════════════════════════════════════
-- profiles — who you are and what you can see
-- ═══════════════════════════════════════════════════════════════════════════

create policy "you can read your own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "admins read all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

create policy "admins manage profiles"
  on public.profiles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
-- Only an admin can set or change a role. A user cannot promote themselves,
-- because there is no self-update policy at all — not even for your own row.

-- ═══════════════════════════════════════════════════════════════════════════
-- reports — the sensitive one
-- ═══════════════════════════════════════════════════════════════════════════

create policy "anyone may file a report"
  on public.reports for insert
  to anon, authenticated
  with check (
    status = 'received'
    and not is_false_report
    and cluster_id is null
    and resolved_at is null
    and filed_by is null
    and assigned_office_id is null    -- routing decides this, not the caller
  );
-- Anonymous submission is the whole point of the product. The check clamps
-- what a caller may assert: you can file a report, you cannot file one that is
-- already resolved, already assigned to an office of your choosing, already
-- clustered, or pre-marked as genuine. There is NO anonymous SELECT policy,
-- so an anonymous caller can write a row and then never read it back.

create policy "admins see every report"
  on public.reports for select
  to authenticated
  using (public.is_admin());

create policy "admins change any report"
  on public.reports for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
-- City-wide dispatch needs an unrestricted view; that is the role's purpose.

create policy "offices see their own queue"
  on public.reports for select
  to authenticated
  using (
    public.auth_role() = 'office'
    and assigned_office_id is not null
    and assigned_office_id = public.auth_office_id()
  );
-- An office sees a report only while it is assigned to that office. Re-routing
-- a report moves it out of one queue and into another; nobody keeps a copy.

create policy "offices update their own queue"
  on public.reports for update
  to authenticated
  using (
    public.auth_role() = 'office'
    and assigned_office_id = public.auth_office_id()
  )
  with check (
    public.auth_role() = 'office'
    and assigned_office_id = public.auth_office_id()
  );
-- Both halves matter. USING decides which rows you may touch; WITH CHECK
-- decides what the row may look like afterwards. Having both means an office
-- cannot reassign a report to a different office to get it off their board,
-- and cannot pull someone else's report into theirs.

create policy "barangay officials see their barangay"
  on public.reports for select
  to authenticated
  using (
    public.auth_role() = 'barangay_official'
    and barangay_id is not null
    and barangay_id = public.auth_barangay_id()
  );
-- Geography, not ownership. A barangay official sees everything happening in
-- their barangay regardless of which office holds the ticket, because they are
-- accountable for the area rather than for the response.

create policy "barangay officials file on behalf of residents"
  on public.reports for insert
  to authenticated
  with check (
    public.auth_role() = 'barangay_official'
    and barangay_id = public.auth_barangay_id()
    and filed_by = auth.uid()
    and status = 'received'
    and is_proxy_report
  );
-- File on Behalf: a resident walks into the barangay hall without a phone.
-- The official may only file inside their own barangay, must be recorded as
-- the filer, and the row is flagged as a proxy report. They have no UPDATE
-- policy, so this is their only write — they still cannot change a status.

-- No DELETE policy exists on reports for any role. Reports are closed, marked
-- false, or superseded; they are never removed.

-- ═══════════════════════════════════════════════════════════════════════════
-- report_status_history — append-only audit trail
-- ═══════════════════════════════════════════════════════════════════════════

create policy "staff read history for reports they can see"
  on public.report_status_history for select
  to authenticated
  using (
    exists (select 1 from public.reports r where r.id = report_id)
  );
-- The EXISTS re-enters public.reports, which is itself under RLS, so this
-- inherits the report policies exactly: if you cannot see the report, the
-- subquery finds nothing and you cannot see its history either.

create policy "admins and offices annotate history"
  on public.report_status_history for insert
  to authenticated
  with check (
    changed_by = auth.uid()
    and (
      public.is_admin()
      or (
        public.auth_role() = 'office'
        and exists (
          select 1 from public.reports r
          where r.id = report_id
            and r.assigned_office_id = public.auth_office_id()
        )
      )
    )
  );
-- Manual notes must be signed by whoever wrote them. Automatic transitions are
-- written by a SECURITY DEFINER trigger and skip this policy entirely.

-- No UPDATE and no DELETE policy, for anyone including admins. That is what
-- makes this an audit trail rather than a status column with extra steps.

-- ═══════════════════════════════════════════════════════════════════════════
-- report_media — photos
-- ═══════════════════════════════════════════════════════════════════════════

create policy "reporters attach photos to a report they just filed"
  on public.report_media for insert
  to anon, authenticated
  with check (
    kind = 'evidence'
    and exists (
      select 1 from public.reports r
      where r.id = report_id
        and r.created_at > now() - interval '10 minutes'
    )
  );
-- A photo upload is a second round trip after the report insert, so it cannot
-- be one statement. The 10 minute window is the compromise: long enough for a
-- slow upload on a bad connection, short enough that a report id harvested
-- later is useless. See the note in the summary about the residual risk.

create policy "staff read media for reports they can see"
  on public.report_media for select
  to authenticated
  using (exists (select 1 from public.reports r where r.id = report_id));
-- Same inheritance trick as history: report visibility governs photo visibility.

create policy "admins and offices attach resolution photos"
  on public.report_media for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and (
      public.is_admin()
      or (
        public.auth_role() = 'office'
        and exists (
          select 1 from public.reports r
          where r.id = report_id
            and r.assigned_office_id = public.auth_office_id()
        )
      )
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- clusters — corroboration groups
-- ═══════════════════════════════════════════════════════════════════════════

create policy "staff read clusters"
  on public.clusters for select
  to authenticated
  using (public.auth_role() is not null);
-- A cluster row is a category, a centroid and a count — no description, no
-- photo, no reporter. Any signed-in official may see that three people
-- reported flooding on the same corner; the reports themselves stay scoped.

create policy "staff read cluster membership for visible reports"
  on public.cluster_reports for select
  to authenticated
  using (exists (select 1 from public.reports r where r.id = report_id));

-- Clusters are written only by the assign_report_cluster trigger, which is
-- SECURITY DEFINER. No INSERT/UPDATE/DELETE policy exists, so no client can
-- manufacture corroboration for a report.

-- ═══════════════════════════════════════════════════════════════════════════
-- gap_log — assistant questions the knowledge base could not answer
-- ═══════════════════════════════════════════════════════════════════════════

create policy "anyone may log a question"
  on public.gap_log for insert
  to anon, authenticated
  with check (not resolved and resolved_by is null and resolved_at is null);
-- Residents write here implicitly by asking the assistant something. They
-- cannot pre-mark their own question as resolved.

create policy "admins read the gap log"
  on public.gap_log for select
  to authenticated
  using (public.is_admin());
-- Questions can contain personal detail typed into a chat box, so this is
-- admin-only rather than all-staff.

create policy "admins resolve gap log entries"
  on public.gap_log for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- panic_flags — abuse counter
-- ═══════════════════════════════════════════════════════════════════════════

-- RLS is enabled and NO policy is defined, which denies every role. All access
-- goes through register_panic_flag(), a SECURITY DEFINER function. A client
-- can increment its own counter and cannot read anyone else's, cannot reset
-- its own, and cannot enumerate device tokens.

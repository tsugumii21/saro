-- SARO 12 — take the auto-close sweep away from anon.
--
-- Migration 11 shipped a hole. It ended with:
--
--     revoke all on function public.close_stale_resolved_reports() from public;
--     grant  execute on function public.close_stale_resolved_reports() to postgres;
--
-- which reads as "nobody but postgres", and is wrong. Supabase's project
-- bootstrap sets:
--
--     alter default privileges in schema public
--       grant execute on functions to postgres, anon, authenticated, service_role;
--
-- Those are EXPLICIT grants to the anon and authenticated roles, not grants to
-- PUBLIC. `revoke ... from public` removes the implicit world-grant and leaves
-- the explicit ones standing. Every function created in this schema is therefore
-- anon-callable by default, and stays that way until each role is named in the
-- revoke.
--
-- Caught by calling the function with the publishable key and getting `0` back
-- instead of a permission error. It returned 0 only because no report has yet
-- been resolved for seven days; against real data an anonymous caller could
-- have closed every report that was waiting on its resident to confirm —
-- destroying exactly the signal the confirmed/unconfirmed split exists to
-- record, and doing it silently, since the sweep writes a plausible history
-- note as it goes.
--
-- The general lesson for this schema: a SECURITY DEFINER function in `public`
-- is reachable by anon unless proven otherwise. Revoking from `public` is not
-- that proof.

revoke all on function public.close_stale_resolved_reports()
  from public, anon, authenticated;

-- service_role keeps it: an Edge Function or a manual admin sweep is the
-- documented fallback for when pg_cron is unavailable on this plan.
grant execute on function public.close_stale_resolved_reports()
  to postgres, service_role;

-- ── Audit of the other SECURITY DEFINER functions in this schema ────────────
--
-- Checked each one for the same mistake. The rest are either intentionally
-- anon-callable, or unreachable through PostgREST:
--
--   get_report_by_tracking_code, get_report_timeline, get_reports_by_device,
--   get_public_map_reports, register_panic_flag, confirm_report_resolution,
--   dispute_report_resolution
--       Intentionally granted to anon. This is the anonymous product surface.
--
--   handle_new_user, apply_report_routing, record_status_change,
--   assign_report_cluster, pin_privileged_profile_columns,
--   log_routing_table_change, touch_updated_at
--       Return `trigger`. PostgREST will not expose them; they cannot be
--       invoked directly over the API at all.
--
--   auth_role, auth_office_id, auth_barangay_id, is_admin, is_resident
--       Report facts about the caller's own JWT. An anon caller learns that
--       they are anonymous.
--
--   generate_tracking_code
--       Returns an unused random code. Calling it grants nothing; codes only
--       mean something once attached to a row.
--
--   report_accepts_evidence(uuid)
--       Returns whether a report id exists and is still open. Requires already
--       knowing a UUID, and RLS still governs every table it guards. Narrow
--       enough to leave reachable rather than break the media-upload path it
--       was extracted from in migration 07.

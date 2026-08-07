-- SARO 20 — schedule the rainfall poller.
--
-- pg_cron fires pg_net every 15 minutes at the rainfall-poll Edge Function.
--
-- ── Why the publishable key and not the service key ─────────────────────────
--
-- pg_net has to send an Authorization header, which means whatever key it uses
-- is stored in this migration or in a database setting. The publishable key is
-- already public — it ships in both browser bundles — so committing it here
-- discloses nothing. A service-role key would be a genuine secret sitting in
-- version control, which this project does not do.
--
-- That is affordable because the function is inert: it takes no input, fetches
-- weather from Open-Meteo, and upserts it. The worst an unauthorised caller can
-- do is cause one extra upstream request. Compare push-dispatch, which does
-- require a JWT, because a call to it sends a notification to a resident's
-- phone.
--
-- ── Why 15 minutes ──────────────────────────────────────────────────────────
--
-- Open-Meteo publishes hourly precipitation, so polling faster cannot produce a
-- new number. 15 minutes means an hour boundary is picked up promptly and the
-- schedule survives three consecutive failures before a reading goes stale.
-- 96 calls a day against a non-commercial guidance of ~10,000.

do $$
declare
  fn_url text := 'https://hfwwsvfoyrsmalzfdhya.supabase.co/functions/v1/rainfall-poll';
  -- Publishable key. Public by design; RLS is what protects the data.
  anon_key text := 'sb_publishable_s-AC9--7nRw7ITaWPyX49g_dYXFDTAZ';
begin
  create extension if not exists pg_net with schema extensions;
  create extension if not exists pg_cron with schema extensions;

  perform extensions.cron.unschedule('saro-rainfall-poll')
  where exists (select 1 from extensions.cron.job where jobname = 'saro-rainfall-poll');

  perform extensions.cron.schedule(
    'saro-rainfall-poll',
    '*/15 * * * *',
    format(
      $job$
      select extensions.net.http_post(
        url     := %L,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'apikey', %L,
                     'Authorization', 'Bearer ' || %L
                   ),
        body    := '{}'::jsonb
      );
      $job$,
      fn_url, anon_key, anon_key
    )
  );

  raise notice 'scheduled saro-rainfall-poll every 15 minutes';
exception when others then
  -- Not fatal. Without the schedule the cache simply goes stale, and the maps
  -- show the last reading with its age — which is why every rainfall pin
  -- carries a timestamp rather than implying it is live.
  raise notice 'could not schedule rainfall poll (%); run it manually or from CI.', sqlerrm;
end;
$$;

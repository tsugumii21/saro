-- SARO 13 — Web Push subscription writes.
--
-- Migration 05 granted anon INSERT on push_subscriptions and nothing else,
-- which is correct and also insufficient: a device that re-subscribes gets a
-- duplicate-key error on the unique endpoint, and a device that turns
-- notifications off has no way to say so.
--
-- The obvious fix — grant UPDATE to anon — is wrong. RLS cannot verify a device
-- id, because the client supplies it and can supply any value. An UPDATE policy
-- on this table would therefore let any anonymous caller deactivate every
-- resident's notifications, or repoint someone else's row at their own
-- endpoint. That is a broadcast channel to other people's phones.
--
-- So both writes are SECURITY DEFINER functions keyed on the endpoint URL.
-- The endpoint is issued by Google's or Mozilla's push service and contains a
-- long random token; knowing it is proof you are the browser it was issued to,
-- in exactly the way knowing a tracking code is proof you were handed one.
-- Neither function can be used to read, list, or enumerate anything: they take
-- an endpoint you must already possess and return nothing about any other row.

create or replace function public.upsert_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth_key   text,
  p_device_id  text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
begin
  if length(btrim(coalesce(p_endpoint, ''))) < 20
     or btrim(coalesce(p_p256dh, '')) = ''
     or btrim(coalesce(p_auth_key, '')) = '' then
    raise exception 'invalid subscription';
  end if;

  -- The same exactly-one rule reports follow: an account subscription or a
  -- device subscription, never both, never neither.
  if uid is null and length(btrim(coalesce(p_device_id, ''))) < 12 then
    raise exception 'invalid subscription';
  end if;

  insert into public.push_subscriptions
    (endpoint, p256dh, auth_key, user_agent, subscriber_user_id, subscriber_device_id,
     is_active, last_seen_at)
  values
    (p_endpoint, p_p256dh, p_auth_key, left(coalesce(p_user_agent, ''), 300),
     uid,
     case when uid is null then p_device_id else null end,
     true, now())
  on conflict (endpoint) do update
    set p256dh               = excluded.p256dh,
        auth_key             = excluded.auth_key,
        user_agent           = excluded.user_agent,
        -- A device that signs in after subscribing anonymously moves its
        -- subscription onto the account, so status updates follow the person
        -- rather than the browser. Both columns are rewritten together to keep
        -- the exactly-one constraint satisfied.
        subscriber_user_id   = excluded.subscriber_user_id,
        subscriber_device_id = excluded.subscriber_device_id,
        is_active            = true,
        last_seen_at         = now();
end;
$$;

comment on function public.upsert_push_subscription is
  'Registers or refreshes this browsers push subscription. The endpoint URL is the credential.';

create or replace function public.deactivate_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update public.push_subscriptions
     set is_active = false, last_seen_at = now()
   where endpoint = p_endpoint;
$$;

comment on function public.deactivate_push_subscription is
  'Marks a subscription inactive. Rows are kept, not deleted, so a dead endpoint is not silently recreated.';

-- INSERT is no longer needed directly now that the RPC owns the write path.
revoke insert on public.push_subscriptions from anon;

revoke all on function public.upsert_push_subscription(text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.deactivate_push_subscription(text)
  from public, anon, authenticated;

grant execute on function public.upsert_push_subscription(text, text, text, text, text)
  to anon, authenticated;
grant execute on function public.deactivate_push_subscription(text)
  to anon, authenticated;

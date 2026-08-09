-- Migration 20260808001000: Remove Proxy Reporting feature
--
-- Drops is_proxy_report and callback_number from public.reports table,
-- and updates the file_anonymous_report RPC to no longer accept or insert them.

alter table public.reports
  drop column if exists is_proxy_report,
  drop column if exists callback_number;

create or replace function public.file_anonymous_report(
  p_category        text,
  p_description     text,
  p_lat             double precision,
  p_lng             double precision,
  p_device_id       text,
  p_barangay_id     uuid    default null,
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
  if length(btrim(coalesce(p_device_id, ''))) < 12 then
    raise exception 'invalid device id';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'location is required';
  end if;

  insert into public.reports (
    category, description, lat, lng,
    reporter_device_id, barangay_id, photo_url
  )
  values (
    p_category,
    btrim(coalesce(p_description, '')),
    p_lat, p_lng,
    btrim(p_device_id),
    p_barangay_id,
    p_photo_url
  )
  returning reports.id into new_id;

  return query
    select r.id, r.tracking_code, r.category, r.status, r.created_at
    from public.reports r
    where r.id = new_id;
end;
$$;

revoke all on function public.file_anonymous_report(
  text, text, double precision, double precision, text, uuid, text
) from public, authenticated;

grant execute on function public.file_anonymous_report(
  text, text, double precision, double precision, text, uuid, text
) from anon, authenticated;

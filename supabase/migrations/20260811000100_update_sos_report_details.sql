-- Continue an active S.O.S. report without creating a second report row.
--
-- Anonymous residents cannot UPDATE reports directly. This narrow SECURITY
-- DEFINER RPC proves ownership with the same device bearer token used when the
-- S.O.S. was filed, then updates only resident-editable incident details.
-- Category, tracking code, status and created_at are never accepted as inputs.

create or replace function public.update_sos_report_details(
  p_report_id     uuid,
  p_tracking_code text,
  p_device_id     text,
  p_description   text,
  p_lat           double precision,
  p_lng           double precision,
  p_barangay_id   uuid default null
)
returns table (
  id            uuid,
  tracking_code text,
  category      text,
  status        public.report_status,
  created_at    timestamptz,
  updated_at    timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  existing public.reports%rowtype;
  next_barangay uuid;
begin
  if length(btrim(coalesce(p_device_id, ''))) < 12 then
    raise exception 'invalid device id';
  end if;

  if length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'description is required';
  end if;

  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90
     or p_lng not between -180 and 180 then
    raise exception 'valid location is required';
  end if;

  select r.* into existing
  from public.reports r
  where r.id = p_report_id
    and r.tracking_code = upper(btrim(p_tracking_code))
    and r.reporter_device_id = btrim(p_device_id)
  for update;

  if not found then
    raise exception 'active S.O.S. report not found for this device';
  end if;

  next_barangay := coalesce(p_barangay_id, existing.barangay_id);

  -- Network retries are idempotent. If the first UPDATE committed but its
  -- response was lost, the retry does not touch updated_at or append a second
  -- timeline entry.
  if existing.description is distinct from btrim(p_description)
     or existing.lat is distinct from p_lat
     or existing.lng is distinct from p_lng
     or existing.barangay_id is distinct from next_barangay then
    update public.reports r
    set description = btrim(p_description),
        lat = p_lat,
        lng = p_lng,
        barangay_id = next_barangay
    where r.id = existing.id
    returning r.* into existing;

    insert into public.report_status_history (
      report_id, from_status, status, changed_by, note
    ) values (
      existing.id, null, existing.status, null,
      'Resident added incident details to the active S.O.S.'
    );
  end if;

  return query
    select existing.id, existing.tracking_code, existing.category,
           existing.status, existing.created_at, existing.updated_at;
end;
$$;

comment on function public.update_sos_report_details is
  'Updates details on the same device-owned S.O.S. report and appends an idempotent timeline event. Never inserts a report.';

revoke all on function public.update_sos_report_details(
  uuid, text, text, text, double precision, double precision, uuid
) from public;

grant execute on function public.update_sos_report_details(
  uuid, text, text, text, double precision, double precision, uuid
) to anon, authenticated;

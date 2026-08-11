-- Storage objects must be removed through the Storage API. The authenticated
-- client does that before calling this database-only RPC.
create or replace function public.delete_report(p_report_id uuid)
returns table (id uuid, tracking_code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  deleted_id uuid;
  deleted_code text;
  affected_clusters uuid[];
begin
  if not public.is_admin() then
    raise exception 'Only a city administrator can delete reports'
      using errcode = '42501';
  end if;

  select array_agg(cr.cluster_id) into affected_clusters
  from public.cluster_reports cr where cr.report_id = p_report_id;

  delete from public.reports r
  where r.id = p_report_id
  returning r.id, r.tracking_code into deleted_id, deleted_code;

  if deleted_id is null then raise exception 'Report not found'; end if;

  delete from public.clusters c
  where c.id = any(coalesce(affected_clusters, array[]::uuid[]))
    and not exists (select 1 from public.cluster_reports cr where cr.cluster_id = c.id);

  update public.clusters c
  set report_count = members.member_count,
      confidence_score = members.member_count,
      centroid = members.centroid
  from (
    select cr.cluster_id, count(*)::integer as member_count,
           extensions.st_centroid(extensions.st_collect(r.location::extensions.geometry))::extensions.geography as centroid
    from public.cluster_reports cr
    join public.reports r on r.id = cr.report_id
    where cr.cluster_id = any(coalesce(affected_clusters, array[]::uuid[]))
    group by cr.cluster_id
  ) members
  where c.id = members.cluster_id;

  return query select deleted_id, deleted_code;
end;
$$;

revoke all on function public.delete_report(uuid) from public, anon, authenticated;
grant execute on function public.delete_report(uuid) to authenticated;

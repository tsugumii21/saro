-- ── Shelters belong to a barangay, and their occupancy is a live number ─────
--
-- Two gaps, both felt during an actual evacuation:
--
--   1. `evacuation_centers` had no barangay. A barangay captain is the person
--      standing in the shelter counting families, and there was no way to say
--      which shelters were theirs — so they could not be given the one write
--      that matters to them without handing them every shelter in the city.
--
--   2. Occupancy had no history and no author. "150 of 800" with no idea
--      whether that was measured ten minutes or ten hours ago is not a number
--      an evacuation can be run on.

alter table public.evacuation_centers
  add column if not exists barangay_id  uuid references public.barangays(id) on delete set null,
  add column if not exists occupancy_updated_at timestamptz,
  add column if not exists occupancy_updated_by uuid references auth.users(id) on delete set null;

comment on column public.evacuation_centers.barangay_id is
  'Which barangay this shelter sits in. Decides which barangay officials may update its occupancy.';
comment on column public.evacuation_centers.occupancy_updated_at is
  'When current_occupancy was last set. A headcount with no timestamp cannot be acted on.';

-- Backfill from the address text, which is where the barangay has been hiding
-- since the table was seeded. Matches on the name appearing in the address, so
-- an unmatched shelter simply keeps a null and stays admin-managed.
update public.evacuation_centers ec
   set barangay_id = b.id
  from public.barangays b
 where ec.barangay_id is null
   and ec.address ilike '%' || b.name || '%';

-- ── Occupancy updates, scoped ───────────────────────────────────────────────
--
-- A SECURITY DEFINER function rather than an UPDATE policy, because the rule is
-- per-column: a barangay official may change the headcount and the open/full
-- status of a shelter in their barangay, and nothing else about it. RLS decides
-- rows, not columns, so a policy would also let them rename the shelter or move
-- its coordinates.
create or replace function public.set_evacuation_occupancy(
  p_center_id uuid,
  p_occupancy integer,
  p_status    text default null
)
returns public.evacuation_centers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_center public.evacuation_centers;
  v_role   text;
begin
  select * into v_center from public.evacuation_centers where id = p_center_id;
  if not found then
    raise exception 'Evacuation center not found';
  end if;

  v_role := public.auth_role();

  if v_role is null then
    raise exception 'Sign in to update a shelter';
  end if;

  if v_role = 'barangay_official'
     and (v_center.barangay_id is null or v_center.barangay_id is distinct from public.auth_barangay_id()) then
    raise exception 'You can only update shelters in your own barangay';
  end if;

  if v_role not in ('admin', 'office', 'barangay_official') then
    raise exception 'You do not have permission to update a shelter';
  end if;

  if p_occupancy < 0 then
    raise exception 'Occupancy cannot be negative';
  end if;

  -- Over capacity is allowed and recorded rather than rejected. A shelter that
  -- has taken 60 more people than it was designed for is a fact the city needs
  -- on a screen, not an input error to argue with at midnight.
  update public.evacuation_centers
     set current_occupancy    = p_occupancy,
         status               = coalesce(nullif(btrim(coalesce(p_status, '')), ''), status),
         occupancy_updated_at = now(),
         occupancy_updated_by = auth.uid(),
         updated_at           = now()
   where id = p_center_id
  returning * into v_center;

  return v_center;
end;
$$;

comment on function public.set_evacuation_occupancy is
  'Headcount and open/full status for one shelter. Admins and offices may update any; a barangay official only shelters inside their own barangay. Deliberately narrower than an UPDATE policy, which cannot restrict which columns change.';

revoke all on function public.set_evacuation_occupancy(uuid, integer, text) from public, anon;
grant execute on function public.set_evacuation_occupancy(uuid, integer, text) to authenticated;

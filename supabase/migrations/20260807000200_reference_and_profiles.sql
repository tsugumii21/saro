-- SARO 02 — reference data (offices, barangays), routing table, profiles.

-- PostGIS types and its GiST operator classes live in `extensions`.
set search_path = public, extensions;

-- ── Offices ─────────────────────────────────────────────────────────────────

create table public.offices (
  id           uuid primary key default extensions.gen_random_uuid(),
  short_name   text not null unique,           -- "CDRRMO"
  full_name    text not null,
  hotline      text,
  created_at   timestamptz not null default now()
);

comment on table public.offices is 'Municipal offices that reports route to.';

-- ── Barangays ───────────────────────────────────────────────────────────────

create table public.barangays (
  id           uuid primary key default extensions.gen_random_uuid(),
  name         text not null unique,
  is_coastal   boolean not null default false,
  -- Polygon used to infer a report's barangay from its coordinates.
  boundary     extensions.geography(Polygon, 4326),
  created_at   timestamptz not null default now()
);

create index barangays_boundary_idx on public.barangays using gist (boundary);

comment on table public.barangays is 'Legazpi City barangays. `boundary` drives automatic barangay assignment on new reports.';

-- ── Routing table ───────────────────────────────────────────────────────────

-- The category list and the routing rules are the same thing: one row per
-- hazard category, naming the office responsible for it.
create table public.routing_table (
  id                    uuid primary key default extensions.gen_random_uuid(),
  category              text not null unique,
  label                 text not null,
  label_bikol           text,
  label_tagalog         text,
  responsible_office_id uuid not null references public.offices(id) on delete restrict,
  is_emergency          boolean not null default false,
  is_fallback           boolean not null default false,
  sla_hours             integer not null default 24 check (sla_hours > 0),
  updated_by            uuid references auth.users(id) on delete set null,
  updated_at            timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

-- Exactly one fallback row: where a report goes when its category has no rule.
create unique index routing_table_single_fallback_idx
  on public.routing_table (is_fallback)
  where is_fallback;

create trigger routing_table_touch_updated_at
  before update on public.routing_table
  for each row execute function public.touch_updated_at();

comment on table public.routing_table is 'Category -> responsible office. Edited by admins in the routing-table editor; every change is journalled to routing_table_changelog.';

-- ── Routing table changelog ─────────────────────────────────────────────────

create table public.routing_table_changelog (
  id               uuid primary key default extensions.gen_random_uuid(),
  routing_table_id uuid references public.routing_table(id) on delete set null,
  category         text not null,               -- kept even if the row is deleted
  action           text not null check (action in ('insert', 'update', 'delete')),
  changed_fields   jsonb not null default '{}'::jsonb,
  previous_values  jsonb,
  new_values       jsonb,
  changed_by       uuid references auth.users(id) on delete set null,
  changed_at       timestamptz not null default now()
);

create index routing_table_changelog_category_idx on public.routing_table_changelog (category, changed_at desc);

-- Journal every routing change automatically. The editor cannot forget to log.
create or replace function public.log_routing_table_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  changed jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'INSERT' then
    insert into public.routing_table_changelog (routing_table_id, category, action, new_values, changed_by)
    values (new.id, new.category, 'insert', to_jsonb(new), auth.uid());
    return new;

  elsif tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if to_jsonb(new) -> k is distinct from to_jsonb(old) -> k
         and k not in ('updated_at', 'updated_by') then
        changed := changed || jsonb_build_object(k, to_jsonb(new) -> k);
      end if;
    end loop;

    if changed <> '{}'::jsonb then
      insert into public.routing_table_changelog
        (routing_table_id, category, action, changed_fields, previous_values, new_values, changed_by)
      values (new.id, new.category, 'update', changed, to_jsonb(old), to_jsonb(new), auth.uid());
    end if;
    return new;

  else
    insert into public.routing_table_changelog (routing_table_id, category, action, previous_values, changed_by)
    values (old.id, old.category, 'delete', to_jsonb(old), auth.uid());
    return old;
  end if;
end;
$$;

create trigger routing_table_changelog_trg
  after insert or update or delete on public.routing_table
  for each row execute function public.log_routing_table_change();

-- ── Profiles ────────────────────────────────────────────────────────────────

-- One row per authenticated user: residents who signed up themselves, and
-- staff provisioned by an administrator. Anonymous guests have no profile at
-- all — they never authenticate, and that stays a first-class path.
--
-- Scope is held as foreign keys, not as free text. The request asked for
-- office_name / barangay_name columns; those are exposed by the
-- profiles_with_scope view below instead. A typo in a text scope key would
-- either silently widen access or lock someone out, and RLS is the wrong place
-- to discover a spelling mistake.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null,
  role         public.user_role not null default 'resident',
  office_id    uuid references public.offices(id) on delete restrict,
  barangay_id  uuid references public.barangays(id) on delete restrict,
  mobile_number text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A role is only meaningful with the scope it implies. A resident holds no
  -- municipal scope whatsoever, which is what makes the signup default safe:
  -- even if a row were forced to role='resident' with an office attached, the
  -- constraint rejects it.
  constraint profiles_scope_matches_role check (
    (role = 'resident'          and office_id is null     and barangay_id is null)
    or (role = 'admin'             and office_id is null     and barangay_id is null)
    or (role = 'office'            and office_id is not null and barangay_id is null)
    or (role = 'barangay_official' and barangay_id is not null and office_id is null)
  )
);

create index profiles_office_idx   on public.profiles (office_id) where office_id is not null;
create index profiles_barangay_idx on public.profiles (barangay_id) where barangay_id is not null;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

comment on table public.profiles is 'Resident and staff accounts. role + office_id/barangay_id are the only inputs to report visibility.';

-- ── Public signup always produces a resident ────────────────────────────────
--
-- Every account created through Supabase Auth gets a profile automatically.
-- The role is hard-coded here, NOT read from user_metadata: a client controls
-- its own metadata at signup, so trusting it would let anyone register as an
-- admin. full_name is the only thing taken from the signup payload, and it is
-- text with no authority attached.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.profiles (id, full_name, role, office_id, barangay_id)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    'resident',      -- deliberately not configurable from the client
    null,
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Role and scope are not self-service ─────────────────────────────────────
--
-- Residents need to edit their own name and mobile number, which means they
-- need an UPDATE policy on their own row. RLS cannot express "you may change
-- these columns but not those" — WITH CHECK sees only the new row, so it
-- cannot tell that `role` just changed from 'resident' to 'admin'.
--
-- This trigger closes that. Any non-admin update silently restores the
-- privileged columns to their previous values, so a resident editing their
-- profile can send role='admin' all day and it will not stick.
create or replace function public.pin_privileged_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Admins (and the service role, whose auth.uid() is null) may set anything.
  if auth.uid() is null or coalesce(public.is_admin(), false) then
    return new;
  end if;

  new.role        := old.role;
  new.office_id   := old.office_id;
  new.barangay_id := old.barangay_id;
  new.is_active   := old.is_active;
  return new;
end;
$$;

create trigger profiles_pin_privileged_columns
  before update on public.profiles
  for each row execute function public.pin_privileged_profile_columns();

-- security_invoker: the view must be filtered by the *caller's* RLS on
-- profiles, not by the view owner's privileges. Without this a view over an
-- RLS table hands out every row.
create view public.profiles_with_scope
with (security_invoker = on)
as
  select
    p.id,
    p.full_name,
    p.role,
    p.office_id,
    o.short_name as office_name,
    p.barangay_id,
    b.name       as barangay_name,
    p.mobile_number,
    p.is_active,
    p.created_at,
    p.updated_at
  from public.profiles p
  left join public.offices   o on o.id = p.office_id
  left join public.barangays b on b.id = p.barangay_id;

comment on view public.profiles_with_scope is 'profiles with office_name / barangay_name resolved. Inherits the RLS of the underlying tables.';

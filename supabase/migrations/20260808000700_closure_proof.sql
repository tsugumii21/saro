-- SARO 16 — accountable closure, enforced in Postgres.
--
-- Two rules the admin UI must obey, written here rather than only there:
--
--   1. A report cannot become 'resolved' without proof. What counts as proof
--      depends on the category: a pothole gets a photograph, a medical call
--      gets a reason code and a reference, because there is nothing
--      photographable about an ambulance that already left.
--
--   2. An official cannot set closed_confirmed, closed_unconfirmed or
--      reopened. Those three belong to the resident and to the timer. An
--      office that could set closed_confirmed itself could manufacture the
--      appearance of a satisfied resident, which would empty the
--      confirmed/unconfirmed split of the only meaning it has.
--
-- Both are triggers, not client checks. The admin app enforces them too, for a
-- decent error message — but a rule that only exists in a React component is a
-- rule that stops existing the moment anyone touches the table another way.

-- ── Which proof a category needs ────────────────────────────────────────────

create type public.resolution_proof as enum ('photo', 'reference');

alter table public.routing_table
  add column if not exists resolution_proof public.resolution_proof not null default 'photo';

comment on column public.routing_table.resolution_proof is
  'What an office must supply to mark this category resolved: a photograph, or a reason code plus a reference.';

-- Photo is the default because most of SARO is physical hazards, and a photo is
-- the strongest evidence available: it is timestamped, it shows the actual
-- location, and a resident disputing the closure can see the same thing the
-- office saw. These are the categories where that is impossible rather than
-- merely inconvenient — the subject has left, or photographing it would be an
-- intrusion on someone having the worst day of their life.
update public.routing_table
   set resolution_proof = 'reference'
 where category in ('medical', 'accident', 'crime', 'emergency_unspecified');

-- ── The reason codes ────────────────────────────────────────────────────────

create type public.resolution_reason as enum (
  'turned_over_to_unit',      -- handed to BFP / PNP / ambulance on scene
  'referred_to_office',       -- not ours; sent elsewhere
  'patient_transported',      -- taken to a facility
  'attended_no_action',       -- attended, nothing further needed
  'could_not_locate',         -- nobody at the scene, or the scene was not findable
  'false_alarm',              -- attended, nothing was happening
  'duplicate'                 -- the same incident as another report
);

alter table public.reports
  add column if not exists resolution_reason public.resolution_reason,
  add column if not exists resolution_reference text;

comment on column public.reports.resolution_reason is
  'Why a non-photographable report was closed. Countable across offices, unlike free text.';
comment on column public.reports.resolution_reference is
  'The specifics a code cannot hold: dispatch number, blotter entry, receiving unit, time. Required alongside the code.';

-- ── Enforcement ─────────────────────────────────────────────────────────────

create or replace function public.enforce_resolution_proof()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  required public.resolution_proof;
  photo_count integer;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Resident- and timer-owned states. An official reaching these through the
  -- API is either a bug or an attempt to fake a resident's answer; both should
  -- fail loudly. auth.uid() is null for the timer sweep and for the resident
  -- RPCs, which run as SECURITY DEFINER — that is how those legitimate paths
  -- are told apart from a staff session.
  if new.status in ('closed_confirmed', 'closed_unconfirmed', 'reopened')
     and auth.uid() is not null
     and public.auth_role() in ('admin', 'office', 'barangay_official') then
    raise exception 'Only the resident or the auto-close timer can set %', new.status
      using hint = 'Confirmation and reopening belong to the person who filed the report.';
  end if;

  if new.status <> 'resolved' then
    return new;
  end if;

  select rt.resolution_proof into required
  from public.routing_table rt
  where rt.category = new.category;

  required := coalesce(required, 'photo');

  if required = 'photo' then
    select count(*) into photo_count
    from public.report_media m
    where m.report_id = new.id and m.kind = 'resolution';

    if photo_count = 0 then
      raise exception 'A resolution photo is required to resolve this report'
        using hint = 'Attach a photo of the completed work before marking it resolved.';
    end if;

    return new;
  end if;

  -- reference: both halves, and the note has to be a real one. A single
  -- character satisfies "not null" while carrying nothing, so there is a floor.
  if new.resolution_reason is null then
    raise exception 'A reason code is required to resolve this report'
      using hint = 'Choose the reason that matches what actually happened.';
  end if;

  if length(btrim(coalesce(new.resolution_reference, ''))) < 4 then
    raise exception 'A reference number or note is required to resolve this report'
      using hint = 'Give the dispatch number, blotter entry, or receiving unit.';
  end if;

  return new;
end;
$$;

create trigger reports_enforce_resolution_proof
  before update of status on public.reports
  for each row execute function public.enforce_resolution_proof();

comment on function public.enforce_resolution_proof is
  'Blocks resolution without proof, and blocks officials from setting the resident-owned closure states.';

-- ── Resolution detail on the timeline ───────────────────────────────────────
--
-- The history row for a resolution should carry the reason, so the audit trail
-- explains itself without a join back to the report.
create or replace function public.record_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  detail text;
begin
  if tg_op = 'INSERT' then
    insert into public.report_status_history (report_id, from_status, status, changed_by, note)
    values (new.id, null, new.status, auth.uid(), 'Report submitted.');
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'resolved' and new.resolution_reason is not null then
      detail := 'Closed as ' || replace(new.resolution_reason::text, '_', ' ')
              || '. Ref: ' || coalesce(new.resolution_reference, '—');
    end if;

    insert into public.report_status_history (report_id, from_status, status, changed_by, note)
    values (new.id, old.status, new.status, auth.uid(), detail);

    if new.status = 'resolved' and new.resolved_at is null then
      new.resolved_at := now();
    end if;
  end if;

  return new;
end;
$$;

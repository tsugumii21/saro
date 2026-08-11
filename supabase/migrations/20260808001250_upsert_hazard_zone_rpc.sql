-- SARO 19 — the loader RPC for hazard_zones.
-- Renumbered to avoid colliding with remove_proxy_reporting on remote.
-- PostgREST will not cast a GeoJSON object to `geography` on the way in, so a
-- plain insert cannot carry geometry. This function takes the GeoJSON as text
-- and does the conversion server-side.
--
-- Not granted to anon or authenticated. It is called by
-- supabase/scripts/seed-hazard-zones.mjs with the service role, which bypasses
-- RLS anyway; leaving it reachable would hand anyone with the publishable key
-- the ability to redraw the danger zones that decide report priority.
--
-- (Reachable-by-default is the trap migration 12 documents: `revoke ... from
-- public` does not remove Supabase's explicit default grants to anon and
-- authenticated. Both are named here.)

create or replace function public.upsert_hazard_zone(
  p_kind         public.hazard_kind,
  p_code         text,
  p_label        text,
  p_severity     smallint,
  p_is_active    boolean,
  p_is_derived   boolean,
  p_geojson      text,
  p_source       text,
  p_source_url   text default null,
  p_notes        text default null,
  p_retrieved_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.hazard_zones
    (kind, code, label, severity, is_active, is_derived, geom,
     source, source_url, notes, retrieved_at)
  values (
    p_kind, p_code, p_label, p_severity, p_is_active, p_is_derived,
    -- ST_Force2D because a stray Z coordinate from an upstream export makes the
    -- geography cast fail with an unhelpful dimension error.
    extensions.st_multi(
      extensions.st_force2d(extensions.st_geomfromgeojson(p_geojson))
    )::extensions.geography,
    p_source, p_source_url, p_notes, p_retrieved_at
  )
  on conflict (code) do update
    set kind         = excluded.kind,
        label        = excluded.label,
        severity     = excluded.severity,
        is_active    = excluded.is_active,
        is_derived   = excluded.is_derived,
        geom         = excluded.geom,
        source       = excluded.source,
        source_url   = excluded.source_url,
        notes        = excluded.notes,
        retrieved_at = excluded.retrieved_at;
end;
$$;

comment on function public.upsert_hazard_zone is
  'Loads a hazard polygon from GeoJSON text. Service role only — these polygons decide report priority.';

revoke all on function public.upsert_hazard_zone(
  public.hazard_kind, text, text, smallint, boolean, boolean, text, text, text, text, timestamptz
) from public, anon, authenticated;

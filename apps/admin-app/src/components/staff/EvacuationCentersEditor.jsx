import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Save, X, Building2, Crosshair, MapPin, Minus, Users, Clock3, LocateFixed,
} from "lucide-react";
import { HazardMap } from "@saro/ui";
import {
  getEvacuationCenters, getBarangays, setEvacuationOccupancy, supabase, useAuth,
} from "@saro/shared";

/**
 * The shelter registry, and the one number on it that moves.
 *
 * Two jobs live here and they belong to different people on different days:
 *
 *   Registry     name, address, coordinates, capacity. Edited rarely, by the
 *                city, and getting a coordinate wrong sends evacuees to the
 *                wrong street — so the position is placed on a map rather than
 *                typed as two decimals into number fields.
 *
 *   Headcount    how many people are inside right now. Edited hourly, during a
 *                typhoon, often by a barangay official standing in the doorway.
 *                It needs to be two taps and it needs to say when it was last
 *                touched, because "150 of 800" with no timestamp is a number
 *                nobody can act on.
 *
 * Postgres enforces the split (`set_evacuation_occupancy`): a barangay official
 * may change the count and the open/full state of a shelter in their barangay
 * and nothing else about it.
 */

const BLANK = {
  name: "",
  address: "",
  barangay_id: "",
  lat: 13.1391,
  lng: 123.7438,
  capacity: 500,
  current_occupancy: 0,
  status: "ready",
  notes: "",
};

/* Status is a fact about the shelter, so it gets the colour that fact deserves.
   Every row used to be painted emerald regardless of state, which meant a full
   or closed shelter read as available at a glance — the exact misreading that
   sends a family to a locked gate. */
const STATUS_STYLES = {
  ready: {
    label: "Ready / standby",
    className: "border-status-resolved-tab bg-status-resolved-wash text-status-resolved-ink",
  },
  open: {
    label: "Open / accepting",
    className: "border-status-progress-tab bg-status-progress-wash text-status-progress-ink",
  },
  full: {
    label: "Full",
    className: "border-status-assigned-tab bg-status-assigned-wash text-status-assigned-ink",
  },
  closed: {
    label: "Closed",
    className: "border-status-closed-tab bg-status-closed-wash text-status-closed-ink",
  },
};

function statusStyle(status) {
  return STATUS_STYLES[status] ?? STATUS_STYLES.ready;
}

function sinceLabel(iso) {
  if (!iso) return "never updated";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (Number.isNaN(minutes)) return "never updated";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function EvacuationCentersEditor() {
  const { viewerScope, isAdmin, isOffice, barangayName } = useAuth();

  const [centers, setCenters] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [busyOccupancyId, setBusyOccupancyId] = useState("");
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);

  const canEditRegistry = isAdmin || isOffice;

  const load = useCallback(async () => {
    const [cRes, bRes] = await Promise.all([getEvacuationCenters(), getBarangays()]);
    if (cRes.data) setCenters(cRes.data);
    if (bRes.data) setBarangays(bRes.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const barangayName_ = useMemo(
    () => Object.fromEntries(barangays.map((b) => [b.id, b.name])),
    [barangays]
  );

  /* A barangay official gets their own shelters first and the rest below,
     rather than a filtered list: knowing the city's other shelters exist is
     useful when yours is full and you are sending families somewhere. */
  const { mine, others } = useMemo(() => {
    if (viewerScope?.role !== "barangay_official" || !viewerScope.barangayId) {
      return { mine: [], others: centers };
    }
    return {
      mine: centers.filter((c) => String(c.barangay_id) === String(viewerScope.barangayId)),
      others: centers.filter((c) => String(c.barangay_id) !== String(viewerScope.barangayId)),
    };
  }, [centers, viewerScope]);

  const canUpdateOccupancy = useCallback(
    (center) => {
      if (isAdmin || isOffice) return true;
      if (viewerScope?.role !== "barangay_official") return false;
      return Boolean(
        viewerScope.barangayId && String(center.barangay_id) === String(viewerScope.barangayId)
      );
    },
    [isAdmin, isOffice, viewerScope]
  );

  const handleEdit = (c) => {
    setEditingId(c.id);
    setDraft({ ...BLANK, ...c, barangay_id: c.barangay_id ?? "" });
    setError("");
  };

  const handleNew = () => {
    setEditingId("__new__");
    setDraft(BLANK);
    setError("");
  };

  /* "I am standing in it." The single most accurate way to place a shelter, and
     the reason this screen is worth opening on a phone at all. */
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      return setError("This device cannot report its location.");
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setDraft((prev) => ({
          ...prev,
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
        }));
      },
      () => {
        setLocating(false);
        setError("Could not read this device's location. Place the pin on the map instead.");
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!draft.name.trim() || !draft.address.trim()) {
      return setError("Name and Address are required.");
    }
    setBusy(true);
    setError("");

    const payload = {
      name: draft.name.trim(),
      address: draft.address.trim(),
      barangay_id: draft.barangay_id || null,
      lat: Number(draft.lat),
      lng: Number(draft.lng),
      capacity: Number(draft.capacity),
      current_occupancy: Number(draft.current_occupancy || 0),
      status: draft.status || "ready",
      notes: draft.notes || "",
    };

    const { error: writeError } =
      editingId === "__new__"
        ? await supabase.from("evacuation_centers").insert(payload)
        : await supabase.from("evacuation_centers").update(payload).eq("id", editingId);

    setBusy(false);
    if (writeError) return setError(writeError.message);

    setEditingId(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to remove this evacuation center?")) return;
    setBusy(true);
    await supabase.from("evacuation_centers").delete().eq("id", id);
    setBusy(false);
    load();
  };

  /* The headcount write. Deliberately optimistic-free: an evacuation is not the
     place to show a number that might not have landed. */
  const adjustOccupancy = async (center, nextValue, nextStatus) => {
    const value = Math.max(0, Number(nextValue));
    setBusyOccupancyId(center.id);
    setError("");
    const { data, error: writeError } = await setEvacuationOccupancy(center.id, value, nextStatus);
    setBusyOccupancyId("");
    if (writeError) return setError(writeError);
    if (data) {
      setCenters((prev) => prev.map((item) => (item.id === center.id ? { ...item, ...data } : item)));
    }
  };

  const renderCenterRow = (center) => {
    const occupancy = Number(center.current_occupancy ?? 0);
    const capacity = Number(center.capacity ?? 0);
    const share = capacity > 0 ? Math.min(1, occupancy / capacity) : 0;
    const editable = canUpdateOccupancy(center);
    const style = statusStyle(center.status);

    return (
      <li key={center.id} className="border-b border-line p-4 last:border-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
              <span className="truncate text-sm font-bold text-ink">{center.name}</span>
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                {center.address}
              </span>
              {center.barangay_id && barangayName_[center.barangay_id] && (
                <span className="rounded border border-line bg-sunken px-1.5 py-px font-mono text-[10px] font-bold">
                  Brgy. {barangayName_[center.barangay_id]}
                </span>
              )}
            </p>
          </div>

          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${style.className}`}>
            {style.label}
          </span>
        </div>

        {/* Occupancy: the number, when it was taken, and the two taps that change it. */}
        <div className="mt-3 rounded border border-line bg-sunken p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="flex items-baseline gap-1.5 font-mono text-lg font-bold tabular-nums text-ink">
                {occupancy}
                <span className="text-xs font-semibold text-ink-muted">of {capacity} places</span>
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-faint">
                <Clock3 className="h-3 w-3" aria-hidden="true" />
                Headcount {sinceLabel(center.occupancy_updated_at)}
              </span>
            </div>

            {editable ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => adjustOccupancy(center, occupancy - 10)}
                  disabled={busyOccupancyId === center.id || occupancy === 0}
                  className="saro-btn saro-btn-secondary saro-btn-sm"
                  aria-label={`Reduce headcount at ${center.name} by 10`}
                >
                  <Minus className="h-3.5 w-3.5" />
                  10
                </button>
                <input
                  type="number"
                  min="0"
                  value={occupancy}
                  onChange={(e) => adjustOccupancy(center, e.target.value)}
                  className="saro-field w-24 text-center text-xs font-bold"
                  aria-label={`Headcount at ${center.name}`}
                />
                <button
                  type="button"
                  onClick={() => adjustOccupancy(center, occupancy + 10)}
                  disabled={busyOccupancyId === center.id}
                  className="saro-btn saro-btn-secondary saro-btn-sm"
                  aria-label={`Add 10 to the headcount at ${center.name}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                  10
                </button>
                <select
                  value={center.status ?? "ready"}
                  onChange={(e) => adjustOccupancy(center, occupancy, e.target.value)}
                  className="saro-field text-xs"
                  aria-label={`Status of ${center.name}`}
                >
                  {Object.entries(STATUS_STYLES).map(([value, item]) => (
                    <option key={value} value={value}>{item.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <span className="text-[11px] text-ink-faint">
                Headcount is kept by the barangay holding this shelter.
              </span>
            )}
          </div>

          {/* Over capacity is shown, not hidden: a shelter holding more people
              than it was built for is the fact the city most needs to see. */}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(2, share * 100)}%`,
                background:
                  occupancy > capacity
                    ? "var(--color-alert)"
                    : share > 0.85
                    ? "var(--color-status-assigned-tab)"
                    : "var(--color-status-progress-tab)",
              }}
            />
          </div>
          {occupancy > capacity && (
            <p className="mt-1.5 text-[11px] font-bold text-alert">
              {occupancy - capacity} people over the designed capacity.
            </p>
          )}
        </div>

        {canEditRegistry && (
          <div className="mt-2 flex justify-end gap-3 text-xs">
            <button type="button" onClick={() => handleEdit(center)} className="font-bold text-brand hover:underline">
              Edit details
            </button>
            {isAdmin && (
              <button type="button" onClick={() => handleDelete(center.id)} className="font-bold text-alert hover:underline">
                Remove
              </button>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-4 font-sans">
      <div className="saro-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <h1 className="t-heading">Evacuation Centers</h1>
          <p className="t-body-sm text-ink-muted">
            {viewerScope?.role === "barangay_official"
              ? `Headcounts for ${barangayName ? `Brgy. ${barangayName}` : "your barangay"}, and the city's other shelters for reference.`
              : "Shelter registry, capacity, and live occupancy across Legazpi City."}
          </p>
        </div>
        {canEditRegistry && (
          <button type="button" onClick={handleNew} className="saro-btn saro-btn-primary text-xs font-bold">
            <Plus className="h-3.5 w-3.5" />
            Add evacuation center
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-xs border border-alert bg-alert-wash p-2.5 text-xs text-alert">
          {error}
        </p>
      )}

      {editingId && canEditRegistry && (
        <form onSubmit={handleSave} className="saro-card space-y-3 p-4">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <span className="t-label text-xs font-bold uppercase tracking-wider text-brand">
              {editingId === "__new__" ? "New evacuation center" : "Edit shelter details"}
            </span>
            <button type="button" onClick={() => setEditingId(null)} className="text-ink-muted hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-ink-muted">Center name</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="saro-field w-full text-xs"
                placeholder="Legazpi City Evacuation Center"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-ink-muted">Address</label>
              <input
                type="text"
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                className="saro-field w-full text-xs"
                placeholder="Bitano, Legazpi City"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-ink-muted">Barangay</label>
              <select
                value={draft.barangay_id ?? ""}
                onChange={(e) => setDraft({ ...draft, barangay_id: e.target.value })}
                className="saro-field w-full text-xs"
              >
                <option value="">Not assigned to a barangay</option>
                {barangays.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <p className="mt-1 text-[10px] leading-tight text-ink-faint">
                Decides which barangay officials can keep this shelter's headcount.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-ink-muted">Max capacity (persons)</label>
              <input
                type="number"
                value={draft.capacity}
                onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
                className="saro-field w-full text-xs"
              />
            </div>
          </div>

          {/* The position, placed rather than typed. Two decimal fields asked
              somebody to transcribe coordinates correctly under pressure; this
              asks them to point at a building. */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-[10px] font-bold uppercase text-ink-muted">
                Where the shelter is
              </label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-ink-muted">
                  {Number(draft.lat).toFixed(5)}, {Number(draft.lng).toFixed(5)}
                </span>
                <button
                  type="button"
                  onClick={useMyLocation}
                  disabled={locating}
                  className="saro-btn saro-btn-secondary saro-btn-sm text-[11px]"
                >
                  <LocateFixed className="h-3.5 w-3.5" />
                  {locating ? "Locating…" : "Use my location"}
                </button>
              </div>
            </div>

            <div className="h-64 overflow-hidden rounded border border-line">
              <HazardMap
                className="h-full w-full"
                center={[Number(draft.lng), Number(draft.lat)]}
                zoom={16}
                picked={{ lat: Number(draft.lat), lng: Number(draft.lng) }}
                onPick={({ lat, lng }) =>
                  setDraft((prev) => ({
                    ...prev,
                    lat: Number(lat.toFixed(6)),
                    lng: Number(lng.toFixed(6)),
                  }))
                }
                showToggles={false}
              />
            </div>
            <p className="flex items-center gap-1.5 text-[10px] text-ink-faint">
              <Crosshair className="h-3 w-3" aria-hidden="true" />
              Tap the map to move the pin. The hazard layers stay visible, so a shelter inside a
              lahar corridor is obvious before it is saved.
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-2">
            <button type="button" onClick={() => setEditingId(null)} className="saro-btn saro-btn-ghost text-xs">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="saro-btn saro-btn-primary text-xs font-bold">
              <Save className="h-3.5 w-3.5" />
              {busy ? "Saving…" : "Save evacuation center"}
            </button>
          </div>
        </form>
      )}

      {mine.length > 0 && (
        <section className="saro-card overflow-hidden">
          <header className="flex items-center gap-2 border-b border-line bg-raised px-4 py-2.5">
            <Users className="h-4 w-4 text-brand" aria-hidden="true" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
              Shelters in your barangay
            </h2>
          </header>
          <ul>{mine.map(renderCenterRow)}</ul>
        </section>
      )}

      <section className="saro-card overflow-hidden">
        <header className="border-b border-line bg-raised px-4 py-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
            {mine.length > 0 ? "Other shelters in the city" : "All shelters"}
          </h2>
        </header>
        {others.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-ink-muted">No shelters on record yet.</p>
        ) : (
          <ul>{others.map(renderCenterRow)}</ul>
        )}
      </section>
    </div>
  );
}

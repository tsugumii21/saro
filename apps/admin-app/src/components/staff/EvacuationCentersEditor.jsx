import { useState, useEffect, useCallback } from "react";
import { Plus, Save, X, Building2 } from "lucide-react";
import { getEvacuationCenters, supabase } from "@saro/shared";

const BLANK = {
  name: "",
  address: "",
  lat: 13.1391,
  lng: 123.7438,
  capacity: 500,
  current_occupancy: 0,
  status: "ready",
  notes: "",
};

export default function EvacuationCentersEditor() {
  const [centers, setCenters] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await getEvacuationCenters();
    if (data) setCenters(data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleEdit = (c) => {
    setEditingId(c.id);
    setDraft({ ...c });
    setError("");
  };

  const handleNew = () => {
    setEditingId("__new__");
    setDraft(BLANK);
    setError("");
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!draft.name.trim() || !draft.address.trim()) {
      return setError("Name and Address are required.");
    }
    setBusy(true);
    setError("");

    if (editingId === "__new__") {
      const { error: insertErr } = await supabase.from("evacuation_centers").insert({
        name: draft.name.trim(),
        address: draft.address.trim(),
        lat: Number(draft.lat),
        lng: Number(draft.lng),
        capacity: Number(draft.capacity),
        current_occupancy: Number(draft.current_occupancy || 0),
        status: draft.status || "ready",
        notes: draft.notes || "",
      });
      setBusy(false);
      if (insertErr) return setError(insertErr.message);
    } else {
      const { error: updateErr } = await supabase
        .from("evacuation_centers")
        .update({
          name: draft.name.trim(),
          address: draft.address.trim(),
          lat: Number(draft.lat),
          lng: Number(draft.lng),
          capacity: Number(draft.capacity),
          current_occupancy: Number(draft.current_occupancy || 0),
          status: draft.status || "ready",
          notes: draft.notes || "",
        })
        .eq("id", editingId);
      setBusy(false);
      if (updateErr) return setError(updateErr.message);
    }

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

  return (
    <div className="space-y-4 font-sans p-4 bg-white rounded-lg border border-line">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-ink">Evacuation Centers Registry</h2>
          <p className="text-xs text-ink-muted">
            Manage official Legazpi DRRM shelter locations, capacity limits, and current status.
          </p>
        </div>
        <button
          type="button"
          onClick={handleNew}
          className="saro-btn saro-btn-primary text-xs font-bold flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Evacuation Center
        </button>
      </div>

      {error && (
        <p className="text-xs text-alert bg-alert-wash border border-alert p-2.5 rounded-xs">
          {error}
        </p>
      )}

      {editingId && (
        <form onSubmit={handleSave} className="p-4 bg-surface border border-brand/30 rounded-md shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <span className="t-label font-bold text-brand uppercase tracking-wider text-xs">
              {editingId === "__new__" ? "New Evacuation Center" : "Edit Shelter Details"}
            </span>
            <button type="button" onClick={() => setEditingId(null)} className="text-ink-muted hover:text-ink">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase text-ink-muted mb-1">Center Name</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="saro-field text-xs w-full"
                placeholder="Legazpi City Evacuation Center"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-ink-muted mb-1">Address / Location</label>
              <input
                type="text"
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                className="saro-field text-xs w-full"
                placeholder="Bitano, Legazpi City"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-ink-muted mb-1">Latitude</label>
              <input
                type="number"
                step="any"
                value={draft.lat}
                onChange={(e) => setDraft({ ...draft, lat: e.target.value })}
                className="saro-field text-xs w-full"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-ink-muted mb-1">Longitude</label>
              <input
                type="number"
                step="any"
                value={draft.lng}
                onChange={(e) => setDraft({ ...draft, lng: e.target.value })}
                className="saro-field text-xs w-full"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-ink-muted mb-1">Max Capacity (persons)</label>
              <input
                type="number"
                value={draft.capacity}
                onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
                className="saro-field text-xs w-full"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-ink-muted mb-1">Status</label>
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                className="saro-field text-xs w-full"
              >
                <option value="ready">Ready / Standby</option>
                <option value="open">Active / Open</option>
                <option value="full">Full / Max Capacity</option>
                <option value="closed">Inactive / Closed</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <button type="button" onClick={() => setEditingId(null)} className="saro-btn saro-btn-ghost text-xs">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="saro-btn saro-btn-primary text-xs font-bold">
              <Save className="w-3.5 h-3.5" />
              {busy ? "Saving…" : "Save Evacuation Center"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto border border-line rounded-md bg-white">
        <table className="w-full text-xs text-left">
          <thead className="bg-raised border-b border-line text-ink-faint font-bold uppercase text-[10px]">
            <tr>
              <th className="p-3">Shelter Name</th>
              <th className="p-3">Address</th>
              <th className="p-3">Capacity</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {centers.map((c) => (
              <tr key={c.id} className="hover:bg-sunken/50">
                <td className="p-3 font-semibold text-ink flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>{c.name}</span>
                </td>
                <td className="p-3 text-ink-muted">{c.address}</td>
                <td className="p-3 font-mono font-bold text-ink">{c.capacity} pax</td>
                <td className="p-3">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 capitalize">
                    {c.status}
                  </span>
                </td>
                <td className="p-3 text-right space-x-2">
                  <button type="button" onClick={() => handleEdit(c)} className="text-brand font-bold hover:underline">Edit</button>
                  <button type="button" onClick={() => handleDelete(c.id)} className="text-alert font-bold hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

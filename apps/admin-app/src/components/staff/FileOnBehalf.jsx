import { useState, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Send, Phone, UserRound, Check } from "lucide-react";
import { TrackingCode } from "@saro/ui";
import {
  getCategories, getBarangays, createReportOnBehalf, validateReportDraft,
  useAuth, LEGAZPI_CENTER,
} from "@saro/shared";

/**
 * File on Behalf.
 *
 * For a resident standing at the barangay hall counter who has no phone, no
 * data, or no interest in installing anything. Someone at the desk files for
 * them. The report lands in the same `reports` table, gets routed by the same
 * trigger, and gets the same tracking code — the only difference is who typed
 * it.
 *
 * ── On "reuse the resident form rather than rebuilding" ──────────────────────
 *
 * What is genuinely shared is the part that matters and the part that drifts:
 * `validateReportDraft` (one definition of a valid report, used by both apps)
 * and `createReportOnBehalf` (one write path, one set of RLS rules). Both come
 * from @saro/shared.
 *
 * The COMPONENT is not shared, and should not be. The resident's form carries
 * an offline queue, background sync, silent-photo consent, an AI structuring
 * step, a login wall and a PWA install path — none of which exist at a
 * barangay desk on a wired connection. Importing it here would mean either
 * dragging that machinery into the admin bundle or threading a dozen flags
 * through it until neither app's version is legible. The two forms serve two
 * different moments and are allowed to differ; the rules they enforce are not.
 *
 * ── On authorization ────────────────────────────────────────────────────────
 *
 * The button is hidden for roles that may not use it, but hiding is not the
 * control. `createReportOnBehalf` writes with `is_proxy_report` and `filed_by`
 * set, and the RLS insert policy admits it only for admin and
 * barangay_official. An office role calling this API directly gets a policy
 * violation, not a report.
 */

const pin = L.divIcon({
  className: "",
  html: `<div style="width:20px;height:20px;background:#1B2E6B;border:2px solid #fff;box-shadow:0 1px 4px rgba(16,23,37,.4)"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function PickPoint({ onPick }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

export default function FileOnBehalf() {
  const { isAdmin, isBarangayOfficial, barangayId, barangayName, profile } = useAuth();

  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [coords, setCoords] = useState(null);
  const [selectedBarangay, setSelectedBarangay] = useState("");
  const [callbackNumber, setCallbackNumber] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [filed, setFiled] = useState(null);

  const load = useCallback(async () => {
    const [c, b] = await Promise.all([getCategories(), getBarangays()]);
    if (c.data) setCategories(c.data);
    if (b.data) setBarangays(b.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  // A barangay official files inside their own barangay; the field is fixed
  // rather than merely defaulted, because RLS will reject anything else and a
  // dropdown that offers rejected options is a trap.
  useEffect(() => {
    if (isBarangayOfficial && barangayId) setSelectedBarangay(barangayId);
  }, [isBarangayOfficial, barangayId]);

  if (!isAdmin && !isBarangayOfficial) {
    return (
      <p className="saro-card p-6 t-body-sm text-ink-muted">
        Filing on behalf of a resident is available to barangay officials and the city
        administrator. Your office receives these reports the same way it receives any other.
      </p>
    );
  }

  const reset = () => {
    setFiled(null);
    setCategoryId("");
    setDescription("");
    setCoords(null);
    setCallbackNumber("");
    setErrors({});
    setSubmitError("");
    if (!isBarangayOfficial) setSelectedBarangay("");
  };

  const submit = async (e) => {
    e.preventDefault();

    // The same validator the resident app runs. One definition of "a valid
    // report", so a desk-filed report can never be weaker than a self-filed one.
    const found = validateReportDraft({
      categoryId, coords, description, isProxy: true, callbackNumber,
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setSubmitError("");

    const { data, error } = await createReportOnBehalf({
      category: categoryId,
      description: description.trim(),
      lat: coords.lat,
      lng: coords.lng,
      barangay_id: selectedBarangay || null,
      callback_number: callbackNumber.trim() || null,
    });

    setBusy(false);
    if (error) return setSubmitError(error);
    setFiled(data);
  };

  if (filed) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="saro-clip saro-card p-6">
          <span className="saro-stamp">Filed on behalf</span>
          <p className="t-body mt-3 text-ink-muted">
            Give this code to the resident. It is the only thing they need to check what happens
            next — no account, no app.
          </p>

          <div className="mt-5 border-t border-rule pt-5">
            <span className="t-label text-ink-faint">Tracking code</span>
            <div className="mt-2">
              <TrackingCode code={filed.tracking_code} size="xl" />
            </div>
          </div>

          <p className="t-body-sm mt-4 flex items-start gap-2 text-ink-faint">
            <Check width={14} height={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            Recorded as filed by {profile?.full_name ?? "you"}. Staff can see it was desk-filed
            rather than reported directly.
          </p>

          <button onClick={reset} className="saro-btn saro-btn-primary saro-btn-block mt-6">
            File another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="t-heading">File on behalf of a resident</h1>
        <p className="t-body-sm mt-1 text-ink-muted">
          For someone reporting in person. It enters the same queue as any other report and
          gets the same tracking code.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="t-label text-ink-faint">What is being reported *</span>
            <select
              value={categoryId}
              onChange={(e) => { setCategoryId(e.target.value); setErrors((p) => ({ ...p, category: "" })); }}
              className="saro-field mt-1.5 w-full"
              aria-invalid={Boolean(errors.category)}
            >
              <option value="">Choose a category…</option>
              {categories.map((c) => (
                <option key={c.id ?? c.category} value={c.id ?? c.category}>
                  {c.name ?? c.label}{c.is_emergency ? " · emergency" : ""}
                </option>
              ))}
            </select>
            {errors.category && <span className="t-body-sm mt-1 block text-alert">{errors.category}</span>}
          </label>

          <label className="block">
            <span className="t-label text-ink-faint">What they told you *</span>
            <textarea
              rows={5}
              value={description}
              onChange={(e) => { setDescription(e.target.value); setErrors((p) => ({ ...p, description: "" })); }}
              placeholder="Write what the resident described, in their words where you can."
              className="saro-field mt-1.5 w-full resize-none"
              aria-invalid={Boolean(errors.description)}
            />
            {errors.description && <span className="t-body-sm mt-1 block text-alert">{errors.description}</span>}
          </label>

          <label className="block">
            <span className="t-label text-ink-faint">Barangay</span>
            {isBarangayOfficial ? (
              <p className="t-body mt-1.5 border border-line bg-sunken px-3 py-2.5">
                {barangayName}
                <span className="t-body-sm ml-2 text-ink-faint">— your barangay</span>
              </p>
            ) : (
              <select
                value={selectedBarangay}
                onChange={(e) => setSelectedBarangay(e.target.value)}
                className="saro-field mt-1.5 w-full"
              >
                <option value="">Detect from the map pin</option>
                {barangays.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
          </label>

          <label className="block">
            <span className="t-label flex items-center gap-1.5 text-ink-faint">
              <Phone width={12} height={12} aria-hidden="true" />
              Their callback number *
            </span>
            <input
              value={callbackNumber}
              onChange={(e) => { setCallbackNumber(e.target.value); setErrors((p) => ({ ...p, callbackNumber: "" })); }}
              placeholder="09XX XXX XXXX"
              inputMode="tel"
              className="saro-field mt-1.5 w-full"
              aria-invalid={Boolean(errors.callbackNumber)}
            />
            <span className="t-body-sm mt-1 block text-ink-faint">
              Required when filing for someone else — they have no app to be notified through,
              so a number is the only way the office can reach them.
            </span>
            {errors.callbackNumber && (
              <span className="t-body-sm mt-1 block text-alert">{errors.callbackNumber}</span>
            )}
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="t-label text-ink-faint">Where it is *</span>
          <div className="saro-card h-[380px] overflow-hidden">
            <MapContainer center={LEGAZPI_CENTER} zoom={13} scrollWheelZoom className="h-full w-full">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              />
              <PickPoint onPick={(p) => { setCoords(p); setErrors((prev) => ({ ...prev, coords: "" })); }} />
              {coords && <Marker position={[coords.lat, coords.lng]} icon={pin} />}
            </MapContainer>
          </div>
          <p className="t-body-sm text-ink-muted">
            {coords
              ? `Pinned at ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
              : "Click the map where the resident says it is."}
          </p>
          {errors.coords && <p className="t-body-sm text-alert">{errors.coords}</p>}
        </div>
      </div>

      {submitError && (
        <p role="alert" className="t-body-sm border border-alert bg-alert-wash p-3 text-alert">
          {submitError}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="saro-btn saro-btn-primary saro-btn-lg">
          <Send width={16} height={16} />
          {busy ? "Filing…" : "File this report"}
        </button>
        <span className="t-body-sm flex items-center gap-1.5 text-ink-faint">
          <UserRound width={13} height={13} aria-hidden="true" />
          Recorded as filed by {profile?.full_name ?? "you"}
        </span>
      </div>
    </form>
  );
}

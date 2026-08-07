import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import {
  X, Upload, Flag, Search, Check, MapPin, Phone, Clock, ShieldCheck, UserRound, Layers,
} from "lucide-react";
import {
  getReports, getCategories, getBarangays, getOffices,
  updateReportStatus, addReportMedia, markFalseReport, saroEvents,
  useAuth, LEGAZPI_CENTER, STATUS_PIPELINE,
} from "@saro/shared";
import { StatusTag, TrackingCode, statusTab } from "@saro/ui";
import QueueTable from "./QueueTable";

/**
 * Dispatch — the rack and the card.
 *
 * The old dashboard offered three layout modes (split / table / map), a sort
 * control, a page-size control and pagination, which meant no single layout
 * had been designed properly and a dispatcher had to configure the tool before
 * using it. All of that is gone.
 *
 * What replaced it is one structure: a rack ordered by time pressure, and a
 * detail panel that opens beside it when you pull a card. The map lives inside
 * that panel, because a dispatcher needs the location of the incident they are
 * working — not a second competing view of every incident at once.
 *
 * Sorting is not a control any more either. Triage order is the product's
 * opinion, and making it configurable is how the most urgent report ends up on
 * page three.
 */

const POLL_INTERVAL = 30_000;

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1280;
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
          if (width > height) { height = Math.round((height * maxSide) / width); width = maxSide; }
          else { width = Math.round((width * maxSide) / height); height = maxSide; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const pin = (color) =>
  L.divIcon({
    className: "saro-marker",
    html: `<div style="width:16px;height:16px;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(16,23,37,.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

function Recenter({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    if (lat && lng) map.setView([lat, lng], 16, { animate: false });
    const t = setTimeout(() => map.invalidateSize(), 80);
    return () => clearTimeout(t);
  }, [lat, lng, map]);
  return null;
}

/** One number and its noun. Four of these replace the old eight-tile KPI grid. */
function Count({ label, value, tone }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-2.5" style={{ borderLeft: `3px solid ${tone}` }}>
      <span className="t-code" style={{ fontSize: 20, lineHeight: "24px", color: "var(--color-ink)" }}>
        {value}
      </span>
      <span className="t-micro text-ink-faint">{label}</span>
    </div>
  );
}

export default function ResponderDashboard() {
  const { officeName, isAdmin, isBarangayOfficial, barangayName } = useAuth();

  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [offices, setOffices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [resolvePhoto, setResolvePhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const fileRef = useRef(null);

  const loadData = useCallback(async () => {
    const [r, c, b, o] = await Promise.all([
      getReports(), getCategories(), getBarangays(), getOffices(),
    ]);
    if (r.data) setReports(r.data);
    if (c.data) setCategories(c.data);
    if (b.data) setBarangays(b.data);
    if (o.data) setOffices(o.data);
  }, []);

  useEffect(() => {
    loadData();
    const u1 = saroEvents.on("report:created", loadData);
    const u2 = saroEvents.on("report:updated", loadData);
    return () => { u1(); u2(); };
  }, [loadData]);

  useEffect(() => {
    const t = setInterval(loadData, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [loadData]);

  const catBy = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id ?? c.category, c])),
    [categories]
  );
  const brgyBy = useMemo(() => Object.fromEntries(barangays.map((b) => [b.id, b])), [barangays]);
  const officeBy = useMemo(() => Object.fromEntries(offices.map((o) => [o.id, o])), [offices]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      const cat = catBy[r.category_id ?? r.category];
      return (
        r.tracking_code.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        (cat?.name || "").toLowerCase().includes(q) ||
        (brgyBy[r.barangay_id]?.name || "").toLowerCase().includes(q)
      );
    });
  }, [reports, query, statusFilter, catBy, brgyBy]);

  // A minute clock. SLA countdowns have to keep moving while a dispatcher sits
  // on this screen, and reading Date.now() during render makes the component
  // impure — the counts would only refresh when something else happened to
  // re-render them.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const counts = useMemo(() => {
    const open = reports.filter((r) => r.status !== "resolved" && r.status !== "closed");
    const overdue = open.filter((r) => {
      const sla = catBy[r.category_id ?? r.category]?.sla_hours || 24;
      return (now - new Date(r.created_at).getTime()) / 3_600_000 > sla;
    });
    return {
      open: open.length,
      overdue: overdue.length,
      unclaimed: open.filter((r) => r.status === "received").length,
      today: reports.filter((r) => now - new Date(r.created_at).getTime() < 86_400_000).length,
    };
  }, [reports, catBy, now]);

  const advance = async (report) => {
    const next = STATUS_PIPELINE[STATUS_PIPELINE.indexOf(report.status) + 1];
    if (!next) return;
    setBusy(true); setActionError("");
    const { error } = await updateReportStatus(report.id, next, `Advanced to ${next}.`);
    setBusy(false);
    if (error) return setActionError(error);
    await loadData();
    setSelected((s) => (s ? { ...s, status: next } : s));
  };

  const resolve = async (report, asFalse) => {
    if (!resolvePhoto) return setActionError("Attach a resolution photo first.");
    setBusy(true); setActionError("");
    await addReportMedia(report.id, resolvePhoto, "resolution");
    if (asFalse) await markFalseReport(report.id, true);
    const { error } = await updateReportStatus(
      report.id, "resolved",
      asFalse ? "Resolved as false report." : "Resolved with photographic evidence."
    );
    setBusy(false);
    if (error) return setActionError(error);
    setResolvePhoto(null);
    setSelected(null);
    await loadData();
  };

  const scope = isAdmin ? "City-wide" : officeName || barangayName || "Your queue";
  const sel = selected ? reports.find((r) => r.id === selected.id) || selected : null;
  const selCat = sel ? catBy[sel.category_id ?? sel.category] : null;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Scope, then the four numbers that decide the shift ────────────── */}
      <div className="saro-card flex flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div>
          <h1 className="t-heading">Dispatch</h1>
          <p className="t-body-sm text-ink-muted">
            {scope} · {filtered.length} of {reports.length} shown
          </p>
        </div>
        <div className="flex flex-wrap items-stretch">
          <Count label="Open" value={counts.open} tone="var(--color-status-progress-tab)" />
          <Count label="Overdue" value={counts.overdue} tone="var(--color-alert)" />
          <Count label="Unclaimed" value={counts.unclaimed} tone="var(--color-status-received-tab)" />
          <Count label="Last 24h" value={counts.today} tone="var(--color-line-strong)" />
        </div>
      </div>

      {/* ── One filter row. No sort control: triage order is not negotiable ── */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[240px] flex-1 items-center">
          <Search width={15} height={15} className="pointer-events-none absolute left-3 text-ink-faint" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code, description, barangay"
            className="saro-field pl-9"
            style={{ height: 36, paddingTop: 0, paddingBottom: 0 }}
            aria-label="Search the queue"
          />
        </label>

        <div className="flex items-center gap-px border border-line bg-line">
          <button
            onClick={() => setStatusFilter("")}
            className="saro-btn saro-btn-sm"
            style={{
              background: statusFilter === "" ? "var(--color-brand)" : "var(--color-surface)",
              color: statusFilter === "" ? "#fff" : "var(--color-ink-muted)",
            }}
          >
            All
          </button>
          {STATUS_PIPELINE.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
              className="saro-btn saro-btn-sm capitalize"
              style={{
                background: statusFilter === s ? "var(--color-brand)" : "var(--color-surface)",
                color: statusFilter === s ? "#fff" : "var(--color-ink-muted)",
              }}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* ── The rack, and the card you pulled from it ─────────────────────── */}
      <div
        className="grid min-h-0 flex-1 gap-4"
        style={{ gridTemplateColumns: sel ? "minmax(0,1fr) 380px" : "minmax(0,1fr)" }}
      >
        <div className="min-w-0 overflow-auto">
          <QueueTable
            reports={filtered}
            categories={categories}
            barangays={barangays}
            selectedId={sel?.id}
            onSelect={(r) => { setSelected(r); setResolvePhoto(null); setActionError(""); }}
          />
        </div>

        {sel && (
          <aside className="saro-card saro-rise flex min-h-0 flex-col overflow-hidden">
            <div
              className="flex items-start justify-between gap-3 border-b border-line px-4 py-3"
              style={{ boxShadow: `inset 0 3px 0 0 ${statusTab(sel.status)}` }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <TrackingCode code={sel.tracking_code} />
                  {sel.filed_by_verified ? (
                    <ShieldCheck width={13} height={13} className="text-status-resolved-ink" aria-label="Verified account" />
                  ) : (
                    <UserRound width={13} height={13} className="text-ink-faint" aria-label="Guest report" />
                  )}
                </div>
                <p className="t-body-sm mt-1 truncate font-semibold">{selCat?.name ?? sel.category}</p>
              </div>
              <button onClick={() => setSelected(null)} className="saro-btn saro-btn-ghost saro-btn-sm -mr-2" aria-label="Close detail">
                <X width={16} height={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="h-44 border-b border-line">
                <MapContainer
                  center={sel.lat && sel.lng ? [sel.lat, sel.lng] : LEGAZPI_CENTER}
                  zoom={16}
                  zoomControl={false}
                  attributionControl={false}
                  style={{ height: "100%", width: "100%" }}
                >
                  <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
                  {sel.lat && sel.lng && <Marker position={[sel.lat, sel.lng]} icon={pin(statusTab(sel.status))} />}
                  <Recenter lat={sel.lat} lng={sel.lng} />
                </MapContainer>
              </div>

              <div className="flex flex-col gap-4 p-4">
                <div>
                  <span className="t-label text-ink-faint">Reported</span>
                  <p className="t-body mt-1">{sel.description}</p>
                </div>

                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="t-label text-ink-faint">Status</dt>
                    <dd className="mt-1"><StatusTag status={sel.status} /></dd>
                  </div>
                  <div>
                    <dt className="t-label text-ink-faint">Office</dt>
                    <dd className="t-body-sm mt-1">{officeBy[sel.assigned_office_id]?.short_name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="t-label text-ink-faint">Barangay</dt>
                    <dd className="t-body-sm mt-1 flex items-center gap-1">
                      <MapPin width={12} height={12} className="text-ink-faint" aria-hidden="true" />
                      {brgyBy[sel.barangay_id]?.name ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="t-label text-ink-faint">Filed</dt>
                    <dd className="t-data mt-1 flex items-center gap-1">
                      <Clock width={12} height={12} className="text-ink-faint" aria-hidden="true" />
                      {new Date(sel.created_at).toLocaleString("en-PH", { dateStyle: "short", timeStyle: "short" })}
                    </dd>
                  </div>
                  {sel.callback_number && (
                    <div className="col-span-2">
                      <dt className="t-label text-ink-faint">Callback</dt>
                      <dd className="mt-1">
                        <a href={`tel:${sel.callback_number}`} className="t-code inline-flex items-center gap-1.5 text-brand">
                          <Phone width={12} height={12} aria-hidden="true" />
                          {sel.callback_number}
                        </a>
                      </dd>
                    </div>
                  )}
                  {sel.cluster_id && (sel.confidence_score ?? 1) > 1 && (
                    <div className="col-span-2">
                      <dt className="t-label text-ink-faint">Corroboration</dt>
                      <dd className="t-body-sm mt-1 flex items-center gap-1.5">
                        <Layers width={13} height={13} className="text-brand" aria-hidden="true" />
                        {sel.confidence_score} independent reports of this
                      </dd>
                    </div>
                  )}
                </dl>

                {actionError && (
                  <p role="alert" className="t-body-sm border border-alert bg-alert-wash p-2.5 text-alert">
                    {actionError}
                  </p>
                )}
              </div>
            </div>

            {/* Actions: never more than the one thing that moves this card on. */}
            {!isBarangayOfficial && sel.status !== "resolved" && sel.status !== "closed" && (
              <div className="flex flex-col gap-2 border-t border-line p-4">
                {sel.status === "in_progress" ? (
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) setResolvePhoto(await compressPhoto(f));
                      }}
                    />
                    {resolvePhoto ? (
                      <img src={resolvePhoto} alt="Resolution evidence" className="h-28 w-full border border-line object-cover" />
                    ) : (
                      <button onClick={() => fileRef.current?.click()} className="saro-btn saro-btn-secondary saro-btn-block">
                        <Upload width={15} height={15} />
                        Attach resolution photo
                      </button>
                    )}
                    <p className="t-body-sm text-ink-muted">
                      A photo is required before this can be marked resolved.
                    </p>
                    <button onClick={() => resolve(sel, false)} disabled={!resolvePhoto || busy} className="saro-btn saro-btn-primary saro-btn-block">
                      <Check width={15} height={15} />
                      Mark resolved
                    </button>
                    <button onClick={() => resolve(sel, true)} disabled={!resolvePhoto || busy} className="saro-btn saro-btn-ghost saro-btn-block">
                      <Flag width={15} height={15} />
                      Resolve as false report
                    </button>
                  </>
                ) : (
                  <button onClick={() => advance(sel)} disabled={busy} className="saro-btn saro-btn-primary saro-btn-block capitalize">
                    Move to {STATUS_PIPELINE[STATUS_PIPELINE.indexOf(sel.status) + 1]?.replace("_", " ")}
                  </button>
                )}
              </div>
            )}

            {isBarangayOfficial && (
              <p className="t-body-sm border-t border-line p-4 text-ink-muted">
                You have read access to reports in {barangayName}. Status changes are made by the
                office handling the report.
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

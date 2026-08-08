import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  X, Upload, Flag, Search, Check, MapPin, Phone, Clock, ShieldCheck, UserRound, Layers,
} from "lucide-react";
import {
  getReports, getCategories, getBarangays, getOffices,
  updateReportStatus, addReportMedia, markFalseReport, saroEvents,
  useAuth, STATUS_PIPELINE,
  RESOLUTION_REASONS, RESOLUTION_REASON_LABELS,
} from "@saro/shared";
import { StatusTag, TrackingCode, statusTab, HazardMap } from "@saro/ui";
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

/**
 * One number and its noun. Four of these replace the old eight-tile KPI grid.
 *
 * These used to carry a 3px coloured left border, borrowing the index-tab
 * device the rack uses. It did not survive scrutiny: on a run card the edge
 * means *that card's status*, but a counter has no status, so here it only said
 * "this counter differs from its neighbour" — which the label already said.
 *
 * The giveaway was the fourth one. "Last 24h" signals nothing, so it had been
 * given `--color-line-strong` purely to keep the row looking consistent. A
 * colour chosen to fill a slot is decoration.
 *
 * The colour now sits on the number, which is the part that actually carries
 * the alarm: an overdue count of 7 should look different from an open count of
 * 7. "Last 24h" gets plain ink, because it has nothing to say. Colour is never
 * alone — the noun is directly beneath it — and it now lands on 20px text
 * rather than a 3px rule, which is easier to see and easier to pass contrast on.
 */
function Count({ label, value, tone }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-2.5">
      <span className="t-code" style={{ fontSize: 20, lineHeight: "24px", color: tone }}>
        {value}
      </span>
      <span className="t-micro text-ink-faint">{label}</span>
    </div>
  );
}

/** States an official can no longer act on. */
function isTerminal(status) {
  return ["resolved", "closed_confirmed", "closed_unconfirmed", "reopened"].includes(status);
}

/**
 * The closure gate.
 *
 * Which proof is demanded comes from the category's `resolution_proof`, set in
 * the routing table. Physical hazards need a photograph — it is timestamped, it
 * shows the actual place, and the resident disputing the closure sees the same
 * frame the office did. Medical, crime and referral cases cannot be
 * photographed: the ambulance has gone, and photographing someone on the worst
 * day of their life to satisfy a form would be indefensible. Those need a
 * countable reason code AND a reference, because a code alone loses every
 * specific and free text alone can never be counted.
 *
 * A trigger in Postgres enforces the same rule. This panel exists so the person
 * finds out what is missing before they lose what they typed.
 */
function ResolvePanel({ report, proofKind, busy, onResolve }) {
  const fileRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");

  const ready = proofKind === "photo"
    ? Boolean(photo)
    : Boolean(reason) && reference.trim().length >= 4;

  if (proofKind === "photo") {
    return (
      <>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setPhoto(await compressPhoto(f));
          }}
        />
        {photo ? (
          <img src={photo} alt="Resolution evidence" className="h-28 w-full border border-line object-cover" />
        ) : (
          <button onClick={() => fileRef.current?.click()} className="saro-btn saro-btn-secondary saro-btn-block">
            <Upload width={15} height={15} />
            Attach resolution photo
          </button>
        )}
        <p className="t-body-sm text-ink-muted">
          A photo of the completed work is required before this can be resolved.
        </p>
        <button
          onClick={() => onResolve({ photo, asFalse: false })}
          disabled={!ready || busy}
          className="saro-btn saro-btn-primary saro-btn-block"
        >
          <Check width={15} height={15} />
          Mark resolved
        </button>
        <button
          onClick={() => onResolve({ photo, asFalse: true })}
          disabled={!ready || busy}
          className="saro-btn saro-btn-ghost saro-btn-block"
        >
          <Flag width={15} height={15} />
          Resolve as false report
        </button>
      </>
    );
  }

  return (
    <>
      <p className="t-body-sm text-ink-muted">
        {report.category_label ?? "This category"} cannot be closed with a photo. Record what
        happened instead.
      </p>

      <label className="block">
        <span className="t-label text-ink-faint">Reason code *</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="saro-field mt-1.5 w-full"
        >
          <option value="">Choose one…</option>
          {RESOLUTION_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="t-label text-ink-faint">Reference number or note *</span>
        <textarea
          rows={2}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="BFP dispatch #2026-0814, endorsed to Ambulance 2 at 14:20"
          className="saro-field mt-1.5 w-full resize-none"
        />
      </label>

      <button
        onClick={() => onResolve({ reason, reference, asFalse: reason === "false_alarm" })}
        disabled={!ready || busy}
        className="saro-btn saro-btn-primary saro-btn-block"
      >
        <Check width={15} height={15} />
        Mark resolved
      </button>
    </>
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

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

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
    // "Open" means still owed work. Reopened counts — a resident said the last
    // resolution did not hold, so it is back on the office.
    const open = reports.filter((r) => !isTerminal(r.status) || r.status === "reopened");
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
    const { error } = await updateReportStatus(report.id, next);
    setBusy(false);
    if (error) return setActionError(error);
    await loadData();
    setSelected((s) => (s ? { ...s, status: next } : s));
  };

  /**
   * Resolve, with whatever proof this category requires.
   *
   * The photo is uploaded BEFORE the status update, because the trigger that
   * enforces the rule counts resolution media on the row. Reversing the order
   * would make every photo-backed resolution fail.
   */
  const resolve = async ({ photo, reason, reference, asFalse }) => {
    const report = sel;
    if (!report) return;

    setBusy(true); setActionError("");

    if (photo) {
      const { error: mediaError } = await addReportMedia(report.id, photo, "resolution");
      if (mediaError) { setBusy(false); return setActionError(mediaError); }
    }

    if (asFalse) await markFalseReport(report.id, true);

    const { error } = await updateReportStatus(report.id, "resolved", { reason, reference });
    setBusy(false);
    if (error) return setActionError(error);

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
          {/* Overdue reads as alert, never as panic — a breached SLA is an
              operational failure, not somebody in danger. "Last 24h" is plain
              ink because it is context, not a condition to act on. */}
          <Count label="Open" value={counts.open} tone="var(--color-status-progress-ink)" />
          <Count label="Overdue" value={counts.overdue} tone="var(--color-alert)" />
          <Count label="Unclaimed" value={counts.unclaimed} tone="var(--color-status-received-ink)" />
          <Count label="Last 24h" value={counts.today} tone="var(--color-ink)" />
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
            // key on ResolvePanel below remounts it per report, so a photo or
            // reason typed for one card can never be submitted against another.
            onSelect={(r) => { setSelected(r); setActionError(""); }}
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
                <HazardMap
                  className="h-full w-full"
                  center={[sel.lng, sel.lat]}
                  zoom={16}
                  showToggles={false}
                  hidden={["rain"]}
                  reports={[{ id: sel.id, lat: sel.lat, lng: sel.lng,
                              priority: sel.priority, color: statusTab(sel.status) }]}
                />
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
            {!isBarangayOfficial && !isTerminal(sel.status) && (
              <div className="flex flex-col gap-2 border-t border-line p-4">
                {sel.status === "in_progress" ? (
                  <ResolvePanel
                    key={sel.id}
                    report={sel}
                    proofKind={catBy[sel.category_id ?? sel.category]?.resolution_proof ?? "photo"}
                    busy={busy}
                    onResolve={resolve}
                  />
                ) : (
                  <button onClick={() => advance(sel)} disabled={busy} className="saro-btn saro-btn-primary saro-btn-block capitalize">
                    Move to {STATUS_PIPELINE[STATUS_PIPELINE.indexOf(sel.status) + 1]?.replace("_", " ")}
                  </button>
                )}
              </div>
            )}

            {/* Terminal states are shown, never offered. closed_confirmed,
                closed_unconfirmed and reopened belong to the resident and to
                the auto-close timer — an office that could set them itself
                could manufacture a satisfied resident, which is the one thing
                the confirmed/unconfirmed split exists to prevent. A trigger
                refuses it too; this is only the explanation. */}
            {!isBarangayOfficial && isTerminal(sel.status) && (
              <div className="border-t border-line p-4">
                <span className="t-label text-ink-faint">Closed</span>
                <p className="t-body-sm mt-1.5 text-ink-muted">
                  {sel.status === "resolved" &&
                    "Waiting for the resident to confirm. It closes itself after 7 days if they do not answer."}
                  {sel.status === "closed_confirmed" &&
                    "The resident confirmed the work was done. Nothing further to do."}
                  {sel.status === "closed_unconfirmed" &&
                    "Closed automatically with no answer from the resident. They can still reopen it."}
                  {sel.status === "reopened" &&
                    "The resident said this was not fixed."}
                </p>
                {sel.resolution_reason && (
                  <p className="t-body-sm mt-2 text-ink-muted">
                    <span className="t-label text-ink-faint">Closed as </span>
                    {RESOLUTION_REASON_LABELS[sel.resolution_reason]} · {sel.resolution_reference}
                  </p>
                )}
              </div>
            )}

            {isBarangayOfficial && (
              <p className="t-body-sm border-t border-line p-4 text-ink-muted">
                You have read access to reports in {barangayName}. Status changes are made by the
                office handling the report — this is enforced by the database, not just hidden here.
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

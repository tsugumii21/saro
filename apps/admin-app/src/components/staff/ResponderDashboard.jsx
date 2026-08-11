import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  X, Upload, Flag, Search, Check, MapPin, Phone, Clock, ShieldCheck, UserRound, Layers,
} from "lucide-react";
import {
  getReports, getCategories, getBarangays, getOffices,
  updateReportStatus, addReportMedia, markFalseReport, saroEvents,
  useAuth, STATUS_PIPELINE,
  RESOLUTION_REASONS, RESOLUTION_REASON_LABELS,
  canViewReport, describeScope,
  canDispatchReport, canEndorseReport, canReassignReport,
} from "@saro/shared";
import { StatusTag, TrackingCode, statusTab, HazardMap } from "@saro/ui";
import QueueTable from "./QueueTable";
import ReportDetailPanel from "./ReportDetailPanel";

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
  /* Ids are no longer read here: jurisdiction is decided by viewerScope in
     @saro/shared. The names remain because they are what the scope caption
     prints. */
  const { officeName, barangayName, isAdmin, viewerScope } = useAuth();

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
    if (!viewerScope?.role) return;
    const [r, c, b, o] = await Promise.all([
      getReports({ scope: viewerScope }), getCategories(), getBarangays(), getOffices(),
    ]);
    if (r.data) setReports(r.data);
    if (c.data) setCategories(c.data);
    if (b.data) setBarangays(b.data);
    if (o.data) setOffices(o.data);
  }, [viewerScope]);

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
      /* Jurisdiction is decided once, in @saro/shared, on ids alone. The old
         version here also matched on office and barangay *names*, which is what
         let a profile with a null id fall through to seeing everything. */
      if (!canViewReport(viewerScope, r)) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      const cat = catBy[r.category_id ?? r.category];
      return (
        r.tracking_code.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        (cat?.label || cat?.name || "").toLowerCase().includes(q) ||
        (brgyBy[r.barangay_id]?.name || r.barangay_name || "").toLowerCase().includes(q)
      );
    });
  }, [reports, query, statusFilter, catBy, brgyBy, viewerScope]);

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

  const scope = describeScope(viewerScope, { officeName, barangayName });
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
          {/* Same ink and weight as the section nav icons. ink-faint is a
              text tone: it clears AA as a glyph, but a 15px lucide outline is a
              ~1.2px hairline, and antialiasing thins that to near nothing on
              white. Icons in this app carry ink-muted and a heavier stroke. */}
          <Search
            width={15}
            height={15}
            strokeWidth={2.25}
            className="pointer-events-none absolute left-3"
            style={{ color: "var(--color-ink-muted)" }}
            aria-hidden="true"
          />
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
        style={{ gridTemplateColumns: sel ? "minmax(0,1fr) 420px" : "minmax(0,1fr)" }}
      >
        <div className="min-w-0 overflow-auto">
          <QueueTable
            reports={filtered}
            categories={categories}
            barangays={barangays}
            selectedId={sel?.id}
            onSelect={(r) => { setSelected(r); setActionError(""); }}
          />
        </div>

        {sel && (
          <ReportDetailPanel
            key={sel.id}
            report={sel}
            category={selCat}
            barangay={brgyBy[sel.barangay_id]}
            office={officeBy[sel.assigned_office_id]}
            offices={offices}
            /* Who may do what is decided once, in @saro/shared, and handed down
               as three plain answers. */
            canDispatch={canDispatchReport(viewerScope, sel)}
            canEndorse={canEndorseReport(viewerScope, sel)}
            canReassign={canReassignReport(viewerScope)}
            canDelete={isAdmin}
            onClose={() => setSelected(null)}
            onUpdateSuccess={loadData}
          />
        )}
      </div>
    </div>
  );
}

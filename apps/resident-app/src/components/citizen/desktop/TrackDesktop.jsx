import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Search, Inbox, MapPin, Building2, ChevronRight, ThumbsUp, RotateCcw,
  CloudOff, Info, UserPlus, X, MessageSquare, Image as ImageIcon, CheckCircle2, ShieldCheck, ArrowRight,
  ChevronLeft, Copy, Check, Activity,
} from "lucide-react";
import { StatusTag, TrackingCode, HazardMap } from "@saro/ui";
import {
  getReportByTrackingCode, getStatusHistory, getOffices, getReportMedia,
  getReportsByDevice, getMyReports, saroEvents,
  confirmReport, disputeReport,
  listRememberedReports, updateRememberedStatus, listOutbox,
  CLIENT_STORAGE_KEYS, useAuth, STATUS_PIPELINE, STATUS_LABELS,
  CLOSED_STATUSES, AUTO_CLOSE_DAYS,
} from "@saro/shared";
import ReportTicket from "../ReportTicket";
import ResidentAuthScreen from "../ResidentAuthScreen";

const DEMO_RESIDENT_REPORTS = [
  {
    id: "demo-101", tracking_code: "SR-8F2K", category: "flood",
    category_label: "Flooding & Water Inundation", status: "in_progress",
    lat: 13.1438, lng: 123.7448,
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    description: "Flooding near Bitano market line. Water level rising fast by the bakery.",
    barangay: "Bitano", assigned_office: "CDRRMO", priority: "high",
    photo_url: "https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "demo-102", tracking_code: "SR-3M9P", category: "open_drain",
    category_label: "Uncovered Drain & Broken Manhole", status: "assigned",
    lat: 13.1415, lng: 123.7410,
    created_at: new Date(Date.now() - 3600000 * 18).toISOString(),
    description: "Manhole cover missing outside the elementary school gate.",
    barangay: "Em's Barrio", assigned_office: "City Engineering", priority: "medium",
    photo_url: "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "demo-103", tracking_code: "SR-7N4L", category: "pothole",
    category_label: "Road Pothole & Surface Damage", status: "resolved",
    lat: 13.1490, lng: 123.7380,
    created_at: new Date(Date.now() - 3600000 * 48).toISOString(),
    description: "Deep pothole on the northbound lane, two tricycles already damaged.",
    barangay: "Gogon", assigned_office: "City Engineering", priority: "low",
  },
  {
    id: "demo-104", tracking_code: "SR-1B9Q", category: "typhoon_debris",
    category_label: "Typhoon Debris & Structural Damage", status: "received",
    lat: 13.1395, lng: 123.7465,
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    description: "Fallen acacia branch blocking half the road after last night's wind.",
    barangay: "Oro Site", assigned_office: "CDRRMO", priority: "medium",
  },
];

function timeSince(iso) {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function daysLeftToConfirm(resolvedAt) {
  if (!resolvedAt) return null;
  const elapsed = (Date.now() - new Date(resolvedAt).getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(AUTO_CLOSE_DAYS - elapsed));
}

function tabKey(status) {
  if (status === "in_progress") return "progress";
  if (status === "closed_confirmed") return "resolved";
  if (status === "closed_unconfirmed") return "closed";
  return status;
}

function formatTimelineDate(entry) {
  if (!entry) return "";
  const raw = entry.changed_at || entry.created_at || entry.timestamp || entry.updated_at;
  if (!raw) return "Recorded";
  const date = new Date(raw);
  if (isNaN(date.getTime())) return "Recorded";
  return date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Desktop Track — Standardized 400px Left Panel + 2-Column Right Detail Card.
 *
 * Left panel (400px): Inline desktop search input group + My Reports list with high-contrast active state.
 * Right panel (flex-1): 2-column desktop detail card (Option 3A Option A editorial guide empty state).
 */
export default function TrackDesktop() {
  const [searchParams] = useSearchParams();
  const { isResident } = useAuth();
  const preCode = searchParams.get("code") || "";

  const [code, setCode] = useState(preCode);
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [offices, setOffices] = useState([]);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [mine, setMine] = useState([]);
  const [queued, setQueued] = useState([]);
  const [selectedCode, setSelectedCode] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const handleCopyCode = (codeToCopy) => {
    if (!codeToCopy) return;
    navigator.clipboard.writeText(codeToCopy);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Confirm / dispute
  const [disputing, setDisputing] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [closureBusy, setClosureBusy] = useState(false);
  const [closureNote, setClosureNote] = useState("");

  const [reportMedia, setReportMedia] = useState([]);
  const detailPanelRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data } = await getOffices();
      if (data) setOffices(data);
    })();
  }, []);

  const loadMine = useCallback(async () => {
    const merged = new Map();
    if (isResident) {
      for (const r of DEMO_RESIDENT_REPORTS) {
        merged.set(r.tracking_code, { ...r, origin: "account" });
      }
    }
    for (const row of await listRememberedReports()) {
      merged.set(row.tracking_code, { ...row, origin: "device" });
    }
    if (isResident) {
      const { data } = await getMyReports();
      for (const row of data ?? []) merged.set(row.tracking_code, { ...row, origin: "account" });
    } else {
      const deviceId = localStorage.getItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT);
      if (deviceId) {
        const { data } = await getReportsByDevice(deviceId);
        for (const row of data ?? []) merged.set(row.tracking_code, { ...row, origin: "device" });
      }
    }
    setMine(
      [...merged.values()].sort((a, b) =>
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
      )
    );
    setQueued(await listOutbox());
  }, [isResident]);

  useEffect(() => { loadMine(); }, [loadMine]);

  const search = useCallback(async (raw) => {
    const c = (raw ?? code).trim().toUpperCase();
    if (!c) return;
    setSearching(true);
    setError("");
    setClosureNote("");
    setDisputing(false);
    setSelectedCode(c);

    if (detailPanelRef.current) detailPanelRef.current.scrollTop = 0;

    const demoMatch = DEMO_RESIDENT_REPORTS.find((r) => r.tracking_code === c);
    if (demoMatch) {
      setReport(demoMatch);
      updateRememberedStatus(demoMatch.tracking_code, demoMatch.status);
      setHistory([
        { status: "received", changed_at: demoMatch.created_at, note: "Report received by Legazpi Command Center" },
        { status: demoMatch.status, changed_at: new Date(Date.now() - 1800000).toISOString(), note: `Status updated to ${demoMatch.status}` },
      ]);
      setSearching(false);
      return;
    }

    const { data, error: err } = await getReportByTrackingCode(c);
    if (err || !data) {
      setError(`No report found for ${c}. Check the code and try again.`);
      setReport(null);
      setHistory([]);
      setSearching(false);
      return;
    }
    setReport(data);
    updateRememberedStatus(data.tracking_code, data.status);
    const h = await getStatusHistory(data.tracking_code);
    setHistory(h.data ?? []);
    setSearching(false);
  }, [code]);

  useEffect(() => { if (preCode) search(preCode); }, [preCode, search]);

  useEffect(() => {
    if (!report) return;
    return saroEvents.on("report:updated", () => search(report.tracking_code));
  }, [report, search]);

  useEffect(() => {
    if (!report?.id) { setReportMedia([]); return; }
    (async () => {
      const { data } = await getReportMedia(report.id);
      setReportMedia(data ?? []);
    })();
  }, [report?.id]);

  const allPhotos = useMemo(() => {
    if (!report) return [];
    const list = [];
    if (report.photo_url) list.push(report.photo_url);
    if (Array.isArray(report.photos)) {
      for (const p of report.photos) {
        if (typeof p === "string") list.push(p);
        else if (p?.signed_url || p?.url) list.push(p.signed_url || p.url);
      }
    }
    for (const m of reportMedia) {
      if (m?.signed_url || m?.url) list.push(m.signed_url || m.url);
    }
    return [...new Set(list)].filter(Boolean);
  }, [report, reportMedia]);

  const handleConfirm = async () => {
    setClosureBusy(true);
    const { error: err } = await confirmReport(report.tracking_code);
    setClosureBusy(false);
    if (err) return setClosureNote(err);
    setClosureNote("Thank you — this report is closed.");
    search(report.tracking_code);
    loadMine();
  };

  const handleDispute = async () => {
    setClosureBusy(true);
    const { error: err } = await disputeReport(report.tracking_code, disputeReason);
    setClosureBusy(false);
    if (err) return setClosureNote(err);
    setDisputing(false);
    setDisputeReason("");
    setClosureNote("Reopened. It is back with the office that handled it.");
    search(report.tracking_code);
    loadMine();
  };

  const canDispute =
    report &&
    (report.status === "resolved" ||
      report.status === "closed_unconfirmed" ||
      report.status === "closed_confirmed");
  const awaitingAnswer = report?.status === "resolved";
  const stepIndex = STATUS_PIPELINE.indexOf(report?.status);
  const isClosed = CLOSED_STATUSES.includes(report?.status);
  const daysLeft = awaitingAnswer ? daysLeftToConfirm(report?.resolved_at) : null;

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas font-sans">

      {/* ── Left panel: search + list (Standardized 400px) ──────────────── */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-line bg-surface overflow-y-auto">

        {/* Panel header */}
        <div className="border-b border-line px-5 py-3.5">
          <h1 className="text-sm font-bold text-ink">Track a Report</h1>
          <p className="text-xs text-ink-faint mt-0.5">Enter code or select a report from your history</p>
        </div>

        <div className="flex flex-col gap-4.5 p-5">

          {/* Desktop Inline Search Form */}
          <form
            onSubmit={(e) => { e.preventDefault(); search(); }}
            className="flex items-center gap-2"
          >
            <label className="sr-only" htmlFor="track-code-desktop">Tracking code</label>
            <input
              id="track-code-desktop"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SR-XXXX"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
              className="saro-field saro-field-code flex-1 font-mono text-sm py-2 px-3.5"
              aria-invalid={Boolean(error)}
            />
            <button
              type="submit"
              disabled={searching || !code.trim()}
              className="saro-btn saro-btn-primary py-2 px-4 flex items-center gap-1.5 shrink-0"
            >
              <Search width={15} height={15} />
              <span>{searching ? "..." : "Check"}</span>
            </button>
          </form>

          {error && (
            <p role="alert" className="text-xs font-bold border border-alert bg-alert-wash px-3.5 py-2.5 text-alert rounded-xs">
              {error}
            </p>
          )}

          {/* Queued / offline */}
          {queued.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-ink-faint uppercase tracking-wider flex items-center gap-1.5">
                <CloudOff width={13} height={13} aria-hidden="true" />
                Waiting to Send ({queued.length})
              </h2>
              <ul className="mt-2 flex flex-col">
                {queued.map((row) => (
                  <li key={row.id} className="border-b border-line py-2.5">
                    <span className="text-xs font-bold block">
                      {row.kind === "panic" ? "Panic alert" : "Report"} · {timeSince(row.created_at)}
                    </span>
                    <span className="text-[11px] text-ink-muted block">
                      {row.last_error ? "Could not send yet. SARO keeps trying." : "Will send when signal returns."}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* My Reports list with High-Contrast Active State */}
          {mine.length > 0 ? (
            <section>
              <h2 className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">
                {isResident ? "Your Reports" : "Reports From This Device"}
              </h2>
              <div className="flex flex-col gap-2.5">
                {mine.slice(0, 20).map((r) => {
                  const isSelected = selectedCode === r.tracking_code;
                  return (
                    <button
                      key={r.tracking_code}
                      onClick={() => { setCode(r.tracking_code); search(r.tracking_code); }}
                      className={`flex flex-col gap-2 p-3.5 text-left rounded-lg border transition-all shadow-2xs ${
                        isSelected
                          ? "bg-brand-wash border-brand ring-1 ring-brand/30"
                          : "bg-surface border-line hover:border-brand-edge hover:bg-raised/60"
                      }`}
                      aria-current={isSelected ? "true" : undefined}
                    >
                      {/* Header Row: Tracking Code + Time + StatusTag */}
                      <div className="flex items-center justify-between gap-2 w-full">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <TrackingCode code={r.tracking_code} />
                          <span className="text-[11px] text-ink-faint font-medium">
                            · {timeSince(r.created_at)}
                          </span>
                        </div>
                        <StatusTag status={r.status} size="sm" />
                      </div>

                      {/* Title & Chevron Row */}
                      <div className="flex items-center justify-between gap-2 w-full">
                        <span className={`text-xs block leading-snug break-words flex-1 min-w-0 ${
                          isSelected ? "font-extrabold text-brand" : "font-semibold text-ink"
                        }`}>
                          {r.category_label ?? r.category}
                        </span>
                        <ChevronRight
                          width={15}
                          height={15}
                          className={`shrink-0 transition-colors ${
                            isSelected ? "text-brand" : "text-ink-faint"
                          }`}
                          aria-hidden="true"
                        />
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Local Storage Info Footer */}
              <div
                className="mt-3 p-3.5 border rounded-xs flex flex-col gap-2"
                style={{ borderColor: "var(--color-brand-edge)", background: "var(--color-brand-wash)" }}
              >
                <div className="flex items-start gap-2">
                  <Info width={14} height={14} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                  <p className="text-xs text-ink-muted leading-relaxed">
                    This list is saved locally on this browser. Clearing browser data removes the list,{" "}
                    <strong className="font-bold text-ink">not the reports</strong> — all reports stay with the city.
                  </p>
                </div>
                {!isResident && (
                  <div className="pt-2 border-t border-brand-edge/50 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-brand">Sync across devices?</span>
                    <button
                      type="button"
                      onClick={() => setShowAuthModal(true)}
                      className="saro-btn saro-btn-primary saro-btn-sm text-xs py-1 px-3 flex items-center gap-1"
                    >
                      <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                      Sign In
                    </button>
                  </div>
                )}
              </div>
            </section>
          ) : (
            !report && !error && queued.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Inbox width={26} height={26} className="text-ink-faint" aria-hidden="true" />
                <p className="text-sm font-bold text-ink">Nothing Saved Yet</p>
                <p className="text-xs text-ink-muted max-w-[28ch] leading-relaxed">
                  Reports you file will appear here. You can always check a report by typing its tracking code above.
                </p>
                {!isResident && (
                  <button
                    type="button"
                    onClick={() => setShowAuthModal(true)}
                    className="saro-btn saro-btn-ghost saro-btn-sm mt-2 flex items-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                    Sign in to sync report history
                  </button>
                )}
              </div>
            )
          )}
        </div>
      </aside>

      {/* ── Right panel: 2-Column Desktop Detail View (flex-1) ─────────────── */}
      <div
        ref={detailPanelRef}
        className="min-w-0 flex-1 overflow-y-auto bg-canvas"
        aria-label="Report detail"
      >
        {/* Idle Guide State — min-h-full + justify-center for true vertical centering
            inside the overflow-y-auto panel. my-auto was dead code here. */}
        {!report && !searching && (
          <div className="min-h-full flex flex-col justify-center px-8 py-10">
          <div className="max-w-4xl mx-auto w-full flex flex-col gap-6">
            <div className="border border-line bg-surface p-6 rounded-md shadow-xs flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-brand-wash text-brand border border-brand-edge flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-ink">Legazpi City Incident Tracking Desk</h2>
                  <p className="text-xs text-ink-muted">Check real-time office assignments &amp; resolution progress</p>
                </div>
              </div>

              {/* Sample Tracking Codes Quick Chips */}
              <div className="pt-3 border-t border-line flex flex-col gap-2">
                <span className="text-xs font-bold text-ink uppercase tracking-wider">
                  Try Sample Demonstration Reports:
                </span>
                <div className="flex flex-wrap gap-2">
                  {DEMO_RESIDENT_REPORTS.map((demo) => (
                    <button
                      key={demo.tracking_code}
                      onClick={() => { setCode(demo.tracking_code); search(demo.tracking_code); }}
                      className="px-3 py-1.5 rounded bg-raised border border-line hover:border-brand hover:bg-brand-wash transition-colors flex items-center gap-2 group text-left"
                    >
                      <TrackingCode code={demo.tracking_code} />
                      <span className="text-xs text-ink-muted group-hover:text-brand font-medium">
                        · {demo.tracking_code === "SR-8F2K" ? "Flooding" : demo.tracking_code === "SR-3M9P" ? "Broken Manhole" : demo.tracking_code === "SR-7N4L" ? "Road Pothole" : demo.tracking_code === "SR-1B9Q" ? "Typhoon Debris" : demo.category_label}
                      </span>
                      <ArrowRight className="w-3 h-3 text-ink-faint group-hover:text-brand" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 3 Step Guide — p-5/gap-3 and text-[13px] for desktop scale */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-5 border border-line bg-surface rounded-md flex flex-col gap-3">
                <span className="text-xs font-bold text-brand uppercase font-mono">Step 1</span>
                <span className="text-sm font-bold text-ink">Enter Tracking Code</span>
                <p className="text-[13px] text-ink-muted leading-relaxed">
                  Type your 8-character code (e.g. SR-8F2K) printed on your receipt when filing.
                </p>
              </div>
              <div className="p-5 border border-line bg-surface rounded-md flex flex-col gap-3">
                <span className="text-xs font-bold text-brand uppercase font-mono">Step 2</span>
                <span className="text-sm font-bold text-ink">View Office Routing</span>
                <p className="text-[13px] text-ink-muted leading-relaxed">
                  See which city department (CDRRMO, Engineering) has been assigned to fix it.
                </p>
              </div>
              <div className="p-5 border border-line bg-surface rounded-md flex flex-col gap-3">
                <span className="text-xs font-bold text-brand uppercase font-mono">Step 3</span>
                <span className="text-sm font-bold text-ink">Confirm or Dispute</span>
                <p className="text-[13px] text-ink-muted leading-relaxed">
                  Residents get the final vote. Confirm when fixed, or reopen if issue persists.
                </p>
              </div>
            </div>
          </div>
          </div>
        )}

        {searching && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm font-bold text-brand animate-pulse flex items-center gap-2">
              <Search className="w-4 h-4" />
              <span>Fetching report record from city database…</span>
            </p>
          </div>
        )}

        {/* 2-Column Desktop Detail View */}
        {report && !searching && (
          <div className="p-6 max-w-5xl mx-auto flex flex-col gap-6">

            {/* Top Banner Header */}
            <article
              className="saro-clip saro-rise saro-card overflow-hidden"
              style={{
                boxShadow: `inset 0 4px 0 0 var(--color-status-${tabKey(report.status)}-tab)`,
                borderTop: `4px solid var(--color-status-${tabKey(report.status)}-tab)`,
              }}
            >
              <div className="border-b border-rule p-5 flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div>
                    <TrackingCode code={report.tracking_code} size="xl" />
                    <span className="text-xs text-ink-faint block mt-1">filed {timeSince(report.created_at)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyCode(report.tracking_code)}
                    className="saro-btn saro-btn-secondary saro-btn-sm text-xs py-1 px-2.5 flex items-center gap-1.5 ml-2 cursor-pointer transition-all active:scale-95"
                    title="Copy tracking code"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700 font-bold">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-ink-muted" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                </div>
                <StatusTag status={report.status} />
              </div>

              {/* 2-Column Desktop Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-line">

                {/* Left Column: Facts, Description, Photos & Receipt */}
                <div className="flex flex-col divide-y divide-line">
                  {/* Facts */}
                  <dl className="grid grid-cols-2 gap-4 p-5">
                    <div>
                      <dt className="text-xs font-bold text-ink-faint uppercase tracking-wider">Category</dt>
                      <dd className="text-sm font-bold text-ink mt-1">
                        {report.category_label ?? report.category}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-bold text-ink-faint uppercase tracking-wider">Assigned Office</dt>
                      <dd className="text-xs font-bold text-brand mt-1 flex items-center gap-1">
                        <Building2 width={14} height={14} className="shrink-0" />
                        {offices.find((o) => o.short_name === report.assigned_office)?.full_name
                          ?? report.assigned_office ?? "Being routed"}
                      </dd>
                    </div>
                    {report.barangay && (
                      <div className="col-span-2">
                        <dt className="text-xs font-bold text-ink-faint uppercase tracking-wider">Barangay</dt>
                        <dd className="text-xs font-semibold text-ink mt-1 flex items-center gap-1">
                          <MapPin width={14} height={14} className="text-brand shrink-0" />
                          {report.barangay}
                        </dd>
                      </div>
                    )}
                  </dl>

                  {/* Description */}
                  {report.description && (
                    <div className="p-5 bg-raised/30 flex flex-col gap-2">
                      <span className="text-xs font-bold text-ink-muted uppercase tracking-wider flex items-center gap-1.5">
                        <MessageSquare width={14} height={14} className="text-brand shrink-0" />
                        Resident Description
                      </span>
                      <p className="text-xs text-ink leading-relaxed bg-surface p-3.5 rounded border border-line font-medium whitespace-pre-wrap shadow-2xs">
                        "{report.description}"
                      </p>
                    </div>
                  )}

                  {/* Photos */}
                  {allPhotos.length > 0 && (
                    <div className="p-5 bg-raised/20 flex flex-col gap-3">
                      <span className="text-xs font-bold text-ink-muted uppercase tracking-wider flex items-center gap-1.5">
                        <ImageIcon width={14} height={14} className="text-brand shrink-0" />
                        Photo Evidence ({allPhotos.length})
                      </span>
                      <div className="grid grid-cols-2 gap-3">
                        {allPhotos.map((imgUrl, i) => (
                          <div key={i} className="relative overflow-hidden rounded border border-line bg-sunken aspect-video group shadow-2xs">
                            <img
                              src={imgUrl}
                              alt={`Photo evidence ${i + 1}`}
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Ticket Summary */}
                  <div className="p-5 bg-surface">
                    <ReportTicket
                      code={report.tracking_code}
                      categoryLabel={report.category_label ?? report.category}
                      filedAt={report.created_at}
                    />
                  </div>
                </div>

                {/* Right Column: Location Map, Confirm/Dispute Card & Timeline */}
                <div className="flex flex-col divide-y divide-line">

                  {/* Location Map */}
                  {report.lat && report.lng && (
                    <div className="p-5 bg-raised/40 flex flex-col gap-2">
                      <span className="text-xs font-bold text-ink-muted uppercase tracking-wider flex items-center gap-1.5">
                        <MapPin width={14} height={14} className="text-brand shrink-0" />
                        Reported Location Pin
                      </span>
                      {/* Outer wrapper: border + rounded + shadow, NO overflow-hidden so
                          MapLibre zoom controls aren't clipped by the card edge.
                          Inner absolute div takes overflow-hidden to clip canvas corners. */}
                      <div className="h-[220px] w-full rounded border border-line shadow-2xs relative">
                        <div className="absolute inset-0 rounded overflow-hidden">
                          <HazardMap
                            className="h-full w-full"
                            center={[
                              typeof report.lng === "string" ? parseFloat(report.lng) : report.lng,
                              typeof report.lat === "string" ? parseFloat(report.lat) : report.lat,
                            ]}
                            zoom={15}
                            showToggles={false}
                            reports={[{
                              id: report.tracking_code,
                              lat: typeof report.lat === "string" ? parseFloat(report.lat) : report.lat,
                              lng: typeof report.lng === "string" ? parseFloat(report.lng) : report.lng,
                              priority: report.priority || "medium",
                              color: `var(--color-status-${tabKey(report.status)}-tab)`,
                            }]}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Confirm / Dispute Action Card */}
                  {canDispute && (
                    <div className="p-5 border-y border-emerald-300/80 bg-emerald-50/50 space-y-3">
                      <div className="flex items-start gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-300/60">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-ink">Was this hazard actually resolved?</h3>
                          <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                            {awaitingAnswer
                              ? `${report.assigned_office ?? "The office"} marked this resolved. Resident verification is required.`
                              : "This closed automatically. You may reopen if the hazard is still present."}
                          </p>
                        </div>
                      </div>

                      {!disputing ? (
                        <div className="pt-1 flex gap-2">
                          {awaitingAnswer && (
                            <button
                              type="button"
                              onClick={handleConfirm}
                              disabled={closureBusy}
                              className="saro-btn saro-btn-primary flex-1 justify-center py-2 text-xs font-bold"
                            >
                              <ThumbsUp width={14} height={14} />
                              Yes, it is fixed
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDisputing(true)}
                            disabled={closureBusy}
                            className="saro-btn saro-btn-secondary flex-1 justify-center py-2 text-xs font-bold"
                          >
                            <RotateCcw width={14} height={14} />
                            No, not fixed
                          </button>
                        </div>
                      ) : (
                        <div className="pt-1 flex flex-col gap-2">
                          <textarea
                            rows={3}
                            value={disputeReason}
                            onChange={(e) => setDisputeReason(e.target.value)}
                            placeholder="State what is still wrong at the location..."
                            className="saro-input text-xs w-full resize-none p-2.5 bg-white"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={handleDispute}
                              disabled={closureBusy}
                              className="saro-btn saro-btn-primary flex-1 text-xs py-2"
                            >
                              {closureBusy ? "Sending…" : "Reopen this report"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDisputing(false)}
                              className="saro-btn saro-btn-ghost text-xs py-2"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {closureNote && (
                        <p role="status" className="text-xs font-bold pt-1 text-brand">
                          {closureNote}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Progress Timeline */}
                  <div className="p-5">
                    <span className="text-xs font-bold text-ink-muted uppercase tracking-wider block mb-3">
                      Resolution Pipeline Progress
                    </span>
                    <ol className="flex flex-col">
                      {STATUS_PIPELINE.map((step, i) => {
                        const entry = history.find((h) => h.status === step);
                        const done = isClosed || report.status === "reopened" ? true : i <= stepIndex;
                        const current = i === stepIndex;
                        return (
                          <li key={step} className="flex gap-3">
                            <span className="flex flex-col items-center">
                              <span
                                className={`mt-0.5 flex items-center justify-center shrink-0 rounded-full border border-white shadow-xs ${
                                  current ? "h-4.5 w-4.5 ring-2 ring-brand/30" : "h-3.5 w-3.5"
                                }`}
                                style={{
                                  background: done
                                    ? `var(--color-status-${tabKey(step)}-tab)`
                                    : "var(--color-line)",
                                }}
                              >
                                {done && !current && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                                {current && <Activity className="w-2.5 h-2.5 text-white animate-pulse" strokeWidth={3} />}
                              </span>
                              {i < STATUS_PIPELINE.length - 1 && (
                                <span
                                  className="w-0.5 flex-1 my-0.5"
                                  style={{ background: done ? "var(--color-line-strong)" : "var(--color-line)" }}
                                />
                              )}
                            </span>
                            <span className={`pb-4 ${done ? "" : "opacity-50"}`}>
                              <span className={`text-xs block ${current ? "font-extrabold text-brand" : "font-bold text-ink"}`}>
                                {STATUS_LABELS[step]}
                              </span>
                              {entry ? (
                                <>
                                  <span className="text-[11px] font-mono text-ink-faint block">
                                    {formatTimelineDate(entry)}
                                  </span>
                                  {entry.note && (
                                    <span className="text-xs text-ink-muted block mt-0.5">{entry.note}</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-[11px] text-ink-faint block">Not yet</span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>

                </div>
              </div>
            </article>

          </div>
        )}
      </div>

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
            onClick={() => setShowAuthModal(false)}
          />
          <div className="relative z-10 w-full max-w-md max-h-[90vh] overflow-y-auto bg-surface shadow-xl border border-line rounded-lg">
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 pt-4 pb-2 bg-surface border-b border-line">
              <span className="text-xs font-bold text-ink uppercase tracking-wider">Resident Account</span>
              <button
                type="button"
                onClick={() => setShowAuthModal(false)}
                className="p-1.5 hover:bg-raised transition-colors rounded"
                aria-label="Close"
              >
                <X className="w-4 h-4 text-ink-muted" />
              </button>
            </div>
            <ResidentAuthScreen
              mode="sign-in"
              reason="Create an account or sign in to sync your report tracking history across all your devices."
              onCancel={() => setShowAuthModal(false)}
              onSignedIn={() => setShowAuthModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

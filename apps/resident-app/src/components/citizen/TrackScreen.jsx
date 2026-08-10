import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Search, Inbox, MapPin, Building2, ChevronRight, ThumbsUp, RotateCcw,
  CloudOff, Info, UserPlus, X, MessageSquare, Image as ImageIcon,
  ChevronLeft, Copy, Check, Activity, ShieldCheck,
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
import ReportTicket from "./ReportTicket";
import ResidentAuthScreen from "./ResidentAuthScreen";

const DEMO_RESIDENT_REPORTS = [
  {
    id: "demo-101",
    tracking_code: "SR-8F2K",
    category: "flood",
    category_label: "Flooding & Water Inundation",
    status: "in_progress",
    lat: 13.1438,
    lng: 123.7448,
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    description: "Flooding near Bitano market line. Water level rising fast by the bakery.",
    barangay: "Bitano",
    assigned_office: "CDRRMO",
    priority: "high",
    photo_url: "https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "demo-102",
    tracking_code: "SR-3M9P",
    category: "open_drain",
    category_label: "Uncovered Drain & Broken Manhole",
    status: "assigned",
    lat: 13.1415,
    lng: 123.7410,
    created_at: new Date(Date.now() - 3600000 * 18).toISOString(),
    description: "Manhole cover missing outside the elementary school gate.",
    barangay: "Em's Barrio",
    assigned_office: "City Engineering",
    priority: "medium",
    photo_url: "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "demo-103",
    tracking_code: "SR-7N4L",
    category: "pothole",
    category_label: "Road Pothole & Surface Damage",
    status: "resolved",
    lat: 13.1490,
    lng: 123.7380,
    created_at: new Date(Date.now() - 3600000 * 48).toISOString(),
    description: "Deep pothole on the northbound lane, two tricycles already damaged.",
    barangay: "Gogon",
    assigned_office: "City Engineering",
    priority: "low"
  },
  {
    id: "demo-104",
    tracking_code: "SR-1B9Q",
    category: "typhoon_debris",
    category_label: "Typhoon Debris & Structural Damage",
    status: "received",
    lat: 13.1395,
    lng: 123.7465,
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    description: "Fallen acacia branch blocking half the road after last night's wind.",
    barangay: "Oro Site",
    assigned_office: "CDRRMO",
    priority: "medium"
  }
];

/**
 * Track — "one code, one place to check".
 *
 * One input at the top, the result beneath it, your own reports below that.
 *
 * The list of "your" reports is assembled from three sources that each know a
 * different subset, because no single one of them is complete:
 *
 *   the account      every report a signed-in resident filed, from any device
 *   the device RPC   reports filed anonymously from this browser
 *   IndexedDB        codes this browser has seen, including ones it only holds
 *                    locally because they have not been delivered yet
 *
 * They are merged by tracking code. The copy under the list says plainly that
 * this is a bookmark rather than the report — someone who thinks clearing their
 * browser deletes their report will be afraid to clear their browser, and
 * someone who thinks the list IS the report will panic on a new phone.
 */

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

/** Status key for the tab colour variables, which use "progress" not "in_progress". */
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
  return date.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function TrackScreen() {
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
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
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

  useEffect(() => {
    (async () => {
      const { data } = await getOffices();
      if (data) setOffices(data);
    })();
  }, []);

  const loadMine = useCallback(async () => {
    const merged = new Map();

    // Include demo resident reports for prototype tracking & map visualization
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

    // Check demo resident reports list
    const demoMatch = DEMO_RESIDENT_REPORTS.find((r) => r.tracking_code === c);
    if (demoMatch) {
      setReport(demoMatch);
      updateRememberedStatus(demoMatch.tracking_code, demoMatch.status);
      setHistory([
        { status: "received", changed_at: demoMatch.created_at, note: "Report received by Legazpi Command Center" },
        { status: demoMatch.status, changed_at: new Date(Date.now() - 1800000).toISOString(), note: `Status updated to ${demoMatch.status}` }
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

  const [reportMedia, setReportMedia] = useState([]);

  useEffect(() => {
    if (!report?.id) {
      setReportMedia([]);
      return;
    }
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
    <div className="flex flex-col gap-6 px-4 pb-8 pt-5">
      <div>
        <h1 className="t-title">Check a Report</h1>
        <p className="t-body-sm mt-1 text-ink-muted">
          Enter the code you were given when you filed.
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex flex-col gap-2">
        <label className="sr-only" htmlFor="track-code">Tracking code</label>
        <input
          id="track-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="SR-XXXX"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck="false"
          className="saro-field saro-field-code"
          aria-invalid={Boolean(error)}
        />
        <button
          type="submit"
          disabled={searching || !code.trim()}
          className="saro-btn saro-btn-primary saro-btn-lg saro-btn-block"
        >
          <Search width={16} height={16} />
          {searching ? "Checking…" : "Check"}
        </button>
      </form>

      {error && (
        <p role="alert" className="t-body-sm border border-alert bg-alert-wash px-3 py-2.5 text-alert">
          {error}
        </p>
      )}

      {/* ── The card ─────────────────────────────────────────────────────── */}
      {report && (
        <article
          className="saro-clip saro-rise saro-card overflow-hidden"
          style={{ boxShadow: `inset 0 4px 0 0 var(--color-status-${tabKey(report.status)}-tab)` }}
        >
          <div className="border-b border-rule p-5" style={{ borderTop: `4px solid var(--color-status-${tabKey(report.status)}-tab)` }}>
            <div className="flex items-center justify-between gap-3">
              <TrackingCode code={report.tracking_code} size="xl" />
              <button
                type="button"
                onClick={() => handleCopyCode(report.tracking_code)}
                className="saro-btn saro-btn-secondary saro-btn-sm text-xs py-1 px-2.5 flex items-center gap-1.5 shrink-0"
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
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusTag status={report.status} />
              <span className="t-body-sm text-ink-faint">filed {timeSince(report.created_at)}</span>
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-3 border-b border-rule p-5">
            <div>
              <dt className="t-label text-ink-faint">What Was Reported</dt>
              <dd className="t-body mt-1 font-bold text-ink leading-normal">
                {report.category_label ?? report.category}
              </dd>
            </div>
            <div>
              <dt className="t-label text-ink-faint">Handled By</dt>
              <dd className="t-body mt-1 flex items-center gap-1.5 font-medium">
                <Building2 width={14} height={14} className="text-ink-faint shrink-0" aria-hidden="true" />
                {offices.find((o) => o.short_name === report.assigned_office)?.full_name
                  ?? report.assigned_office ?? "Being routed"}
              </dd>
            </div>
            {report.barangay && (
              <div>
                <dt className="t-label text-ink-faint">Where</dt>
                <dd className="t-body mt-1 flex items-center gap-1.5 font-medium">
                  <MapPin width={14} height={14} className="text-ink-faint shrink-0" aria-hidden="true" />
                  {report.barangay}
                </dd>
              </div>
            )}
          </dl>

          {/* ── Resident Description (What You Wrote) ────────────────────── */}
          {report.description && (
            <div className="border-b border-rule p-5 bg-raised/30">
              <span className="t-label text-ink-faint flex items-center gap-1.5 font-bold mb-2">
                <MessageSquare width={13} height={13} className="text-brand shrink-0" aria-hidden="true" />
                What You Wrote (Your Description)
              </span>
              <p className="t-body text-ink leading-relaxed bg-surface p-3.5 rounded-xs border border-line shadow-xs font-sans whitespace-pre-wrap font-medium">
                "{report.description}"
              </p>
            </div>
          )}

          {/* ── Submitted Photo Evidence ──────────────────────────────────── */}
          {allPhotos.length > 0 && (
            <div className="border-b border-rule p-5 bg-raised/20">
              <span className="t-label text-ink-faint flex items-center gap-1.5 font-bold mb-3">
                <ImageIcon width={13} height={13} className="text-brand shrink-0" aria-hidden="true" />
                Submitted Photo Evidence ({allPhotos.length})
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {allPhotos.map((imgUrl, i) => (
                  <div key={i} className="relative rounded-xs overflow-hidden border border-line bg-sunken aspect-video shadow-xs group">
                    <button
                      type="button"
                      onClick={() => setLightboxUrl(imgUrl)}
                      className="w-full h-full text-left focus:outline-none"
                      aria-label={`View photo evidence ${i + 1}`}
                    >
                      <img
                        src={imgUrl}
                        alt={`Photo evidence ${i + 1}`}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Consolidated Single Map for Report Details */}
          {report.lat && report.lng && (
            <div className="border-b border-rule p-4 bg-raised">
              <span className="t-label text-ink-faint block mb-2 flex items-center gap-1.5 font-bold">
                <MapPin width={13} height={13} className="text-brand shrink-0" aria-hidden="true" />
                Reported Location Map
              </span>
              <div className="h-[200px] w-full rounded-xs overflow-hidden border border-line">
                <HazardMap
                  className="h-full w-full"
                  center={[
                    typeof report.lng === "string" ? parseFloat(report.lng) : report.lng,
                    typeof report.lat === "string" ? parseFloat(report.lat) : report.lat
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
          )}

          {/* ── Confirm / Dispute ──────────────────────────────────────── */}
          {canDispute && (
            <div className="border-b border-rule p-5 bg-emerald-50/60 border-l-4 border-l-emerald-500">
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-300/60 mt-0.5">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="t-subhead font-bold text-ink">
                    Was this hazard actually resolved?
                  </h2>
                  <p className="t-body-sm mt-1 text-ink-muted leading-relaxed">
                    {awaitingAnswer
                      ? `${report.assigned_office ?? "The office"} marked this resolved. You have the final say.`
                      : "This closed without an answer from you. If it was never fixed, you can still say so."}
                  </p>
                </div>
              </div>

              {!disputing ? (
                <div className="mt-4 flex flex-col sm:flex-row gap-2.5 w-full">
                  {awaitingAnswer && (
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={closureBusy}
                      className="saro-btn saro-btn-primary saro-btn-lg flex-1 min-h-[44px] justify-center text-xs font-bold whitespace-nowrap px-4"
                    >
                      <ThumbsUp width={16} height={16} className="shrink-0" />
                      <span>Yes, it is fixed</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDisputing(true)}
                    disabled={closureBusy}
                    className="saro-btn saro-btn-secondary saro-btn-lg flex-1 min-h-[44px] justify-center text-xs font-bold whitespace-nowrap px-4"
                  >
                    <RotateCcw width={16} height={16} className="shrink-0" />
                    <span>No, it is not fixed</span>
                  </button>
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-2">
                  <label htmlFor="dispute-reason" className="t-label text-ink-faint">
                    What is still wrong? (optional)
                  </label>
                  <textarea
                    id="dispute-reason"
                    rows={3}
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    placeholder="The drain is still blocked at the same spot."
                    className="saro-field w-full resize-none bg-white"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleDispute}
                      disabled={closureBusy}
                      className="saro-btn saro-btn-primary saro-btn-lg flex-1"
                    >
                      {closureBusy ? "Sending…" : "Reopen this report"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisputing(false)}
                      className="saro-btn saro-btn-ghost saro-btn-lg"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {awaitingAnswer && daysLeft !== null && (
                <p className="t-body-sm mt-3 text-ink-muted">
                  {daysLeft > 0
                    ? `If you do not answer, this closes as unconfirmed in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. You can still reopen it after that.`
                    : "This will close as unconfirmed shortly. You can still reopen it after that."}
                </p>
              )}
            </div>
          )}

          {closureNote && (
            <p role="status" className="t-body-sm border-b border-rule px-5 py-3 text-ink-muted">
              {closureNote}
            </p>
          )}

          {/* Progress Timeline */}
          <div className="p-5">
            <span className="t-label text-ink-faint">Progress</span>
            <ol className="mt-3 flex flex-col">
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
                          className="w-px flex-1"
                          style={{ background: done ? "var(--color-line-strong)" : "var(--color-line)" }}
                        />
                      )}
                    </span>
                    <span className={`pb-4 ${done ? "" : "opacity-45"}`}>
                      <span className={`t-body-sm block ${current ? "font-bold" : "font-semibold"}`}>
                        {STATUS_LABELS[step]}
                      </span>
                      {entry ? (
                        <>
                          <span className="t-data-sm block text-ink-faint">
                            {formatTimelineDate(entry)}
                          </span>
                          {entry.note && (
                            <span className="t-body-sm block text-ink-muted">{entry.note}</span>
                          )}
                        </>
                      ) : (
                        <span className="t-body-sm block text-ink-faint">Not yet</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>

            {(isClosed || report.status === "reopened") && (
              <div className="mt-2 border-t border-rule pt-4">
                <span className="t-label text-ink-faint">Outcome</span>
                <div className="mt-2">
                  <StatusTag status={report.status} />
                </div>
                <p className="t-body-sm mt-2 text-ink-muted">
                  {report.status === "closed_confirmed" &&
                    "You confirmed the work was done. Nothing further is needed."}
                  {report.status === "closed_unconfirmed" &&
                    `Closed automatically after ${AUTO_CLOSE_DAYS} days with no answer. The record shows nobody verified it.`}
                  {report.status === "reopened" &&
                    "You said this was not fixed. It went back to the office with its full history intact."}
                </p>
              </div>
            )}
          </div>

          {/* Report Ticket */}
          <div className="border-t border-rule p-5">
            <ReportTicket
              code={report.tracking_code}
              categoryLabel={report.category_label ?? report.category}
              filedAt={report.created_at}
            />
          </div>
        </article>
      )}

      {/* ── Waiting to send ──────────────────────────────────────────────── */}
      {queued.length > 0 && (
        <section>
          <h2 className="t-label flex items-center gap-2 text-ink-faint">
            <CloudOff width={13} height={13} aria-hidden="true" />
            Waiting to Send ({queued.length})
          </h2>
          <ul className="mt-3 flex flex-col">
            {queued.map((row) => (
              <li key={row.id} className="border-b border-line py-3">
                <span className="t-body-sm block font-bold">
                  {row.kind === "panic" ? "Panic alert" : "Report"} · saved {timeSince(row.created_at)}
                </span>
                <span className="t-body-sm block text-ink-muted">
                  {row.last_error
                    ? "Could not send yet. SARO keeps trying."
                    : "Will send when signal returns."}
                </span>
              </li>
            ))}
          </ul>
          <p className="t-body-sm mt-3 text-ink-faint">
            These are saved on this phone. You do not need to keep SARO open.
          </p>
        </section>
      )}

      {/* ── Single Consolidated Map of Reported Hazards (Shown when no report card is open) ── */}
      {!report && mine.length > 0 && (
        <section className="saro-card overflow-hidden shadow-xs border border-line">
          <div className="border-b border-line bg-raised px-4 py-3 flex items-center justify-between">
            <span className="t-label text-ink-faint flex items-center gap-1.5 font-bold">
              <MapPin width={14} height={14} className="text-brand shrink-0" aria-hidden="true" />
              Map of Your Reported Hazards ({mine.filter((r) => r.lat && r.lng).length})
            </span>
            <span className="t-micro text-ink-muted font-mono">Legazpi City</span>
          </div>
          <div className="h-[240px] w-full relative">
            <HazardMap
              className="h-full w-full"
              center={[123.7430, 13.1420]}
              zoom={13}
              showToggles={false}
              reports={mine
                .filter((r) => r.lat && r.lng)
                .map((r) => ({
                  id: r.tracking_code,
                  lat: typeof r.lat === "string" ? parseFloat(r.lat) : r.lat,
                  lng: typeof r.lng === "string" ? parseFloat(r.lng) : r.lng,
                  priority: r.priority || "medium",
                  color: `var(--color-status-${tabKey(r.status)}-tab)`,
                  onSelect: () => {
                    setCode(r.tracking_code);
                    search(r.tracking_code);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  },
                }))}
            />
          </div>
          <div className="p-2.5 bg-surface border-t border-line text-center">
            <span className="t-micro text-ink-muted font-medium">Tap any pin to view tracking status & details</span>
          </div>
        </section>
      )}

      {/* ── Your own reports List ─────────────────────────────────────────────── */}
      {mine.length > 0 && (
        <section>
          <h2 className="t-label text-ink-faint uppercase tracking-wider font-bold">
            {isResident ? "Your Reports" : "Reports From This Device"}
          </h2>
          <div className="mt-3 flex flex-col gap-3">
            {mine.slice(0, 12).map((r) => {
              const isSelected = report?.tracking_code === r.tracking_code;
              return (
                <button
                  key={r.tracking_code}
                  type="button"
                  onClick={() => {
                    setCode(r.tracking_code);
                    search(r.tracking_code);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className={`flex flex-col gap-2.5 p-4 text-left rounded-lg border transition-all shadow-2xs ${
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
                    <span className={`text-[13px] block leading-snug break-words flex-1 min-w-0 ${
                      isSelected ? "font-extrabold text-brand" : "font-semibold text-ink"
                    }`}>
                      {r.category_label ?? r.category}
                    </span>
                    <ChevronRight
                      width={16}
                      height={16}
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

          <div className="mt-4 p-3.5 rounded-lg border flex flex-col gap-2"
               style={{ borderColor: 'var(--color-brand-edge)', background: 'var(--color-brand-wash)' }}>
            <div className="flex items-start gap-2.5">
              <Info width={15} height={15} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
              <div className="text-xs text-ink-muted leading-relaxed">
                This list is saved locally on this phone. Clearing your browser removes the bookmark list, <strong className="font-bold text-ink">not the reports</strong> — every report stays with the city and can be searched by code.
              </div>
            </div>
            {!isResident && (
              <div className="pt-1 border-t border-brand-edge/50 flex items-center justify-between gap-2 mt-1">
                <span className="text-[11px] font-semibold text-brand">Keep history across devices?</span>
                <button
                  type="button"
                  onClick={() => setShowAuthModal(true)}
                  className="saro-btn saro-btn-primary saro-btn-sm text-xs py-1 px-2.5 flex items-center gap-1 shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  Sign In / Create Account
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {!report && !error && mine.length === 0 && queued.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Inbox width={26} height={26} className="text-ink-faint" aria-hidden="true" />
          <p className="t-subhead">Nothing to Show Yet</p>
          <p className="t-body-sm max-w-[34ch] text-ink-muted">
            Reports you file will appear here, and you can always look one up with its code.
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
      )}

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

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Search, Inbox, MapPin, Building2, ChevronRight, ThumbsUp, RotateCcw,
  CloudOff, Info,
} from "lucide-react";
import { StatusTag, TrackingCode } from "@saro/ui";
import {
  getReportByTrackingCode, getStatusHistory, getOffices,
  getReportsByDevice, getMyReports, saroEvents,
  confirmReport, disputeReport,
  listRememberedReports, updateRememberedStatus, listOutbox,
  CLIENT_STORAGE_KEYS, useAuth, STATUS_PIPELINE, STATUS_LABELS,
  CLOSED_STATUSES, AUTO_CLOSE_DAYS,
} from "@saro/shared";
import ReportTicket from "./ReportTicket";

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

    // The RPC, not a table read. Anonymous callers have no SELECT on reports at
    // all; this returns a narrow public projection with no description, photo,
    // contact number or device id in it.
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

  const stepIndex = report ? STATUS_PIPELINE.indexOf(report.status) : -1;
  const isClosed = report && CLOSED_STATUSES.includes(report.status);
  const awaitingAnswer = report?.status === "resolved";
  // A report the city closed without hearing back can still be disputed —
  // coming back after nine days and finding the drain still blocked must not be
  // a dead end.
  const canDispute = awaitingAnswer || report?.status === "closed_unconfirmed";
  const daysLeft = awaitingAnswer ? daysLeftToConfirm(report.resolved_at) : null;

  return (
    <div className="flex flex-col gap-6 px-4 pb-8 pt-5">
      <div>
        <h1 className="t-title">Check a report</h1>
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
          <div className="border-b border-rule p-5">
            <TrackingCode code={report.tracking_code} size="xl" />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusTag status={report.status} />
              <span className="t-body-sm text-ink-faint">filed {timeSince(report.created_at)}</span>
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-3 border-b border-rule p-5">
            <div>
              <dt className="t-label text-ink-faint">What was reported</dt>
              <dd className="t-body mt-1">{report.category_label ?? report.category}</dd>
            </div>
            <div>
              <dt className="t-label text-ink-faint">Handled by</dt>
              <dd className="t-body mt-1 flex items-center gap-1.5">
                <Building2 width={14} height={14} className="text-ink-faint" aria-hidden="true" />
                {offices.find((o) => o.short_name === report.assigned_office)?.full_name
                  ?? report.assigned_office ?? "Being routed"}
              </dd>
            </div>
            {report.barangay && (
              <div>
                <dt className="t-label text-ink-faint">Where</dt>
                <dd className="t-body mt-1 flex items-center gap-1.5">
                  <MapPin width={14} height={14} className="text-ink-faint" aria-hidden="true" />
                  {report.barangay}
                </dd>
              </div>
            )}
          </dl>

          {/* ── Confirm / Dispute ────────────────────────────────────────
           * The one moment SARO asks the resident for something. It appears
           * only when the city says the work is done, and it is a genuine
           * question rather than a satisfaction survey: answering "no" puts
           * the report back in front of the office that closed it.
           */}
          {canDispute && (
            <div
              className="border-b border-rule p-5"
              style={{ background: "var(--color-status-resolved-wash)" }}
            >
              <h2 className="t-subhead font-bold">
                {awaitingAnswer ? "Was this actually fixed?" : "Was this actually fixed?"}
              </h2>
              <p className="t-body-sm mt-1 text-ink-muted">
                {awaitingAnswer
                  ? `${report.assigned_office ?? "The office"} marked this resolved. You have the final say.`
                  : "This closed without an answer from you. If it was never fixed, you can still say so."}
              </p>

              {!disputing ? (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  {awaitingAnswer && (
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={closureBusy}
                      className="saro-btn saro-btn-primary saro-btn-lg flex-1"
                    >
                      <ThumbsUp width={16} height={16} />
                      Yes, it is fixed
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDisputing(true)}
                    disabled={closureBusy}
                    className="saro-btn saro-btn-secondary saro-btn-lg flex-1"
                  >
                    <RotateCcw width={16} height={16} />
                    No, it is not
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
                    className="saro-field w-full resize-none"
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

          {/* Progress as stamped steps. Closure is shown as an outcome below
              the pipeline, not as a fifth dot — "closed" is an ending, and
              rendering it as progress would imply it was a good one. */}
          <div className="p-5">
            <span className="t-label text-ink-faint">Progress</span>
            <ol className="mt-3 flex flex-col">
              {STATUS_PIPELINE.map((step, i) => {
                const entry = history.find((h) => h.status === step);
                // Once a report is closed or reopened it has been through the
                // whole pipeline, so every step reads as done rather than the
                // list appearing to have gone backwards.
                const done = isClosed || report.status === "reopened" ? true : i <= stepIndex;
                const current = i === stepIndex;
                return (
                  <li key={step} className="flex gap-3">
                    <span className="flex flex-col items-center">
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0"
                        style={{
                          background: done
                            ? `var(--color-status-${tabKey(step)}-tab)`
                            : "var(--color-line)",
                        }}
                      />
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
                            {new Date(entry.changed_at).toLocaleString("en-PH", {
                              dateStyle: "medium", timeStyle: "short",
                            })}
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

          {/* Everything needed to hold on to the code, on the screen where
              somebody has just looked it up. */}
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
            Waiting to send ({queued.length})
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

      {/* ── Your own reports ─────────────────────────────────────────────── */}
      {mine.length > 0 && (
        <section>
          <h2 className="t-label text-ink-faint">
            {isResident ? "Your reports" : "Reports from this device"}
          </h2>
          <ul className="mt-3 flex flex-col">
            {mine.slice(0, 12).map((r) => (
              <li key={r.tracking_code}>
                <button
                  onClick={() => { setCode(r.tracking_code); search(r.tracking_code); }}
                  className="flex w-full items-center gap-3 border-b border-line py-3 text-left"
                >
                  <span
                    className="h-8 w-1 shrink-0"
                    style={{ background: `var(--color-status-${tabKey(r.status)}-tab)` }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <TrackingCode code={r.tracking_code} />
                    <span className="t-body-sm block truncate text-ink-muted">
                      {r.category_label ?? r.category} · {timeSince(r.created_at)}
                    </span>
                  </span>
                  <StatusTag status={r.status} size="sm" />
                  <ChevronRight width={16} height={16} className="shrink-0 text-ink-faint" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>

          <p className="t-body-sm mt-3 flex items-start gap-2 text-ink-faint">
            <Info width={14} height={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              This list is a bookmark kept on this phone. Clearing your browser removes the
              list, <strong className="font-bold">not the reports</strong> — every one of
              them stays with the city and comes back the moment you type its code.
              {!isResident && " Create an account and the list follows you to a new phone."}
            </span>
          </p>
        </section>
      )}

      {!report && !error && mine.length === 0 && queued.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Inbox width={26} height={26} className="text-ink-faint" aria-hidden="true" />
          <p className="t-subhead">Nothing to show yet</p>
          <p className="t-body-sm max-w-[34ch] text-ink-muted">
            Reports you file will appear here, and you can always look one up with its code.
          </p>
        </div>
      )}
    </div>
  );
}

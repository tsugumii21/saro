import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Inbox, MapPin, Building2, ChevronRight } from "lucide-react";
import { StatusTag, TrackingCode } from "@saro/ui";
import {
  getReportByTrackingCode, getStatusHistory, getOffices,
  getReportsByDevice, getMyReports, saroEvents,
  CLIENT_STORAGE_KEYS, useAuth, STATUS_PIPELINE, STATUS_LABELS,
} from "@saro/shared";

/**
 * Track — "one code, one place to check".
 *
 * The old screen opened with a row of five hard-coded demo tracking codes
 * labelled "Quick Example Tracking Codes", which is a debug affordance shipped
 * to residents: it invites people to look up somebody else's report and it
 * makes the real input look optional. Gone.
 *
 * The screen now has exactly one input at the top, the result beneath it, and
 * your own reports below that. The result is a run card — clipped corner,
 * status on the leading edge, the code set large in the disambiguated mono —
 * so the thing you were handed and the thing you are looking at are visibly
 * the same object.
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

  useEffect(() => {
    (async () => {
      const { data } = await getOffices();
      if (data) setOffices(data);
    })();
  }, []);

  // Signed in → the account's reports, from any device. Guest → this browser's.
  useEffect(() => {
    (async () => {
      if (isResident) {
        const { data } = await getMyReports();
        if (data) setMine(data);
        return;
      }
      const deviceId = localStorage.getItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT);
      if (!deviceId) return;
      const { data } = await getReportsByDevice(deviceId);
      if (data) setMine(data);
    })();
  }, [isResident]);

  const search = useCallback(async (raw) => {
    const c = (raw ?? code).trim().toUpperCase();
    if (!c) return;
    setSearching(true);
    setError("");

    const { data, error: err } = await getReportByTrackingCode(c);
    if (err || !data) {
      setError(`No report found for ${c}. Check the code and try again.`);
      setReport(null);
      setHistory([]);
      setSearching(false);
      return;
    }
    setReport(data);
    const h = await getStatusHistory(data.tracking_code);
    setHistory(h.data ?? []);
    setSearching(false);
  }, [code]);

  useEffect(() => { if (preCode) search(preCode); }, [preCode, search]);

  // Live status changes for the report currently on screen.
  useEffect(() => {
    if (!report) return;
    return saroEvents.on("report:updated", () => search(report.tracking_code));
  }, [report, search]);

  const stepIndex = report ? STATUS_PIPELINE.indexOf(report.status) : -1;

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
          style={{ boxShadow: `inset 0 4px 0 0 var(--color-status-${
            report.status === "in_progress" ? "progress" : report.status
          }-tab)` }}
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

          {/* Progress as four stamped steps, not a percentage bar. Each step
              is a state the report was actually in, with the time it moved. */}
          <div className="p-5">
            <span className="t-label text-ink-faint">Progress</span>
            <ol className="mt-3 flex flex-col">
              {STATUS_PIPELINE.map((step, i) => {
                const entry = history.find((h) => h.status === step);
                const done = i <= stepIndex;
                const current = i === stepIndex;
                return (
                  <li key={step} className="flex gap-3">
                    <span className="flex flex-col items-center">
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0"
                        style={{
                          background: done
                            ? `var(--color-status-${step === "in_progress" ? "progress" : step}-tab)`
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
          </div>
        </article>
      )}

      {/* ── Your own reports ─────────────────────────────────────────────── */}
      {mine.length > 0 && (
        <section>
          <h2 className="t-label text-ink-faint">
            {isResident ? "Your reports" : "Reports from this device"}
          </h2>
          <ul className="mt-3 flex flex-col">
            {mine.slice(0, 8).map((r) => (
              <li key={r.tracking_code}>
                <button
                  onClick={() => { setCode(r.tracking_code); search(r.tracking_code); }}
                  className="flex w-full items-center gap-3 border-b border-line py-3 text-left"
                >
                  <span
                    className="h-8 w-1 shrink-0"
                    style={{ background: `var(--color-status-${
                      r.status === "in_progress" ? "progress" : r.status
                    }-tab)` }}
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
          {!isResident && (
            <p className="t-body-sm mt-3 text-ink-faint">
              This list lives on this phone only. Create an account and it follows you to a
              new one.
            </p>
          )}
        </section>
      )}

      {!report && !error && mine.length === 0 && (
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

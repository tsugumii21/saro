import { useState, useEffect, useCallback, useMemo } from "react";
import { Siren, Info, Radio, CheckCircle2, RefreshCw } from "lucide-react";
import { StatusTag, TrackingCode } from "@saro/ui";
import {
  getReports, getPanicFlags, getReportHistory, saroEvents, useAuth,
  SOS_REPEAT_WINDOW_MS, SOS_CATEGORY,
} from "@saro/shared";

/**
 * Emergency SOS — who pressed it, and whether anybody came.
 *
 * This screen used to be "Panic Press Review": a table of devices that had
 * pressed the button repeatedly, framed as abuse detection. Its own
 * documentation argued against that framing — a repeat press usually means the
 * first alert brought nobody — so the screen spent its first paragraph telling
 * the reader not to believe its own premise.
 *
 * It now asks the question that framing implied. Every SOS is listed by how
 * long it has been waiting, unanswered ones first, and a repeat press is shown
 * as what it almost always is: the same person asking again because nothing
 * happened. There is still no block, no throttle, and no way to silence a
 * device — that part was right and is unchanged. Wrongly ignoring a prank costs
 * a wasted trip; wrongly silencing a real emergency costs a life.
 *
 * The database still calls this `panic_flags`; the product calls it Emergency
 * SOS. See the note in shared/constants.js.
 */

function minutesSince(iso) {
  if (!iso) return null;
  const value = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  return Number.isFinite(value) ? value : null;
}

function waitLabel(iso) {
  const minutes = minutesSince(iso);
  if (minutes === null) return "—";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

function clockTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

/** Unanswered SOS get the alert tone. Nothing else on this screen does. */
function urgencyTone(report) {
  if (report.status !== "received") return "var(--color-ink-faint)";
  const minutes = minutesSince(report.created_at) ?? 0;
  if (minutes >= 15) return "var(--color-alert)";
  if (minutes >= 5) return "var(--color-status-assigned-ink)";
  return "var(--color-status-progress-ink)";
}

/**
 * One stage of the SOS queue.
 *
 * Declared at module scope rather than inside the screen: a component defined
 * during render is a new type on every render, so React unmounts and remounts
 * the whole list each time the minute clock ticks — losing scroll position on a
 * queue somebody is reading during an emergency.
 */
function Section({ title, description, Icon, tone, rows, empty, loading, renderRow }) {
  return (
    <section className="saro-card overflow-hidden">
      <header className="flex items-start gap-2.5 border-b border-line bg-raised px-4 py-3">
        <Icon width={16} height={16} style={{ color: tone }} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink">{title}</h2>
          <p className="mt-0.5 text-[11px] leading-tight text-ink-muted">{description}</p>
        </div>
        <span className="shrink-0 rounded border border-line bg-surface px-2 py-0.5 font-mono text-xs font-bold text-ink">
          {rows.length}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-ink-muted">{loading ? "Loading…" : empty}</p>
      ) : (
        <ul>{rows.map(renderRow)}</ul>
      )}
    </section>
  );
}

export default function SosReview() {
  const { viewerScope } = useAuth();

  const [sosReports, setSosReports] = useState([]);
  const [flags, setFlags] = useState([]);
  const [selected, setSelected] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    if (!viewerScope?.role) return;
    setLoadError("");
    const [reportsRes, flagsRes] = await Promise.all([
      getReports({ scope: viewerScope }),
      getPanicFlags(),
    ]);
    if (reportsRes.error) setLoadError(reportsRes.error);
    setSosReports(
      (reportsRes.data ?? []).filter(
        (report) => (report.category_id ?? report.category) === SOS_CATEGORY
      )
    );
    setFlags(flagsRes.data ?? []);
    setLoading(false);
  }, [viewerScope]);

  useEffect(() => {
    load();
    const u1 = saroEvents.on("report:created", load);
    const u2 = saroEvents.on("report:updated", load);
    return () => { u1(); u2(); };
  }, [load]);

  /* A minute clock: every number on this screen is an elapsed time, and a
     stopped clock on an emergency queue is worse than no clock. */
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  /* Repeat presses, keyed by the device that made them. The device token is a
     random browser-local value, not an identity — it tells us "the same phone
     asked again", which is the whole signal. */
  const repeatsByDevice = useMemo(() => {
    const map = new Map();
    for (const flag of flags) {
      if ((flag.flag_count ?? 0) > 1) map.set(flag.device_token, flag);
    }
    return map;
  }, [flags]);

  const waiting = useMemo(
    () =>
      sosReports
        .filter((r) => r.status === "received")
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    [sosReports]
  );

  const answering = useMemo(
    () =>
      sosReports
        .filter((r) => r.status === "assigned" || r.status === "in_progress")
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    [sosReports]
  );

  const finished = useMemo(
    () =>
      sosReports
        .filter((r) => !["received", "assigned", "in_progress"].includes(r.status))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 20),
    [sosReports]
  );

  const inspect = useCallback(async (report) => {
    setSelected(report);
    setTimeline([]);
    const { data } = await getReportHistory(report.id);
    setTimeline(data ?? []);
  }, []);

  const windowMinutes = SOS_REPEAT_WINDOW_MS / 60_000;

  const renderRow = (report) => {
    const repeat = repeatsByDevice.get(report.reporter_device_id);
    const isSelected = selected?.id === report.id;

    return (
      <li key={report.id} className="border-b border-line last:border-0">
        <button
          type="button"
          onClick={() => inspect(report)}
          aria-current={isSelected ? "true" : undefined}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
            isSelected ? "bg-brand-wash" : "hover:bg-raised"
          }`}
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: urgencyTone(report) }}
            aria-hidden="true"
          />
          <span className="shrink-0">
            <TrackingCode code={report.tracking_code} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-ink">
              {report.description?.trim() || "No description — the button was pressed and held."}
            </span>
            <span className="block truncate text-[11px] text-ink-muted">
              {report.barangays?.name ? `Brgy. ${report.barangays.name}` : "Location sent with the alert"}
              {" · "}
              {clockTime(report.created_at)}
            </span>
          </span>

          {repeat && (
            /* Not a suspicion badge. It is the same phone asking again, which is
               the strongest evidence on this screen that nobody has come. */
            <span className="shrink-0 rounded border border-alert bg-alert-wash px-1.5 py-0.5 text-[10px] font-bold text-alert">
              pressed {repeat.flag_count}×
            </span>
          )}

          <span
            className="shrink-0 font-mono text-xs font-bold tabular-nums"
            style={{ color: urgencyTone(report) }}
          >
            {report.status === "received" ? `waiting ${waitLabel(report.created_at)}` : waitLabel(report.created_at)}
          </span>
          <span className="shrink-0">
            <StatusTag status={report.status} size="sm" />
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="saro-card flex flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div>
          <h1 className="t-heading">Emergency SOS</h1>
          <p className="t-body-sm text-ink-muted">
            Every SOS press, oldest unanswered first.
          </p>
        </div>
        <button type="button" onClick={load} className="saro-btn saro-btn-secondary saro-btn-sm">
          <RefreshCw width={13} height={13} />
          Refresh
        </button>
      </div>

      <p className="t-body-sm flex items-start gap-2 border border-line bg-raised p-3 text-ink-muted">
        <Info width={15} height={15} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
        <span>
          SARO never blocks, throttles, or rate-limits an SOS, and nothing on this screen can. A
          second press within {windowMinutes} minutes is shown because it usually means the first
          alert brought nobody — read the report before deciding anything.
        </span>
      </p>

      {loadError && (
        <p role="alert" className="border border-alert bg-alert-wash p-3 text-xs font-semibold text-alert">
          {loadError}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <Section
            title="Waiting for a responder"
            description="Nobody has picked these up yet."
            Icon={Siren}
            tone="var(--color-alert)"
            rows={waiting}
            empty="Every SOS has been picked up."
            loading={loading}
            renderRow={renderRow}
          />
          <Section
            title="Being answered"
            description="An office has claimed these and is working."
            Icon={Radio}
            tone="var(--color-status-progress-ink)"
            rows={answering}
            empty="No SOS is currently in progress."
            loading={loading}
            renderRow={renderRow}
          />
          <Section
            title="Finished"
            description="Resolved, closed, or reopened. The 20 most recent."
            Icon={CheckCircle2}
            tone="var(--color-status-resolved-ink)"
            rows={finished}
            empty="No SOS has been closed yet."
            loading={loading}
            renderRow={renderRow}
          />
        </div>

        {selected && (
          <aside className="saro-card self-start overflow-hidden">
            <header className="border-b border-line bg-raised p-4">
              <span className="t-label flex items-center gap-1.5 text-ink-faint">
                <Siren width={13} height={13} aria-hidden="true" />
                What happened to this SOS
              </span>
              <div className="mt-2 flex items-center gap-2">
                <TrackingCode code={selected.tracking_code} />
                <StatusTag status={selected.status} size="sm" />
              </div>
              <p className="t-body-sm mt-2 text-ink-muted">
                {selected.description?.trim() || "No description was sent with the press."}
              </p>
              <p className="mt-1 text-[11px] text-ink-faint">
                Pressed {clockTime(selected.created_at)}
                {selected.status === "received" && ` · unanswered for ${waitLabel(selected.created_at)}`}
              </p>
            </header>

            <ol className="flex flex-col">
              {timeline.map((step, index) => {
                const elapsed = minutesSince(selected.created_at) ?? 0;
                const stepElapsed = Math.max(
                  0,
                  elapsed - (minutesSince(step.changed_at) ?? 0)
                );
                return (
                  <li key={step.id ?? `${step.status}-${index}`} className="border-b border-line p-3 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <StatusTag status={step.status} size="sm" />
                      <span className="font-mono text-[10px] text-ink-faint">
                        {index === 0 ? "on arrival" : `+${stepElapsed} min`}
                      </span>
                    </div>
                    {step.note && <p className="t-body-sm mt-1.5 text-ink-muted">{step.note}</p>}
                    <p className="t-data-sm mt-1 text-ink-faint">{clockTime(step.changed_at)}</p>
                  </li>
                );
              })}
              {timeline.length === 0 && (
                <li className="t-body-sm p-4 text-ink-muted">
                  Nothing has been recorded against this SOS yet — it is still exactly as it
                  arrived.
                </li>
              )}
            </ol>

            <p className="t-body-sm border-t border-line bg-raised p-3 text-ink-faint">
              There is no block action here, by design. If a device is genuinely abusing the system,
              that is a conversation for the barangay, not a switch on this screen.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

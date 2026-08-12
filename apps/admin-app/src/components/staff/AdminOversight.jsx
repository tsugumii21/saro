import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Inbox, Clock3, RefreshCw, CheckCircle2 } from "lucide-react";
import { StatusTag, TrackingCode } from "@saro/ui";
import {
  getReports, getCategories, getBarangays, getOffices, saroEvents,
  useAuth, daysSinceStatusUpdate,
  canDispatchReport, canEndorseReport, canReassignReport,
} from "@saro/shared";
import ReportDetailPanel from "./ReportDetailPanel";

/**
 * City oversight — what an administrator is actually for.
 *
 * The admin used to open Dispatch: the office queue with the office filter
 * removed, status buttons and all. That framed the city director as a
 * dispatcher with a bigger inbox, and it is the wrong job. An office answers
 * reports; the city answers for whether the system of offices is working.
 *
 * So this screen asks three questions an office cannot ask about itself:
 *
 *   Is anything past its SLA?      the promise the city made to a resident
 *   Is anything unrouted?          a report nobody has been made responsible for
 *   Is anything stalled?           claimed, then quietly abandoned
 *
 * And it offers exactly one write, on the report panel: reassign, with a reason,
 * recorded. Status stays with the office doing the work — see canDispatchReport
 * in @saro/shared, which answers `false` for admins.
 */

const STALL_DAYS = 3;

/** States an office can no longer act on. Same list Dispatch uses. */
function isTerminal(status) {
  return ["resolved", "closed_confirmed", "closed_unconfirmed", "reopened"].includes(status);
}

function hoursSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function ageLabel(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** One number and its name, styled as a SARO tabbed card. */
function Stat({ label, value, tabColor, tone, hint, alertWash }) {
  return (
    <div
      className={`flex min-w-[130px] flex-1 flex-col gap-1 rounded border border-line p-3 shadow-2xs transition-all ${
        alertWash ? "bg-alert-wash border-alert/40" : "bg-surface"
      }`}
      style={{ borderLeftWidth: "4px", borderLeftColor: tabColor }}
    >
      <span className="t-label text-[10px] font-bold uppercase tracking-wider text-ink-muted">{label}</span>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-extrabold leading-none tabular-nums" style={{ color: tone }}>
          {value}
        </span>
        {hint && <span className="text-[10px] font-medium text-ink-faint shrink-0">{hint}</span>}
      </div>
    </div>
  );
}

/**
 * A list of reports that need somebody at city level to look.
 *
 * Empty is the good outcome here, so the empty state says so plainly rather
 * than apologising for having nothing to show.
 */
function AttentionList({ title, description, Icon, tone, reports, emptyLabel, selectedId, onSelect, officeBy }) {
  return (
    <section className="saro-card flex min-h-0 flex-col overflow-hidden">
      <header className="flex items-start gap-2.5 border-b border-line bg-raised px-4 py-3">
        <Icon width={16} height={16} style={{ color: tone }} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink">{title}</h2>
          <p className="mt-0.5 text-[11px] leading-tight text-ink-muted">{description}</p>
        </div>
        <span className="shrink-0 rounded border border-line bg-surface px-2 py-0.5 font-mono text-xs font-bold text-ink">
          {reports.length}
        </span>
      </header>

      {reports.length === 0 ? (
        <div className="flex items-center gap-3 p-4 bg-status-resolved-wash/60 border-t border-status-resolved-tab/20 text-status-resolved-ink">
          <CheckCircle2 width={18} height={18} className="shrink-0 text-status-resolved-ink" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <span className="block text-xs font-bold uppercase tracking-wider">All Clear</span>
            <p className="text-xs text-status-resolved-ink/90 font-medium leading-tight mt-0.5">{emptyLabel}</p>
          </div>
        </div>
      ) : (
        <ul className="max-h-72 min-h-0 overflow-y-auto">
          {reports.map((report) => {
            const office = officeBy[report.assigned_office_id];
            const isSelected = String(selectedId) === String(report.id);
            const hrs = hoursSince(report.created_at);
            const isSevereBreach = hrs >= 24 || report.priority === "high";

            return (
              <li key={report.id} className="border-b border-line last:border-0">
                <button
                  type="button"
                  onClick={() => onSelect(report)}
                  aria-current={isSelected ? "true" : undefined}
                  className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors border-l-4 ${
                    isSelected
                      ? "border-brand bg-brand-wash"
                      : isSevereBreach
                      ? "border-alert bg-alert-wash/40 hover:bg-alert-wash/70"
                      : "border-transparent hover:bg-raised"
                  }`}
                >
                  <span className="shrink-0">
                    <TrackingCode code={report.tracking_code} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-ink">
                      {report.routing_table?.label ?? report.category}
                    </span>
                    <span className="block truncate text-[11px] text-ink-muted">
                      {report.barangays?.name ? `Brgy. ${report.barangays.name}` : "Legazpi City"}
                      {" · "}
                      {office?.short_name ?? "Unrouted"}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded font-mono text-[11px] font-bold tabular-nums px-2 py-0.5 ${
                      isSevereBreach
                        ? "bg-alert-wash text-alert border border-alert/30"
                        : "bg-sunken text-ink-muted border border-line/60"
                    }`}
                  >
                    {ageLabel(hrs)}
                  </span>
                  <span className="shrink-0">
                    <StatusTag status={report.status} size="sm" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function AdminOversight() {
  const { viewerScope, isAdmin } = useAuth();

  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [offices, setOffices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(async () => {
    if (!viewerScope?.role) return;
    setLoadError("");
    const [r, c, b, o] = await Promise.all([
      getReports({ scope: viewerScope }),
      getCategories(),
      getBarangays(),
      getOffices(),
    ]);
    if (r.error) setLoadError(r.error);
    if (r.data) setReports(r.data);
    if (c.data) setCategories(c.data);
    if (b.data) setBarangays(b.data);
    if (o.data) setOffices(o.data);
    setLoading(false);
  }, [viewerScope]);

  useEffect(() => {
    loadData();
    const u1 = saroEvents.on("report:created", loadData);
    const u2 = saroEvents.on("report:updated", loadData);
    return () => { u1(); u2(); };
  }, [loadData]);

  const catBy = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id ?? c.category, c])),
    [categories]
  );
  const brgyBy = useMemo(() => Object.fromEntries(barangays.map((b) => [b.id, b])), [barangays]);
  const officeBy = useMemo(() => Object.fromEntries(offices.map((o) => [o.id, o])), [offices]);

  /* A minute clock, so an SLA countdown keeps moving while somebody watches it
     rather than freezing until the next unrelated render. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const open = useMemo(
    () => reports.filter((r) => !isTerminal(r.status) || r.status === "reopened"),
    [reports]
  );

  const breached = useMemo(() => {
    return open
      .filter((r) => {
        const sla = catBy[r.category_id ?? r.category]?.sla_hours || 24;
        return (now - new Date(r.created_at).getTime()) / 3_600_000 > sla;
      })
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }, [open, catBy, now]);

  /* Unrouted means nobody was made responsible. The routing trigger assigns an
     office on insert, so a null here is a category with no rule or a rule that
     points at a deleted office — a configuration failure, not a queue. */
  const unrouted = useMemo(
    () => open.filter((r) => !r.assigned_office_id && !r.office_id),
    [open]
  );

  /* Claimed, then nothing. Distinct from breached: a report can be inside its
     SLA and still have had no human touch for days, and that is the failure a
     resident actually feels. */
  /* Deliberately not `isStaleReport`: that helper only speaks about
     infrastructure categories, because on the resident map a quiet pothole
     means something different from a quiet fire. Here the question is simply
     how long any claimed report has gone without a human touch. */
  const stalled = useMemo(
    () =>
      open
        .filter((r) => {
          if (r.status === "received") return false;
          const waiting = daysSinceStatusUpdate(r, now);
          return waiting !== null && waiting >= STALL_DAYS;
        })
        .sort((a, b) => (daysSinceStatusUpdate(b, now) ?? 0) - (daysSinceStatusUpdate(a, now) ?? 0)),
    [open, now]
  );

  /* Per-office load. The question this answers is not "who is busiest" but
     "whose promises are breaking", so overdue sits beside open rather than
     under it. */
  const officeLoad = useMemo(() => {
    const rows = offices.map((office) => {
      const mine = open.filter((r) => String(r.assigned_office_id ?? r.office_id) === String(office.id));
      const late = mine.filter((r) => {
        const sla = catBy[r.category_id ?? r.category]?.sla_hours || 24;
        return (now - new Date(r.created_at).getTime()) / 3_600_000 > sla;
      });
      return {
        id: office.id,
        name: office.short_name ?? office.full_name,
        open: mine.length,
        overdue: late.length,
      };
    });
    return rows.sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  }, [offices, open, catBy, now]);

  const sel = selected ? reports.find((r) => r.id === selected.id) || selected : null;
  const selCat = sel ? catBy[sel.category_id ?? sel.category] : null;

  if (!isAdmin) return null;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="saro-card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="t-heading text-ink font-bold">City Oversight</h1>
          <p className="t-body-sm text-ink-muted">
            City-wide · {reports.length} report{reports.length === 1 ? "" : "s"} on record
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex sm:items-stretch">
          <Stat
            label="Open"
            value={open.length}
            tabColor="var(--color-status-progress-tab)"
            tone="var(--color-status-progress-ink)"
          />
          <Stat
            label="Past SLA"
            value={breached.length}
            tabColor="var(--color-alert)"
            tone="var(--color-alert)"
            alertWash={breached.length > 0}
          />
          <Stat
            label="Unrouted"
            value={unrouted.length}
            tabColor="var(--color-status-received-tab)"
            tone="var(--color-status-received-ink)"
          />
          <Stat
            label="Stalled"
            value={stalled.length}
            tabColor="var(--color-status-assigned-tab)"
            tone="var(--color-status-assigned-ink)"
            hint={`>${STALL_DAYS}d`}
          />
        </div>
      </div>

      {/* The city director governs the system, so the one thing this screen must
          never do is quietly imply they run the queue. Said once, in plain
          words, rather than discovered by finding no buttons. */}
      <p className="flex items-start gap-2 border border-line bg-raised px-3.5 py-2.5 text-[11px] leading-relaxed text-ink-muted">
        <Building2 width={14} height={14} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
        <span>
          Statuses are set by the office holding the report. From here you can move a report to a
          different office, with a reason that goes on its permanent record — everything else on
          this screen is for reading.
        </span>
      </p>

      {loadError && (
        <p role="alert" className="border border-alert bg-alert-wash p-3 text-xs font-semibold text-alert">
          {loadError}
          <button type="button" onClick={loadData} className="saro-btn saro-btn-secondary saro-btn-sm ml-3">
            <RefreshCw width={13} height={13} /> Try again
          </button>
        </p>
      )}

      <div
        className="grid min-h-0 flex-1 gap-4"
        style={{ gridTemplateColumns: sel ? "minmax(0,1fr) 420px" : "minmax(0,1fr)" }}
      >
        <div className="flex min-w-0 flex-col gap-4 overflow-y-auto">
          <div className="grid gap-4 xl:grid-cols-2">
            <AttentionList
              title="Past its SLA"
              description="The city promised a response time and missed it."
              Icon={AlertTriangle}
              tone="var(--color-alert)"
              reports={breached}
              emptyLabel={loading ? "Loading…" : "Nothing is past its SLA right now."}
              selectedId={sel?.id}
              onSelect={setSelected}
              officeBy={officeBy}
            />
            <AttentionList
              title="Unrouted"
              description="No office has been made responsible for these."
              Icon={Inbox}
              tone="var(--color-status-received-ink)"
              reports={unrouted}
              emptyLabel={loading ? "Loading…" : "Every open report has an office."}
              selectedId={sel?.id}
              onSelect={setSelected}
              officeBy={officeBy}
            />
          </div>

          <AttentionList
            title="Stalled"
            description={`Claimed by an office, then no update for ${STALL_DAYS} days or more.`}
            Icon={Clock3}
            tone="var(--color-status-assigned-ink)"
            reports={stalled}
            emptyLabel={loading ? "Loading…" : "Nothing has gone quiet."}
            selectedId={sel?.id}
            onSelect={setSelected}
            officeBy={officeBy}
          />

          <section className="saro-card overflow-hidden">
            <header className="border-b border-line bg-raised px-4 py-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-ink">Load by office</h2>
              <p className="mt-0.5 text-[11px] text-ink-muted">
                Open work each office is carrying, and how much of it is late.
              </p>
            </header>
            {(() => {
              const maxOpen = Math.max(...officeLoad.map((r) => r.open), 1);
              return (
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-line bg-surface">
                      <th className="t-label px-4 py-2.5 text-left text-ink-faint">Office</th>
                      <th className="t-label px-4 py-2.5 text-left text-ink-faint">Workload Share</th>
                      <th className="t-label px-4 py-2.5 text-right text-ink-faint">Open</th>
                      <th className="t-label px-4 py-2.5 text-right text-ink-faint">Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {officeLoad.map((row) => {
                      const pct = Math.round((row.open / maxOpen) * 100);
                      return (
                        <tr key={row.id} className="border-b border-line last:border-0 hover:bg-raised/60 transition-colors">
                          <td className="px-4 py-2.5 font-bold text-ink">{row.name}</td>
                          <td className="px-4 py-2.5 w-1/3 min-w-[120px]">
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 rounded-full bg-sunken overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-brand-mid transition-all duration-300"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-ink-faint w-7 text-right">{pct}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums text-ink">{row.open}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {row.overdue > 0 ? (
                              <span className="inline-block rounded-full bg-alert-wash px-2 py-0.5 text-[11px] font-bold text-alert border border-alert/30">
                                {row.overdue}
                              </span>
                            ) : (
                              <span className="inline-block rounded-full bg-sunken/60 px-2 py-0.5 text-[11px] font-bold text-ink-faint">
                                0
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {officeLoad.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-ink-muted">
                          No offices are configured yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              );
            })()}
          </section>
        </div>

        {sel && (
          <ReportDetailPanel
            key={sel.id}
            report={sel}
            category={selCat}
            barangay={brgyBy[sel.barangay_id]}
            office={officeBy[sel.assigned_office_id]}
            offices={offices}
            canDispatch={canDispatchReport(viewerScope, sel)}
            canEndorse={canEndorseReport(viewerScope, sel)}
            canReassign={canReassignReport(viewerScope)}
            canDelete
            onClose={() => setSelected(null)}
            onUpdateSuccess={loadData}
          />
        )}
      </div>
    </div>
  );
}

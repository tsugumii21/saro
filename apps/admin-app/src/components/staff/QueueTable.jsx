import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, UserRound, Layers, MapPin, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { StatusTag, TrackingCode, statusTab } from "@saro/ui";
import { isStaleReport, daysSinceStatusUpdate, STALE_REPORT_LABEL, STATUS_PIPELINE } from "@saro/shared";

/**
 * The rack.
 *
 * What the old queue was: a table with five equal-weight columns, three layout
 * modes, a sort control, and a pagination bar — every element competing, and
 * nothing telling a dispatcher which row to touch first. On a busy afternoon
 * that meant reading the whole table to find the one incident that mattered.
 *
 * What it is now: a rack of run cards, ordered by how close each is to failing
 * its SLA. The information hierarchy is deliberate and narrow:
 *
 *   1. Time pressure. The urgency dot is the only saturated colour on an
 *      ordinary row. A dispatcher scanning the left edge alone gets the triage
 *      answer.
 *   2. The code. Mono, disambiguated, the handle for everything else.
 *   3. What and where. Enough to decide, not enough to read as prose.
 *   4. When it was filed. Relative, because "3h ago" is a decision and a
 *      timestamp is arithmetic.
 *   5. Status. A tab, because it is a state, not a headline.
 *
 * Density is a feature here, not a compromise: this is read for hours at a
 * desk, so rows are 44px, rules are hairlines, numerals are tabular, and there
 * is no zebra striping — the printed non-photo-blue ruling does that job
 * without adding a second value to the page.
 */

/** How often the relative timestamps re-render. Below an hour they tick by the
 *  minute, so half a minute keeps every label honest without busy work. */
const TICK_MS = 30_000;

function hoursSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function ageLabel(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * When it was filed, in the words a dispatcher would use.
 *
 * Days are spelled out ("2 days ago") rather than compressed to "2d" because
 * this column is read as language, not scanned as a figure — the mono column
 * next to it already carries the scannable serial.
 */
function relativeTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/** The precise reading, matching the detail panel's "Filed At" exactly. */
function exactTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Statuses that sink to the bottom of the rack.
 *
 * 'reopened' is deliberately absent. A resident saying the work did not hold is
 * live, urgent, and owed to the office that already called it done — sorting it
 * with the finished work is how a disputed report gets ignored twice.
 */
const SETTLED = new Set(["resolved", "closed_confirmed", "closed_unconfirmed"]);

/**
 * Lifecycle order for the Status sort: the pipeline first, then the states a
 * report can only reach after it. Anything unrecognised sorts last rather than
 * silently landing at the top.
 */
const STATUS_ORDER = [...STATUS_PIPELINE, "reopened", "closed_confirmed", "closed_unconfirmed"];
const statusRank = (status) => {
  const i = STATUS_ORDER.indexOf(status);
  return i === -1 ? STATUS_ORDER.length : i;
};

/**
 * The SLA signal that survived the column change.
 *
 * The Reported column answers "when did this come in"; it cannot answer "which
 * of these is about to breach", and that second question is the one that
 * decides what a dispatcher touches next. So the urgency reading stays,
 * compressed from a bar into a dot that sits at the head of the timestamp.
 *
 * Three carriers, never colour alone: hue, the written state in the tooltip,
 * and screen-reader text. Overdue is --color-alert and never the reserved panic
 * vermilion — a breached SLA is an operational failure, not somebody in danger.
 */
function UrgencyDot({ createdAt, slaHours, settled }) {
  if (settled) {
    return (
      <span
        className="inline-block shrink-0 rounded-full"
        style={{ width: 7, height: 7, background: "var(--color-line-strong)" }}
        title="Closed — no SLA running"
      >
        <span className="sr-only">Closed</span>
      </span>
    );
  }

  const elapsed = hoursSince(createdAt);
  const remaining = slaHours - elapsed;
  const over = remaining < 0;
  const nearly = !over && elapsed / slaHours > 0.75;

  const tone = over
    ? "var(--color-alert)"
    : nearly
      ? "var(--color-status-assigned-tab)"
      : "var(--color-status-progress-tab)";

  const state = over
    ? `Overdue by ${ageLabel(-remaining)}`
    : nearly
      ? `Due soon — ${ageLabel(remaining)} left`
      : `On track — ${ageLabel(remaining)} left`;

  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: 7,
        height: 7,
        background: tone,
        // The breached state gets a ring as well as a hue, so it separates
        // from "due soon" in greyscale and for a red-green colourblind reader.
        boxShadow: over ? "0 0 0 2px var(--color-alert-wash)" : "none",
      }}
      title={state}
    >
      <span className="sr-only">{state}</span>
    </span>
  );
}

/** Confirmed account vs anonymous device. Quiet by design — see the badge note. */
function Provenance({ verified }) {
  const Icon = verified ? ShieldCheck : UserRound;
  return (
    <span
      title={verified ? "Filed from a confirmed resident account" : "Filed anonymously from a device"}
      className="inline-flex"
      style={{ color: verified ? "var(--color-status-resolved-ink)" : "var(--color-ink-faint)" }}
    >
      <Icon width={13} height={13} strokeWidth={2.4} aria-hidden="true" />
      <span className="sr-only">{verified ? "Verified account" : "Guest report"}</span>
    </span>
  );
}

/**
 * A column header that sorts.
 *
 * The arrow is only drawn on the active column; the inactive columns carry a
 * muted double-chevron so a dispatcher can tell at a glance which headers are
 * even sortable, without the table growing a row of competing arrows.
 */
function SortHeader({ label, column, sort, onSort, className = "" }) {
  const active = sort.column === column;
  const ascending = sort.direction === "asc";
  const Icon = active ? (ascending ? ChevronUp : ChevronDown) : ChevronsUpDown;

  return (
    <th
      className={`t-label px-3 py-2.5 text-left ${className}`}
      style={{ color: "var(--color-ink-faint)" }}
      aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="t-label inline-flex items-center gap-1 hover:text-ink"
        style={{ color: active ? "var(--color-ink)" : "inherit" }}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <Icon
          width={12}
          height={12}
          strokeWidth={2.5}
          aria-hidden="true"
          style={{ opacity: active ? 1 : 0.45 }}
        />
      </button>
    </th>
  );
}

export default function QueueTable({
  reports,
  categories,
  barangays,
  selectedId,
  onSelect,
}) {
  /* null column = the triage order below, which is the screen's default and
     the thing a dispatcher gets without asking for anything. */
  const [sort, setSort] = useState({ column: null, direction: "asc" });

  /* Relative labels are computed at render, so the table needs a heartbeat to
     stay true. Nothing is fetched — this only re-runs the formatting. */
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const catBy = useMemo(
    () => Object.fromEntries((categories ?? []).map((c) => [c.id ?? c.category, c])),
    [categories]
  );
  const brgyBy = useMemo(
    () => Object.fromEntries((barangays ?? []).map((b) => [b.id, b])),
    [barangays]
  );

  /**
   * Reported sorts oldest first, Status sorts down the pipeline; a second click
   * reverses either. Both act on `reports` exactly as handed over, which is the
   * already-filtered set — the active tab is the caller's state and nothing
   * here can reach it.
   */
  const onSort = (column) =>
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" }
    );

  const ordered = useMemo(() => {
    const rows = [...(reports ?? [])];

    if (sort.column === "reported") {
      const flip = sort.direction === "asc" ? 1 : -1;
      // Ascending is oldest first, so the earliest timestamp leads.
      return rows.sort(
        (a, b) => flip * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      );
    }

    if (sort.column === "status") {
      const flip = sort.direction === "asc" ? 1 : -1;
      return rows.sort((a, b) => {
        const byStatus = statusRank(a.status) - statusRank(b.status);
        // Within one status the newest is the one still worth looking at.
        return byStatus !== 0
          ? flip * byStatus
          : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }

    // Default triage order: unresolved first, then by how far through its SLA
    // it is. This is the screen's single most important behaviour — the top row
    // should always be the row a dispatcher should touch next.
    return rows.sort((a, b) => {
      const aDone = SETTLED.has(a.status);
      const bDone = SETTLED.has(b.status);
      if (aDone !== bDone) return aDone ? 1 : -1;
      const aSla = catBy[a.category_id ?? a.category]?.sla_hours || 24;
      const bSla = catBy[b.category_id ?? b.category]?.sla_hours || 24;
      return hoursSince(b.created_at) / bSla - hoursSince(a.created_at) / aSla;
    });
  }, [reports, catBy, sort]);

  if (!ordered.length) {
    return (
      <div className="saro-card flex flex-col items-center gap-2 px-6 py-16 text-center">
        <span className="t-subhead">Nothing in this queue</span>
        <span className="t-body-sm" style={{ color: "var(--color-ink-muted)" }}>
          Reports routed to your office will appear here as they arrive.
        </span>
      </div>
    );
  }

  return (
    <div className="saro-card overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ background: "var(--color-raised)" }}>
            <th className="w-1" aria-label="Status colour" />
            <th className="t-label px-3 py-2.5 text-left" style={{ color: "var(--color-ink-faint)" }}>Code</th>
            <th className="t-label px-3 py-2.5 text-left" style={{ color: "var(--color-ink-faint)" }}>Incident</th>
            <th className="t-label px-3 py-2.5 text-left" style={{ color: "var(--color-ink-faint)" }}>Barangay</th>
            <SortHeader label="Reported" column="reported" sort={sort} onSort={onSort} />
            <SortHeader label="Status" column="status" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => {
            const cat = catBy[r.category_id ?? r.category];
            const brgy = brgyBy[r.barangay_id];
            const done = SETTLED.has(r.status);
            const selected = r.id === selectedId;
            const clustered = r.cluster_id && (r.confidence_score ?? 1) > 1;

            return (
              <tr
                key={r.id}
                onClick={() => onSelect?.(r)}
                aria-selected={selected}
                className="cursor-pointer align-middle"
                style={{
                  borderTop: "1px solid var(--color-rule-faint)",
                  background: selected ? "var(--color-brand-wash)" : "transparent",
                  opacity: done ? 0.62 : 1,
                }}
              >
                {/* The index tab. The left edge alone carries the state. */}
                <td style={{ background: statusTab(r.status), width: 4, padding: 0 }} />

                <td className="whitespace-nowrap px-3 py-2.5">
                  <span className="flex items-center gap-1.5">
                    <TrackingCode code={r.tracking_code} />
                    <Provenance verified={r.filed_by_verified} />
                    {r.priority === "high" && (
                      <span
                        className="t-micro ml-1.5 inline-flex items-center gap-1 border px-1.5 py-0.5"
                        style={{
                          borderColor: "var(--color-alert)",
                          color: "var(--color-alert)",
                        }}
                        title={r.priority_reason ?? "Inside an active hazard zone"}
                      >
                        IN HAZARD ZONE
                      </span>
                    )}
                    {clustered && (
                      <span
                        className="t-data-sm inline-flex items-center gap-0.5 px-1"
                        title={`${r.confidence_score} people reported this`}
                        style={{ color: "var(--color-brand)", background: "var(--color-brand-wash)" }}
                      >
                        <Layers width={10} height={10} />
                        {r.confidence_score}
                      </span>
                    )}
                    {/* Nothing is hidden or removed — an infrastructure report
                        that no office has moved in REPORT_STALE_DAYS_INFRASTRUCTURE
                        days is marked so an ageing backlog becomes visible here,
                        which is the screen where it can be acted on. */}
                    {isStaleReport(r) && (
                      <span
                        className="t-micro ml-1.5 inline-flex items-center gap-1 border px-1.5 py-0.5"
                        style={{
                          borderColor: "var(--color-status-assigned-tab)",
                          color: "var(--color-status-assigned-ink)",
                        }}
                        title={`${STALE_REPORT_LABEL} — no office update in ${daysSinceStatusUpdate(r)} days`}
                      >
                        STALE
                      </span>
                    )}
                  </span>
                </td>

                <td className="max-w-[380px] px-3 py-2.5">
                  <span className="t-body-sm block truncate font-semibold">
                    {cat?.name ?? cat?.label ?? r.category}
                  </span>
                  <span
                    className="t-body-sm block truncate"
                    style={{ color: "var(--color-ink-faint)" }}
                  >
                    {r.description}
                  </span>
                </td>

                <td className="whitespace-nowrap px-3 py-2.5">
                  <span
                    className="t-body-sm inline-flex items-center gap-1"
                    style={{ color: "var(--color-ink-muted)" }}
                  >
                    <MapPin width={12} height={12} style={{ color: "var(--color-ink-faint)" }} />
                    {brgy?.name ?? "—"}
                  </span>
                </td>

                {/* When it was filed, with the SLA reading kept as a dot and the
                    exact stamp one hover away. */}
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span
                    className="t-data-sm inline-flex items-center gap-1.5"
                    style={{ color: "var(--color-ink-muted)" }}
                    title={`Filed ${exactTime(r.created_at)}`}
                  >
                    <UrgencyDot
                      createdAt={r.created_at}
                      slaHours={cat?.sla_hours || 24}
                      settled={done}
                    />
                    <time dateTime={r.created_at}>{relativeTime(r.created_at)}</time>
                  </span>
                </td>

                <td className="whitespace-nowrap px-3 py-2.5">
                  <StatusTag status={r.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

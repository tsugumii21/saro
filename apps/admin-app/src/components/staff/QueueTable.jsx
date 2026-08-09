import { useMemo } from "react";
import { ShieldCheck, UserRound, Layers, MapPin } from "lucide-react";
import { StatusTag, TrackingCode, statusTab } from "@saro/ui";

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
 *   1. Time pressure. The SLA bar is the only element with saturated colour on
 *      an ordinary row, and a breached card turns its whole leading edge. A
 *      dispatcher scanning the left edge alone gets the triage answer.
 *   2. The code. Mono, disambiguated, the handle for everything else.
 *   3. What and where. Enough to decide, not enough to read as prose.
 *   4. Status. A tab, because it is a state, not a headline.
 *
 * Density is a feature here, not a compromise: this is read for hours at a
 * desk, so rows are 44px, rules are hairlines, numerals are tabular, and there
 * is no zebra striping — the printed non-photo-blue ruling does that job
 * without adding a second value to the page.
 */

function hoursSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function ageLabel(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * SLA as a filled bar rather than a number.
 *
 * A percentage requires arithmetic; a bar that is nearly full does not. The
 * bar carries a written remainder for anyone who needs the figure, and the
 * breached state adds the word OVERDUE so colour is never the only signal.
 *
 * Note the colour choice: an overdue report is an operational failure, not an
 * emergency, so this uses --color-alert and never the reserved panic vermilion.
 */
function SlaBar({ createdAt, slaHours, resolved }) {
  if (resolved) {
    return (
      <span className="t-data-sm" style={{ color: "var(--color-ink-faint)" }}>
        closed
      </span>
    );
  }
  const elapsed = hoursSince(createdAt);
  const pct = Math.min((elapsed / slaHours) * 100, 100);
  const over = elapsed > slaHours;
  const remaining = slaHours - elapsed;

  const fill = over
    ? "var(--color-alert)"
    : pct > 75
      ? "var(--color-status-assigned-tab)"
      : "var(--color-status-progress-tab)";

  return (
    <span className="flex flex-col gap-1" style={{ minWidth: 84 }}>
      <span
        className="relative block h-1.5 w-full overflow-hidden"
        style={{ background: "var(--color-sunken)" }}
        role="img"
        aria-label={over ? `Overdue by ${ageLabel(-remaining)}` : `${ageLabel(remaining)} remaining`}
      >
        <span
          className="absolute inset-y-0 left-0"
          style={{ width: `${pct}%`, background: fill }}
        />
      </span>
      <span
        className="t-data-sm"
        style={{ color: over ? "var(--color-alert)" : "var(--color-ink-muted)" }}
      >
        {over ? `OVERDUE ${ageLabel(-remaining)}` : `${ageLabel(remaining)} left`}
      </span>
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
 * Statuses that sink to the bottom of the rack.
 *
 * 'reopened' is deliberately absent. A resident saying the work did not hold is
 * live, urgent, and owed to the office that already called it done — sorting it
 * with the finished work is how a disputed report gets ignored twice.
 */
const SETTLED = new Set(["resolved", "closed_confirmed", "closed_unconfirmed"]);

export default function QueueTable({
  reports,
  categories,
  barangays,
  selectedId,
  onSelect,
}) {
  const catBy = useMemo(
    () => Object.fromEntries((categories ?? []).map((c) => [c.id ?? c.category, c])),
    [categories]
  );
  const brgyBy = useMemo(
    () => Object.fromEntries((barangays ?? []).map((b) => [b.id, b])),
    [barangays]
  );

  // Triage order: unresolved first, then by how far through its SLA it is.
  //
  // This is the screen's single most important behaviour — the top row should
  // always be the row a dispatcher should touch next.
  const ordered = useMemo(() => {
    return [...(reports ?? [])].sort((a, b) => {
      const aDone = SETTLED.has(a.status);
      const bDone = SETTLED.has(b.status);
      if (aDone !== bDone) return aDone ? 1 : -1;
      const aSla = catBy[a.category_id ?? a.category]?.sla_hours || 24;
      const bSla = catBy[b.category_id ?? b.category]?.sla_hours || 24;
      return hoursSince(b.created_at) / bSla - hoursSince(a.created_at) / aSla;
    });
  }, [reports, catBy]);

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
            <th className="t-label px-3 py-2.5 text-left" style={{ color: "var(--color-ink-faint)" }}>Time Left</th>
            <th className="t-label px-3 py-2.5 text-left" style={{ color: "var(--color-ink-faint)" }}>Status</th>
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

                <td className="px-3 py-2.5">
                  <SlaBar
                    createdAt={r.created_at}
                    slaHours={cat?.sla_hours || 24}
                    resolved={done}
                  />
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

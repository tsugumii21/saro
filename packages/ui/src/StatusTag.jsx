import {
  CircleDashed, ArrowRightCircle, Activity, Check,
  CheckCheck, Archive, RotateCcw,
} from "lucide-react";

/**
 * The pipeline's index tab.
 *
 * Colour is never load-bearing on its own here. Every state ships a distinct
 * colour, a distinct icon SHAPE, and the written word, so the tag survives
 * deuteranopia, a sunlit phone screen, and the washed-out monitor in a
 * barangay hall. Take the colour away and the icon still separates the six;
 * take the icon away and the word still does.
 *
 * The six colours are anchored on the Okabe-Ito colourblind-safe set and
 * darkened where they needed to clear 4.5:1 on white. None of them is the
 * panic vermilion, which is reserved and never appears in this component.
 */

/**
 * Closure is two states, not one, and they are drawn as two.
 *
 * closed_confirmed carries the resolved green and a double check: a resident
 * looked at the work and said it was done. closed_unconfirmed carries the
 * neutral archive grey: the city says it is finished and nobody corroborated
 * that. Collapsing both into one "Closed" tag would let an office's record read
 * identically whether residents were satisfied or simply never heard from,
 * which is exactly the fact this pair exists to keep visible.
 */
export const STATUS_META = {
  received:           { label: "Received",            Icon: CircleDashed,     key: "received" },
  assigned:           { label: "Assigned",            Icon: ArrowRightCircle, key: "assigned" },
  in_progress:        { label: "In Progress",         Icon: Activity,         key: "progress" },
  resolved:           { label: "Resolved",            Icon: Check,            key: "resolved" },
  closed_confirmed:   { label: "Closed · Confirmed",  Icon: CheckCheck,       key: "resolved" },
  closed_unconfirmed: { label: "Closed · No reply",   Icon: Archive,          key: "closed" },
  reopened:           { label: "Reopened",            Icon: RotateCcw,        key: "reopened" },
  // Retained so a row written before migration 10 still renders.
  closed:             { label: "Closed",              Icon: Archive,          key: "closed" },
};

export function statusTab(status) {
  const key = STATUS_META[status]?.key ?? "received";
  return `var(--color-status-${key}-tab)`;
}

export default function StatusTag({ status, size = "md" }) {
  const meta = STATUS_META[status] ?? STATUS_META.received;
  const { label, Icon, key } = meta;
  const iconSize = size === "sm" ? 11 : 13;

  return (
    <span
      className="saro-status"
      style={{
        color: `var(--color-status-${key}-ink)`,
        background: `var(--color-status-${key}-wash)`,
        boxShadow: `inset 2px 0 0 0 var(--color-status-${key}-tab)`,
      }}
    >
      <Icon width={iconSize} height={iconSize} strokeWidth={2.5} aria-hidden="true" />
      {label}
    </span>
  );
}

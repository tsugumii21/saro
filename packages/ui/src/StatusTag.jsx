import { CircleDashed, ArrowRightCircle, Activity, Check, Archive, RotateCcw } from "lucide-react";

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

export const STATUS_META = {
  received:    { label: "Received",    Icon: CircleDashed,      key: "received" },
  assigned:    { label: "Assigned",    Icon: ArrowRightCircle,  key: "assigned" },
  in_progress: { label: "In Progress", Icon: Activity,          key: "progress" },
  resolved:    { label: "Resolved",    Icon: Check,             key: "resolved" },
  closed:      { label: "Closed",      Icon: Archive,           key: "closed" },
  reopened:    { label: "Reopened",    Icon: RotateCcw,         key: "reopened" },
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

import { Mountain, ExternalLink } from "lucide-react";

/**
 * Mayon's current alert level.
 *
 * Set by hand by a city administrator, never scraped. A scraper that silently
 * broke against a redesigned PHIVOLCS page would leave SARO displaying a stale
 * level with total confidence, and people make evacuation decisions on this
 * number — a confidently wrong "Level 1" is worse than an obvious blank.
 *
 * So the badge shows three things together and never one without the others:
 * the level, how long since a human last verified it, and a link to the
 * official bulletin. The age is the honesty mechanism. Past 24 hours it stops
 * reading as current and says so.
 */

const LEVELS = {
  0: { name: "Normal", meaning: "No magmatic eruption in the foreseeable future.", tone: "resolved" },
  1: { name: "Low unrest", meaning: "Slight increase in activity. Entry into the danger zone is not advised.", tone: "assigned" },
  2: { name: "Moderate unrest", meaning: "Increasing unrest. Danger zone entry is prohibited.", tone: "assigned" },
  3: { name: "High unrest", meaning: "Magma is at the crater. Hazardous eruption is possible within weeks.", tone: "alert" },
  4: { name: "Hazardous eruption imminent", meaning: "Hazardous eruption possible within days.", tone: "panic" },
  5: { name: "Hazardous eruption ongoing", meaning: "Life-threatening eruption in progress.", tone: "panic" },
};

const TONE_COLOR = {
  resolved: "var(--color-status-resolved-ink)",
  assigned: "var(--color-status-assigned-ink)",
  alert: "var(--color-alert)",
  panic: "var(--color-panic-strong)",
};

function ageLabel(iso) {
  if (!iso) return { text: "never verified", stale: true };
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return { text: "verified in the last hour", stale: false };
  if (hours < 24) return { text: `verified ${Math.floor(hours)}h ago`, stale: false };
  const days = Math.floor(hours / 24);
  return { text: `last verified ${days} day${days === 1 ? "" : "s"} ago`, stale: true };
}

export default function AlertLevelBadge({ alert, compact = false }) {
  if (!alert) return null;

  const level = LEVELS[alert.alert_level] ?? LEVELS[0];
  const color = TONE_COLOR[level.tone];
  const age = ageLabel(alert.last_verified_at);

  return (
    <div
      className="saro-card flex flex-col gap-1 p-3"
      style={{ borderColor: color }}
      role="status"
    >
      <div className="flex items-center gap-2">
        <Mountain width={15} height={15} style={{ color }} aria-hidden="true" />
        <span className="t-label text-ink-faint">{alert.volcano ?? "Mayon"} alert level</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="t-code" style={{ fontSize: 26, lineHeight: "28px", color }}>
          {alert.alert_level}
        </span>
        <span className="t-body-sm font-bold" style={{ color }}>{level.name}</span>
      </div>

      {!compact && (
        <p className="t-body-sm text-ink-muted">{alert.summary?.trim() || level.meaning}</p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule pt-1.5">
        <span
          className="t-body-sm"
          style={{ color: age.stale ? "var(--color-alert)" : "var(--color-ink-faint)" }}
        >
          {age.text}
        </span>
        <a
          href={alert.bulletin_url}
          target="_blank"
          rel="noopener noreferrer"
          className="t-body-sm inline-flex items-center gap-1 text-brand-bright underline"
        >
          PHIVOLCS bulletin
          <ExternalLink width={11} height={11} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

export { LEVELS as ALERT_LEVELS };

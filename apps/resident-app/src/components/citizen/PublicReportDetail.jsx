import { useEffect, useState } from "react";
import { MapPin, Clock, X, Building2, Loader2, Image as ImageIcon, BadgeCheck } from "lucide-react";
import { StatusTag } from "@saro/ui";
import { getPublicReport, getPublicReportTimeline, getReportMedia, STATUS_LABELS } from "@saro/shared";

/**
 * The full report behind a public map pin.
 *
 * Opened by id, never by tracking code. The code is what the person who filed
 * the report uses to confirm or dispute its resolution, so it is not published
 * on a map anyone can open — which is also why this view is read-only: it shows
 * what happened and who is handling it, and offers no action on the report.
 */

function formatWhen(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Every hazard filed at one map point.
 *
 * The pin popup shows the first couple and defers here rather than growing a
 * scrollbar in front of its own buttons.
 */
function LocationList({ groups, locationLabel, onOpenReport, onClose }) {
  const total = groups.reduce((sum, group) => sum + (group.count ?? 1), 0);

  return (
    <div className="fixed inset-0 z-[900] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close list"
        className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reports at this location"
        className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <span className="t-label text-ink-faint">Reports at this location</span>
            <h2 className="mt-1 text-base font-bold leading-snug text-ink">
              {total} report{total === 1 ? "" : "s"}
              {locationLabel ? ` · ${locationLabel}` : ""}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-5">
          {groups.map((group) => {
            /* The pin stamped each row with whether it is the reader's, so this
               list and the popup it came from agree on what "yours" means. */
            const rowIsMine = Boolean(group.report?.is_mine);
            return (
            <li
              key={group.id}
              className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                rowIsMine ? "border-brand-edge bg-brand-wash/50" : "border-line bg-raised"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-bold text-ink">
                    {group.report?.categoryName || group.report?.category_label || group.report?.category || "Hazard report"}
                  </span>
                  {rowIsMine && (
                    <span className="flex shrink-0 items-center gap-1 rounded border border-brand-edge bg-brand-wash px-1.5 py-px text-[10px] font-bold text-brand">
                      <BadgeCheck className="h-2.5 w-2.5" aria-hidden="true" />
                      Yours
                    </span>
                  )}
                  {group.count > 1 && (
                    <span className="shrink-0 rounded border border-brand-edge bg-brand-wash px-1.5 py-px font-mono text-[10px] font-bold text-brand">
                      ×{group.count}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <StatusTag status={group.report?.status || "received"} size="sm" />
                  <span className="truncate text-[10px] text-ink-faint">
                    {group.report?.timeSinceStr || formatWhen(group.report?.created_at)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onOpenReport?.({
                    isMine: rowIsMine,
                    /* A code only travels with a report the reader owns: Track is
                       where a resolution is confirmed or disputed. */
                    trackingCode: rowIsMine
                      ? group.report?.my_tracking_code || group.report?.tracking_code || ""
                      : "",
                    reportId: group.report?.report_id || group.report?.id,
                    report: group.report,
                  })
                }
                className={`saro-btn saro-btn-sm shrink-0 text-[11px] ${
                  rowIsMine ? "saro-btn-primary" : "saro-btn-secondary"
                }`}
              >
                {rowIsMine && (group.report?.my_tracking_code || group.report?.tracking_code)
                  ? "Track report"
                  : "View report"}
              </button>
            </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default function PublicReportDetail({
  reportId,
  fallbackReport,
  onClose,
  locationGroups,
  locationLabel,
  onOpenReport,
}) {
  const [report, setReport] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const isList = Array.isArray(locationGroups) && locationGroups.length > 0;

  useEffect(() => {
    if (isList || !reportId) return undefined;
    let active = true;
    setLoading(true);
    setLoadError("");

    (async () => {
      const [detail, history] = await Promise.all([
        getPublicReport(reportId),
        getPublicReportTimeline(reportId),
      ]);
      if (!active) return;

      if (detail.error && !fallbackReport) {
        setLoadError(detail.error);
      } else {
        setReport(detail.data ?? fallbackReport ?? null);
      }
      setTimeline(history.data ?? []);
      setLoading(false);
    })();

    return () => { active = false; };
  }, [reportId, fallbackReport, isList]);

  useEffect(() => {
    if (isList || !reportId) return undefined;
    let active = true;
    /* Photos exist for reports this device can read media for; a public pin on
       live data has none, and the section simply does not appear. */
    getReportMedia(reportId)
      .then(({ data }) => {
        if (!active) return;
        setPhotos((data ?? []).map((row) => row.signed_url).filter(Boolean));
      })
      .catch(() => active && setPhotos([]));
    return () => { active = false; };
  }, [reportId, isList]);

  if (isList) {
    return (
      <LocationList
        groups={locationGroups}
        locationLabel={locationLabel}
        onOpenReport={onOpenReport}
        onClose={onClose}
      />
    );
  }

  const shown = report ?? fallbackReport;
  const categoryLabel =
    shown?.category_label || shown?.categoryName || shown?.category || "Hazard Report";

  return (
    <div className="fixed inset-0 z-[900] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close report"
        className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Report detail: ${categoryLabel}`}
        className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <span className="t-label text-ink-faint">Report detail</span>
            <h2 className="mt-1 text-base font-bold leading-snug text-ink">{categoryLabel}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center gap-2 text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden="true" />
              <span className="t-body-sm">Loading this report…</span>
            </div>
          )}

          {loadError && !shown && (
            <p className="rounded-md border border-alert bg-alert-wash p-3 text-xs text-alert">{loadError}</p>
          )}

          {shown && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusTag status={shown.status || "received"} />
                {shown.assigned_office && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2 py-0.5 text-[11px] font-bold text-ink-muted">
                    <Building2 className="h-3 w-3 text-brand" aria-hidden="true" />
                    {shown.assigned_office}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-ink-muted">
                <span className="flex min-w-0 items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
                  <span className="truncate">
                    {shown.barangay_name || shown.barangayName || shown.barangay || "Legazpi City"}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
                  {formatWhen(shown.created_at)}
                </span>
              </div>

              {photos.length > 0 && (
                <div className="space-y-1.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                    <ImageIcon className="h-3 w-3 text-brand" aria-hidden="true" />
                    Submitted photos ({photos.length})
                  </span>
                  <div className="no-scrollbar flex gap-2 overflow-x-auto py-1">
                    {photos.map((url, index) => (
                      <img
                        key={url}
                        src={url}
                        alt={`Report evidence ${index + 1}`}
                        className="h-24 w-32 shrink-0 rounded-md border border-line bg-raised object-cover"
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-line bg-sunken p-3.5 text-sm leading-relaxed text-ink">
                {shown.description?.trim() || "No description was filed with this report."}
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  What has happened so far
                </span>
                {timeline.length === 0 ? (
                  <p className="t-body-sm text-ink-muted">
                    No status changes have been recorded yet.
                  </p>
                ) : (
                  <ol className="space-y-2.5 border-l border-line pl-4">
                    {timeline.map((step, index) => (
                      <li key={`${step.status}-${step.changed_at}-${index}`} className="relative">
                        <span
                          className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand"
                          aria-hidden="true"
                        />
                        <span className="block text-xs font-bold text-ink">
                          {STATUS_LABELS?.[step.status] || String(step.status).replaceAll("_", " ")}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-ink-muted">
                          {formatWhen(step.changed_at)}
                          {step.note ? ` · ${step.note}` : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <p className="t-body-sm text-ink-faint">
                This is the public view of a report. Confirming or disputing a resolution needs
                the tracking code issued to whoever filed it.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

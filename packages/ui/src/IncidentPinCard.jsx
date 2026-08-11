import { useState, useEffect } from "react";
import { MapPin, Clock, X, Image as ImageIcon, Layers, BadgeCheck } from "lucide-react";
import StatusTag from "./StatusTag.jsx";
import { getReportMedia } from "@saro/shared";

/**
 * The card inside a map pin's popup — the one place a report is described.
 *
 * A pin can stand for one report or for everything filed at one point, because
 * public coordinates are rounded to ~110 m and unrelated reports share a
 * lattice point. When it stands for several, this lists them grouped by
 * category with an action on every row: the reader never scrolls to reach the
 * button, and opening one never spawns a second marker on the map.
 */

function isRealReportId(value) {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value)) ||
    String(value).startsWith("demo-")
  );
}

function timeLabel(report, fallback) {
  if (report?.timeSinceStr) return report.timeSinceStr;
  if (fallback) return fallback;
  return report?.created_at ? new Date(report.created_at).toLocaleString("en-PH") : "Filed recently";
}

export default function IncidentPinCard({
  report,
  categoryName,
  barangayName,
  onClose,
  onViewReport,
  timeSinceStr,
  /* How many rows to show before the popup defers to the full list. Kept small
     on phones so the card never grows a scrollbar in front of its own action. */
  maxRows = 3,
  onShowAll,
}) {
  const [photos, setPhotos] = useState(() => report?.photos ?? []);

  /* Map pins carry a grouping id, not the report row's id — `report_id` is the
     row the photo evidence hangs off. */
  const mediaId = report?.report_id ?? report?.id;

  useEffect(() => {
    if (!mediaId || !isRealReportId(mediaId)) return;
    if (report.photos && report.photos.length > 0) return;

    let isMounted = true;
    getReportMedia(mediaId)
      .then(({ data }) => {
        if (!isMounted) return;
        const urls = (data ?? []).map((m) => m.signed_url).filter(Boolean);
        if (urls.length > 0) setPhotos(urls);
      })
      .catch(() => {
        if (isMounted) setPhotos([]);
      });

    return () => {
      isMounted = false;
    };
  }, [mediaId, report?.photos]);

  /* Groups come from the shared location grouping: one entry per kind of hazard
     filed at this point. A pin standing for a single report has none. */
  const groups = Array.isArray(report?.groups) ? report.groups : [];
  const totalCount = report?.count ?? report?.clusterCount ?? 1;
  const isLocation = groups.length > 1 || totalCount > 1;

  const description = report?.description?.trim() || "No description supplied.";
  /* The tracking code is the credential its filer closes the report with, so
     the public map never publishes one. A pin without a code is not broken.

     `my_tracking_code` is different: the host recognised this report as the
     reader's own and paired it with a code the reader already held. It is never
     read off the map. */
  const isMine = Boolean(report?.is_mine);
  const myTrackingCode = report?.my_tracking_code || "";
  const publicCode = report?.tracking_code || report?.trackingCode || report?.code || "";
  const trackingCode = isMine ? myTrackingCode || publicCode : publicCode;
  const detailId = report?.report_id || report?.id;
  const canOpenFullReport = Boolean(onViewReport) && Boolean(trackingCode || detailId);
  /* A location pin is "yours" when any hazard filed on that point is. */
  const locationHasMine = isMine || groups.some((group) => group.report?.is_mine);

  const displayPhotos = photos.slice(0, 4);
  const visibleGroups = groups.slice(0, maxRows);
  const hiddenGroupCount = groups.length - visibleGroups.length;

  /* Only a report the reader owns travels with a code: a code sent for anyone
     else's pin would open Track — the confirm/dispute surface — on a report the
     reader has no standing to close. */
  const openReport = (row) => {
    const target = row ?? report;
    const targetIsMine = Boolean(target?.is_mine);
    onViewReport?.({
      isMine: targetIsMine,
      trackingCode: targetIsMine
        ? target?.my_tracking_code || target?.tracking_code || target?.trackingCode || target?.code || ""
        : "",
      reportId: target?.report_id || target?.id,
      report: target,
    });
  };

  return (
    /* Header and action sit outside the scroll area: only the middle scrolls,
       so the way into the full report can never end up below the fold — which
       is what a single overflowing card kept doing on a phone. */
    <div className="flex w-full max-h-[44vh] flex-col overflow-hidden rounded-xl border border-line bg-surface font-sans shadow-2xl animate-fade-in sm:max-h-[44vh]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3.5 pb-2.5 pt-3.5 sm:px-5 sm:pt-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {isLocation ? (
            <span className="flex shrink-0 items-center gap-1 rounded-md bg-ink px-2 py-0.5 text-[10px] font-mono font-bold text-white shadow-2xs">
              <Layers className="h-3 w-3 text-brand-edge" aria-hidden="true" />
              {totalCount} reports here
            </span>
          ) : (
            <>
              <StatusTag status={report?.status || "received"} />
              {trackingCode ? (
                <span className="shrink-0 rounded-md border border-line bg-sunken px-2 py-0.5 font-mono text-[10px] font-bold text-ink-muted">
                  {trackingCode}
                </span>
              ) : null}
            </>
          )}
          {/* Said on the pin's own card, not only in the list below it: the
              reader should know a pin is theirs before deciding to open it. */}
          {locationHasMine ? (
            <span className="flex shrink-0 items-center gap-1 rounded-md border border-brand-edge bg-brand-wash px-2 py-0.5 text-[10px] font-bold text-brand">
              <BadgeCheck className="h-3 w-3" aria-hidden="true" />
              {isLocation ? "Includes your report" : "Your report"}
            </span>
          ) : null}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-1 text-ink-muted transition-colors hover:bg-sunken hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
          aria-label="Close detail"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3.5 py-3 sm:space-y-3.5 sm:px-5 sm:py-4">
      {/* Title + place */}
      <div>
        <h3 className="text-[15px] font-bold leading-snug text-ink">
          {isLocation ? "Reports at this location" : categoryName || "Hazard Report"}
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-ink-muted">
          <span className="flex min-w-0 items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
            <span className="truncate">{barangayName || report?.barangay || "Legazpi City"}</span>
          </span>
          <span className="text-ink-faint">·</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
            <span>{timeLabel(report, timeSinceStr)}</span>
          </span>
        </div>
      </div>

      {isLocation ? (
        /* One row per kind of hazard filed here, each with its own way in. */
        <ul className="space-y-2">
          {visibleGroups.map((group) => {
            const rowCategory =
              group.report?.categoryName || group.report?.category_label || group.report?.category || "Hazard report";
            const rowIsMine = Boolean(group.report?.is_mine);
            /* Without a code there is nothing for Track to open, so the row keeps
               the read-only wording even when the report is the reader's. */
            const rowCanTrack =
              rowIsMine && Boolean(group.report?.my_tracking_code || group.report?.tracking_code);
            return (
              <li
                key={group.id}
                className={`flex items-center justify-between gap-2.5 rounded-lg border p-2.5 ${
                  rowIsMine ? "border-brand-edge bg-brand-wash/50" : "border-line bg-raised"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-bold text-ink">{rowCategory}</span>
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
                  <div className="mt-1 flex items-center gap-1.5">
                    <StatusTag status={group.report?.status || "received"} size="sm" />
                    <span className="truncate text-[10px] text-ink-faint">{timeLabel(group.report)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openReport(group.report)}
                  className={`saro-btn saro-btn-sm shrink-0 text-[11px] ${
                    rowIsMine ? "saro-btn-primary" : "saro-btn-secondary"
                  }`}
                >
                  {rowCanTrack ? "Track report" : "View report"}
                </button>
              </li>
            );
          })}

          {hiddenGroupCount > 0 && (
            <li>
              <button
                type="button"
                onClick={() => onShowAll?.(report)}
                className="w-full rounded-lg border border-dashed border-line px-3 py-2 text-[11px] font-bold text-brand transition-colors hover:bg-brand-wash/40"
              >
                Show all {groups.length} hazards here
              </button>
            </li>
          )}
        </ul>
      ) : (
        <>
          {displayPhotos.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                <ImageIcon className="h-3 w-3 text-brand" aria-hidden="true" />
                <span>Submitted photos ({displayPhotos.length})</span>
              </div>
              <div className="no-scrollbar flex items-center gap-2 overflow-x-auto py-0.5">
                {displayPhotos.map((url, idx) => (
                  <img
                    key={url}
                    src={url}
                    alt={`Report evidence ${idx + 1}`}
                    className="h-16 w-24 shrink-0 rounded-md border border-line bg-raised object-cover sm:h-20 sm:w-28"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Clamped: the whole story lives in the full report. */}
          <p className="line-clamp-3 rounded-lg border border-line bg-sunken p-3 text-xs leading-relaxed text-ink sm:text-sm">
            {description}
          </p>
        </>
      )}
      </div>

      {!isLocation && canOpenFullReport && (
        <div className="shrink-0 border-t border-line px-3.5 py-3 sm:px-5 sm:py-4">
          <button
            type="button"
            onClick={() => openReport(null)}
            className="saro-btn saro-btn-primary saro-btn-block text-xs font-bold sm:text-sm"
          >
            {isMine && trackingCode ? "View Full Report in Track" : "View Full Report"}
          </button>
        </div>
      )}
    </div>
  );
}

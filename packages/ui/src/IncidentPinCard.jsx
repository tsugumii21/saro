import { useState, useEffect } from "react";
import { MapPin, Clock, X, Image as ImageIcon, Sparkles } from "lucide-react";
import StatusTag from "./StatusTag.jsx";
import { getReportMedia } from "@saro/shared";

export default function IncidentPinCard({
  report,
  categoryName,
  barangayName,
  onClose,
  onActionClick,
  actionLabel = "Report a Hazard in This Area",
  timeSinceStr,
}) {
  const [photos, setPhotos] = useState([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  const isCluster = (report?.clusterCount || report?.count || 1) > 1;
  const clusterCount = report?.clusterCount || report?.count || 1;

  useEffect(() => {
    if (!report?.id) return;

    if (report.photos && report.photos.length > 0) {
      setPhotos(report.photos);
      return;
    }

    let isMounted = true;
    setLoadingPhotos(true);
    getReportMedia(report.id)
      .then(({ data }) => {
        if (isMounted) {
          setLoadingPhotos(false);
          if (data && data.length > 0) {
            const urls = data.map((m) => m.signed_url).filter(Boolean);
            setPhotos(urls);
          }
        }
      })
      .catch(() => {
        if (isMounted) setLoadingPhotos(false);
      });

    return () => {
      isMounted = false;
    };
  }, [report?.id, report?.photos]);

  const description = report?.description?.trim() || "";

  const clusterSummary = isCluster
    ? report?.cluster_summary ||
      `Cluster Summary (${clusterCount} Reports): Multiple citizen reports submitted for ${categoryName || "hazard"} in ${barangayName || "this location"}. ${description || "Active hazard area under monitoring."}`
    : description;

  // Representative photos (max 3 for cluster, max 4 for single)
  const displayPhotos = isCluster ? photos.slice(0, 3) : photos.slice(0, 4);

  return (
    <div className="bg-surface border border-line shadow-2xl p-5 rounded-xl font-sans max-h-[85vh] overflow-y-auto space-y-3.5 animate-fade-in">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <StatusTag status={report?.status || "received"} />
          {isCluster ? (
            <span className="text-[10px] font-mono font-bold rounded-md px-2 py-0.5 bg-ink text-white shadow-2xs flex items-center gap-1 shrink-0">
              <Sparkles className="w-3 h-3 text-amber-400" />
              {clusterCount} reports in cluster
            </span>
          ) : (
            <span className="text-[10px] font-mono font-bold text-ink-muted bg-sunken px-2 py-0.5 rounded-md border border-line shrink-0">
              {report?.tracking_code || "SR-PIN"}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-ink-muted hover:text-ink p-1 rounded-lg hover:bg-sunken transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-brand/30"
          aria-label="Close detail"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Category Title */}
      <h3 className="text-base font-bold text-ink leading-snug">
        {isCluster
          ? `${clusterCount} Reports in this Area (${categoryName || "Hazard"})`
          : categoryName || "Hazard Report"}
      </h3>

      {/* Location & Time Subheader */}
      <div className="flex items-center gap-2 text-xs text-ink-muted font-medium flex-wrap">
        <span className="flex items-center gap-1.5 min-w-0">
          <MapPin className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden="true" />
          <span className="truncate">{barangayName || report?.barangay || "Legazpi City"}</span>
        </span>
        <span className="text-ink-faint">·</span>
        <span className="flex items-center gap-1.5 shrink-0">
          <Clock className="w-3.5 h-3.5 text-ink-faint shrink-0" aria-hidden="true" />
          <span>{timeSinceStr || "recently"}</span>
        </span>
      </div>

      {/* Photo Gallery (Only rendered if photos exist) */}
      {displayPhotos.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="text-[10px] font-bold uppercase text-ink-muted tracking-wider flex items-center gap-1">
            <ImageIcon className="w-3 h-3 text-brand" />
            <span>
              {isCluster
                ? `Representative Photos (${displayPhotos.length})`
                : `Submitted Photos (${displayPhotos.length})`}
            </span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
            {displayPhotos.map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt={`Report evidence ${idx + 1}`}
                className="h-20 sm:h-24 w-28 sm:w-32 object-cover rounded-md border border-line shadow-2xs shrink-0 bg-raised"
              />
            ))}
          </div>
        </div>
      )}

      {/* Description / Summarized Context Box */}
      {clusterSummary ? (
        <div className="bg-sunken p-3.5 rounded-lg border border-line text-xs sm:text-sm text-ink leading-relaxed font-sans space-y-1">
          {isCluster && (
            <span className="font-bold text-brand block text-[10px] uppercase tracking-wider">
              Summarized Context
            </span>
          )}
          <span>{clusterSummary}</span>
        </div>
      ) : null}

      {/* Bottom Action Footer */}
      {onActionClick && (
        <div className="pt-3 border-t border-line">
          <button
            onClick={onActionClick}
            className="saro-btn saro-btn-primary saro-btn-lg w-full font-bold shadow-md hover:shadow-lg transition-all text-xs sm:text-sm py-3"
          >
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}

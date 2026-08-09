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
    <div className="fixed sm:absolute bottom-0 inset-x-0 bg-white border-t border-line shadow-sheet px-4 pt-4 pb-4 animate-slide-up z-[600] rounded-t-lg font-sans max-h-[85vh] overflow-y-auto">
      {/* Header Bar */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusTag status={report?.status || "received"} />
          {isCluster ? (
            <span className="t-micro font-bold rounded-xs px-2 py-0.5 bg-ink text-white shadow-2xs flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              {clusterCount} reports in cluster
            </span>
          ) : (
            <span className="text-[10px] font-mono font-bold text-ink-muted bg-raised px-2 py-0.5 rounded border border-line">
              {report?.tracking_code || "SR-PIN"}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-xs text-ink-muted hover:text-ink p-1 rounded-xs transition-colors"
          aria-label="Close detail"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Category Title */}
      <h3 className="text-base font-bold text-ink mb-1">
        {isCluster
          ? `${clusterCount} Reports in this Area (${categoryName || "Hazard"})`
          : categoryName || "Hazard Report"}
      </h3>

      {/* Location & Time Subheader */}
      <div className="flex items-center gap-3 text-xs text-ink-muted mb-3 font-medium">
        <span className="flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden="true" />
          <span>{barangayName || report?.barangay || "Legazpi City"}</span>
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5 text-ink-muted shrink-0" aria-hidden="true" />
          <span>{timeSinceStr || "recently"}</span>
        </span>
      </div>

      {/* Photo Gallery (Only rendered if photos exist - No broken placeholders!) */}
      {displayPhotos.length > 0 && (
        <div className="mb-3 space-y-1">
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
        <div className="mb-4 bg-sunken/60 p-3 rounded-md border border-line/60 text-xs sm:text-sm text-ink leading-relaxed font-sans">
          {isCluster && (
            <span className="font-bold text-brand block mb-1 text-[11px] uppercase tracking-wider">
              Summarized Context
            </span>
          )}
          <span>{clusterSummary}</span>
        </div>
      ) : null}

      {/* Bottom Action Button */}
      {onActionClick && (
        <button
          onClick={onActionClick}
          className="saro-btn saro-btn-primary saro-btn-lg w-full font-bold shadow-xs text-xs sm:text-sm"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

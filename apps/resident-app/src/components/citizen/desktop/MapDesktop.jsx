import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PlusCircle, Loader2, MapPin, ChevronRight, Layers, Activity } from "lucide-react";
import { HazardMap, AlertLevelBadge, IncidentPinCard, StatusTag, TrackingCode } from "@saro/ui";
import {
  getPublicMapReports, getCategories, getBarangays,
  getRainfall, getVolcanicAlert, getEvacuationCenters, getAccidentBlackspots,
  LEGAZPI_CENTER, saroEvents, isArchivedReport,
} from "@saro/shared";

const LEGAZPI_CENTER_LNGLAT = [LEGAZPI_CENTER[1], LEGAZPI_CENTER[0]];

const STATUS_LABELS = {
  received: "Received",
  assigned: "Assigned",
  in_progress: "In Progress",
  resolved: "Resolved",
};

const STATUS_COLORS = {
  received: "#94A3B8",
  assigned: "#F59E0B",
  in_progress: "#0060A9",
  resolved: "#22C55E",
};

const STATUS_ORDER = ["received", "assigned", "in_progress", "resolved"];

function timeSince(dateStr) {
  if (!dateStr) return "";
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (isNaN(seconds) || seconds < 0) return "";
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Desktop Map — D1 layout.
 *
 * Left panel (340px): Status filters, Mayon Alert status, and scrollable Active Incidents Feed.
 * Right panel (flex-1): Full height HazardMap with layer controls.
 */
export default function MapDesktop() {
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [mapCenter, setMapCenter] = useState(LEGAZPI_CENTER_LNGLAT);
  const [statusFilter, setStatusFilter] = useState("");
  const [hiddenLayers] = useState([]);
  const [rainfall, setRainfall] = useState([]);
  const [evacuationCenters, setEvacuationCenters] = useState([]);
  const [accidentBlackspots, setAccidentBlackspots] = useState([]);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(async () => {
    setLoadError("");
    const [rRes, cRes, bRes, rainRes, alertRes, ecRes, bsRes] = await Promise.all([
      getPublicMapReports(),
      getCategories(),
      getBarangays(),
      getRainfall(),
      getVolcanicAlert(),
      getEvacuationCenters(),
      getAccidentBlackspots(),
    ]);

    setLoading(false);
    if (rRes.error) {
      setLoadError(rRes.error);
      return;
    }

    if (rRes.data) setReports(rRes.data);
    if (cRes.data) setCategories(cRes.data);
    if (bRes.data) setBarangays(bRes.data);
    if (rainRes.data) setRainfall(rainRes.data);
    if (alertRes.data) setAlert(alertRes.data);
    if (ecRes.data) setEvacuationCenters(ecRes.data);
    if (bsRes.data) setAccidentBlackspots(bsRes.data);
  }, []);

  useEffect(() => {
    loadData();
    const unsub1 = saroEvents.on("report:created", loadData);
    const unsub2 = saroEvents.on("report:updated", loadData);
    return () => { unsub1(); unsub2(); };
  }, [loadData]);

  const getCategoryName = (catId) => {
    const cat = categories.find((c) => c.id === catId);
    return cat ? cat.name : catId;
  };

  const getBarangayName = (brgyId) => {
    const brgy = barangays.find((b) => b.id === brgyId);
    return brgy ? brgy.name : "Legazpi City";
  };

  const activeReports = reports.filter((r) => !isArchivedReport(r));
  const filteredReports = statusFilter
    ? activeReports.filter((r) => r.status === statusFilter)
    : activeReports;

  // Spatial cluster grouping
  const displayReports = [];
  const processed = new Set();

  filteredReports.forEach((r, idx) => {
    if (!r.lat || !r.lng || processed.has(idx)) return;
    const rLat = typeof r.lat === "string" ? parseFloat(r.lat) : Number(r.lat);
    const rLng = typeof r.lng === "string" ? parseFloat(r.lng) : Number(r.lng);

    const clusterMembers = [r];
    processed.add(idx);

    filteredReports.forEach((other, oIdx) => {
      if (processed.has(oIdx) || !other.lat || !other.lng) return;
      const oLat = typeof other.lat === "string" ? parseFloat(other.lat) : Number(other.lat);
      const oLng = typeof other.lng === "string" ? parseFloat(other.lng) : Number(other.lng);

      const isClusterIdMatch = r.cluster_id && other.cluster_id && r.cluster_id === other.cluster_id;
      const dist = Math.sqrt(Math.pow(rLat - oLat, 2) + Math.pow(rLng - oLng, 2));
      const isProximityMatch = dist < 0.005;

      if (isClusterIdMatch || isProximityMatch) {
        clusterMembers.push(other);
        processed.add(oIdx);
      }
    });

    displayReports.push({
      report: r,
      count: Math.max(clusterMembers.length, r.confidence_score || 1),
      members: clusterMembers,
    });
  });

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas font-sans">
      {/* ── Left Sidebar (340px) ──────────────────────────────────────── */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-line bg-surface overflow-y-auto">
        {/* Header */}
        <div className="border-b border-line px-5 py-3.5 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-ink">Public Hazard Map</h1>
            <p className="text-xs text-ink-faint mt-0.5">Legazpi City DRRM & Incident Feed</p>
          </div>
          {loading && <Loader2 className="w-4 h-4 text-brand animate-spin" />}
        </div>

        <div className="flex flex-col gap-4 p-4">
          {/* Mayon Volcanic Alert Status Card */}
          {alert && (
            <div className="flex flex-col gap-1.5 p-3 rounded-md border border-line bg-surface shadow-2xs">
              <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">
                Volcanic Advisory
              </span>
              <AlertLevelBadge alert={alert} compact />
            </div>
          )}

          {/* Status Filter Pills */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">
              Filter Status ({filteredReports.length})
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setStatusFilter("")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all border ${
                  !statusFilter
                    ? "bg-ink text-white border-ink"
                    : "bg-surface text-ink border-line hover:bg-raised"
                }`}
              >
                All ({activeReports.length})
              </button>
              {STATUS_ORDER.map((status) => {
                const isActive = statusFilter === status;
                const count = activeReports.filter((r) => r.status === status).length;
                return (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(isActive ? "" : status)}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 border ${
                      isActive
                        ? "bg-ink text-white border-ink"
                        : "bg-surface text-ink border-line hover:bg-raised"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: STATUS_COLORS[status] }}
                    />
                    <span>{STATUS_LABELS[status]}</span>
                    <span className="text-[10px] opacity-75 font-mono">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Incidents List Feed */}
          <div className="flex flex-col gap-2 pt-2 border-t border-line">
            <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider flex items-center justify-between">
              <span>Active Incidents</span>
              <span className="font-mono text-brand">{displayReports.length} pins</span>
            </span>

            {loadError && (
              <div className="p-3 border border-alert bg-alert-wash text-alert text-xs rounded-xs">
                {loadError}
              </div>
            )}

            {!loading && displayReports.length === 0 && (
              <div className="p-4 text-center border border-line bg-raised rounded-xs">
                <p className="text-xs font-bold text-ink">No incidents found</p>
                <p className="text-[11px] text-ink-muted mt-1">
                  {statusFilter ? "Try clearing status filters." : "No active hazard reports."}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              {displayReports.map(({ report: r, count }) => {
                const reportKey = r.id || r.tracking_code;
                const activeKey = selectedReport?.id || selectedReport?.tracking_code;
                const isSelected = Boolean(activeKey) && activeKey === reportKey;

                const handleCardClick = () => {
                  if (isSelected) {
                    setSelectedReport(null);
                    return;
                  }
                  const lat = typeof r.lat === "string" ? parseFloat(r.lat) : Number(r.lat);
                  const lng = typeof r.lng === "string" ? parseFloat(r.lng) : Number(r.lng);
                  setSelectedReport({
                    ...r,
                    clusterCount: count,
                    categoryName: getCategoryName(r.category_id || r.category),
                    barangayName: getBarangayName(r.barangay_id) || r.barangay || "Legazpi City",
                    timeSinceStr: timeSince(r.created_at),
                  });
                  if (!isNaN(lat) && !isNaN(lng) && lat && lng) {
                    setMapCenter([lng, lat]);
                  }
                };

                return (
                  <button
                    key={reportKey}
                    type="button"
                    onClick={handleCardClick}
                    aria-current={isSelected ? "true" : undefined}
                    className={`flex flex-col gap-2 p-3.5 text-left rounded-lg border transition-all shadow-2xs cursor-pointer ${
                      isSelected
                        ? "bg-brand-wash border-brand ring-1 ring-brand/30"
                        : "bg-surface border-line hover:border-brand-edge hover:bg-raised/60"
                    }`}
                  >
                    {/* Header Row: Dot + Title + StatusTag */}
                    <div className="flex items-center justify-between gap-2 w-full">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: STATUS_COLORS[r.status] || STATUS_COLORS.received }}
                        />
                        <span className={`text-xs leading-tight truncate ${
                          isSelected ? "font-extrabold text-brand" : "font-bold text-ink"
                        }`}>
                          {getCategoryName(r.category_id || r.category)}
                        </span>
                      </div>
                      <div className="pointer-events-none shrink-0">
                        <StatusTag status={r.status} size="sm" />
                      </div>
                    </div>

                    {/* Footer Row: Location + Time + Cluster Pill */}
                    <div className="flex items-center justify-between gap-2 w-full text-[11px] text-ink-muted">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <MapPin className="w-3 h-3 text-brand shrink-0" />
                        <span className="truncate">{getBarangayName(r.barangay_id) || r.barangay || "Legazpi City"}</span>
                        <span className="text-ink-faint">·</span>
                        <span className="shrink-0 text-ink-faint">{timeSince(r.created_at)}</span>
                      </div>
                      {count > 1 && (
                        <span className="text-[10px] font-mono font-bold bg-brand-wash text-brand border border-brand-edge/60 px-2 py-0.5 rounded-full shrink-0 shadow-2xs">
                          ⚡ {count} reports
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </aside>

      {/* ── Right Map View (flex-1) ───────────────────────────────────── */}
      <div className="relative min-w-0 flex-1 h-full overflow-hidden">
        <HazardMap
          className="h-full w-full"
          center={mapCenter}
          selectedId={selectedReport?.cluster_id || selectedReport?.id}
          onClearSelectedReport={() => setSelectedReport(null)}
          zoom={13}
          rainfall={rainfall}
          evacuationCenters={evacuationCenters}
          accidentBlackspots={accidentBlackspots}
          showToggles={true}
          hidden={hiddenLayers}
          reports={displayReports.map(({ report: r, count }) => ({
            id: r.cluster_id || r.id,
            lat: r.lat,
            lng: r.lng,
            priority: r.priority,
            color: STATUS_COLORS[r.status] || STATUS_COLORS.received,
            count: count,
            category: r.category_id || r.category,
            categoryName: getCategoryName(r.category_id || r.category),
            barangayName: getBarangayName(r.barangay_id) || r.barangay || "Legazpi City",
            timeSinceStr: timeSince(r.created_at),
            status: r.status,
            onActionClick: () => navigate(`/report?category=${r.category_id || r.category}`),
            onSelect: () => {
              const lat = typeof r.lat === "string" ? parseFloat(r.lat) : Number(r.lat);
              const lng = typeof r.lng === "string" ? parseFloat(r.lng) : Number(r.lng);
              setSelectedReport({ ...r, clusterCount: count });
              if (!isNaN(lat) && !isNaN(lng) && lat && lng) {
                setMapCenter([lng, lat]);
              }
            },
          }))}
        />

        {/* Floating Incident & Cluster Details Overlay Card */}
        {selectedReport && (
          <div className="absolute bottom-6 left-6 z-30 w-full max-w-md shadow-2xl animate-fade-in">
            <IncidentPinCard
              report={selectedReport}
              categoryName={getCategoryName(selectedReport.category_id || selectedReport.category)}
              barangayName={getBarangayName(selectedReport.barangay_id) || selectedReport.barangay || "Legazpi City"}
              timeSinceStr={timeSince(selectedReport.created_at)}
              onClose={() => setSelectedReport(null)}
              onActionClick={() => navigate(`/report?category=${selectedReport.category_id || selectedReport.category}`)}
              actionLabel="Report a Hazard in This Area"
            />
          </div>
        )}
      </div>
    </div>
  );
}

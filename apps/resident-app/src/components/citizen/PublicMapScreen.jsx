import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { HazardMap, IncidentPinCard } from "@saro/ui";
import {
  getPublicMapReports, getCategories, getBarangays,
  getRainfall, getVolcanicAlert, getEvacuationCenters, getAccidentBlackspots,
  LEGAZPI_CENTER, saroEvents, isArchivedReport,
} from "@saro/shared";

/** MapLibre takes [lng, lat]; LEGAZPI_CENTER is [lat, lng] for historical reasons. */
const LEGAZPI_CENTER_LNGLAT = [LEGAZPI_CENTER[1], LEGAZPI_CENTER[0]];

const STATUS_LABELS = {
  received: "Received",
  assigned: "Assigned",
  in_progress: "In Progress",
  resolved: "Resolved"
};

const STATUS_COLORS = {
  received: "#94A3B8",
  assigned: "#F59E0B",
  in_progress: "#0060A9",
  resolved: "#22C55E"
};

const STATUS_ORDER = ["received", "assigned", "in_progress", "resolved"];

function timeSince(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function PublicMapScreen() {
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
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
    setLoading(false);
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

  // Exclude auto-archived old resolved reports (>72h) from public map pins
  const activeReports = reports.filter((r) => !isArchivedReport(r));

  // Apply status filter
  const filteredReports = statusFilter
    ? activeReports.filter((r) => r.status === statusFilter)
    : activeReports;

  // Smart spatial & cluster_id grouping
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
    <div className="flex flex-col h-full w-full relative overflow-hidden">
      {/* Map Container */}
      <div className="flex-1 relative overflow-hidden border-b border-line">
        {loading && (
          <div
            role="status"
            className="absolute inset-x-0 top-0 z-[600] flex items-center justify-center gap-2 bg-surface/95 py-2 backdrop-blur border-b border-line"
          >
            <Loader2 width={14} height={14} className="animate-spin text-brand" aria-hidden="true" />
            <span className="t-body-sm text-ink-muted">Loading the map…</span>
          </div>
        )}

        {loadError && (
          <div
            role="alert"
            className="absolute inset-x-3 top-3 z-[600] border border-alert bg-alert-wash p-3 rounded-xs shadow-card"
          >
            <p className="t-body-sm text-alert">{loadError}</p>
            <button onClick={loadData} className="saro-btn saro-btn-secondary saro-btn-sm mt-2">
              Try again
            </button>
          </div>
        )}

        {!loading && !loadError && displayReports.length === 0 && (
          <div className="absolute inset-x-3 bottom-20 z-[600] border border-line bg-surface/95 p-3 rounded-xs backdrop-blur shadow-card">
            <p className="t-body-sm text-ink">
              {statusFilter
                ? "No active reports with that status."
                : "No active hazard reports in Legazpi City right now."}
            </p>
            <p className="t-body-sm mt-1 text-ink-muted">
              The hazard layers below still show where flooding and Mayon's danger zones are.
            </p>
          </div>
        )}

        <HazardMap
          className="h-full w-full"
          style={{ minHeight: "300px" }}
          center={LEGAZPI_CENTER_LNGLAT}
          zoom={13}
          rainfall={rainfall}
          evacuationCenters={evacuationCenters}
          accidentBlackspots={accidentBlackspots}
          showToggles={true}
          hidden={hiddenLayers}
          reports={displayReports.map(({ report: r, count, members }) => ({
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
            members: (members || [r]).slice(0, 3).map(m => ({
              ...m,
              categoryName: getCategoryName(m.category_id || m.category)
            })),
            onTrackClick: (code) => navigate(`/track?code=${code}`),
            onActionClick: () => navigate(`/report?category=${r.category_id || r.category}`),
            onSelect: () => setSelectedReport({ ...r, clusterCount: count, members: (members || [r]).slice(0, 3) }),
          }))}
        />

        {/* Top Control Bar: Status Filter Chips with smooth horizontal scroll & gradient fade mask */}
        <div className="relative w-full z-20">
          <div className="pointer-events-none absolute right-0 top-3 h-9 w-10 bg-gradient-to-l from-white via-white/70 to-transparent z-30" aria-hidden="true" />
          <div className="absolute left-0 top-3 right-0 z-20 overflow-x-auto overscroll-x-contain px-3 no-scrollbar">
            <div className="flex w-max items-center gap-1.5 pb-1 pr-6">
              <button
                onClick={() => setStatusFilter("")}
                className={`px-3 py-1.5 rounded-full t-label font-bold transition-all shadow-xs cursor-pointer border ${
                  !statusFilter
                    ? "bg-ink text-white border-ink"
                    : "bg-white/95 backdrop-blur text-ink border-line hover:bg-white hover:border-ink/30"
                }`}
              >
                All ({activeReports.length})
              </button>
              {STATUS_ORDER.map((status) => {
                const isActive = statusFilter === status;
                const color = STATUS_COLORS[status];
                const count = activeReports.filter((r) => r.status === status).length;
                return (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(isActive ? "" : status)}
                    className={`px-3 py-1.5 rounded-full t-label font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5 border ${
                      isActive
                        ? "bg-ink text-white border-ink"
                        : "bg-white/95 backdrop-blur text-ink border-line hover:bg-white hover:border-ink/30"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }}></span>
                    <span>{STATUS_LABELS[status]} ({count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

      </div>

      {/* Connected Bottom Sheet for Selected Report / Cluster (Cleared above mobile bottom tab bar) */}
      {selectedReport && (
        <div className="mb-14 sm:mb-0">
          <IncidentPinCard
            report={selectedReport}
            categoryName={getCategoryName(selectedReport.category_id || selectedReport.category)}
            barangayName={getBarangayName(selectedReport.barangay_id) || selectedReport.barangay || "Legazpi City"}
            timeSinceStr={timeSince(selectedReport.created_at)}
            onClose={() => setSelectedReport(null)}
            onTrackClick={(code) => navigate(`/track?code=${code}`)}
            onActionClick={() => navigate(`/report?category=${selectedReport.category_id || selectedReport.category}`)}
            actionLabel="Report Another Hazard Here"
          />
        </div>
      )}
    </div>
  );
}

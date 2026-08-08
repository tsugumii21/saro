import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PlusCircle, Clock, MapPin, Layers, X, Loader2 } from "lucide-react";
import { StatusTag, HazardMap, AlertLevelBadge } from "@saro/ui";
import {
  getPublicMapReports, getCategories, getBarangays,
  getRainfall, getVolcanicAlert, LEGAZPI_CENTER, saroEvents,
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

// The DivIcon builder, the bounds controller and the custom zoom buttons that
// used to live here are gone with Leaflet. HazardMap owns marker rendering and
// ships MapLibre's own NavigationControl, so there is one implementation of
// each rather than one per screen.

function timeSince(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function PublicMapScreen() {
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [showLegend, setShowLegend] = useState(false);
  const [statusFilter, setStatusFilter] = useState(""); // "" = all
  const [rainfall, setRainfall] = useState([]);
  const [alert, setAlert] = useState(null);

  // Three states this screen previously had none of. A map that renders an
  // empty basemap looks identical whether it is still loading, has nothing to
  // show, or failed — and the resident has no way to tell which.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(async () => {
    setLoadError("");
    const [rRes, cRes, bRes, rainRes, alertRes] = await Promise.all([
      getPublicMapReports(),
      getCategories(),
      getBarangays(),
      // Both come from cached tables, never from the upstream sources — see
      // the rainfall-poll Edge Function and the volcanic_alert table.
      getRainfall(),
      getVolcanicAlert()
    ]);
    if (rRes.data) setReports(rRes.data);
    if (cRes.data) setCategories(cRes.data);
    if (bRes.data) setBarangays(bRes.data);
    if (rainRes.data) setRainfall(rainRes.data);
    if (alertRes.data) setAlert(alertRes.data);

    // Only the reports read is fatal to this screen. Rainfall or the alert
    // level failing leaves a usable map with one layer missing, and saying
    // "could not load" over a working hazard map would be a lie.
    if (rRes.error) setLoadError(rRes.error);
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

  // Apply status filter
  const filteredReports = statusFilter
    ? reports.filter((r) => r.status === statusFilter)
    : reports;

  // Deduplicate clustered reports
  const clusterMap = new Map();
  const displayReports = [];

  filteredReports.forEach((r) => {
    if (!r.lat || !r.lng) return;
    if (r.cluster_id) {
      if (!clusterMap.has(r.cluster_id)) {
        clusterMap.set(r.cluster_id, { report: r, count: r.confidence_score || 1 });
      }
    } else {
      displayReports.push({ report: r, count: 1 });
    }
  });
  clusterMap.forEach((val) => displayReports.push(val));

  return (
    <div className="flex flex-col h-full w-full relative overflow-hidden">
      {/* Map Container */}
      <div className="flex-1 relative overflow-hidden border-b border-line">
        {/* The public hazard map.
         *
         * Citizen reports sit on top of the official layers rather than beside
         * them, which is the point of the overlay work: "three people reported
         * flooding here" means something different once you can see the spot is
         * inside the 5-year flood extent, and a report inside the Permanent
         * Danger Zone is a different kind of report.
         *
         * Layers are toggleable because showing all of them at once turns
         * Legazpi into a wash of translucent polygons and the reports vanish
         * underneath. Rain is off by default for the same reason — it is the
         * layer you turn on when it is raining. */}
        {loading && (
          <div
            role="status"
            className="absolute inset-x-0 top-0 z-[600] flex items-center justify-center gap-2 bg-surface/95 py-2 backdrop-blur"
          >
            <Loader2 width={14} height={14} className="animate-spin text-brand" aria-hidden="true" />
            <span className="t-body-sm text-ink-muted">Loading the map…</span>
          </div>
        )}

        {loadError && (
          <div
            role="alert"
            className="absolute inset-x-3 top-3 z-[600] border border-alert bg-alert-wash p-3"
          >
            <p className="t-body-sm text-alert">{loadError}</p>
            <button onClick={loadData} className="saro-btn saro-btn-secondary saro-btn-sm mt-2">
              Try again
            </button>
          </div>
        )}

        {/* Empty is not the same as broken, and it is usually good news. */}
        {!loading && !loadError && displayReports.length === 0 && (
          <div className="absolute inset-x-3 bottom-20 z-[600] border border-line bg-surface/95 p-3 backdrop-blur">
            <p className="t-body-sm text-ink">
              {statusFilter
                ? "No reports with that status in the last 7 days."
                : "No reports in Legazpi in the last 7 days."}
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
          reports={displayReports.map(({ report: r, count }) => ({
            id: r.cluster_id || r.id,
            lat: r.lat,
            lng: r.lng,
            priority: r.priority,
            color: STATUS_COLORS[r.status] || STATUS_COLORS.received,
            onSelect: () => setSelectedReport({ ...r, clusterCount: count }),
          }))}
        />

        {/* The alert level rides on the map itself, because that is where
            somebody is when they need it — not behind a menu. */}
        {alert && (
          <div className="absolute bottom-3 left-3 z-[500] max-w-[260px]">
            <AlertLevelBadge alert={alert} compact />
          </div>
        )}

        {/* Top Bar: Status Filter Chips with smooth horizontal scroll */}
        <div className="absolute right-12 top-3 z-[500] overflow-x-auto no-scrollbar" style={{ left: "13.5rem" }}>
          <div className="flex items-center gap-1.5 min-w-max pb-1">
            <button
              onClick={() => setStatusFilter("")}
              className={`px-3 py-1.5 rounded-full t-label font-bold transition-all shadow-xs border ${
                !statusFilter
                  ? "bg-ink text-white border-ink"
                  : "bg-white/95 backdrop-blur text-ink border-line hover:bg-white"
              }`}
            >
              All
            </button>
            {STATUS_ORDER.map((status) => {
              const isActive = statusFilter === status;
              const color = STATUS_COLORS[status];
              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(isActive ? "" : status)}
                  className={`px-3 py-1.5 rounded-full t-label font-bold transition-all shadow-xs flex items-center gap-1.5 border ${
                    isActive
                      ? "bg-ink text-white border-ink"
                      : "bg-white/95 backdrop-blur text-ink border-line hover:bg-white"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }}></span>
                  <span>{STATUS_LABELS[status]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Map Legend Toggle (Top Right) */}
        <button
          onClick={() => setShowLegend(!showLegend)}
          className="absolute top-3 right-3 z-[500] bg-white/95 backdrop-blur border border-line rounded-full p-2 shadow-xs hover:bg-white transition-colors"
          aria-label={showLegend ? "Close legend" : "Show map legend"}
        >
          {showLegend ? <X className="w-4 h-4 text-ink" /> : <Layers className="w-4 h-4 text-ink-muted" />}
        </button>

        {/* Map Legend Panel (Synced order & colors) */}
        {showLegend && (
          <div className="absolute top-12 right-3 z-[500] bg-white/95 backdrop-blur border border-line rounded-xs p-3.5 shadow-none min-w-[170px] animate-fade-in">
            <h4 className="t-label font-bold text-ink mb-2 uppercase tracking-wider">Map Legend</h4>
            <div className="space-y-2">
              {STATUS_ORDER.map((status) => (
                <div key={status} className="flex items-center gap-2 t-label">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white shadow-xs" style={{ backgroundColor: STATUS_COLORS[status] }}></span>
                  <span className="text-ink font-semibold">{STATUS_LABELS[status]}</span>
                </div>
              ))}
              <div className="border-t border-line pt-2 mt-2">
                <div className="flex items-center gap-2 t-label">
                  <span className="bg-ink text-white t-micro font-bold w-4 h-4 rounded-full flex items-center justify-center shrink-0">3</span>
                  <span className="text-ink-muted font-medium">Clustered reports</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Floating Action Button — Professional Copy */}
        {!selectedReport && (
          <button
            onClick={() => navigate("/report")}
            className="absolute bottom-4 right-4 z-[500] bg-brand hover:bg-brand-mid text-white rounded-full px-4 py-3 shadow-none flex items-center gap-2 text-xs font-bold active:scale-95 transition-all min-h-[44px]"
            aria-label="Report a Hazard"
          >
            <PlusCircle className="w-4 h-4" aria-hidden="true" />
            <span>Report a Hazard</span>
          </button>
        )}
      </div>

      {/* Connected Bottom Sheet for Selected Report */}
      {selectedReport && (
        <div className="bg-white border-t border-line shadow-none px-4 pt-4 pb-4 animate-slide-up z-[500]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: STATUS_COLORS[selectedReport.status] }}
                aria-hidden="true"
              ></span>
              <StatusTag status={selectedReport.status} />
              {selectedReport.clusterCount > 1 && (
                <span className="t-data-sm inline-flex items-center gap-1 border border-line bg-raised px-1.5 text-ink-muted">
                  {selectedReport.clusterCount} reports
                </span>
              )}
            </div>
            <button
              onClick={() => setSelectedReport(null)}
              className="text-xs text-ink-muted hover:text-ink p-1 rounded-xs"
              aria-label="Close detail"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <h3 className="text-sm font-bold text-ink mb-1">
            {getCategoryName(selectedReport.category_id)}
          </h3>

          <div className="flex items-center gap-3 text-xs text-ink-muted mb-3 font-medium">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              {getBarangayName(selectedReport.barangay_id)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-ink-muted" aria-hidden="true" />
              {timeSince(selectedReport.created_at)}
            </span>
          </div>

          <button
            onClick={() => navigate(`/report?category=${selectedReport.category_id}`)}
            className="saro-btn-primary w-full text-xs py-2.5 font-bold"
          >
            Report a Hazard in This Area
          </button>
        </div>
      )}
    </div>
  );
}

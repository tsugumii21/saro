import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { PlusCircle, Clock, MapPin, Layers, X, Plus, Minus } from "lucide-react";
import { getPublicMapReports, getCategories, getBarangays, LEGAZPI_CENTER } from "@saro/shared";
import { saroEvents } from "@saro/shared";

const LEGAZPI_BOUNDS = [
  [13.10, 123.70],
  [13.20, 123.78]
];

const STATUS_LABELS = {
  received: "Received",
  assigned: "Assigned",
  in_progress: "In Progress",
  resolved: "Resolved"
};

const STATUS_COLORS = {
  received: "#94A3B8",
  assigned: "#F59E0B",
  in_progress: "#0F766E",
  resolved: "#22C55E"
};

const STATUS_ORDER = ["received", "assigned", "in_progress", "resolved"];

// Build a Leaflet DivIcon marker from category color + status
function makeMarkerIcon(color, isResolved, clusterCount) {
  const opacity = isResolved ? 0.4 : 1;
  const size = clusterCount > 1 ? 28 : 18;
  const badge = clusterCount > 1
    ? `<span style="position:absolute;top:-6px;right:-6px;background:#1E293B;color:#fff;font-size:10px;font-weight:700;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;">${clusterCount}</span>`
    : "";

  return L.divIcon({
    className: "saro-marker",
    html: `<div style="position:relative;width:${size}px;height:${size}px;opacity:${opacity};">
      <div style="background:${color};width:100%;height:100%;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25);"></div>
      ${badge}
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

// Fit map bounds on mount
function BoundsController() {
  const map = useMap();
  useEffect(() => {
    map.setMaxBounds(L.latLngBounds(LEGAZPI_BOUNDS).pad(0.1));
    map.setMinZoom(13);
  }, [map]);
  return null;
}

// Custom map zoom controls component
function MapZoomButtons() {
  const map = useMap();
  return (
    <div className="absolute bottom-20 right-4 z-[500] flex flex-col gap-1 shadow-md">
      <button
        onClick={() => map.zoomIn()}
        className="w-9 h-9 bg-white/95 backdrop-blur hover:bg-white text-saro-ink border border-saro-line rounded-t-lg flex items-center justify-center font-bold text-lg active:bg-slate-100 transition-colors"
        aria-label="Zoom in"
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        onClick={() => map.zoomOut()}
        className="w-9 h-9 bg-white/95 backdrop-blur hover:bg-white text-saro-ink border-x border-b border-saro-line rounded-b-lg flex items-center justify-center font-bold text-lg active:bg-slate-100 transition-colors"
        aria-label="Zoom out"
      >
        <Minus className="w-4 h-4" />
      </button>
    </div>
  );
}

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

  const loadData = useCallback(async () => {
    const [rRes, cRes, bRes] = await Promise.all([
      getPublicMapReports(),
      getCategories(),
      getBarangays()
    ]);
    if (rRes.data) setReports(rRes.data);
    if (cRes.data) setCategories(cRes.data);
    if (bRes.data) setBarangays(bRes.data);
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
      <div className="flex-1 relative overflow-hidden border-b border-saro-line">
        <MapContainer
          center={LEGAZPI_CENTER}
          zoom={14}
          zoomControl={false}
          scrollWheelZoom={true}
          className="w-full h-full"
          style={{ minHeight: "300px" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />
          <BoundsController />
          <MapZoomButtons />

          {displayReports.map(({ report: r, count }) => {
            const isResolved = r.status === "resolved";
            const color = STATUS_COLORS[r.status] || STATUS_COLORS.received;

            return (
              <Marker
                key={r.cluster_id || r.id}
                position={[r.lat, r.lng]}
                icon={makeMarkerIcon(color, isResolved, count)}
                eventHandlers={{
                  click: () => setSelectedReport({ ...r, clusterCount: count })
                }}
              />
            );
          })}
        </MapContainer>

        {/* Top Bar: Status Filter Chips with smooth horizontal scroll */}
        <div className="absolute top-3 left-3 right-12 z-[500] overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 min-w-max pb-1">
            <button
              onClick={() => setStatusFilter("")}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all shadow-xs border ${
                !statusFilter
                  ? "bg-saro-ink text-white border-saro-ink"
                  : "bg-white/95 backdrop-blur text-saro-ink border-saro-line hover:bg-white"
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
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all shadow-xs flex items-center gap-1.5 border ${
                    isActive
                      ? "bg-saro-ink text-white border-saro-ink"
                      : "bg-white/95 backdrop-blur text-saro-ink border-saro-line hover:bg-white"
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
          className="absolute top-3 right-3 z-[500] bg-white/95 backdrop-blur border border-saro-line rounded-full p-2 shadow-xs hover:bg-white transition-colors"
          aria-label={showLegend ? "Close legend" : "Show map legend"}
        >
          {showLegend ? <X className="w-4 h-4 text-saro-ink" /> : <Layers className="w-4 h-4 text-saro-secondary" />}
        </button>

        {/* Map Legend Panel (Synced order & colors) */}
        {showLegend && (
          <div className="absolute top-12 right-3 z-[500] bg-white/95 backdrop-blur border border-saro-line rounded-xl p-3.5 shadow-lg min-w-[170px] animate-fade-in">
            <h4 className="text-[11px] font-bold text-saro-ink mb-2 uppercase tracking-wider">Map Legend</h4>
            <div className="space-y-2">
              {STATUS_ORDER.map((status) => (
                <div key={status} className="flex items-center gap-2 text-[11px]">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white shadow-xs" style={{ backgroundColor: STATUS_COLORS[status] }}></span>
                  <span className="text-saro-ink font-semibold">{STATUS_LABELS[status]}</span>
                </div>
              ))}
              <div className="border-t border-saro-line pt-2 mt-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="bg-saro-ink text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center shrink-0">3</span>
                  <span className="text-saro-secondary font-medium">Clustered reports</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Floating Action Button — Professional Copy */}
        {!selectedReport && (
          <button
            onClick={() => navigate("/report")}
            className="absolute bottom-4 right-4 z-[500] bg-saro-primary hover:bg-saro-primary-hover text-white rounded-full px-4 py-3 shadow-lg flex items-center gap-2 text-xs font-bold active:scale-95 transition-all min-h-[44px]"
            aria-label="Report a Hazard"
          >
            <PlusCircle className="w-4 h-4" aria-hidden="true" />
            <span>Report a Hazard</span>
          </button>
        )}
      </div>

      {/* Connected Bottom Sheet for Selected Report */}
      {selectedReport && (
        <div className="bg-white border-t border-saro-line shadow-2xl px-4 pt-4 pb-4 animate-slide-up z-[500]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: STATUS_COLORS[selectedReport.status] }}
                aria-hidden="true"
              ></span>
              <span className={`saro-pill saro-pill-status-${selectedReport.status}`}>
                {STATUS_LABELS[selectedReport.status]}
              </span>
              {selectedReport.clusterCount > 1 && (
                <span className="saro-badge-dup">
                  {selectedReport.clusterCount} reports
                </span>
              )}
            </div>
            <button
              onClick={() => setSelectedReport(null)}
              className="text-xs text-saro-secondary hover:text-saro-ink p-1 rounded-md"
              aria-label="Close detail"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <h3 className="text-sm font-bold text-saro-ink mb-1">
            {getCategoryName(selectedReport.category_id)}
          </h3>

          <div className="flex items-center gap-3 text-xs text-saro-secondary mb-3 font-medium">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-saro-primary" aria-hidden="true" />
              {getBarangayName(selectedReport.barangay_id)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-saro-secondary" aria-hidden="true" />
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

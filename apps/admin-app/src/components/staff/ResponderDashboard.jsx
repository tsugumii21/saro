import { useState, useEffect, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import {
  Clock, AlertTriangle, MapPin, X, Upload, Flag, Search, Timer,
  Columns, Table as TableIcon, Map as MapIcon, Rows, Target, BarChart2, CheckCircle2,
  ShieldCheck, UserRound
} from "lucide-react";
import {
  getReports, getCategories, getBarangays, getOffices,
  updateReportStatus, addReportMedia, markFalseReport, LEGAZPI_CENTER
} from "@saro/shared";
import { saroEvents } from "@saro/shared";
import { useAuth } from "@saro/shared";

const POLL_INTERVAL = 30000;
const PAGE_SIZE = 10;

const STATUS_LABELS = {
  received: "Received",
  assigned: "Assigned",
  in_progress: "In Progress",
  resolved: "Resolved"
};
const STATUS_FLOW = ["received", "assigned", "in_progress", "resolved"];
const STATUS_COLORS = {
  received: "#64748B",
  assigned: "#D97706",
  in_progress: "#0F766E",
  resolved: "#16A34A"
};
const STATUS_ICONS = {
  received: "●",
  assigned: "◐",
  in_progress: "▶",
  resolved: "✓"
};

function timeSince(dateStr) {
  if (!dateStr) return "";
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function hoursElapsed(dateStr) {
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

function formatCountdown(hoursRemaining) {
  if (hoursRemaining <= 0) return null;
  if (hoursRemaining < 1) {
    const mins = Math.ceil(hoursRemaining * 60);
    return `${mins}m left`;
  }
  return `${hoursRemaining.toFixed(1)}h left`;
}

function slaProgress(created, slaHours) {
  const elapsed = hoursElapsed(created);
  return Math.min((elapsed / slaHours) * 100, 100);
}

/**
 * Did this report come from a confirmed identity?
 *
 * Reads `reports.filed_by_verified`, a generated column that is true exactly
 * when reporter_user_id is set. It is not a truth rating: a guest report is not
 * less real, it is less traceable. Staff use it to decide how much weight a
 * lone uncorroborated report carries, and whether there is anyone to call back.
 *
 * Deliberately quiet. A loud green tick next to verified rows would read as
 * "trust this one, distrust that one", which is not what it means.
 */
function VerifiedBadge({ verified, showLabel = false }) {
  if (verified) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-800 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded"
        title="Filed from a confirmed resident account"
      >
        <ShieldCheck className="w-3 h-3" aria-hidden="true" />
        {showLabel ? "Verified account" : <span className="sr-only">Verified account</span>}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded"
      title="Filed anonymously from a device, with no account"
    >
      <UserRound className="w-3 h-3" aria-hidden="true" />
      {showLabel ? "Guest report" : <span className="sr-only">Guest report</span>}
    </span>
  );
}

function makeMapIcon(color, isResolved, isSelected) {
  const opacity = isResolved ? 0.45 : 1;
  const size = isSelected ? 22 : 16;
  return L.divIcon({
    className: "saro-marker",
    html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid #fff;opacity:${opacity};"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1280;
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
          if (width > height) { height = Math.round((height * maxSide) / width); width = maxSide; }
          else { width = Math.round((width * maxSide) / height); height = maxSide; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Leaflet Map Controller
function MapController({ coords, layoutMode, reports, autoFitSignal }) {
  const map = useMap();

  const fitAllPoints = useCallback(() => {
    if (reports && reports.length > 0) {
      const validPoints = reports.filter((r) => r.lat && r.lng).map((r) => [r.lat, r.lng]);
      if (validPoints.length > 0) {
        const bounds = L.latLngBounds(validPoints);
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
      }
    }
  }, [reports, map]);

  useEffect(() => {
    fitAllPoints();
  }, [fitAllPoints, autoFitSignal]);

  useEffect(() => {
    if (coords) map.flyTo([coords.lat, coords.lng], 16, { duration: 0.4 });
  }, [coords, map]);

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);
    return () => clearTimeout(timer);
  }, [layoutMode, map]);

  return null;
}

export default function ResponderDashboard() {
  const { profile } = useAuth();
  const officeId = profile?.office_id;
  const tableRef = useRef(null);

  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [offices, setOffices] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [sortField, setSortField] = useState("priority");
  const [sortDir, setSortDir] = useState("desc");

  // Layout mode
  const [layoutMode, setLayoutMode] = useState("split");
  const [autoFitSignal, setAutoFitSignal] = useState(0);

  // Filters
  const [filterBarangay, setFilterBarangay] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // Resolution state
  const [resolveTarget, setResolveTarget] = useState(null);
  const [resolutionPhoto, setResolutionPhoto] = useState(null);
  const [isFalseReport, setIsFalseReport] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [advancing, setAdvancing] = useState(null);

  // Live timer tick
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const loadData = useCallback(async () => {
    const [rRes, cRes, bRes, oRes] = await Promise.all([
      getReports({ officeId }),
      getCategories(),
      getBarangays(),
      getOffices()
    ]);
    if (rRes.data) setReports(rRes.data);
    if (cRes.data) setCategories(cRes.data);
    if (bRes.data) setBarangays(bRes.data);
    if (oRes.data) setOffices(oRes.data);
  }, [officeId]);

  useEffect(() => {
    loadData();
    const u1 = saroEvents.on("report:created", loadData);
    const u2 = saroEvents.on("report:updated", loadData);
    return () => { u1(); u2(); };
  }, [loadData]);

  useEffect(() => {
    const interval = setInterval(loadData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadData]);

  const getCat = (id) => categories.find((c) => c.id === id);
  const getBrgy = (id) => barangays.find((b) => b.id === id);
  const getOfficeName = (id) => offices.find((o) => o.id === id)?.short_name || id;

  // Filter reports
  const filteredReports = reports.filter((r) => {
    if (filterBarangay && r.barangay_id !== filterBarangay) return false;
    if (filterCategory && r.category_id !== filterCategory) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const cat = getCat(r.category_id);
      const brgy = getBrgy(r.barangay_id);
      if (
        !r.tracking_code.toLowerCase().includes(q) &&
        !(cat?.name || "").toLowerCase().includes(q) &&
        !(brgy?.name || "").toLowerCase().includes(q) &&
        !(r.description || "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // Rank / sort reports
  const sortedReports = [...filteredReports].sort((a, b) => {
    if (sortField === "priority") {
      const aResolved = a.status === "resolved" ? 1 : 0;
      const bResolved = b.status === "resolved" ? 1 : 0;
      if (aResolved !== bResolved) return aResolved - bResolved;

      const aCat = getCat(a.category_id);
      const bCat = getCat(b.category_id);
      const aSla = aCat ? hoursElapsed(a.created_at) / aCat.sla_hours : 0;
      const bSla = bCat ? hoursElapsed(b.created_at) / bCat.sla_hours : 0;

      if (aSla >= 1 && bSla < 1) return -1;
      if (bSla >= 1 && aSla < 1) return 1;

      if (b.confidence_score !== a.confidence_score) return b.confidence_score - a.confidence_score;
      return new Date(b.created_at) - new Date(a.created_at);
    }
    if (sortField === "created_at") {
      const diff = new Date(a.created_at) - new Date(b.created_at);
      return sortDir === "desc" ? -diff : diff;
    }
    return 0;
  });

  // Pagination (10 items per page)
  const totalPages = Math.max(1, Math.ceil(sortedReports.length / PAGE_SIZE));
  const paginatedReports = sortedReports.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filterBarangay, filterCategory, filterStatus, searchQuery]);

  // Active counts by barangay
  const brgyBreakdown = barangays.map((b) => {
    const bReports = filteredReports.filter((r) => r.barangay_id === b.id);
    const active = bReports.filter((r) => r.status !== "resolved").length;
    return { id: b.id, name: b.name, total: bReports.length, active };
  }).filter((b) => b.total > 0).sort((a, b) => b.active - a.active);

  const handleAdvanceStatus = async (report) => {
    const idx = STATUS_FLOW.indexOf(report.status);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return;
    const next = STATUS_FLOW[idx + 1];

    if (next === "resolved") {
      setResolveTarget(report);
      setResolutionPhoto(null);
      setIsFalseReport(false);
      return;
    }

    setAdvancing(report.id);
    await updateReportStatus(report.id, next, `Status advanced to ${next}`);
    setAdvancing(null);
  };

  const handleFlagFalseReport = async (report) => {
    setResolveTarget(report);
    setIsFalseReport(true);
    setResolutionPhoto(null);
  };

  const handleResolve = async () => {
    if (!resolveTarget || !resolutionPhoto) return;
    setResolving(true);
    await addReportMedia(resolveTarget.id, resolutionPhoto, "resolution");
    if (isFalseReport) {
      await markFalseReport(resolveTarget.id, true);
    }
    await updateReportStatus(resolveTarget.id, "resolved", isFalseReport ? "Resolved as false report." : "Resolved with evidence.");
    setResolving(false);
    setResolveTarget(null);
    setResolutionPhoto(null);
    setIsFalseReport(false);
  };

  const handleResolutionPhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressPhoto(file);
    setResolutionPhoto(compressed);
  };

  const scrollToRow = (reportId) => {
    const row = tableRef.current?.querySelector(`[data-report-id="${reportId}"]`);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleMarkerClick = (report) => {
    setSelectedReport(report);
    scrollToRow(report.id);
  };

  const isStacked = layoutMode === "stacked";
  const isTableOnly = layoutMode === "table";
  const isMapOnly = layoutMode === "map";

  return (
    <div className={`w-full font-sans ${isStacked ? "flex flex-col gap-3 overflow-y-auto" : "flex items-start gap-4 h-[calc(100vh-85px)] overflow-hidden"}`}>
      
      {/* Left Column: Content-Height Hugging Table Container (No forced empty space) */}
      <div className={`${
        isStacked || isTableOnly ? "w-full" : isMapOnly ? "w-[30%]" : "w-[62%]"
      } shrink-0 flex flex-col bg-white rounded-xl border border-saro-line overflow-hidden transition-all duration-300 h-fit max-h-full`}>
        
        {/* Header Bar */}
        <div className="bg-slate-900 text-white px-4 py-2.5 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xs font-bold text-white tracking-wide uppercase">Responder Queue</h2>
            <span className="text-[11px] bg-teal-950 text-teal-300 border border-teal-800 px-2.5 py-0.5 rounded font-mono font-semibold">
              {getOfficeName(officeId)}
            </span>
            <span className="text-xs text-slate-400 font-medium">
              ({filteredReports.length} items)
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Sort Controls */}
            <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs">
              <button
                onClick={() => { setSortField("priority"); setSortDir("desc"); }}
                className={`px-2.5 py-1 rounded font-semibold transition-colors ${sortField === "priority" ? "bg-teal-700 text-white" : "text-slate-400 hover:text-white"}`}
              >
                Priority
              </button>
              <button
                onClick={() => { setSortField("created_at"); setSortDir(sortDir === "desc" ? "asc" : "desc"); }}
                className={`px-2.5 py-1 rounded font-semibold transition-colors ${sortField === "created_at" ? "bg-teal-700 text-white" : "text-slate-400 hover:text-white"}`}
              >
                Time {sortField === "created_at" ? (sortDir === "desc" ? "↓" : "↑") : ""}
              </button>
            </div>

            {/* Layout Mode Toggles */}
            <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-slate-400">
              <button
                onClick={() => setLayoutMode("split")}
                className={`p-1.5 rounded transition-colors ${layoutMode === "split" ? "bg-teal-700 text-white" : "hover:text-white"}`}
                title="Split View"
              >
                <Columns className="w-4 h-4" />
              </button>
              <button
                onClick={() => setLayoutMode("stacked")}
                className={`p-1.5 rounded transition-colors ${layoutMode === "stacked" ? "bg-teal-700 text-white" : "hover:text-white"}`}
                title="Stacked View"
              >
                <Rows className="w-4 h-4" />
              </button>
              <button
                onClick={() => setLayoutMode("table")}
                className={`p-1.5 rounded transition-colors ${layoutMode === "table" ? "bg-teal-700 text-white" : "hover:text-white"}`}
                title="Table Only"
              >
                <TableIcon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setLayoutMode("map")}
                className={`p-1.5 rounded transition-colors ${layoutMode === "map" ? "bg-teal-700 text-white" : "hover:text-white"}`}
                title="Map Only"
              >
                <MapIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Integrated Barangay Active Chips Bar */}
        <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
            <span className="font-bold text-slate-700 uppercase tracking-wider shrink-0 flex items-center gap-1 text-[11px]">
              <BarChart2 className="w-3.5 h-3.5 text-teal-700" />
              Barangay Active:
            </span>
            {brgyBreakdown.slice(0, 5).map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200 shrink-0 font-medium">
                <span className="font-semibold">{b.name}:</span>
                <span className="font-bold text-teal-800">{b.active}</span>
              </span>
            ))}
          </div>
          <span className="text-[11px] font-mono text-slate-500 font-semibold shrink-0">
            CDRRMO LEGAZPI
          </span>
        </div>

        {/* Compact Filter Bar */}
        <div className="bg-slate-50 px-4 py-2 border-b border-saro-line flex items-center gap-2.5 shrink-0 flex-wrap">
          <div className="relative flex-1 min-w-[150px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter code, category, description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none font-medium"
            />
          </div>
          <select
            value={filterBarangay}
            onChange={(e) => setFilterBarangay(e.target.value)}
            className="text-xs py-1.5 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-800 font-medium"
          >
            <option value="">All Barangays</option>
            {barangays.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="text-xs py-1.5 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-800 font-medium"
          >
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-xs py-1.5 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-800 font-medium"
          >
            <option value="">All Statuses</option>
            {STATUS_FLOW.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>

        {/* High-Readability Queue Table with Larger Text (~14px) and Comfortable Padding */}
        <div className="overflow-y-auto max-h-[calc(100vh-230px)]" ref={tableRef}>
          <table className="w-full text-sm border-collapse">
            <thead className="bg-slate-50 text-slate-500 border-b border-saro-line sticky top-0 z-20 font-bold uppercase tracking-wider text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">Code</th>
                <th className="text-left px-3 py-2.5 min-w-[200px]">Category</th>
                <th className="text-left px-3 py-2.5">Barangay</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-left px-3 py-2.5">SLA / Age</th>
                <th className="text-right px-4 py-2.5 sticky right-0 bg-slate-50 z-20 border-l border-slate-200">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedReports.map((r) => {
                const cat = getCat(r.category_id);
                const brgy = getBrgy(r.barangay_id);
                const isResolved = r.status === "resolved";
                const slaPassed = cat && r.status !== "resolved" && hoursElapsed(r.created_at) > cat.sla_hours;
                const isSelected = selectedReport?.id === r.id;
                const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(r.status) + 1];
                const slaRemaining = cat && r.status !== "resolved" ? cat.sla_hours - hoursElapsed(r.created_at) : null;
                const slaPct = cat && r.status !== "resolved" ? slaProgress(r.created_at, cat.sla_hours) : 0;

                return (
                  <tr
                    key={r.id}
                    data-report-id={r.id}
                    onClick={() => setSelectedReport(r)}
                    className={`cursor-pointer transition-colors group ${
                      isSelected ? "bg-teal-50 font-medium" : "hover:bg-slate-50"
                    } ${isResolved ? "opacity-60" : ""}`}
                  >
                    {/* Incident Code (~14px Mono) */}
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 text-sm whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {r.tracking_code}
                        <VerifiedBadge verified={r.filed_by_verified} />
                        {r.cluster_id && r.confidence_score > 1 && (
                          <span className="text-xs bg-teal-100 text-teal-800 font-bold px-1.5 py-0.5 rounded">
                            ×{r.confidence_score}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Category Name (Sufficient width, no awkward wrap) */}
                    <td className="px-3 py-3 text-slate-900 text-sm font-semibold max-w-[240px] truncate">
                      <div className="flex items-center gap-2">
                        {cat?.is_emergency && <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />}
                        <span className="truncate">{cat?.name || r.category_id}</span>
                      </div>
                    </td>

                    {/* Barangay Name */}
                    <td className="px-3 py-3 text-slate-800 text-sm font-semibold whitespace-nowrap">
                      {brgy?.name || "—"}
                    </td>

                    {/* Status Pill (Proportionally sized ~12-13px) */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md border uppercase tracking-wider ${
                        r.status === "resolved" ? "bg-green-50 text-green-700 border-green-200" :
                        r.status === "in_progress" ? "bg-teal-50 text-teal-700 border-teal-200" :
                        r.status === "assigned" ? "bg-amber-50 text-amber-700 border-amber-200" :
                        "bg-slate-100 text-slate-600 border-slate-200"
                      }`}>
                        <span>{STATUS_ICONS[r.status]}</span>
                        {STATUS_LABELS[r.status]}
                      </span>
                    </td>

                    {/* SLA & Age Badge */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      {slaPassed ? (
                        <div className="flex items-center gap-2">
                          <span className="bg-red-100 text-red-700 border border-red-200 text-xs font-bold px-2 py-0.5 rounded uppercase">
                            Breach
                          </span>
                          <span className="text-xs text-slate-500 font-mono">{timeSince(r.created_at)}</span>
                        </div>
                      ) : cat && r.status !== "resolved" ? (
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs text-slate-700 font-mono font-semibold">
                            {formatCountdown(slaRemaining)}
                          </span>
                          <div className="w-14 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${slaPct > 80 ? "bg-red-500" : slaPct > 50 ? "bg-amber-500" : "bg-teal-600"}`}
                              style={{ width: `${slaPct}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500 font-mono">{timeSince(r.created_at)}</span>
                      )}
                    </td>

                    {/* Sticky Action Column */}
                    <td className={`px-4 py-3 text-right sticky right-0 border-l border-slate-200 whitespace-nowrap ${
                      isSelected ? "bg-teal-50" : "bg-white group-hover:bg-slate-50"
                    }`}>
                      <div className="flex items-center justify-end gap-1.5">
                        {!isResolved && nextStatus && (
                          <button
                            disabled={advancing === r.id}
                            onClick={(e) => { e.stopPropagation(); handleAdvanceStatus(r); }}
                            className="bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                          >
                            {advancing === r.id ? "..." : nextStatus === "resolved" ? "Resolve" : `→ ${STATUS_LABELS[nextStatus]}`}
                          </button>
                        )}
                        {!isResolved && r.status !== "received" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFlagFalseReport(r); }}
                            className="text-slate-400 hover:text-red-600 p-1.5 rounded transition-colors"
                            title="Flag as false report"
                          >
                            <Flag className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paginatedReports.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-xs">
                    No matching reports found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Hugging Table Pagination Footer (No forced bottom gap) */}
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-2 flex items-center justify-between text-xs shrink-0">
          <span className="text-slate-600 font-medium text-xs">
            Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, sortedReports.length)}–{Math.min(currentPage * PAGE_SIZE, sortedReports.length)} of {sortedReports.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 rounded-md border border-slate-200 text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 text-xs font-bold"
            >
              Prev
            </button>
            <span className="px-2 text-slate-800 font-bold text-xs">{currentPage} / {totalPages}</span>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1 rounded-md border border-slate-200 text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 text-xs font-bold"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Full-Height Live Map Panel */}
      {!isTableOnly && (
        <div className={`${
          isStacked ? "w-full h-[460px] shrink-0" : isMapOnly ? "w-full h-full" : "w-[38%] h-full"
        } rounded-xl overflow-hidden border border-saro-line bg-white flex flex-col transition-all duration-300 relative`}>
          
          {/* Map Header with Auto-Fit Button */}
          <div className="bg-slate-900 text-white px-4 py-2.5 border-b border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Legazpi Incident Map
              </h3>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoFitSignal((s) => s + 1)}
                className="flex items-center gap-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-teal-300 border border-slate-700 px-2.5 py-1 rounded font-mono font-semibold transition-colors"
                title="Fit map to active pins"
              >
                <Target className="w-3.5 h-3.5" />
                Fit Pins
              </button>
              <span className="text-[11px] bg-slate-800 px-2.5 py-1 rounded font-mono font-semibold text-slate-300 border border-slate-700">
                {sortedReports.filter((r) => r.lat && r.lng).length} Plotted
              </span>
            </div>
          </div>

          <div className="flex-1 relative w-full h-full">
            <MapContainer
              center={LEGAZPI_CENTER}
              zoom={13}
              scrollWheelZoom={true}
              className="w-full h-full"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              />
              <MapController coords={selectedReport ? { lat: selectedReport.lat, lng: selectedReport.lng } : null} layoutMode={layoutMode} reports={sortedReports} autoFitSignal={autoFitSignal} />
              {sortedReports.filter((r) => r.lat && r.lng).map((r) => (
                <Marker
                  key={r.id}
                  position={[r.lat, r.lng]}
                  icon={makeMapIcon(STATUS_COLORS[r.status] || "#64748B", r.status === "resolved", selectedReport?.id === r.id)}
                  eventHandlers={{ click: () => handleMarkerClick(r) }}
                >
                  <Popup>
                    <div className="text-xs font-sans p-1">
                      <div className="font-bold text-slate-900">{r.tracking_code}</div>
                      <div className="text-slate-600">{getCat(r.category_id)?.name}</div>
                      <div className="text-teal-700 font-semibold mt-0.5 flex items-center gap-1">
                        <span>{STATUS_ICONS[r.status]}</span>
                        {STATUS_LABELS[r.status]}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>

            {/* Scaled Map Legend Footer */}
            <div className="absolute bottom-2 left-3 right-3 bg-white/98 border border-slate-300 rounded-xl px-4 py-2.5 z-[500] flex items-center justify-between text-xs font-bold text-slate-800 shadow-sm">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-500" /> Received</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Assigned</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-teal-700" /> In Progress</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-600" /> Closed</span>
              </div>
              <span className="text-xs text-slate-500 font-mono font-bold">Legazpi EOC</span>
            </div>

            {/* Scaled Selected Report Detail Overlay */}
            {selectedReport && (
              <div className="absolute bottom-14 left-3 right-3 bg-white/98 border-2 border-teal-700/30 rounded-2xl p-4 sm:p-5 z-[501] shadow-2xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm font-extrabold text-slate-900">{selectedReport.tracking_code}</span>
                    <VerifiedBadge verified={selectedReport.filed_by_verified} showLabel />
                  </span>
                  <button onClick={() => setSelectedReport(null)} className="text-slate-400 hover:text-slate-900 p-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-slate-900 font-medium leading-relaxed mb-3">
                  {selectedReport.description}
                </p>
                <div className="flex items-center gap-4 text-xs font-semibold text-slate-700">
                  <span className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                    <MapPin className="w-4 h-4 text-teal-700" />
                    {getBrgy(selectedReport.barangay_id)?.name || "—"}
                  </span>
                  <span className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                    <Clock className="w-4 h-4 text-slate-600" />
                    {timeSince(selectedReport.created_at)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Resolution Photo Modal */}
      {resolveTarget && (
        <div className="fixed inset-0 bg-slate-950/60 z-50 flex items-center justify-center p-6">
          <div className="bg-white border border-saro-line rounded-xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900">
                {isFalseReport ? "Flag as False Report" : "Resolve Report"} {resolveTarget.tracking_code}
              </h3>
              <button onClick={() => { setResolveTarget(null); setResolutionPhoto(null); setIsFalseReport(false); }} className="text-slate-400 hover:text-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              A resolution photo is required before marking this incident as resolved in public records.
            </p>

            {resolutionPhoto ? (
              <div className="relative mb-4">
                <img src={resolutionPhoto} alt="Resolution" className="w-full h-40 object-cover rounded-lg border border-slate-200" />
                <button
                  onClick={() => setResolutionPhoto(null)}
                  className="absolute top-2 right-2 bg-slate-900 text-white text-[11px] px-2 py-1 rounded"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 p-6 bg-slate-50 border border-slate-200 border-dashed rounded-xl cursor-pointer mb-4 hover:border-teal-700 transition-colors">
                <Upload className="w-5 h-5 text-teal-700" />
                <span className="text-xs font-semibold text-slate-800">Attach Resolution Photo</span>
                <span className="text-[10px] text-slate-500">JPEG/PNG max 10MB</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleResolutionPhotoUpload} />
              </label>
            )}

            <label className="flex items-center gap-2.5 mb-5 cursor-pointer bg-slate-50 border border-slate-200 p-3 rounded-xl">
              <input
                type="checkbox"
                checked={isFalseReport}
                onChange={(e) => setIsFalseReport(e.target.checked)}
                className="w-4 h-4 rounded accent-teal-700"
              />
              <div className="text-xs">
                <span className="text-slate-900 font-bold flex items-center gap-1">
                  <Flag className="w-3.5 h-3.5 text-red-600" />
                  Mark as False Report
                </span>
              </div>
            </label>

            <button
              disabled={!resolutionPhoto || resolving}
              onClick={handleResolve}
              className="w-full py-2.5 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-bold text-xs rounded-xl transition-colors disabled:opacity-40"
            >
              {resolving ? "Resolving Report..." : isFalseReport ? "Resolve as False Report" : "Confirm & Resolve Report"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

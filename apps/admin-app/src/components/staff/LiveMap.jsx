import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Layers, MapPin, Clock, ShieldCheck, UserRound, X, Split, Eye, Flame, Filter, Sparkles, AlertTriangle, Search, Image as ImageIcon, Archive
} from "lucide-react";
import { StatusTag, TrackingCode, HazardMap } from "@saro/ui";
import {
  getClustersWithReports, splitFromCluster, getReports, saroEvents, REALTIME_EVENTS,
  useAuth, LEGAZPI_CENTER, CLUSTER_RADIUS_METERS, CLUSTER_WINDOW_MINUTES,
  STATUS_LABELS, isArchivedReport,
} from "@saro/shared";

const STATUS_COLORS = {
  received: "#94A3B8",
  assigned: "#F59E0B",
  in_progress: "#0060A9",
  resolved: "#22C55E",
  closed_confirmed: "#15803D",
  closed_unconfirmed: "#78716C",
  reopened: "#DC2626",
};

/**
 * Calculates distance between two coordinates in meters (Haversine formula).
 */
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Confidence Badge calculation.
 * Displays calculated confidence score percentage and independent count.
 */
function ConfidenceBadge({ value, count }) {
  const percent = Math.round((value ?? 0.5) * 100);
  const isHigh = percent >= 75;
  const isMid = percent >= 50;

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold font-mono"
      style={{
        background: isHigh
          ? "var(--color-status-resolved-tab)"
          : isMid
          ? "var(--color-brand-wash)"
          : "var(--color-sunken)",
        color: isHigh
          ? "var(--color-status-resolved-ink)"
          : isMid
          ? "var(--color-brand)"
          : "var(--color-ink-muted)",
        border: "1px solid var(--color-rule-faint)",
      }}
    >
      <Sparkles width={12} height={12} />
      {percent}% Confidence ({count} report{count === 1 ? "" : "s"})
    </span>
  );
}

export default function LiveMap() {
  const { isBarangayOfficial } = useAuth();
  const [reports, setReports] = useState([]);
  const [dbClusters, setDbClusters] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null); // cluster or report
  const [showRecurringSpots, setShowRecurringSpots] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [busySplitId, setBusySplitId] = useState("");
  const [actionError, setActionError] = useState("");

  const loadData = useCallback(async () => {
    const [cRes, rRes] = await Promise.all([
      getClustersWithReports(),
      getReports(),
    ]);
    if (cRes.data) setDbClusters(cRes.data);
    if (rRes.data) setReports(rRes.data);
  }, []);

  useEffect(() => {
    loadData();
    const offCluster = saroEvents.on(REALTIME_EVENTS.CLUSTER_UPDATED, loadData);
    const offReport = saroEvents.on(REALTIME_EVENTS.REPORT_CREATED, loadData);
    const offUpdated = saroEvents.on("report:updated", loadData);
    return () => {
      offCluster();
      offReport();
      offUpdated();
    };
  }, [loadData]);

  // Compute total archived count (>72h resolved/closed reports)
  const archivedCount = useMemo(() => {
    return reports.filter((r) => isArchivedReport(r)).length;
  }, [reports]);

  // Compute auto-clustered groups from raw reports matching 150m & 60-min rule
  const computedClusters = useMemo(() => {
    // Exclude archived reports unless showArchived toggle is ON
    const filteredReports = reports.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!showArchived && isArchivedReport(r)) return false;
      return true;
    });

    if (!filteredReports.length) return [];

    const assigned = new Set();
    const clusterGroups = [];

    for (let i = 0; i < filteredReports.length; i++) {
      const main = filteredReports[i];
      if (assigned.has(main.id)) continue;

      const groupMembers = [main];
      assigned.add(main.id);

      const mainTime = new Date(main.created_at).getTime();

      for (let j = i + 1; j < filteredReports.length; j++) {
        const candidate = filteredReports[j];
        if (assigned.has(candidate.id)) continue;

        // Same category requirement
        if ((candidate.category_id ?? candidate.category) !== (main.category_id ?? main.category)) {
          continue;
        }

        // Distance check (150m threshold)
        const dist = getDistanceMeters(main.lat, main.lng, candidate.lat, candidate.lng);
        if (dist > CLUSTER_RADIUS_METERS) continue;

        // Time check (60-minute threshold)
        const candidateTime = new Date(candidate.created_at).getTime();
        const diffMinutes = Math.abs(mainTime - candidateTime) / 60000;
        if (diffMinutes > CLUSTER_WINDOW_MINUTES) continue;

        groupMembers.push(candidate);
        assigned.add(candidate.id);
      }

      // Calculate centroid
      const avgLat = groupMembers.reduce((sum, r) => sum + r.lat, 0) / groupMembers.length;
      const avgLng = groupMembers.reduce((sum, r) => sum + r.lng, 0) / groupMembers.length;

      clusterGroups.push({
        id: groupMembers.length > 1 ? `cluster-${main.id}` : main.id,
        isCluster: groupMembers.length > 1,
        clusterCount: groupMembers.length,
        confidence: Math.min(0.35 + groupMembers.length * 0.15, 0.98),
        lat: avgLat,
        lng: avgLng,
        category: main.category,
        category_label: main.routing_table?.label ?? main.category,
        priority: groupMembers.some((r) => r.priority === "high") ? "high" : "medium",
        color: STATUS_COLORS[main.status] || STATUS_COLORS.received,
        mainReport: main,
        reports: groupMembers,
        created_at: main.created_at,
      });
    }

    return clusterGroups;
  }, [reports, statusFilter, showArchived]);

  // Recurring spots (spatial hotspots aggregated to ~110m grid)
  const recurringSpots = useMemo(() => {
    const buckets = new Map();
    for (const r of reports) {
      if (typeof r.lat !== "number" || typeof r.lng !== "number") continue;
      const key = `${r.lat.toFixed(3)},${r.lng.toFixed(3)}`;
      if (!buckets.has(key)) buckets.set(key, { lat: r.lat, lng: r.lng, reports: [] });
      buckets.get(key).reports.push(r);
    }
    return [...buckets.values()]
      .filter((spot) => spot.reports.length >= 2)
      .sort((a, b) => b.reports.length - a.reports.length);
  }, [reports]);

  // Prepare map pins
  const mapReportMarkers = useMemo(() => {
    return computedClusters.map((grp) => ({
      id: grp.id,
      lat: grp.lat,
      lng: grp.lng,
      count: grp.clusterCount,
      priority: grp.priority,
      color: grp.color,
      onSelect: () => setSelectedItem(grp),
    }));
  }, [computedClusters]);

  const handleSplitReport = async (clusterId, reportId) => {
    setBusySplitId(reportId);
    setActionError("");
    const { error: splitErr } = await splitFromCluster(clusterId, reportId);
    setBusySplitId("");
    if (splitErr) return setActionError(splitErr);
    await loadData();
    setSelectedItem(null);
  };

  const totalActive = reports.filter((r) => r.status !== "closed_confirmed" && !isArchivedReport(r)).length;
  const totalClusteredCount = computedClusters.filter((c) => c.isCluster).length;
  const highPriorityCount = reports.filter((r) => r.priority === "high" && !isArchivedReport(r)).length;

  return (
    <div className="flex flex-col gap-4 font-sans" style={{ height: "calc(100vh - 92px)" }}>
      {/* ── Control Header & Live Stats ─────────────────────────────────── */}
      <div className="saro-card flex flex-wrap items-center justify-between gap-4 px-4 py-3 bg-white border border-line shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="t-heading text-ink font-bold">Live Operations Map</h1>
            <span className="text-[10px] font-mono font-bold bg-brand-wash text-brand px-2 py-0.5 rounded border border-brand-edge">
              Auto-Clustering Active
            </span>
          </div>
          <p className="t-body-sm text-ink-muted mt-0.5">
            City-wide spatial monitoring with real-time automatic hazard clustering within {CLUSTER_RADIUS_METERS}m & {CLUSTER_WINDOW_MINUTES} mins.
          </p>
        </div>

        {/* Operational Counters */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex flex-col items-start border-r border-line pr-4">
            <span className="text-[10px] uppercase font-bold text-ink-faint">Active Incidents</span>
            <span className="text-base font-bold font-mono text-brand">{totalActive}</span>
          </div>
          <div className="flex flex-col items-start border-r border-line pr-4">
            <span className="text-[10px] uppercase font-bold text-ink-faint">Auto Clusters</span>
            <span className="text-base font-bold font-mono text-status-resolved-ink">{totalClusteredCount}</span>
          </div>
          <div className="flex flex-col items-start border-r border-line pr-4">
            <span className="text-[10px] uppercase font-bold text-ink-faint">In Hazard Zone</span>
            <span className="text-base font-bold font-mono text-alert">{highPriorityCount}</span>
          </div>
          <div className="flex flex-col items-start border-r border-line pr-4">
            <span className="text-[10px] uppercase font-bold text-ink-faint">Recurring Spots</span>
            <span className="text-base font-bold font-mono text-ink">{recurringSpots.length}</span>
          </div>
          <div className="flex flex-col items-start">
            <span className="text-[10px] uppercase font-bold text-ink-faint">Archived (&gt;3d)</span>
            <span className="text-base font-bold font-mono text-slate-500">{archivedCount}</span>
          </div>
        </div>
      </div>

      {/* ── Toolbar & Filter Controls ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRecurringSpots(!showRecurringSpots)}
            className={`saro-btn saro-btn-sm font-bold gap-1.5 ${
              showRecurringSpots ? "bg-amber-100 text-amber-900 border-amber-300" : "bg-white text-ink-muted border-line"
            }`}
          >
            <Flame width={14} height={14} className={showRecurringSpots ? "text-amber-600" : "text-ink-faint"} />
            {showRecurringSpots ? "Hide Recurring Spots" : "Highlight Recurring Spots"}
          </button>

          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className={`saro-btn saro-btn-sm font-bold gap-1.5 ${
              showArchived ? "bg-slate-800 text-white border-slate-700" : "bg-white text-ink-muted border-line"
            }`}
          >
            <Archive width={14} height={14} className={showArchived ? "text-amber-400" : "text-ink-faint"} />
            {showArchived ? "Hide Archived Reports" : "Show Archived (Resolved >3d)"}
            {archivedCount > 0 && (
              <span className="ml-1 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-700 text-white">
                {archivedCount}
              </span>
            )}
          </button>
        </div>

        {/* Status Filter Buttons */}
        <div className="flex items-center gap-px border border-line bg-line rounded overflow-hidden">
          <button
            onClick={() => setStatusFilter("")}
            className="saro-btn saro-btn-sm"
            style={{
              background: statusFilter === "" ? "var(--color-brand)" : "var(--color-surface)",
              color: statusFilter === "" ? "#fff" : "var(--color-ink-muted)",
            }}
          >
            All Incidents ({reports.length})
          </button>
          {["received", "assigned", "in_progress", "resolved"].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(statusFilter === st ? "" : st)}
              className="saro-btn saro-btn-sm capitalize"
              style={{
                background: statusFilter === st ? "var(--color-brand)" : "var(--color-surface)",
                color: statusFilter === st ? "#fff" : "var(--color-ink-muted)",
              }}
            >
              {STATUS_LABELS[st] || st.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Operations Map Container ───────────────────────────────── */}
      <div
        className="grid min-h-0 flex-1 gap-4"
        style={{ gridTemplateColumns: selectedItem ? "minmax(0,1fr) 420px" : "minmax(0,1fr)" }}
      >
        {/* City-Wide Map */}
        <div className="saro-card relative h-full overflow-hidden border border-line shadow-xs">
          <HazardMap
            className="h-full w-full"
            center={[LEGAZPI_CENTER[1], LEGAZPI_CENTER[0]]}
            zoom={13}
            hidden={["rain"]}
            reports={mapReportMarkers}
            accidentBlackspots={showRecurringSpots ? recurringSpots.map((spot, idx) => ({
              id: `spot-${idx}`,
              lat: spot.lat,
              lng: spot.lng,
              name: `Hotspot: ${spot.reports[0]?.routing_table?.label || spot.reports[0]?.category}`,
              location_label: `${spot.reports.length} recurring reports near this location`,
              incident_count: spot.reports.length,
              last_reported: "Active",
            })) : []}
          />
        </div>

        {/* ── Cluster / Incident Summary Drawer Panel ───────────────────── */}
        {selectedItem && (
          <aside className="saro-card saro-rise flex h-full min-h-0 flex-col overflow-hidden bg-white border border-line shadow-card rounded-xs">
            {/* Header */}
            <div
              className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 bg-raised"
              style={{ boxShadow: `inset 0 3px 0 0 ${selectedItem.color}` }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-ink uppercase tracking-wider">
                    {selectedItem.isCluster ? "Auto-Clustered Incident" : "Single Incident Report"}
                  </span>
                  <ConfidenceBadge value={selectedItem.confidence} count={selectedItem.clusterCount} />
                </div>
                <h2 className="t-body-sm mt-1 truncate font-bold text-ink">
                  {selectedItem.category_label || selectedItem.category}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="saro-btn saro-btn-ghost saro-btn-sm -mr-2 text-ink-muted hover:text-ink"
                aria-label="Close summary card"
              >
                <X width={18} height={18} />
              </button>
            </div>

            {/* Scrollable Summary Body */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
              {/* Location & Barangay */}
              <div className="flex items-center justify-between text-xs bg-sunken p-2.5 rounded border border-line">
                <span className="flex items-center gap-1 font-semibold text-ink">
                  <MapPin width={14} height={14} className="text-brand" />
                  {selectedItem.mainReport?.barangays?.name
                    ? `Brgy. ${selectedItem.mainReport.barangays.name}`
                    : "Legazpi City"}
                </span>
                <span className="font-mono text-ink-faint text-[11px]">
                  {selectedItem.lat.toFixed(4)}, {selectedItem.lng.toFixed(4)}
                </span>
              </div>

              {/* Summarized Context */}
              <div className="space-y-1.5">
                <span className="t-label text-ink-faint block uppercase text-[10px] font-bold tracking-wider">
                  Aggregated Context & Descriptions
                </span>
                <div className="space-y-2">
                  {selectedItem.reports.map((r, i) => (
                    <div key={r.id || i} className="p-3 bg-raised rounded border border-line space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <TrackingCode code={r.tracking_code} />
                          {r.filed_by_verified ? (
                            <ShieldCheck width={12} height={12} className="text-status-resolved-ink" aria-label="Verified resident" />
                          ) : (
                            <UserRound width={12} height={12} className="text-ink-faint" aria-label="Guest report" />
                          )}
                        </div>
                        <StatusTag status={r.status} />
                      </div>
                      <p className="text-ink font-medium leading-relaxed">
                        {r.description || "No description text provided."}
                      </p>
                      <span className="font-mono text-[10px] text-ink-faint block text-right pt-0.5">
                        {new Date(r.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Split Action for Admins */}
              {!isBarangayOfficial && selectedItem.isCluster && (
                <div className="p-3 bg-amber-50/50 border border-amber-200 rounded space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                    <Split width={14} height={14} />
                    Cluster Override & Management
                  </div>
                  <p className="text-[11px] text-amber-800 leading-tight">
                    If these reports were automatically merged by proximity but describe separate physical incidents, you can split any report out of this cluster.
                  </p>
                  {actionError && (
                    <p className="text-xs text-alert font-bold bg-alert-wash p-1.5 rounded">{actionError}</p>
                  )}
                  <div className="space-y-1.5 pt-1">
                    {selectedItem.reports.map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-xs bg-white p-2 rounded border border-amber-200">
                        <span className="font-mono font-bold text-ink">{r.tracking_code}</span>
                        <button
                          type="button"
                          onClick={() => handleSplitReport(selectedItem.id, r.id)}
                          disabled={busySplitId === r.id}
                          className="saro-btn saro-btn-secondary saro-btn-sm text-[11px] py-1"
                        >
                          {busySplitId === r.id ? "Splitting..." : "Split Out"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

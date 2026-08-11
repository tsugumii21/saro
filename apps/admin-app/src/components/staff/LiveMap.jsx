import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Layers, MapPin, Clock, ShieldCheck, UserRound, X, Split, Eye, Flame, Filter, AlertTriangle, Search, Image as ImageIcon, Archive
} from "lucide-react";
import { StatusTag, TrackingCode, HazardMap, IncidentPinCard } from "@saro/ui";
import {
  splitFromCluster, getReports, saroEvents, REALTIME_EVENTS,
  useAuth, LEGAZPI_CENTER, CLUSTER_RADIUS_METERS, CLUSTER_WINDOW_MINUTES,
  STATUS_LABELS, isArchivedReport, getDistanceMeters, corroborationLabel,
} from "@saro/shared";

/** Stable empty array — a new `[]` each render would rebuild the map markers. */
const EMPTY_BLACKSPOTS = [];

const STATUS_COLORS = {
  received: "#94A3B8",
  assigned: "#F59E0B",
  in_progress: "#0060A9",
  resolved: "#22C55E",
  closed_confirmed: "#15803D",
  closed_unconfirmed: "#78716C",
  reopened: "#DC2626",
};

/* getDistanceMeters was a second Haversine implementation living here. It now
   comes from @saro/shared, which is also what the corroboration facts are
   measured with — two copies of the same formula is two chances to disagree
   about whether reports are 150 m apart. */

/**
 * What corroborates this incident, stated as facts.
 *
 * Replaces a "confidence" badge that showed a percentage derived from the
 * member count alone (`0.35 + n × 0.15`). Three reports always read "80%
 * confidence", which sounds like a measurement and was not one — and the badge
 * painted resolved-ink on resolved-tab, two neighbouring greens at ~1.2:1, so
 * at high counts the text vanished into its own background.
 *
 * Both problems have the same fix: say the true thing, in ink that can be read.
 */
function CorroborationBadge({ label, saved }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] font-bold"
      style={{
        background: saved ? "var(--color-brand-wash)" : "var(--color-sunken)",
        color: saved ? "var(--color-brand)" : "var(--color-ink-muted)",
        borderColor: saved ? "var(--color-brand-edge)" : "var(--color-line)",
      }}
    >
      <Layers width={12} height={12} aria-hidden="true" />
      {label}
    </span>
  );
}

export default function LiveMap() {
  const { isBarangayOfficial, viewerScope } = useAuth();
  const [reports, setReports] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null); // cluster or report
  const [showRecurringSpots, setShowRecurringSpots] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [busySplitId, setBusySplitId] = useState("");
  const [actionError, setActionError] = useState("");

  /* The map draws pins from these rows, so an unscoped read here puts every
     barangay's reports on a barangay official's screen even when their queue
     below is correctly filtered. */
  const loadData = useCallback(async () => {
    if (!viewerScope?.role) return;
    /* Cluster membership travels on the reports themselves (`cluster_id`), so
       there is no second fetch for the cluster rows: one read, one truth. */
    const { data } = await getReports({ scope: viewerScope });
    if (data) setReports(data);
  }, [viewerScope]);

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

  /**
   * The groups this map draws.
   *
   * Membership comes from Postgres first. `assign_report_cluster` runs on
   * insert and writes `reports.cluster_id`, so the database already holds the
   * answer to "which reports are one incident" — and it is the only copy of
   * that answer anyone can edit. The screen used to ignore it and re-derive
   * groups in the browser under synthetic ids like `cluster-<reportId>`, which
   * is why Split Out could never work: it asked Postgres to remove a row from a
   * cluster that existed only in this component's memory.
   *
   * Reports the trigger left unclustered are still grouped by proximity, but
   * that grouping is labelled as a view rather than a record, and offers no
   * split — there is nothing on the server to split.
   */
  const computedClusters = useMemo(() => {
    const filteredReports = reports.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!showArchived && isArchivedReport(r)) return false;
      return true;
    });

    if (!filteredReports.length) return [];

    const groups = [];
    const claimed = new Set();

    const buildGroup = (members, { id, isSaved }) => {
      const main = members[0];
      const avgLat = members.reduce((sum, r) => sum + Number(r.lat), 0) / members.length;
      const avgLng = members.reduce((sum, r) => sum + Number(r.lng), 0) / members.length;
      return {
        id,
        /* True only for a cluster row that exists in Postgres. Everything that
           can act on the server — Split Out above all — keys off this. */
        isSavedCluster: isSaved,
        isCluster: members.length > 1,
        clusterCount: members.length,
        corroboration: corroborationLabel(members),
        lat: avgLat,
        lng: avgLng,
        category: main.category,
        category_label: main.routing_table?.label ?? main.category,
        priority: members.some((r) => r.priority === "high") ? "high" : "medium",
        color: STATUS_COLORS[main.status] || STATUS_COLORS.received,
        mainReport: main,
        reports: members,
        created_at: main.created_at,
      };
    };

    // 1. Real clusters, exactly as Postgres recorded them.
    const byClusterId = new Map();
    for (const report of filteredReports) {
      if (!report.cluster_id) continue;
      if (!byClusterId.has(report.cluster_id)) byClusterId.set(report.cluster_id, []);
      byClusterId.get(report.cluster_id).push(report);
      claimed.add(report.id);
    }
    for (const [clusterId, members] of byClusterId) {
      groups.push(buildGroup(members, { id: clusterId, isSaved: true }));
    }

    // 2. Everything the trigger did not cluster, grouped by the same 150 m /
    //    60 min rule so the map still shows one pin per apparent incident.
    const rest = filteredReports.filter((r) => !claimed.has(r.id));
    for (let i = 0; i < rest.length; i++) {
      const main = rest[i];
      if (claimed.has(main.id)) continue;

      const members = [main];
      claimed.add(main.id);
      const mainTime = new Date(main.created_at).getTime();

      for (let j = i + 1; j < rest.length; j++) {
        const candidate = rest[j];
        if (claimed.has(candidate.id)) continue;
        if ((candidate.category_id ?? candidate.category) !== (main.category_id ?? main.category)) continue;
        if (getDistanceMeters(main.lat, main.lng, candidate.lat, candidate.lng) > CLUSTER_RADIUS_METERS) continue;

        const diffMinutes = Math.abs(mainTime - new Date(candidate.created_at).getTime()) / 60000;
        if (diffMinutes > CLUSTER_WINDOW_MINUTES) continue;

        members.push(candidate);
        claimed.add(candidate.id);
      }

      groups.push(buildGroup(members, { id: main.id, isSaved: false }));
    }

    return groups;
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

  /* Prepare map pins. Each pin carries the detail its popup renders — the popup
     is where a report is read, so a pin that knows only its coordinates would
     leave the operator looking at an empty card. */
  const mapReportMarkers = useMemo(() => {
    return computedClusters.map((grp) => ({
      id: grp.id,
      report_id: grp.mainReport?.id,
      lat: grp.lat,
      lng: grp.lng,
      count: grp.clusterCount,
      priority: grp.priority,
      color: grp.color,
      status: grp.mainReport?.status,
      category: grp.category,
      categoryName: grp.category_label,
      tracking_code: grp.mainReport?.tracking_code,
      description: grp.mainReport?.description,
      barangayName: grp.mainReport?.barangays?.name || "Legazpi City",
      created_at: grp.created_at,
      members: grp.reports,
      onSelect: () => setSelectedItem(grp),
      onSelectMember: () => setSelectedItem(grp),
    }));
  }, [computedClusters]);

  /* Memoised because the map rebuilds its markers whenever this array changes
     identity — a fresh literal on every render tore the open pin popup down
     the moment selecting a pin re-rendered this component. */
  const blackspotMarkers = useMemo(() => {
    if (!showRecurringSpots) return EMPTY_BLACKSPOTS;
    return recurringSpots.map((spot, idx) => ({
      id: `spot-${idx}`,
      lat: spot.lat,
      lng: spot.lng,
      name: `Hotspot: ${spot.reports[0]?.routing_table?.label || spot.reports[0]?.category}`,
      location_label: `${spot.reports.length} recurring reports near this location`,
      incident_count: spot.reports.length,
      last_reported: "Active",
    }));
  }, [showRecurringSpots, recurringSpots]);

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
  /* Counted separately, because they are different claims: one is what the
     database linked, the other is what this screen drew. */
  const savedClusterCount = computedClusters.filter((c) => c.isCluster && c.isSavedCluster).length;
  const proximityGroupCount = computedClusters.filter((c) => c.isCluster && !c.isSavedCluster).length;
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
            Incidents linked by the database on arrival. Reports it left unlinked are drawn together
            when they fall within {CLUSTER_RADIUS_METERS} m and {CLUSTER_WINDOW_MINUTES} minutes.
          </p>
        </div>

        {/* Operational Counters */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex flex-col items-start border-r border-line pr-4">
            <span className="text-[10px] uppercase font-bold text-ink-faint">Active Incidents</span>
            <span className="text-base font-bold font-mono text-brand">{totalActive}</span>
          </div>
          <div className="flex flex-col items-start border-r border-line pr-4">
            <span className="text-[10px] uppercase font-bold text-ink-faint">Linked Incidents</span>
            <span className="text-base font-bold font-mono text-status-resolved-ink">{savedClusterCount}</span>
          </div>
          <div className="flex flex-col items-start border-r border-line pr-4">
            <span className="text-[10px] uppercase font-bold text-ink-faint">Near Each Other</span>
            <span className="text-base font-bold font-mono text-ink">{proximityGroupCount}</span>
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
            renderReportPopup={(pin, { close }) => (
              <IncidentPinCard
                report={pin}
                categoryName={pin.categoryName || pin.category}
                barangayName={pin.barangayName}
                timeSinceStr={pin.created_at ? new Date(pin.created_at).toLocaleString("en-PH") : ""}
                onClose={close}
                onSelectReport={() => {
                  close();
                  pin.onSelect?.();
                }}
              />
            )}
            selectedId={selectedItem?.id ?? null}
            onClearSelectedReport={() => setSelectedItem(null)}
            accidentBlackspots={blackspotMarkers}
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
                    {selectedItem.isCluster
                      ? selectedItem.isSavedCluster
                        ? "Clustered Incident"
                        : "Grouped by proximity"
                      : "Single Incident Report"}
                  </span>
                  <CorroborationBadge
                    label={selectedItem.corroboration}
                    saved={selectedItem.isSavedCluster}
                  />
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

              {/* A group the browser inferred is a drawing, not a record: there
                  is no cluster row on the server to take a report out of. Say so
                  rather than offering a button that cannot do anything. */}
              {selectedItem.isCluster && !selectedItem.isSavedCluster && (
                <p className="rounded border border-line bg-sunken p-3 text-[11px] leading-relaxed text-ink-muted">
                  These reports are drawn as one pin because they arrived within{" "}
                  {CLUSTER_RADIUS_METERS} m and {CLUSTER_WINDOW_MINUTES} minutes of each other. The
                  database has not linked them into an incident, so there is nothing here to split.
                </p>
              )}

              {/* Split Action for Admins */}
              {!isBarangayOfficial && selectedItem.isCluster && selectedItem.isSavedCluster && (
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

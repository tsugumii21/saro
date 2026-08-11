import { useState, useEffect, useCallback, useMemo } from "react";
import {
  FileDown, Table, Crosshair, Loader2, Search, MapPin, Layers, X, Clock,
  ChevronDown, Printer, Filter, ArrowLeft,
} from "lucide-react";
import { StatusTag, TrackingCode, HazardMap } from "@saro/ui";
import {
  getReportsNearPoint, getReportMedia, getReports, getBarangays,
  getClustersWithReports, getReportByTrackingCode,
  useAuth, LEGAZPI_CENTER, RESOLUTION_REASON_LABELS, STATUS_LABELS,
  CLUSTER_RADIUS_METERS, CLUSTER_WINDOW_MINUTES, describeScope,
} from "@saro/shared";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function monthKey(iso) {
  return new Date(iso).toLocaleString("en-PH", { month: "short", year: "numeric" });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Main component ──────────────────────────────────────────────────────── */

export default function EvidenceExport() {
  const { profile, officeName, barangayName, viewerScope } = useAuth();

  // Data sources
  const [allReports, setAllReports] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [barangays, setBarangays] = useState([]);

  // Search / selection state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState("smart"); // smart | radius
  const [selectedSource, setSelectedSource] = useState(null);

  // Radius fallback state
  const [radiusPoint, setRadiusPoint] = useState(null);
  const [radius, setRadius] = useState(150);

  // Results
  const [rows, setRows] = useState([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState("");
  const [error, setError] = useState("");

  /* Every read here is scoped to the signed-in viewer. This screen used to call
     getReports() bare and print the viewer's office as a caption, which meant a
     barangay captain could search, open and export evidence for the whole city
     under a heading that said "Brgy. Bitano". */
  useEffect(() => {
    if (!viewerScope?.role) return;
    (async () => {
      const [rRes, cRes, bRes] = await Promise.all([
        getReports({ scope: viewerScope }),
        getClustersWithReports({ scope: viewerScope }),
        getBarangays(),
      ]);
      if (rRes.data) setAllReports(rRes.data);
      if (cRes.data) setClusters(cRes.data);
      /* A barangay official gets one entry in the barangay picker: their own.
         The list is a navigation aid, and offering the other 69 barangays as
         search targets that return nothing is worse than not offering them. */
      if (bRes.data) {
        setBarangays(
          viewerScope.role === "barangay_official" && viewerScope.barangayId
            ? bRes.data.filter((b) => String(b.id) === String(viewerScope.barangayId))
            : bRes.data
        );
      }
    })();
  }, [viewerScope]);

  // Build searchable items from clusters, barangays, and individual reports
  const searchableItems = useMemo(() => {
    const items = [];

    // Clusters (auto-grouped incidents)
    for (const cluster of clusters) {
      if (!cluster.reports?.length) continue;
      const label = cluster.reports[0]?.routing_table?.label ?? cluster.category ?? "Incident";
      const brgy = cluster.reports[0]?.barangays?.name;
      items.push({
        id: `cluster-${cluster.id}`,
        type: "cluster",
        label: `${label} cluster`,
        sublabel: `${cluster.report_count} reports${brgy ? ` · Brgy. ${brgy}` : ""}`,
        reportCount: cluster.report_count,
        reports: cluster.reports,
        lat: cluster.reports[0]?.lat,
        lng: cluster.reports[0]?.lng,
      });
    }

    // Barangays with report counts
    const reportsByBarangay = {};
    for (const r of allReports) {
      const name = r.barangays?.name;
      if (!name) continue;
      if (!reportsByBarangay[name]) reportsByBarangay[name] = [];
      reportsByBarangay[name].push(r);
    }
    for (const brgy of barangays) {
      const brgyReports = reportsByBarangay[brgy.name] ?? [];
      if (!brgyReports.length) continue;
      items.push({
        id: `barangay-${brgy.id}`,
        type: "barangay",
        label: `Brgy. ${brgy.name}`,
        sublabel: `${brgyReports.length} report${brgyReports.length === 1 ? "" : "s"}`,
        reportCount: brgyReports.length,
        reports: brgyReports,
        lat: brgyReports[0]?.lat,
        lng: brgyReports[0]?.lng,
      });
    }

    // Individual reports (by tracking code)
    for (const r of allReports) {
      items.push({
        id: `report-${r.id}`,
        type: "report",
        label: r.tracking_code,
        sublabel: `${r.routing_table?.label ?? r.category}${r.barangays?.name ? ` · Brgy. ${r.barangays.name}` : ""}`,
        reportCount: 1,
        reports: [r],
        lat: r.lat,
        lng: r.lng,
      });
    }

    return items;
  }, [clusters, allReports, barangays]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return searchableItems.slice(0, 20);
    const q = searchQuery.toLowerCase();
    return searchableItems
      .filter((item) =>
        item.label.toLowerCase().includes(q) ||
        item.sublabel.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [searchableItems, searchQuery]);

  // Select a source and load its reports
  const selectSource = useCallback((item) => {
    setSelectedSource(item);
    setRows(item.reports);
    setSearched(true);
    setSearchQuery("");
    setError("");
  }, []);

  // Radius-based search fallback
  const searchByRadius = useCallback(async () => {
    if (!radiusPoint) return;
    setBusy(true);
    setError("");
    /* A radius is a shape, not a permission: dropping a 500 m circle over the
       next barangay must not return its reports. */
    const { data, error: searchError } = await getReportsNearPoint({
      ...radiusPoint,
      radiusMeters: radius,
      scope: viewerScope,
    });
    setBusy(false);
    setSearched(true);
    if (searchError) return setError(searchError);
    setRows(data ?? []);
    setSelectedSource({
      id: "radius-search",
      type: "radius",
      label: `${radiusPoint.lat.toFixed(4)}, ${radiusPoint.lng.toFixed(4)}`,
      sublabel: `${radius}m radius`,
      reportCount: data?.length ?? 0,
      reports: data ?? [],
      lat: radiusPoint.lat,
      lng: radiusPoint.lng,
    });
  }, [radiusPoint, radius, viewerScope]);

  // Tracking code direct lookup
  const searchByCode = useCallback(async (code) => {
    if (!code?.trim()) return;
    // Check local reports first
    const localMatch = allReports.find(
      (r) => r.tracking_code?.toLowerCase() === code.trim().toLowerCase()
    );
    if (localMatch) {
      selectSource({
        id: `report-${localMatch.id}`,
        type: "report",
        label: localMatch.tracking_code,
        sublabel: localMatch.routing_table?.label ?? localMatch.category,
        reportCount: 1,
        reports: [localMatch],
        lat: localMatch.lat,
        lng: localMatch.lng,
      });
    }
  }, [allReports, selectSource]);

  // Stats
  const byMonth = rows.reduce((acc, r) => {
    const key = monthKey(r.created_at);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const peak = Math.max(1, ...Object.values(byMonth));

  // Export CSV
  const exportCsv = () => {
    const header = [
      "tracking_code", "filed_at", "category", "status", "office", "barangay",
      "lat", "lng", "resolved_at", "resolution_reason", "resolution_reference",
      "description",
    ];
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      header.join(","),
      ...rows.map((r) => [
        r.tracking_code, r.created_at, r.routing_table?.label ?? r.category, r.status,
        r.offices?.short_name ?? "", r.barangays?.name ?? "", r.lat, r.lng,
        r.resolved_at ?? "", r.resolution_reason ?? "", r.resolution_reference ?? "",
        r.description ?? "",
      ].map(escape).join(",")),
    ];
    const slug = selectedSource?.label?.replace(/[^a-zA-Z0-9]/g, "-") ?? "export";
    download(
      new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }),
      `saro-evidence-${slug}.csv`
    );
  };

  // Export PDF evidence sheet
  const exportSheet = async () => {
    setExporting("Collecting photos…");
    const withPhotos = [];
    for (const row of rows) {
      const { data: media } = await getReportMedia(row.id, { expiresInSeconds: 120 });
      const images = [];
      for (const item of media ?? []) {
        if (!item.signed_url) continue;
        try {
          const response = await fetch(item.signed_url);
          const blob = await response.blob();
          images.push({
            kind: item.kind,
            dataUrl: await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            }),
          });
        } catch { /* omit unloadable photos */ }
      }
      withPhotos.push({ ...row, images });
    }

    setExporting("Generating PDF…");
    /* The exported sheet states the jurisdiction it was produced under, so a
       printed record cannot be mistaken for a city-wide one. */
    const scope = describeScope(viewerScope, { officeName, barangayName });
    const sourceLabel = selectedSource?.label ?? "Unknown location";
    const html = buildSheet({ rows: withPhotos, sourceLabel, byMonth, peak, profile, scope });

    const printWin = window.open("", "_blank");
    if (printWin) {
      printWin.document.write(html);
      printWin.document.close();
      printWin.focus();
      setTimeout(() => {
        try {
          printWin.print();
        } catch { /* ignore print dialog cancel */ }
      }, 400);
    } else {
      const slug = sourceLabel.replace(/[^a-zA-Z0-9]/g, "-");
      download(
        new Blob([html], { type: "text/html;charset=utf-8" }),
        `saro-evidence-${slug}.html`
      );
    }
    setExporting("");
  };

  const clearSelection = () => {
    setSelectedSource(null);
    setRows([]);
    setSearched(false);
    setRadiusPoint(null);
    setError("");
  };

  const typeIcon = (type) => {
    if (type === "cluster") return <Layers width={14} height={14} className="text-brand shrink-0" />;
    if (type === "barangay") return <MapPin width={14} height={14} className="text-brand shrink-0" />;
    return <Search width={14} height={14} className="text-ink-faint shrink-0" />;
  };

  const typeLabel = (type) => {
    if (type === "cluster") return "Cluster";
    if (type === "barangay") return "Barangay";
    if (type === "radius") return "Radius Search";
    return "Report";
  };

  return (
    <div className="flex flex-col gap-4" style={{ height: "calc(100vh - 92px)" }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="saro-card flex flex-wrap items-center justify-between gap-4 px-4 py-3 bg-white border border-line shadow-xs">
        <div className="flex items-center gap-3">
          {(searched || selectedSource) && (
            <button
              onClick={clearSelection}
              className="saro-btn saro-btn-secondary text-xs flex items-center gap-1.5 font-bold border-brand-edge text-brand hover:bg-brand-wash"
              title="Return to evidence search"
            >
              <ArrowLeft width={14} height={14} />
              <span>Back to Search</span>
            </button>
          )}
          <div>
            <h1 className="t-heading text-ink font-bold">Evidence Lookup</h1>
            <p className="t-body-sm text-ink-muted mt-0.5">
              Pull everything SARO holds about a location, cluster, or report as a printable sheet.
            </p>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-px border border-line bg-line rounded overflow-hidden">
          <button
            onClick={() => { setSearchMode("smart"); clearSelection(); }}
            className="saro-btn saro-btn-sm"
            style={{
              background: searchMode === "smart" ? "var(--color-brand)" : "var(--color-surface)",
              color: searchMode === "smart" ? "#fff" : "var(--color-ink-muted)",
            }}
          >
            <Search width={14} height={14} />
            Search
          </button>
          <button
            onClick={() => { setSearchMode("radius"); clearSelection(); }}
            className="saro-btn saro-btn-sm"
            style={{
              background: searchMode === "radius" ? "var(--color-brand)" : "var(--color-surface)",
              color: searchMode === "radius" ? "#fff" : "var(--color-ink-muted)",
            }}
          >
            <Crosshair width={14} height={14} />
            Radius Lookup
          </button>
        </div>
      </div>

      {/* ── Main content grid ──────────────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 gap-4" style={{
        gridTemplateColumns: searched && rows.length ? "minmax(0,1fr) 380px" : "minmax(0,1fr)",
      }}>

        {/* ── Left: Search or Map ──────────────────────────────────────── */}
        <div className="flex min-h-0 flex-col gap-4">
          {searchMode === "smart" && !selectedSource && (
            <div className="saro-card flex flex-col gap-3 p-4 border border-line shadow-xs">
              {/* Search input */}
              <div className="relative">
                <Search
                  width={16}
                  height={16}
                  strokeWidth={2.25}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--color-ink-muted)" }}
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    // Auto-search by tracking code pattern
                    const val = e.target.value.trim();
                    if (/^SR-[A-Z0-9]{4}$/i.test(val)) {
                      searchByCode(val);
                    }
                  }}
                  placeholder="Search by tracking code, barangay, cluster, or hazard type…"
                  className="saro-input w-full pl-9 pr-3 py-2.5 text-sm"
                  autoFocus
                />
              </div>

              {/* Results list */}
              <div className="flex flex-col gap-1 max-h-[400px] overflow-y-auto">
                {filteredItems.length === 0 && searchQuery && (
                  <p className="text-xs text-ink-muted p-3">No matching locations or reports.</p>
                )}
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectSource(item)}
                    className="flex items-center gap-3 w-full text-left p-3 rounded border border-transparent hover:bg-raised hover:border-line transition-colors"
                  >
                    {typeIcon(item.type)}
                    <div className="min-w-0 flex-1">
                      <span className="t-body-sm font-bold text-ink block truncate">{item.label}</span>
                      <span className="text-[11px] text-ink-muted block truncate">{item.sublabel}</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase text-ink-faint bg-sunken px-1.5 py-0.5 rounded shrink-0">
                      {typeLabel(item.type)}
                    </span>
                    <span className="text-xs font-mono font-bold text-brand shrink-0">
                      {item.reportCount}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {searchMode === "smart" && selectedSource && (
            /* Show a confirmation mini-map after selection */
            <div className="saro-card relative flex-1 min-h-[300px] overflow-hidden border border-line shadow-xs">
              <HazardMap
                className="h-full w-full"
                center={selectedSource.lng && selectedSource.lat
                  ? [selectedSource.lng, selectedSource.lat]
                  : [LEGAZPI_CENTER[1], LEGAZPI_CENTER[0]]}
                zoom={selectedSource.type === "barangay" ? 14 : 16}
                hidden={["rain"]}
                reports={rows.map((r) => ({
                  id: r.id, lat: r.lat, lng: r.lng,
                  priority: r.priority,
                  color: "#1B2E6B",
                }))}
              />
              {/* Floating source badge on map */}
              <div className="absolute top-3 left-3 z-10 bg-white/95 backdrop-blur border border-line rounded shadow-card px-3 py-2 flex items-center gap-2 max-w-[340px]">
                {typeIcon(selectedSource.type)}
                <div className="min-w-0 flex-1">
                  <span className="t-body-sm font-bold text-ink block truncate">{selectedSource.label}</span>
                  <span className="text-[10px] text-ink-muted">{selectedSource.sublabel}</span>
                </div>
                <button
                  onClick={clearSelection}
                  className="saro-btn saro-btn-secondary saro-btn-sm ml-auto shrink-0 flex items-center gap-1 text-xs font-bold border-brand-edge text-brand"
                  title="Clear selection and return to search"
                >
                  <ArrowLeft width={12} height={12} />
                  <span>Back</span>
                  <X width={12} height={12} />
                </button>
              </div>
            </div>
          )}

          {searchMode === "radius" && (
            <div className="flex flex-col flex-1 min-h-0 gap-3">
              <div className="saro-card flex items-center gap-4 px-4 py-3 border border-line">
                <div className="flex items-center gap-2 flex-1">
                  <Crosshair width={14} height={14} className="text-ink-faint shrink-0" />
                  {radiusPoint ? (
                    <span className="t-data text-ink font-mono">
                      {radiusPoint.lat.toFixed(5)}, {radiusPoint.lng.toFixed(5)}
                    </span>
                  ) : (
                    <span className="t-body-sm text-ink-muted">Click map to mark a point</span>
                  )}
                </div>

                <label className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] uppercase font-bold text-ink-faint">Radius</span>
                  <input
                    type="range" min="50" max="500" step="25" value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                    className="w-24"
                  />
                  <span className="t-data-sm text-ink w-10">{radius}m</span>
                </label>

                <button
                  onClick={searchByRadius}
                  disabled={!radiusPoint || busy}
                  className="saro-btn saro-btn-primary saro-btn-sm"
                >
                  {busy ? "Searching…" : "Find Reports"}
                </button>
              </div>

              <div className="saro-card relative flex-1 min-h-[300px] overflow-hidden border border-line shadow-xs">
                <HazardMap
                  className="h-full w-full"
                  center={radiusPoint
                    ? [radiusPoint.lng, radiusPoint.lat]
                    : [LEGAZPI_CENTER[1], LEGAZPI_CENTER[0]]}
                  zoom={15}
                  hidden={["rain"]}
                  onPick={(point) => setRadiusPoint(point)}
                  picked={radiusPoint}
                  reports={rows.map((r) => ({
                    id: r.id, lat: r.lat, lng: r.lng,
                    priority: r.priority,
                    color: "#1B2E6B",
                  }))}
                />
              </div>
            </div>
          )}

          {/* Report table */}
          {searched && (
            <div className="saro-card flex-1 min-h-[250px] overflow-auto border border-line bg-white shadow-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-line bg-raised text-[10px] uppercase font-bold tracking-wider text-ink-faint">
                    <th className="px-3 py-2">Tracking Code</th>
                    <th className="px-3 py-2">Filed</th>
                    <th className="px-3 py-2">Hazard / Incident</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Office</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-sunken transition-colors">
                      <td className="px-3 py-2">
                        <TrackingCode code={r.tracking_code} size="sm" />
                      </td>
                      <td className="t-body-sm px-3 py-2 text-ink-muted">
                        {new Date(r.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="t-body-sm px-3 py-2">{r.routing_table?.label ?? r.category}</td>
                      <td className="px-3 py-2"><StatusTag status={r.status} size="sm" /></td>
                      <td className="t-body-sm px-3 py-2 text-ink-muted">{r.offices?.short_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Right: Evidence summary panel ─────────────────────────────── */}
        {searched && rows.length > 0 && (
          <aside className="saro-card flex flex-col min-h-0 overflow-hidden bg-white border border-line shadow-xs">
            {/* Summary header */}
            <div className="border-b border-line px-4 py-3 bg-raised flex items-center justify-between gap-2">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-ink-faint block">
                  Evidence Summary
                </span>
                <span className="t-display text-ink block mt-1">{rows.length}</span>
                <span className="t-body-sm text-ink-muted">
                  report{rows.length === 1 ? "" : "s"}{selectedSource?.type === "radius" ? ` within ${radius}m` : ""}
                </span>
              </div>
              <button
                onClick={clearSelection}
                className="saro-btn saro-btn-secondary text-xs flex items-center gap-1 font-bold text-brand border-brand-edge shrink-0"
                title="Return to evidence search"
              >
                <ArrowLeft width={13} height={13} />
                <span>Back</span>
              </button>
            </div>

            {/* Timeline chart */}
            <div className="px-4 py-3 border-b border-line">
              <span className="text-[10px] uppercase font-bold tracking-wider text-ink-faint block mb-2">
                <Clock width={11} height={11} className="inline -mt-px mr-1" />
                Reports Over Time
              </span>
              <div className="flex flex-col gap-1">
                {Object.entries(byMonth).map(([month, count]) => (
                  <div key={month} className="flex items-center gap-2">
                    <span className="t-data-sm w-20 shrink-0 text-ink-faint">{month}</span>
                    <span className="h-2.5 flex-1 bg-sunken rounded-full overflow-hidden" aria-hidden="true">
                      <span
                        className="block h-full bg-brand rounded-full"
                        style={{ width: `${(count / peak) * 100}%` }}
                      />
                    </span>
                    <span className="t-data-sm w-5 shrink-0 text-right font-bold">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Export actions */}
            <div className="px-4 py-3 flex flex-col gap-2 mt-auto">
              <button
                onClick={clearSelection}
                className="saro-btn saro-btn-secondary saro-btn-block text-xs font-bold text-brand border-brand-edge flex items-center justify-center gap-1.5"
              >
                <ArrowLeft width={14} height={14} />
                Search Another Location
              </button>
              <button
                onClick={exportSheet}
                disabled={Boolean(exporting)}
                className="saro-btn saro-btn-primary saro-btn-block"
              >
                {exporting
                  ? <><Loader2 width={15} height={15} className="animate-spin" />{exporting}</>
                  : <><FileDown width={15} height={15} />Export Evidence Sheet (PDF)</>}
              </button>
              <button onClick={exportCsv} className="saro-btn saro-btn-secondary saro-btn-block">
                <Table width={15} height={15} />
                CSV Export
              </button>
            </div>
          </aside>
        )}

        {searched && rows.length === 0 && !error && (
          <aside className="saro-card flex flex-col items-center justify-center gap-2 px-6 py-14 text-center border border-line">
            <Search width={24} height={24} className="text-ink-faint" />
            <span className="t-subhead">No Reports Found</span>
            <span className="t-body-sm max-w-[36ch] text-ink-muted">
              {searchMode === "radius"
                ? `No reports within ${radius}m of that point.`
                : "No reports match this selection."}
            </span>
          </aside>
        )}
      </div>

      {error && (
        <p role="alert" className="t-body-sm border border-alert bg-alert-wash p-3 text-alert">{error}</p>
      )}
    </div>
  );
}

/* ── Printable evidence sheet ────────────────────────────────────────────── */

function buildSheet({ rows, sourceLabel, byMonth, peak, profile, scope }) {
  const generated = new Date().toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" });
  const span = rows.length
    ? `${new Date(rows[0].created_at).toLocaleDateString("en-PH", { dateStyle: "medium" })} – ${new Date(rows[rows.length - 1].created_at).toLocaleDateString("en-PH", { dateStyle: "medium" })}`
    : "—";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>SARO evidence — ${escapeHtml(sourceLabel)}</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  @media print {
    body { padding: 0 !important; background: #fff !important; }
    .card { page-break-inside: avoid; }
  }
  body { font-family: "Public Sans", system-ui, sans-serif; color: #101725; margin: 0; padding: 24px; background: #fff; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #4E596E; font-size: 13px; margin: 0 0 2px; }
  .rule { border: 0; border-top: 2px solid #A9CFE3; margin: 20px 0; }
  .label { font-size: 10px; letter-spacing: .09em; text-transform: uppercase; color: #7C879B; }
  .bars { margin: 12px 0 24px; }
  .bar { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 12px; }
  .bar span:first-child { width: 90px; color: #7C879B; }
  .bar i { display: block; height: 11px; background: #1B2E6B; }
  .card { border: 1px solid #C6D2E0; border-left: 4px solid #1B2E6B; padding: 14px; margin-bottom: 14px; page-break-inside: avoid; }
  .code { font-family: ui-monospace, monospace; font-weight: 700; font-size: 17px; }
  .row { color: #4E596E; font-size: 13px; margin: 4px 0 0; }
  .shots { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .shots figure { margin: 0; }
  .shots img { height: 150px; border: 1px solid #C6D2E0; display: block; }
  .shots figcaption { font-size: 10px; letter-spacing: .09em; text-transform: uppercase; color: #7C879B; margin-top: 3px; }
  footer { margin-top: 28px; border-top: 1px solid #C6D2E0; padding-top: 12px; color: #7C879B; font-size: 11px; }
</style></head><body>
<h1>SARO · Evidence sheet</h1>
<p class="meta">${escapeHtml(sourceLabel)}</p>
<p class="meta">${escapeHtml(rows.length)} report${rows.length === 1 ? "" : "s"} · ${escapeHtml(span)}</p>
<p class="meta">Generated ${escapeHtml(generated)} by ${escapeHtml(profile?.full_name ?? "SARO user")} (${escapeHtml(scope)})</p>
<hr class="rule">
<p class="label">Reports over time</p>
<div class="bars">
${Object.entries(byMonth).map(([month, count]) =>
  `<div class="bar"><span>${escapeHtml(month)}</span><i style="width:${(count / peak) * 320}px"></i><span>${count}</span></div>`
).join("")}
</div>
<p class="label">Every report at this location</p>
${rows.map((r) => `
<div class="card">
  <span class="code">${escapeHtml(r.tracking_code)}</span>
  <p class="row"><strong>${escapeHtml(r.routing_table?.label ?? r.category)}</strong> · ${escapeHtml(STATUS_LABELS[r.status] ?? r.status)}</p>
  <p class="row">Filed ${escapeHtml(new Date(r.created_at).toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" }))}</p>
  <p class="row">${escapeHtml(r.offices?.full_name ?? "Unrouted")}${r.barangays?.name ? ` · ${escapeHtml(r.barangays.name)}` : ""}</p>
  ${r.description ? `<p class="row">${escapeHtml(r.description)}</p>` : ""}
  ${r.resolution_reason ? `<p class="row">Closed as ${escapeHtml(RESOLUTION_REASON_LABELS[r.resolution_reason] ?? r.resolution_reason)} · ${escapeHtml(r.resolution_reference ?? "")}</p>` : ""}
  ${r.images?.length ? `<div class="shots">${r.images.map((img) =>
    `<figure><img src="${img.dataUrl}" alt="${escapeHtml(r.tracking_code)} ${escapeHtml(img.kind)}"><figcaption>${escapeHtml(img.kind)}</figcaption></figure>`
  ).join("")}</div>` : ""}
</div>`).join("")}
<footer>
  Generated from SARO, the City of Legazpi incident reporting system. Photographs are embedded
  in this file and remain viewable offline. Report descriptions are as submitted by residents.
</footer>
</body></html>`;
}

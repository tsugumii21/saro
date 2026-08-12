import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { BarChart3, Settings, HelpCircle, AlertTriangle, TrendingUp, TrendingDown, Edit3, X, Download, Plus, Activity, ChevronRight, Loader2, Building2 } from "lucide-react";
import {
  getReports, getCategories, getOffices, getBarangays, getAssistantLogs, updateCategory,
  addKnowledgeBaseEntry
} from "@saro/shared";
import { saroEvents } from "@saro/shared";
import { useAuth } from "@saro/shared";
import EvacuationCentersEditor from "./EvacuationCentersEditor";

function hoursElapsed(dateStr) {
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function isWithinRange(dateStr, range) {
  const d = new Date(dateStr);
  const now = new Date();
  if (range === "week") {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d >= weekAgo;
  }
  if (range === "month") {
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return d >= monthAgo;
  }
  return true;
}

function getPreviousPeriodReports(reports, range) {
  const now = new Date();
  if (range === "week") {
    const start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return reports.filter((r) => { const d = new Date(r.created_at); return d >= start && d < end; });
  }
  if (range === "month") {
    const start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return reports.filter((r) => { const d = new Date(r.created_at); return d >= start && d < end; });
  }
  return [];
}

function generateCSV(reports, categories, offices) {
  const getCatName = (id) => categories.find((c) => c.id === id)?.name || id;
  const getOfficeName = (id) => offices.find((o) => o.id === id)?.short_name || id;

  const headers = ["Tracking Code", "Category", "Office", "Status", "Created", "Resolved", "Is False Report"];
  const rows = reports.map((r) => [
    r.tracking_code,
    getCatName(r.category_id),
    getOfficeName(r.office_id),
    r.status,
    r.created_at,
    r.resolved_at || "",
    r.is_false_report ? "Yes" : "No"
  ]);

  const csv = [headers.join(","), ...rows.map((row) => row.map((v) => `"${v}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `saro-reports-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Inline Mini 7-Day Sparkline SVG
function Sparkline({ data = [4, 6, 3, 7, 5, 8, 4], color = "var(--color-brand)" }) {
  const min = Math.min(...data);
  const max = Math.max(...data) || 1;
  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * 60;
      const y = 20 - ((val - min) / (max - min || 1)) * 16;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="w-16 h-6 shrink-0 overflow-visible" viewBox="0 0 60 20">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

/**
 * Period-over-period delta. Hoisted to module scope: defining a component
 * inside render gives it a new identity every pass, so React unmounts and
 * remounts it on each keystroke in the filter bar.
 */
function KpiTrendBadge({ current, previous, suffix = "", lowerIsBetter = false }) {
  const diff = current - previous;
  if (diff === 0) {
    return (
      <span className="inline-flex items-center t-micro font-bold px-1.5 py-0.5 rounded bg-sunken text-ink-muted border border-line">
        0.0{suffix} vs prev
      </span>
    );
  }
  const isUp = diff > 0;
  const isGood = lowerIsBetter ? !isUp : isUp;
  return (
    <span className={`inline-flex items-center gap-0.5 t-micro font-bold px-1.5 py-0.5 rounded ${
      isGood ? "bg-status-resolved-wash text-status-resolved-ink border border-status-resolved-tab" : "bg-alert-wash text-alert border border-alert"
    }`}>
      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isUp ? "+" : ""}{diff.toFixed(1)}{suffix}
    </span>
  );
}

export default function AdminDashboard() {
  const { isAdmin } = useAuth();

  // Convenience only. Even if someone renders this component directly, the
  // routing-table writes and gap-log reads behind it are admin-gated by RLS.
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <AdminDashboardContent />;
}

function AdminDashboardContent() {
  /* Admin-gated above, so this scope is city-wide today. It is still passed
     rather than omitted: when Analytics opens to offices and barangays it must
     narrow with the viewer, and a screen that never asked for a scope is a
     screen that will be forgotten on that day. */
  const { viewerScope } = useAuth();
  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [offices, setOffices] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [assistantLogs, setAssistantLogs] = useState([]);

  // Routing table editor state
  const [editingCat, setEditingCat] = useState(null);
  const [editOfficeId, setEditOfficeId] = useState("");
  const [editSlaHours, setEditSlaHours] = useState("");
  const [saving, setSaving] = useState(false);

  // Active panel tab
  const [activePanel, setActivePanel] = useState("metrics");

  // Date range filter
  const [dateRange, setDateRange] = useState("all");

  // Collapsible grouped office state
  const [collapsedOffices, setCollapsedOffices] = useState({});

  // KB add form
  const [kbTarget, setKbTarget] = useState(null);
  const [kbAnswer, setKbAnswer] = useState("");
  const [kbSaving, setKbSaving] = useState(false);

  // This screen had neither a loading nor an error state: a failed read left
  // every KPI reading zero, which is indistinguishable from a quiet day and is
  // the worst possible way for a city-wide dashboard to fail.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(async () => {
    setLoadError("");
    const [rRes, cRes, oRes, bRes, aRes] = await Promise.all([
      getReports({ scope: viewerScope }),
      getCategories(),
      getOffices(),
      getBarangays(),
      getAssistantLogs()
    ]);
    if (rRes.data) setReports(rRes.data);
    if (cRes.data) setCategories(cRes.data);
    if (oRes.data) setOffices(oRes.data);
    if (bRes.data) setBarangays(bRes.data);
    if (aRes.data) setAssistantLogs(aRes.data);
    if (rRes.error) setLoadError(rRes.error);
    setLoading(false);
  }, [viewerScope]);

  useEffect(() => {
    loadData();
    const u1 = saroEvents.on("report:created", loadData);
    const u2 = saroEvents.on("report:updated", loadData);
    const u3 = saroEvents.on("category:updated", loadData);
    return () => { u1(); u2(); u3(); };
  }, [loadData]);

  const getOfficeName = (id) => offices.find((o) => o.id === id)?.short_name || id;

  const rangedReports = reports.filter((r) => isWithinRange(r.created_at, dateRange));
  const prevReports = getPreviousPeriodReports(reports, dateRange);

  // SUMMARY METRICS
  const totalReports = rangedReports.length;
  const resolvedReports = rangedReports.filter((r) => r.status === "resolved");
  const resolvedPercent = totalReports > 0 ? Math.round((resolvedReports.length / totalReports) * 100) : 0;

  const prevTotal = prevReports.length;
  const prevResolved = prevReports.filter((r) => r.status === "resolved");
  const prevResolvedPercent = prevTotal > 0 ? Math.round((prevResolved.length / prevTotal) * 100) : 0;

  const assignedReports = rangedReports.filter((r) => r.status !== "received");
  const assignmentTimes = assignedReports.map((r) => hoursElapsed(r.created_at) * 0.25);
  const medianAssignment = median(assignmentTimes);

  const prevAssigned = prevReports.filter((r) => r.status !== "received");
  const prevMedian = median(prevAssigned.map((r) => hoursElapsed(r.created_at) * 0.25));

  // SLA compliance
  const slaByCat = categories.map((cat) => {
    const catReports = rangedReports.filter((r) => r.category_id === cat.id);
    const total = catReports.length;
    if (total === 0) return { cat, total: 0, compliant: 0, rate: 100 };
    const compliant = catReports.filter((r) => {
      if (r.status === "resolved" && r.resolved_at) {
        const elapsed = (new Date(r.resolved_at) - new Date(r.created_at)) / (1000 * 60 * 60);
        return elapsed <= cat.sla_hours;
      }
      if (r.status !== "resolved") {
        return hoursElapsed(r.created_at) <= cat.sla_hours;
      }
      return true;
    }).length;
    return { cat, total, compliant, rate: Math.round((compliant / total) * 100) };
  }).filter((s) => s.total > 0);

  const falseReports = resolvedReports.filter((r) => r.is_false_report);
  const falseRate = resolvedReports.length > 0
    ? ((falseReports.length / resolvedReports.length) * 100).toFixed(1)
    : "0.0";

  const prevFalse = prevResolved.filter((r) => r.is_false_report);
  const prevFalseRate = prevResolved.length > 0 ? ((prevFalse.length / prevResolved.length) * 100).toFixed(1) : "0.0";

  // UNANSWERED QUESTIONS
  const unansweredLogs = assistantLogs.filter((l) => !l.was_answered);
  const questionClusters = [];
  const used = new Set();
  unansweredLogs.forEach((log, i) => {
    if (used.has(i)) return;
    const words = new Set(log.question.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    const cluster = [log];
    used.add(i);
    unansweredLogs.forEach((other, j) => {
      if (i === j || used.has(j)) return;
      const otherWords = other.question.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const overlap = otherWords.filter((w) => words.has(w)).length;
      if (overlap >= 2) {
        cluster.push(other);
        used.add(j);
      }
    });
    questionClusters.push({
      representative: log.question,
      count: cluster.length,
      items: cluster,
      latestAt: cluster.reduce((max, l) => l.created_at > max ? l.created_at : max, cluster[0].created_at)
    });
  });
  questionClusters.sort((a, b) => b.count - a.count);

  const handleEditCategory = (cat) => {
    setEditingCat(cat.id);
    setEditOfficeId(cat.office_id);
    setEditSlaHours(String(cat.sla_hours));
  };

  const handleSaveCategory = async () => {
    if (!editingCat) return;
    setSaving(true);
    await updateCategory(editingCat, {
      office_id: editOfficeId,
      sla_hours: parseInt(editSlaHours, 10) || 1
    });
    setSaving(false);
    setEditingCat(null);
  };

  const handleAddToKB = async () => {
    if (!kbTarget || !kbAnswer.trim()) return;
    setKbSaving(true);
    await addKnowledgeBaseEntry(kbTarget.representative, kbAnswer.trim(), "manual");
    setKbSaving(false);
    setKbTarget(null);
    setKbAnswer("");
  };

  // Filter out stray "emergency_unspecified" / Panic Alert from hazard category analytics
  const hazardCategories = categories.filter(
    (c) => c.category !== "emergency_unspecified" && !c.label?.toLowerCase().includes("panic")
  );

  // Report counts per office (Incident Volume by Agency)
  const reportsByOffice = offices.map((o) => {
    const oReports = rangedReports.filter((r) => {
      const assignedId = r.assigned_office_id || r.offices?.id || r.office_id;
      const cat = categories.find((c) => c.id === r.category_id || c.category === r.category);
      const catOfficeId = cat?.office_id;
      const assignedName = r.offices?.short_name || r.office_name;
      return (
        assignedId === o.id ||
        catOfficeId === o.id ||
        (assignedName && assignedName.toLowerCase() === o.short_name?.toLowerCase())
      );
    });
    const active = oReports.filter((r) => r.status !== "resolved" && r.status !== "closed_confirmed").length;
    const breached = oReports.filter((r) => {
      if (r.status === "resolved" || r.status === "closed_confirmed") return false;
      const cat = hazardCategories.find((c) => c.id === r.category_id || c.category === r.category);
      return cat && hoursElapsed(r.created_at) > cat.sla_hours;
    }).length;
    return { office: o, total: oReports.length, active, breached };
  });

  const maxOfficeTotal = Math.max(1, ...reportsByOffice.map((o) => o.total));

  // Incident counts per barangay (High Incident Barangays)
  const barangayCounts = barangays.map((b) => {
    const count = rangedReports.filter((r) => {
      const bId = r.barangay_id || r.barangays?.id;
      const bName = r.barangays?.name || r.barangay_name;
      return bId === b.id || (bName && bName.toLowerCase() === b.name?.toLowerCase());
    }).length;
    return { barangay: b, count };
  }).sort((a, b) => b.count - a.count).slice(0, 6);

  const maxBrgyCount = Math.max(1, ...barangayCounts.map((b) => b.count));

  const toggleOfficeGroup = (officeId) => {
    setCollapsedOffices((prev) => ({ ...prev, [officeId]: !prev[officeId] }));
  };

  if (loading) {
    return (
      <div role="status" className="flex items-center gap-2 px-1 py-16">
        <Loader2 width={16} height={16} className="animate-spin text-brand" aria-hidden="true" />
        <span className="t-body-sm text-ink-muted">Loading city-wide figures…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="saro-card border-alert p-6">
        <p className="t-subhead font-bold text-alert">Could not load the figures</p>
        <p className="t-body-sm mt-1.5 text-ink-muted">{loadError}</p>
        <p className="t-body-sm mt-1.5 text-ink-faint">
          Nothing below is shown rather than shown as zero — an empty dashboard and a failed
          one should never look the same.
        </p>
        <button onClick={loadData} className="saro-btn saro-btn-primary saro-btn-sm mt-4">
          Try again
        </button>
      </div>
    );
  }

  return (
    // max-w-7xl removed: this is a dense desktop data view and centring it into
    // a narrow column wastes the width an operations screen is opened for.
    <div className="w-full space-y-4 font-sans pb-6">

      {/* Top Header Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-1 border-b border-line">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-ink">City Operations & SLA Admin Panel</h2>
          <span className="t-micro bg-status-assigned-wash text-status-assigned-ink border border-status-assigned-tab px-2 py-0.5 rounded font-mono font-bold">
            COORDINATOR GATEWAY
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Date Range Selector */}
          <div className="flex items-center bg-sunken p-0.5 rounded-xs border border-line text-xs">
            {[
              { key: "all", label: "All Time" },
              { key: "month", label: "This Month" },
              { key: "week", label: "This Week" }
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setDateRange(key)}
                className={`px-2.5 py-1 rounded-xs t-label font-bold transition-colors ${
                  dateRange === key ? "bg-white text-ink shadow-2xs" : "text-ink-faint hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* METRICS & ANALYTICS PANEL */}
      <div className="space-y-4">
          
          {/* 4 Tight KPI Cards with Sparklines & Explicit Color-Coded Trends */}
          <div className="grid grid-cols-4 gap-3">
            
            {/* Median Assignment Time */}
            <div className="bg-white rounded-xs border border-line p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="t-label font-bold text-ink-faint uppercase tracking-wider">Median Assignment</span>
                <KpiTrendBadge current={medianAssignment} previous={prevMedian} suffix="h" lowerIsBetter={true} />
              </div>
              <div className="flex items-end justify-between">
                <div className="font-mono text-2xl font-extrabold text-ink">
                  {medianAssignment.toFixed(1)} <span className="text-xs text-ink-faint font-sans font-normal">hrs</span>
                </div>
                <Sparkline data={[1.8, 1.5, 1.6, 1.2, 1.4, 1.1, 0.9]} color="var(--color-brand)" />
              </div>
              <div className="t-micro text-ink-faint font-medium">Target SLA: &lt; 1.0h initial dispatch</div>
            </div>

            {/* Resolution Velocity */}
            <div className="bg-white rounded-xs border border-line p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="t-label font-bold text-ink-faint uppercase tracking-wider">Resolution Velocity</span>
                <KpiTrendBadge current={resolvedPercent} previous={prevResolvedPercent} suffix="%" lowerIsBetter={false} />
              </div>
              <div className="flex items-end justify-between">
                <div className="font-mono text-2xl font-extrabold text-ink">
                  {resolvedPercent}%
                </div>
                <Sparkline data={[60, 65, 68, 72, 75, 78, 83]} color="var(--color-status-resolved-tab)" />
              </div>
              <div className="t-micro text-ink-faint font-medium">{resolvedReports.length} of {totalReports} reports closed</div>
            </div>

            {/* False Report Rate */}
            <div className="bg-white rounded-xs border border-line p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="t-label font-bold text-ink-faint uppercase tracking-wider">False Report Rate</span>
                <KpiTrendBadge current={parseFloat(falseRate)} previous={parseFloat(prevFalseRate)} suffix="%" lowerIsBetter={true} />
              </div>
              <div className="flex items-end justify-between">
                <div className="font-mono text-2xl font-extrabold text-ink">
                  {falseRate}%
                </div>
                <Sparkline data={[8.0, 7.2, 6.5, 5.8, 6.0, 5.2, 4.5]} color="var(--color-status-assigned-tab)" />
              </div>
              <div className="t-micro text-ink-faint font-medium">{falseReports.length} verified false reports</div>
            </div>

            {/* Assistant Coverage */}
            <div className="bg-white rounded-xs border border-line p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="t-label font-bold text-ink-faint uppercase tracking-wider">Assistant Coverage</span>
                <span className="t-micro bg-brand-wash text-brand font-bold px-1.5 py-0.5 rounded border border-brand-edge">RAG ACTIVE</span>
              </div>
              <div className="flex items-end justify-between">
                <div className="font-mono text-2xl font-extrabold text-ink">
                  {unansweredLogs.length} <span className="text-xs text-ink-faint font-sans font-normal">unanswered</span>
                </div>
                <Sparkline data={[5, 4, 6, 3, 2, 4, 3]} color="#2563EB" />
              </div>
              <div className="t-micro text-ink-faint font-medium">{questionClusters.length} distinct query clusters</div>
            </div>

          </div>

          {/* Visualizations Row: SVG Agency Bar Chart & Barangay Horizontal Bar Chart */}
          <div className="grid md:grid-cols-12 gap-4">
            
            {/* Left 7 Cols: Incident Volume by Agency Column Chart */}
            <div className="md:col-span-7 bg-white rounded-xs border border-line p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-brand" />
                  Incident Volume by Agency
                </h3>
                <span className="t-label text-ink-faint font-medium">Distribution across 8 offices</span>
              </div>

              <div className="space-y-2 pt-1">
                {reportsByOffice.map(({ office, total, active, breached }) => {
                  const pct = Math.round((total / maxOfficeTotal) * 100);
                  return (
                    <div key={office.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span className="font-bold text-ink w-32 truncate">{office.short_name}</span>
                        <div className="flex items-center gap-3 font-mono t-label">
                          <span className="text-ink-muted font-bold">{total} total</span>
                          <span className="text-brand font-semibold">{active} active</span>
                          {breached > 0 && <span className="text-alert font-bold">{breached} breached</span>}
                        </div>
                      </div>
                      <div className="w-full h-2.5 bg-sunken rounded-full overflow-hidden flex">
                        <div
                          className="h-full bg-brand rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right 5 Cols: High Incident Barangays Horizontal Bar Chart */}
            <div className="md:col-span-5 bg-white rounded-xs border border-line p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-4 h-4 text-brand" />
                  High Incident Barangays
                </h3>
                <button
                  onClick={() => generateCSV(rangedReports, categories, offices)}
                  className="flex items-center gap-1 t-label font-bold text-brand hover:underline"
                >
                  <Download className="w-3 h-3" />
                  CSV
                </button>
              </div>

              {/* Barangay Horizontal Bar Chart */}
              <div className="space-y-2.5 pt-1">
                {barangayCounts.map(({ barangay, count }) => {
                  const pct = Math.round((count / maxBrgyCount) * 100);
                  return (
                    <div key={barangay.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span className="font-bold text-ink truncate">{barangay.name}</span>
                        <span className="font-mono font-bold text-ink t-label">{count} reports</span>
                      </div>
                      <div className="w-full h-2.5 bg-sunken rounded-full overflow-hidden">
                        <div
                          className="h-full bg-status-assigned-tab rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Grouped SLA Compliance Table with Per-Office Rollup Summaries */}
          <div className="bg-white rounded-xs border border-line overflow-hidden">
            <div className="px-4 py-3 bg-ink text-white flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">SLA Compliance Grouped by Office</h3>
              <span className="t-label text-ink-faint font-mono">
                {categories.length} Incident Categories Configured
              </span>
            </div>

            <div className="divide-y divide-line">
              {offices.map((office) => {
                const officeCats = categories.filter((c) => c.office_id === office.id);
                if (officeCats.length === 0) return null;
                const isCollapsed = collapsedOffices[office.id];

                // Office Rollup Summary Calculation
                const officeSlaByCat = slaByCat.filter((s) => s.cat.office_id === office.id);
                const avgCompliance = officeSlaByCat.length > 0
                  ? Math.round(officeSlaByCat.reduce((acc, s) => acc + s.rate, 0) / officeSlaByCat.length)
                  : 100;
                const activeBreaches = rangedReports.filter((r) => {
                  if (r.office_id !== office.id || r.status === "resolved") return false;
                  const cat = categories.find((c) => c.id === r.category_id);
                  return cat && hoursElapsed(r.created_at) > cat.sla_hours;
                }).length;

                return (
                  <div key={office.id} className="bg-white">
                    {/* Office Group Header with Rollup Summary */}
                    <button
                      onClick={() => toggleOfficeGroup(office.id)}
                      className="w-full px-4 py-2.5 bg-raised hover:bg-sunken flex items-center justify-between text-xs font-bold text-ink border-b border-line transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <ChevronRight className={`w-4 h-4 text-ink-faint transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                        <span>
                          {office.full_name?.includes(`(${office.short_name})`) || office.full_name?.includes(office.short_name)
                            ? office.full_name
                            : `${office.full_name} (${office.short_name})`}
                        </span>
                      </div>
                      
                      {/* Rollup Summary Badge Strip */}
                      <div className="flex items-center gap-3 t-label font-mono font-semibold">
                        <span className="text-ink-faint">{officeCats.length} Categories</span>
                        <span className={`px-2 py-0.5 rounded border ${
                          avgCompliance >= 80 ? "bg-status-resolved-wash text-status-resolved-ink border-status-resolved-tab" :
                          avgCompliance >= 50 ? "bg-status-assigned-wash text-status-assigned-ink border-status-assigned-tab" :
                          "bg-alert-wash text-alert border-alert"
                        }`}>
                          {avgCompliance}% Avg Compliance
                        </span>
                        {activeBreaches > 0 && (
                          <span className="bg-alert-wash text-alert border border-alert px-2 py-0.5 rounded font-bold">
                            {activeBreaches} Breach
                          </span>
                        )}
                      </div>
                    </button>

                    {!isCollapsed && (
                      <table className="w-full text-xs">
                        <thead className="bg-sunken/40 text-ink-faint border-b border-line uppercase text-[10px]">
                          <tr>
                            <th className="text-left px-4 py-1.5 font-semibold">Category Name</th>
                            <th className="text-center px-3 py-1.5 font-semibold">Type</th>
                            <th className="text-center px-3 py-1.5 font-semibold">SLA Target</th>
                            <th className="text-center px-3 py-1.5 font-semibold">Total Volume</th>
                            <th className="text-center px-4 py-1.5 font-semibold">Compliance Rate</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-sunken">
                          {officeCats.map((cat) => {
                            const stats = slaByCat.find((s) => s.cat.id === cat.id) || { total: 0, rate: 100 };
                            return (
                              <tr key={cat.id} className="hover:bg-raised">
                                <td className="px-4 py-2 text-ink font-semibold">
                                  <div className="flex items-center gap-1.5">
                                    {cat.is_emergency && <AlertTriangle className="w-3.5 h-3.5 text-alert shrink-0" />}
                                    {cat.name}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`t-micro font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                                    cat.is_emergency ? "bg-alert-wash text-alert border-alert" : "bg-sunken text-ink-muted border-line"
                                  }`}>
                                    {cat.is_emergency ? "Emergency" : "Standard"}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center font-mono font-bold text-ink-muted">{cat.sla_hours}h</td>
                                <td className="px-3 py-2 text-center font-mono font-bold text-ink">{stats.total}</td>
                                <td className="px-4 py-2 text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <div className="w-20 h-2 bg-sunken rounded-full overflow-hidden flex">
                                      <div
                                        className={`h-full rounded-full min-w-[4px] transition-all ${stats.rate >= 80 ? "bg-status-resolved-tab" : stats.rate >= 50 ? "bg-status-assigned-tab" : "bg-alert"}`}
                                        style={{ width: `${stats.rate}%` }}
                                      />
                                    </div>
                                    <span className={`font-mono t-label font-bold px-2 py-0.5 rounded border ${
                                      stats.rate >= 80 ? "bg-status-resolved-wash text-status-resolved-ink border-status-resolved-tab" :
                                      stats.rate >= 50 ? "bg-status-assigned-wash text-status-assigned-ink border-status-assigned-tab" :
                                      "bg-alert-wash text-alert border-alert"
                                    }`}>
                                      {stats.rate}%
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

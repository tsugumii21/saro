import { useState, useEffect, useCallback } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  BarChart3, Settings, HelpCircle, AlertTriangle, CheckCircle2,
  TrendingUp, TrendingDown, Edit3, Save, X, ChevronDown, Flag, Download,
  Plus, BookOpen, Calendar, Activity, ChevronRight, PieChart, ShieldCheck
} from "lucide-react";
import {
  getReports, getCategories, getOffices, getBarangays, getAssistantLogs, updateCategory,
  addKnowledgeBaseEntry
} from "@saro/shared";
import { mockEvents } from "@saro/shared";
import { useAuth } from "@saro/shared";

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
function Sparkline({ data = [4, 6, 3, 7, 5, 8, 4], color = "#0F766E" }) {
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

export default function AdminDashboard() {
  const { profile } = useAuth();

  if (!profile?.is_coordinator) {
    return <Navigate to="/dashboard" replace />;
  }

  return <AdminDashboardContent />;
}

function AdminDashboardContent() {
  const navigate = useNavigate();
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

  const loadData = useCallback(async () => {
    const [rRes, cRes, oRes, bRes, aRes] = await Promise.all([
      getReports(),
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
  }, []);

  useEffect(() => {
    loadData();
    const u1 = mockEvents.on("report:created", loadData);
    const u2 = mockEvents.on("report:updated", loadData);
    const u3 = mockEvents.on("category:updated", loadData);
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

  // Report counts per office
  const reportsByOffice = offices.map((o) => {
    const oReports = rangedReports.filter((r) => r.office_id === o.id);
    const active = oReports.filter((r) => r.status !== "resolved").length;
    const breached = oReports.filter((r) => {
      if (r.status === "resolved") return false;
      const cat = categories.find((c) => c.id === r.category_id);
      return cat && hoursElapsed(r.created_at) > cat.sla_hours;
    }).length;
    return { office: o, total: oReports.length, active, breached };
  });

  const maxOfficeTotal = Math.max(1, ...reportsByOffice.map((o) => o.total));

  // Incident counts per barangay (horizontal bar chart data)
  const barangayCounts = barangays.map((b) => {
    const count = rangedReports.filter((r) => r.barangay_id === b.id).length;
    return { barangay: b, count };
  }).sort((a, b) => b.count - a.count).slice(0, 6);

  const maxBrgyCount = Math.max(1, ...barangayCounts.map((b) => b.count));

  // Explicit, Unambiguous KPI Trend Indicator
  function KpiTrendBadge({ current, previous, suffix = "", lowerIsBetter = false }) {
    const diff = current - previous;
    if (diff === 0) {
      return (
        <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
          0.0{suffix} vs prev
        </span>
      );
    }
    const isUp = diff > 0;
    const isGood = lowerIsBetter ? !isUp : isUp;
    return (
      <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${
        isGood ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
      }`}>
        {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {isUp ? "+" : ""}{diff.toFixed(1)}{suffix}
      </span>
    );
  }

  const toggleOfficeGroup = (officeId) => {
    setCollapsedOffices((prev) => ({ ...prev, [officeId]: !prev[officeId] }));
  };

  return (
    <div className="w-full space-y-4 font-sans max-w-7xl mx-auto pb-6">
      
      {/* Top Header Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-1 border-b border-saro-line">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-900">City Operations & SLA Admin Panel</h2>
          <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded font-mono font-bold">
            COORDINATOR GATEWAY
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Date Range Selector */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
            {[
              { key: "all", label: "All Time" },
              { key: "month", label: "This Month" },
              { key: "week", label: "This Week" }
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setDateRange(key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
                  dateRange === key ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Panel Tab Selector */}
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            {[
              { key: "metrics", label: "Metrics & Analytics", icon: BarChart3 },
              { key: "routing", label: "Routing & SLA Editor", icon: Settings },
              { key: "questions", label: "Unanswered Queries", icon: HelpCircle }
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActivePanel(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-colors ${
                  activePanel === key ? "bg-teal-700 text-white shadow-2xs" : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* METRICS & ANALYTICS PANEL */}
      {activePanel === "metrics" && (
        <div className="space-y-4">
          
          {/* 4 Tight KPI Cards with Sparklines & Explicit Color-Coded Trends */}
          <div className="grid grid-cols-4 gap-3">
            
            {/* Median Assignment Time */}
            <div className="bg-white rounded-xl border border-saro-line p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Median Assignment</span>
                <KpiTrendBadge current={medianAssignment} previous={prevMedian} suffix="h" lowerIsBetter={true} />
              </div>
              <div className="flex items-end justify-between">
                <div className="font-mono text-2xl font-extrabold text-slate-900">
                  {medianAssignment.toFixed(1)} <span className="text-xs text-slate-500 font-sans font-normal">hrs</span>
                </div>
                <Sparkline data={[1.8, 1.5, 1.6, 1.2, 1.4, 1.1, 0.9]} color="#0F766E" />
              </div>
              <div className="text-[10px] text-slate-400 font-medium">Target SLA: &lt; 1.0h initial dispatch</div>
            </div>

            {/* Resolution Velocity */}
            <div className="bg-white rounded-xl border border-saro-line p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Resolution Velocity</span>
                <KpiTrendBadge current={resolvedPercent} previous={prevResolvedPercent} suffix="%" lowerIsBetter={false} />
              </div>
              <div className="flex items-end justify-between">
                <div className="font-mono text-2xl font-extrabold text-slate-900">
                  {resolvedPercent}%
                </div>
                <Sparkline data={[60, 65, 68, 72, 75, 78, 83]} color="#16A34A" />
              </div>
              <div className="text-[10px] text-slate-400 font-medium">{resolvedReports.length} of {totalReports} reports closed</div>
            </div>

            {/* False Report Rate */}
            <div className="bg-white rounded-xl border border-saro-line p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">False Report Rate</span>
                <KpiTrendBadge current={parseFloat(falseRate)} previous={parseFloat(prevFalseRate)} suffix="%" lowerIsBetter={true} />
              </div>
              <div className="flex items-end justify-between">
                <div className="font-mono text-2xl font-extrabold text-slate-900">
                  {falseRate}%
                </div>
                <Sparkline data={[8.0, 7.2, 6.5, 5.8, 6.0, 5.2, 4.5]} color="#D97706" />
              </div>
              <div className="text-[10px] text-slate-400 font-medium">{falseReports.length} verified false reports</div>
            </div>

            {/* Assistant Coverage */}
            <div className="bg-white rounded-xl border border-saro-line p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Assistant Coverage</span>
                <span className="text-[10px] bg-teal-50 text-teal-700 font-bold px-1.5 py-0.5 rounded border border-teal-200">RAG ACTIVE</span>
              </div>
              <div className="flex items-end justify-between">
                <div className="font-mono text-2xl font-extrabold text-slate-900">
                  {unansweredLogs.length} <span className="text-xs text-slate-500 font-sans font-normal">unanswered</span>
                </div>
                <Sparkline data={[5, 4, 6, 3, 2, 4, 3]} color="#2563EB" />
              </div>
              <div className="text-[10px] text-slate-400 font-medium">{questionClusters.length} distinct query clusters</div>
            </div>

          </div>

          {/* Visualizations Row: SVG Agency Bar Chart & Barangay Horizontal Bar Chart */}
          <div className="grid md:grid-cols-12 gap-4">
            
            {/* Left 7 Cols: Incident Volume by Agency Column Chart */}
            <div className="md:col-span-7 bg-white rounded-xl border border-saro-line p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-teal-700" />
                  Incident Volume by Agency
                </h3>
                <span className="text-[11px] text-slate-500 font-medium">Distribution across 8 offices</span>
              </div>

              <div className="space-y-2 pt-1">
                {reportsByOffice.map(({ office, total, active, breached }) => {
                  const pct = Math.round((total / maxOfficeTotal) * 100);
                  return (
                    <div key={office.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span className="font-bold text-slate-800 w-32 truncate">{office.short_name}</span>
                        <div className="flex items-center gap-3 font-mono text-[11px]">
                          <span className="text-slate-700 font-bold">{total} total</span>
                          <span className="text-teal-700 font-semibold">{active} active</span>
                          {breached > 0 && <span className="text-red-600 font-bold">{breached} breached</span>}
                        </div>
                      </div>
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
                        <div
                          className="h-full bg-teal-700 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right 5 Cols: High Incident Barangays Horizontal Bar Chart */}
            <div className="md:col-span-5 bg-white rounded-xl border border-saro-line p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-4 h-4 text-teal-700" />
                  High Incident Barangays
                </h3>
                <button
                  onClick={() => generateCSV(rangedReports, categories, offices)}
                  className="flex items-center gap-1 text-[11px] font-bold text-teal-700 hover:underline"
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
                        <span className="font-bold text-slate-800 truncate">{barangay.name}</span>
                        <span className="font-mono font-bold text-slate-900 text-[11px]">{count} reports</span>
                      </div>
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all"
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
          <div className="bg-white rounded-xl border border-saro-line overflow-hidden">
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">SLA Compliance Grouped by Office</h3>
              <span className="text-[11px] text-slate-400 font-mono">
                {categories.length} Incident Categories Configured
              </span>
            </div>

            <div className="divide-y divide-slate-200">
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
                      className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-bold text-slate-900 border-b border-slate-200 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                        <span>{office.full_name} ({office.short_name})</span>
                      </div>
                      
                      {/* Rollup Summary Badge Strip */}
                      <div className="flex items-center gap-3 text-[11px] font-mono font-semibold">
                        <span className="text-slate-500">{officeCats.length} Categories</span>
                        <span className={`px-2 py-0.5 rounded border ${
                          avgCompliance >= 80 ? "bg-green-50 text-green-700 border-green-200" :
                          avgCompliance >= 50 ? "bg-amber-50 text-amber-700 border-amber-200" :
                          "bg-red-50 text-red-700 border-red-200"
                        }`}>
                          {avgCompliance}% Avg Compliance
                        </span>
                        {activeBreaches > 0 && (
                          <span className="bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded font-bold">
                            {activeBreaches} Breach
                          </span>
                        )}
                      </div>
                    </button>

                    {!isCollapsed && (
                      <table className="w-full text-xs">
                        <thead className="bg-white text-slate-500 border-b border-slate-200 uppercase text-[10px]">
                          <tr>
                            <th className="text-left px-4 py-2 font-semibold">Category Name</th>
                            <th className="text-center px-3 py-2 font-semibold">Type</th>
                            <th className="text-center px-3 py-2 font-semibold">SLA Target</th>
                            <th className="text-center px-3 py-2 font-semibold">Total Volume</th>
                            <th className="text-center px-4 py-2 font-semibold">Compliance Rate</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {officeCats.map((cat) => {
                            const stats = slaByCat.find((s) => s.cat.id === cat.id) || { total: 0, rate: 100 };
                            return (
                              <tr key={cat.id} className="hover:bg-slate-50">
                                <td className="px-4 py-2 text-slate-900 font-semibold">
                                  <div className="flex items-center gap-1.5">
                                    {cat.is_emergency && <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />}
                                    {cat.name}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                                    cat.is_emergency ? "bg-red-50 text-red-700 border-red-200" : "bg-slate-100 text-slate-600 border-slate-200"
                                  }`}>
                                    {cat.is_emergency ? "Emergency" : "Standard"}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center font-mono font-bold text-slate-700">{cat.sla_hours}h</td>
                                <td className="px-3 py-2 text-center font-mono font-bold text-slate-900">{stats.total}</td>
                                <td className="px-4 py-2 text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${stats.rate >= 80 ? "bg-green-600" : stats.rate >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                                        style={{ width: `${stats.rate}%` }}
                                      />
                                    </div>
                                    <span className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded border ${
                                      stats.rate >= 80 ? "bg-green-50 text-green-700 border-green-200" :
                                      stats.rate >= 50 ? "bg-amber-50 text-amber-700 border-amber-200" :
                                      "bg-red-50 text-red-700 border-red-200"
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
      )}

      {/* ROUTING & SLA EDITOR PANEL */}
      {activePanel === "routing" && (
        <div className="bg-white rounded-xl border border-saro-line p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Department Routing & SLA Target Editor</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure automatic department dispatch rules and response SLA hours for each hazard category.
              </p>
            </div>
          </div>

          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-600 border-b border-saro-line uppercase text-[10px] font-bold">
              <tr>
                <th className="text-left px-4 py-2.5">Category Name</th>
                <th className="text-left px-3 py-2.5">Assigned Department</th>
                <th className="text-center px-3 py-2.5">SLA Target (Hours)</th>
                <th className="text-right px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map((cat) => {
                const isEditing = editingCat === cat.id;
                return (
                  <tr key={cat.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-900 font-semibold">
                      <div className="flex items-center gap-1.5">
                        {cat.is_emergency && <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />}
                        {cat.name}
                      </div>
                    </td>

                    <td className="px-3 py-3">
                      {isEditing ? (
                        <select
                          value={editOfficeId}
                          onChange={(e) => setEditOfficeId(e.target.value)}
                          className="text-xs py-1 px-2 rounded border border-slate-200 bg-white font-medium text-slate-900"
                        >
                          {offices.map((o) => (
                            <option key={o.id} value={o.id}>{o.full_name} ({o.short_name})</option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-semibold text-slate-800">{getOfficeName(cat.office_id)}</span>
                      )}
                    </td>

                    <td className="px-3 py-3 text-center">
                      {isEditing ? (
                        <input
                          type="number"
                          min="1"
                          max="168"
                          value={editSlaHours}
                          onChange={(e) => setEditSlaHours(e.target.value)}
                          className="w-16 text-center text-xs py-1 px-2 rounded border border-slate-200 bg-white font-mono font-bold text-slate-900"
                        />
                      ) : (
                        <span className="font-mono font-bold text-slate-900">{cat.sla_hours}h</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            disabled={saving}
                            onClick={handleSaveCategory}
                            className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold px-3 py-1 rounded transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingCat(null)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-2 py-1 rounded transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEditCategory(cat)}
                          className="text-teal-700 hover:underline font-semibold text-xs flex items-center justify-end gap-1 ml-auto"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit Rules
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* UNANSWERED QUESTIONS PANEL */}
      {activePanel === "questions" && (
        <div className="bg-white rounded-xl border border-saro-line p-6 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Unanswered Assistant Queries</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Review frequent questions asked by citizens that were not found in the local knowledge base.
            </p>
          </div>

          <div className="space-y-3">
            {questionClusters.map((cluster, idx) => (
              <div key={idx} className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    "{cluster.representative}"
                  </div>
                  <div className="text-[11px] text-slate-500 font-medium">
                    Asked {cluster.count} time(s) &bull; Latest: {new Date(cluster.latestAt).toLocaleString()}
                  </div>
                </div>

                <button
                  onClick={() => setKbTarget(cluster)}
                  className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors shrink-0 flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add to Knowledge Base
                </button>
              </div>
            ))}
            {questionClusters.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500">
                No unanswered query clusters recorded.
              </div>
            )}
          </div>
        </div>
      )}

      {/* KB Add Modal */}
      {kbTarget && (
        <div className="fixed inset-0 bg-slate-950/60 z-50 flex items-center justify-center p-6">
          <div className="bg-white border border-saro-line rounded-xl p-6 w-full max-w-lg shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Add Answer to Knowledge Base</h3>
              <button onClick={() => setKbTarget(null)} className="text-slate-400 hover:text-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <span className="font-bold text-slate-700 block mb-1">Question:</span>
              <span className="text-slate-900 font-medium">"{kbTarget.representative}"</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1.5">Official City Answer</label>
              <textarea
                rows={4}
                value={kbAnswer}
                onChange={(e) => setKbAnswer(e.target.value)}
                placeholder="Enter official public service response..."
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 font-medium focus:border-teal-700 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setKbTarget(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                disabled={!kbAnswer.trim() || kbSaving}
                onClick={handleAddToKB}
                className="px-4 py-2 bg-teal-700 text-white text-xs font-bold rounded-lg hover:bg-teal-800 disabled:opacity-40"
              >
                {kbSaving ? "Saving..." : "Publish to KB"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Brain, BarChart3, Activity, Download, RefreshCw, AlertTriangle,
  Building2, Sparkles, Filter, Shield, Calendar, CheckCircle2, Clock,
  FileText, ArrowUpRight, Zap, Search, Table
} from "lucide-react";
import {
  getReports, getCategories, getOffices, getBarangays,
  saroEvents, useAuth, supabase
} from "@saro/shared";

function hoursElapsed(dateStr) {
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
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

function generateFallbackNarrative(report, catLabel, barangayName) {
  const isEmergency = report.status === "received" || report.is_emergency;
  const severity = isEmergency ? "HIGH OPERATIONAL SEVERITY" : "MODERATE SEVERITY";
  const locationText = barangayName ? `Brgy. ${barangayName}` : "Legazpi City";
  const desc = report.description || "";

  return {
    insight: `${severity}: ${catLabel} incident reported in ${locationText}. Active threat requiring CDRRMO assessment to mitigate public safety risks.`,
    root_cause: desc.length > 25
      ? `Likely triggered by localized physical conditions or infrastructure stress reported in "${desc.slice(0, 70)}…"`
      : "Insufficient detail in report to determine a probable root cause.",
    suggested_action: `Dispatch CDRRMO inspection team to ${locationText} to establish perimeter and coordinate response with local barangay EOC.`
  };
}

function parseNarrativeObject(raw, report, catLabel, barangayName) {
  const fallback = generateFallbackNarrative(report, catLabel, barangayName);
  if (!raw) return fallback;
  if (typeof raw === "object" && raw.insight) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.insight) return parsed;
    } catch {
      // String text fallback
    }
    return {
      insight: raw,
      root_cause: "Insufficient detail in report to determine a probable root cause.",
      suggested_action: "Dispatch CDRRMO response team to site."
    };
  }
  return fallback;
}

function exportInsightsCSV(reports, categories, barangays) {
  const headers = [
    "Tracking Code",
    "Category",
    "Barangay",
    "Citizen Description",
    "Status",
    "Filed Date",
    "AI Insight",
    "Probable Root Cause",
    "Suggested Action / Solution"
  ];

  const rows = reports.map((r) => {
    const cat = categories.find((c) => c.id === r.category_id || c.category === r.category);
    const b = barangays.find((b) => b.id === r.barangay_id) || r.barangays;
    const catLabel = cat?.name || cat?.label || r.category || "Hazard";
    const bName = b?.name || r.barangay_name || "Legazpi City";
    const structured = parseNarrativeObject(r.ai_narrative, r, catLabel, bName);

    return [
      r.tracking_code,
      catLabel,
      bName,
      (r.description || "").replace(/"/g, '""'),
      r.status,
      new Date(r.created_at).toLocaleString("en-PH"),
      (structured.insight || "").replace(/"/g, '""'),
      (structured.root_cause || "").replace(/"/g, '""'),
      (structured.suggested_action || "").replace(/"/g, '""')
    ];
  });

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.map((val) => `"${val}"`).join(","))
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `cdrrmo-hazard-insights-${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function HazardInsights() {
  const { role, isAdmin } = useAuth();
  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [offices, setOffices] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dateRange, setDateRange] = useState("all");
  const [synthesizingMap, setSynthesizingMap] = useState({});

  // STAGE 3 Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadData = useCallback(async () => {
    setLoadError("");
    setLoading(true);
    try {
      const [rRes, cRes, oRes, bRes] = await Promise.all([
        getReports({ scope: "City-wide" }),
        getCategories(),
        getOffices(),
        getBarangays()
      ]);
      if (rRes.data) setReports(rRes.data);
      if (cRes.data) setCategories(cRes.data);
      if (oRes.data) setOffices(oRes.data);
      if (bRes.data) setBarangays(bRes.data);
      if (rRes.error) setLoadError(rRes.error);
    } catch (err) {
      setLoadError(err.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const u1 = saroEvents.on("report:created", loadData);
    const u2 = saroEvents.on("report:updated", loadData);
    return () => { u1(); u2(); };
  }, [loadData]);

  // Find CDRRMO office object
  const cdrmoOffice = useMemo(() => {
    return offices.find(
      (o) =>
        o.short_name?.toLowerCase().includes("cdrmo") ||
        o.full_name?.toLowerCase().includes("disaster") ||
        o.id === "cdrrmo"
    ) || offices[0];
  }, [offices]);

  // Scope reports: CDRRMO role sees CDRRMO-assigned / category-mapped reports.
  // Director (admin) sees city-wide (CDRRMO focused).
  const scopedReports = useMemo(() => {
    if (!reports.length) return [];
    if (isAdmin) return reports;

    const cdrmoId = cdrmoOffice?.id;
    const cdrmoCatIds = new Set(
      categories.filter((c) => c.office_id === cdrmoId).map((c) => c.id)
    );

    return reports.filter((r) => {
      const assignedId = r.assigned_office_id || r.office_id;
      const catMatch = cdrmoCatIds.has(r.category_id);
      return assignedId === cdrmoId || catMatch || r.office_name?.toLowerCase().includes("cdrmo");
    });
  }, [reports, isAdmin, cdrmoOffice, categories]);

  const rangedReports = useMemo(() => {
    return scopedReports.filter((r) => isWithinRange(r.created_at, dateRange));
  }, [scopedReports, dateRange]);

  // STAGE 3 Table Filtered Reports
  const filteredReports = useMemo(() => {
    return rangedReports.filter((r) => {
      const cat = categories.find((c) => c.id === r.category_id || c.category === r.category);
      const b = barangays.find((b) => b.id === r.barangay_id) || r.barangays;
      const catLabel = cat?.name || cat?.label || r.category || "";
      const bName = b?.name || r.barangay_name || "";

      // Category filter check
      if (catFilter !== "all" && cat?.id !== catFilter && r.category !== catFilter) {
        return false;
      }

      // Status filter check
      if (statusFilter !== "all" && r.status !== statusFilter) {
        return false;
      }

      // Search query check
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesCode = r.tracking_code?.toLowerCase().includes(q);
        const matchesDesc = r.description?.toLowerCase().includes(q);
        const matchesBarangay = bName.toLowerCase().includes(q);
        const matchesCat = catLabel.toLowerCase().includes(q);
        return matchesCode || matchesDesc || matchesBarangay || matchesCat;
      }

      return true;
    });
  }, [rangedReports, categories, barangays, catFilter, statusFilter, searchQuery]);

  // Auto-synthesize missing narratives for reports
  const synthesizeReport = useCallback(async (report) => {
    if (report.ai_narrative || synthesizingMap[report.id]) return;
    setSynthesizingMap((prev) => ({ ...prev, [report.id]: true }));

    const cat = categories.find((c) => c.id === report.category_id || c.category === report.category);
    const b = barangays.find((b) => b.id === report.barangay_id) || report.barangays;
    const catLabel = cat?.name || cat?.label || report.category || "Hazard";
    const bName = b?.name || report.barangay_name || "";

    let narrativeText = "";
    try {
      const res = await supabase.functions.invoke("gemini-proxy", {
        body: {
          mode: "insight",
          report: {
            tracking_code: report.tracking_code,
            category: catLabel,
            description: report.description,
            barangay: bName,
            status: report.status,
            created_at: report.created_at
          }
        }
      });
      if (res.data?.narrative) {
        narrativeText = res.data.narrative;
      } else {
        narrativeText = generateFallbackNarrative(report, catLabel, bName);
      }
    } catch {
      narrativeText = generateFallbackNarrative(report, catLabel, bName);
    }

    setReports((prev) =>
      prev.map((r) => (r.id === report.id ? { ...r, ai_narrative: narrativeText } : r))
    );

    try {
      await supabase.from("reports").update({ ai_narrative: narrativeText }).eq("id", report.id);
    } catch {
      // Non-blocking write fallback
    } finally {
      setSynthesizingMap((prev) => ({ ...prev, [report.id]: false }));
    }
  }, [categories, barangays, synthesizingMap]);

  useEffect(() => {
    if (rangedReports.length > 0) {
      rangedReports.slice(0, 8).forEach((r) => {
        if (!r.ai_narrative) synthesizeReport(r);
      });
    }
  }, [rangedReports, synthesizeReport]);

  // Executive KPI Stat Counts
  const totalCount = rangedReports.length;
  const activeCount = rangedReports.filter(
    (r) => r.status !== "resolved" && r.status !== "closed_confirmed"
  ).length;
  const breachedCount = rangedReports.filter((r) => {
    if (r.status === "resolved" || r.status === "closed_confirmed") return false;
    const cat = categories.find((c) => c.id === r.category_id || c.category === r.category);
    return cat && hoursElapsed(r.created_at) > cat.sla_hours;
  }).length;
  const synthesizedCount = rangedReports.filter((r) => Boolean(r.ai_narrative)).length;

  // Hazard Category Frequency Breakdown
  const categoryFrequency = useMemo(() => {
    const countsMap = new Map();
    rangedReports.forEach((r) => {
      const cat = categories.find((c) => c.id === r.category_id || c.category === r.category);
      const catLabel = cat?.name || cat?.label || r.category || "Uncategorized";
      const isEmergency = cat?.is_emergency || false;
      const current = countsMap.get(catLabel) || { label: catLabel, count: 0, isEmergency };
      current.count += 1;
      countsMap.set(catLabel, current);
    });
    return Array.from(countsMap.values()).sort((a, b) => b.count - a.count);
  }, [rangedReports, categories]);

  const maxCatCount = Math.max(1, ...categoryFrequency.map((c) => c.count));

  // Barangay Frequency Breakdown
  const barangayFrequency = useMemo(() => {
    const countsMap = new Map();
    rangedReports.forEach((r) => {
      const b = barangays.find((b) => b.id === r.barangay_id) || r.barangays;
      const bName = b?.name || r.barangay_name || "Unknown Location";
      const current = countsMap.get(bName) || { name: bName, count: 0 };
      current.count += 1;
      countsMap.set(bName, current);
    });
    return Array.from(countsMap.values()).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [rangedReports, barangays]);

  const maxBrgyCount = Math.max(1, ...barangayFrequency.map((b) => b.count));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 bg-canvas">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 text-brand animate-spin" />
          <span className="t-body-sm text-ink-muted">Synthesizing CDRRMO Hazard Insights…</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="saro-card border-alert p-6">
        <p className="t-subhead font-bold text-alert">Could not load Hazard Insights</p>
        <p className="t-body-sm mt-1.5 text-ink-muted">{loadError}</p>
        <button onClick={loadData} className="saro-btn saro-btn-primary saro-btn-sm mt-4">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 font-sans pb-8">
      {/* Header Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-2 border-b border-line">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xs bg-brand-wash text-brand border border-brand-edge">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-ink flex items-center gap-2">
              Hazard Insights & Intelligence
            </h1>
            <p className="t-micro text-ink-faint">
              Per-report operational synthesis and hazard-frequency analytics
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Scope Badge */}
          <span className="t-micro font-mono font-bold px-2.5 py-1 rounded bg-raised text-brand border border-brand-edge flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" />
            {isAdmin ? "CITY-WIDE EOC OVERVIEW (CDRRMO FOCUS)" : "CDRRMO OPERATIONS SCOPE"}
          </span>

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

      {/* Executive KPI Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xs border border-line p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="t-label font-bold text-ink-faint uppercase tracking-wider">CDRRMO Reports</span>
            <Shield className="w-4 h-4 text-brand" />
          </div>
          <div className="font-mono text-2xl font-extrabold text-ink">{totalCount}</div>
          <div className="t-micro text-ink-faint">Incidents under CDRRMO domain</div>
        </div>

        <div className="bg-white rounded-xs border border-line p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="t-label font-bold text-ink-faint uppercase tracking-wider">Active Operations</span>
            <Activity className="w-4 h-4 text-status-assigned-tab" />
          </div>
          <div className="font-mono text-2xl font-extrabold text-ink">{activeCount}</div>
          <div className="t-micro text-ink-faint">Dispatched / in-progress</div>
        </div>

        <div className="bg-white rounded-xs border border-line p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="t-label font-bold text-ink-faint uppercase tracking-wider">Overdue Breaches</span>
            <AlertTriangle className="w-4 h-4 text-alert" />
          </div>
          <div className="font-mono text-2xl font-extrabold text-alert">{breachedCount}</div>
          <div className="t-micro text-ink-faint">Exceeding target SLA response time</div>
        </div>

        <div className="bg-white rounded-xs border border-line p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="t-label font-bold text-ink-faint uppercase tracking-wider">AI Synthesized</span>
            <Sparkles className="w-4 h-4 text-brand" />
          </div>
          <div className="font-mono text-2xl font-extrabold text-ink">{synthesizedCount} / {totalCount}</div>
          <div className="t-micro text-brand font-semibold">Gemini Operational Narratives</div>
        </div>
      </div>

      {/* STAGE 1: Hazard Frequency Breakdown Section */}
      <div className="grid md:grid-cols-12 gap-4">
        <div className="md:col-span-7 bg-white rounded-xs border border-line p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-brand" />
              CDRRMO Hazard Category Frequency
            </h2>
            <span className="t-label text-ink-faint font-mono">{categoryFrequency.length} Hazard Types</span>
          </div>

          <div className="space-y-2 pt-1">
            {categoryFrequency.map(({ label, count, isEmergency }) => {
              const pct = Math.round((count / maxCatCount) * 100);
              return (
                <div key={label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="font-bold text-ink flex items-center gap-1.5 truncate">
                      {isEmergency && <AlertTriangle className="w-3.5 h-3.5 text-alert shrink-0" />}
                      {label}
                    </span>
                    <span className="font-mono font-bold text-ink-muted t-label">{count} incidents</span>
                  </div>
                  <div className="w-full h-2.5 bg-sunken rounded-full overflow-hidden flex">
                    <div
                      className={`h-full rounded-full transition-all ${isEmergency ? "bg-alert" : "bg-brand"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-5 bg-white rounded-xs border border-line p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-brand" />
              High Recurrence Barangays
            </h2>
            <span className="t-label text-ink-faint font-mono">Top Hotspots</span>
          </div>

          <div className="space-y-2.5 pt-1">
            {barangayFrequency.map(({ name, count }) => {
              const pct = Math.round((count / maxBrgyCount) * 100);
              return (
                <div key={name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="font-bold text-ink truncate">{name}</span>
                    <span className="font-mono font-bold text-ink t-label">{count} reports</span>
                  </div>
                  <div className="w-full h-2.5 bg-sunken rounded-full overflow-hidden flex">
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

      {/* STAGE 2: Per-Report Gemini AI Narrative Feed */}
      <div className="bg-white rounded-xs border border-line p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand" />
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider">
              Per-Report AI Executive Operational Synthesis
            </h2>
          </div>
          <span className="t-micro text-ink-faint font-mono">
            AUTOMATIC PER-REPORT AI ANALYSIS
          </span>
        </div>

        <div className="grid gap-3">
          {rangedReports.slice(0, 5).map((report) => {
            const cat = categories.find((c) => c.id === report.category_id || c.category === report.category);
            const b = barangays.find((b) => b.id === report.barangay_id) || report.barangays;
            const catLabel = cat?.name || cat?.label || report.category || "Hazard";
            const bName = b?.name || report.barangay_name || "Legazpi City";
            const isEmergency = cat?.is_emergency;
            const isSynthesizing = synthesizingMap[report.id];

            return (
              <div key={report.id} className="p-3.5 bg-sunken/40 rounded-xs border border-line space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-extrabold text-ink bg-white px-2 py-0.5 rounded border border-line">
                      #{report.tracking_code}
                    </span>
                    <span className={`t-micro font-bold px-2 py-0.5 rounded border uppercase ${
                      isEmergency ? "bg-alert-wash text-alert border-alert" : "bg-white text-ink-muted border-line"
                    }`}>
                      {catLabel}
                    </span>
                    <span className="t-micro text-ink-faint font-semibold">
                      Brgy. {bName}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 t-micro font-mono">
                    <span className="text-ink-faint">{new Date(report.created_at).toLocaleString("en-PH", { dateStyle: "short", timeStyle: "short" })}</span>
                    <span className={`px-2 py-0.5 rounded border font-bold uppercase ${
                      report.status === "resolved" ? "bg-status-resolved-wash text-status-resolved-ink border-status-resolved-tab" :
                      report.status === "assigned" || report.status === "in_progress" ? "bg-status-assigned-wash text-status-assigned-ink border-status-assigned-tab" :
                      "bg-sunken text-ink-muted border-line"
                    }`}>
                      {report.status}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-ink-muted bg-white p-2.5 rounded-xs border border-line">
                  <span className="font-bold text-ink text-[11px] uppercase tracking-wider block mb-0.5">Citizen Description</span>
                  "{report.description}"
                </div>

                {(() => {
                  const structured = parseNarrativeObject(report.ai_narrative, report, catLabel, bName);
                  return (
                    <div className="bg-brand-wash/50 p-3.5 rounded-xs border border-brand-edge space-y-3">
                      <div className="flex items-center justify-between pb-1 border-b border-brand-edge/60">
                        <div className="flex items-center gap-1.5">
                          <Brain className="w-4 h-4 text-brand" />
                          <span className="t-micro font-extrabold text-brand uppercase tracking-wider">
                            AI Executive Operational Intelligence
                          </span>
                        </div>
                        <span className="t-micro bg-brand text-white font-bold px-2 py-0.5 rounded text-[9px] flex items-center gap-1">
                          <Zap className="w-2.5 h-2.5" />
                          GEMINI SYNTHESIZED
                        </span>
                      </div>

                      {isSynthesizing ? (
                        <div className="flex items-center gap-2 t-micro text-brand py-2">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Synthesizing per-report operational narrative…</span>
                        </div>
                      ) : (
                        <div className="space-y-2.5 text-xs">
                          {/* 1. INSIGHT */}
                          <div className="space-y-0.5 bg-white p-2.5 rounded-xs border border-brand-edge/40">
                            <span className="font-extrabold text-brand text-[10px] uppercase tracking-wider flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-brand" />
                              1. INSIGHT
                            </span>
                            <p className="text-ink font-medium leading-relaxed">
                              {structured.insight}
                            </p>
                          </div>

                          {/* 2. PROBABLE ROOT CAUSE(S) */}
                          <div className="space-y-0.5 bg-white p-2.5 rounded-xs border border-alert/30">
                            <span className="font-extrabold text-alert text-[10px] uppercase tracking-wider flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-alert" />
                              2. PROBABLE ROOT CAUSE(S)
                            </span>
                            <p className="text-ink font-medium leading-relaxed">
                              {structured.root_cause}
                            </p>
                          </div>

                          {/* 3. SUGGESTED ACTION/SOLUTION */}
                          <div className="space-y-0.5 bg-white p-2.5 rounded-xs border border-status-assigned-tab/40">
                            <span className="font-extrabold text-status-assigned-tab text-[10px] uppercase tracking-wider flex items-center gap-1">
                              <Shield className="w-3 h-3 text-status-assigned-tab" />
                              3. SUGGESTED ACTION / SOLUTION
                            </span>
                            <p className="text-ink font-medium leading-relaxed">
                              {structured.suggested_action}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>

      {/* STAGE 3: Raw Data Table & CSV Export */}
      <div className="bg-white rounded-xs border border-line p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Table className="w-4 h-4 text-brand" />
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider">
              Raw Hazard Reports & Intelligence Log
            </h2>
            <span className="t-micro bg-raised text-ink-muted px-2 py-0.5 rounded font-mono font-bold">
              {filteredReports.length} Rows
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-ink-faint absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Search code, barangay, text…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1 bg-sunken rounded-xs border border-line text-xs w-48 focus:outline-none focus:border-brand"
              />
            </div>

            {/* Category Filter */}
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="px-2 py-1 bg-sunken rounded-xs border border-line text-xs font-medium focus:outline-none"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name || c.label}</option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2 py-1 bg-sunken rounded-xs border border-line text-xs font-medium focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="received">Received</option>
              <option value="assigned">Assigned</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
            </select>

            {/* Export CSV Button */}
            <button
              onClick={() => exportInsightsCSV(filteredReports, categories, barangays)}
              className="flex items-center gap-1.5 px-3 py-1 bg-brand text-white rounded-xs t-label font-bold hover:bg-brand/90 transition-colors shadow-2xs"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto border border-line rounded-xs">
          <table className="w-full text-xs text-left">
            <thead className="bg-sunken text-ink-faint border-b border-line uppercase text-[10px] font-mono">
              <tr>
                <th className="px-3 py-2 font-semibold">Tracking Code</th>
                <th className="px-3 py-2 font-semibold">Category</th>
                <th className="px-3 py-2 font-semibold">Barangay</th>
                <th className="px-4 py-2 font-semibold">Citizen Description</th>
                <th className="px-3 py-2 font-semibold text-center">Status</th>
                <th className="px-3 py-2 font-semibold">Filed Date</th>
                <th className="px-4 py-2 font-semibold">1. AI Insight</th>
                <th className="px-4 py-2 font-semibold">2. Probable Root Cause</th>
                <th className="px-4 py-2 font-semibold">3. Suggested Action / Solution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sunken bg-white">
              {filteredReports.map((report) => {
                const cat = categories.find((c) => c.id === report.category_id || c.category === report.category);
                const b = barangays.find((b) => b.id === report.barangay_id) || report.barangays;
                const catLabel = cat?.name || cat?.label || report.category || "Hazard";
                const bName = b?.name || report.barangay_name || "Legazpi City";
                const structured = parseNarrativeObject(report.ai_narrative, report, catLabel, bName);

                return (
                  <tr key={report.id} className="hover:bg-raised/60 transition-colors">
                    <td className="px-3 py-2 font-mono font-extrabold text-ink whitespace-nowrap">
                      #{report.tracking_code}
                    </td>
                    <td className="px-3 py-2 font-medium text-ink whitespace-nowrap">
                      {catLabel}
                    </td>
                    <td className="px-3 py-2 text-ink-muted whitespace-nowrap">
                      {bName}
                    </td>
                    <td className="px-4 py-2 text-ink max-w-xs truncate">
                      "{report.description}"
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <span className={`t-micro font-bold px-2 py-0.5 rounded border uppercase ${
                        report.status === "resolved" ? "bg-status-resolved-wash text-status-resolved-ink border-status-resolved-tab" :
                        report.status === "assigned" || report.status === "in_progress" ? "bg-status-assigned-wash text-status-assigned-ink border-status-assigned-tab" :
                        "bg-sunken text-ink-muted border-line"
                      }`}>
                        {report.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono t-micro text-ink-faint whitespace-nowrap">
                      {new Date(report.created_at).toLocaleDateString("en-PH")}
                    </td>
                    <td className="px-4 py-2 text-ink font-medium text-[11px] max-w-xs truncate">
                      {structured.insight}
                    </td>
                    <td className="px-4 py-2 text-ink-muted text-[11px] max-w-xs truncate">
                      {structured.root_cause}
                    </td>
                    <td className="px-4 py-2 text-status-assigned-ink font-medium text-[11px] max-w-xs truncate">
                      {structured.suggested_action}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

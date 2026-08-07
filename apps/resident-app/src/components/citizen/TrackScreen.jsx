import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Search, Clock, MapPin, CheckCircle2, AlertCircle, ArrowRight,
  Copy, ChevronDown, Building2, Inbox, Sparkles, Tag
} from "lucide-react";
import {
  getReportByTrackingCode, getStatusHistory, getCategories, getBarangays,
  getOffices, getReportsByReporter
} from "@saro/shared";
import { mockEvents } from "@saro/shared";
import { useAuth } from "@saro/shared";

const STATUS_LABELS = {
  received: "Received",
  assigned: "Assigned",
  in_progress: "In Progress",
  resolved: "Resolved"
};
const STATUS_STEPS = ["received", "assigned", "in_progress", "resolved"];

// Popular example tracking codes for quick test & demonstration
const EXAMPLE_CODES = [
  { code: "SR-8F2K", label: "Flooding (Bitano)", status: "In Progress" },
  { code: "SR-8F2M", label: "Sandbags (Bitano)", status: "Assigned" },
  { code: "SR-9X2F", label: "Road Crash (Oro Site)", status: "Received" },
  { code: "SR-7K1W", label: "Gas Leak (Dap-Dap)", status: "In Progress" },
  { code: "SR-5L9K", label: "Storm Debris (Bonot)", status: "Resolved" }
];

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

export default function TrackScreen() {
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const preCode = searchParams.get("code") || "";

  const [trackingCode, setTrackingCode] = useState(preCode);
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [offices, setOffices] = useState([]);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [recentReports, setRecentReports] = useState([]);
  const [copied, setCopied] = useState(false);

  // Load reference data
  useEffect(() => {
    (async () => {
      const [cRes, bRes, oRes] = await Promise.all([getCategories(), getBarangays(), getOffices()]);
      if (cRes.data) setCategories(cRes.data);
      if (bRes.data) setBarangays(bRes.data);
      if (oRes.data) setOffices(oRes.data);
    })();
  }, []);

  // Load recent reports for signed-in residents
  useEffect(() => {
    if (profile?.id) {
      (async () => {
        const { data } = await getReportsByReporter(profile.id);
        if (data) setRecentReports(data);
      })();
    }
  }, [profile]);

  const handleSearch = useCallback(async (code) => {
    const c = (code || trackingCode).trim().toUpperCase();
    if (!c) return;
    setSearching(true);
    setError("");
    setHasSearched(true);

    const { data, error: err } = await getReportByTrackingCode(c);
    if (err || !data) {
      setError(err || "No report found matching code.");
      setReport(null);
      setHistory([]);
      setSearching(false);
      return;
    }
    setReport(data);

    const hRes = await getStatusHistory(data.id);
    if (hRes.data) setHistory(hRes.data);

    setSearching(false);
  }, [trackingCode]);

  // Auto-search if code in URL
  useEffect(() => {
    if (preCode) handleSearch(preCode);
  }, [preCode, handleSearch]);

  // Listen for updates
  useEffect(() => {
    if (!report) return;
    const unsub = mockEvents.on("report:updated", ({ report: updated }) => {
      if (updated.id === report.id) {
        setReport(updated);
        getStatusHistory(updated.id).then((r) => { if (r.data) setHistory(r.data); });
      }
    });
    return unsub;
  }, [report]);

  const handleSelectExample = (code) => {
    setTrackingCode(code);
    handleSearch(code);
  };

  const getCatName = (id) => categories.find((c) => c.id === id)?.name || id;
  const getBrgyName = (id) => barangays.find((b) => b.id === id)?.name || id;
  const getOfficeFullName = (id) => offices.find((o) => o.id === id)?.full_name || id;

  const currentStepIndex = report ? STATUS_STEPS.indexOf(report.status) : 0;

  const handleCopyCode = () => {
    if (!report) return;
    navigator.clipboard.writeText(report.tracking_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 space-y-4 max-w-md mx-auto font-sans pb-20">
      
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-saro-ink">Track your report</h2>
        <p className="text-xs text-saro-secondary mt-0.5">
          Enter the tracking code you received to check real-time response status.
        </p>
      </div>

      {/* Input Form */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-saro-secondary" />
          <input
            type="text"
            placeholder="SR-XXXX (e.g. SR-8F2K)"
            value={trackingCode}
            onChange={(e) => setTrackingCode(e.target.value.toUpperCase())}
            className="w-full pl-10 pr-3 py-2.5 bg-white border border-saro-line rounded-xl text-sm font-mono font-bold text-saro-ink placeholder:text-saro-secondary/50 focus:border-saro-primary focus:outline-none min-h-[44px]"
          />
        </div>
        <button
          type="submit"
          disabled={searching || !trackingCode.trim()}
          className="bg-saro-primary hover:bg-saro-primary/90 active:bg-saro-primary/80 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-colors disabled:opacity-40 min-h-[44px] shrink-0"
        >
          {searching ? "..." : "Track"}
        </button>
      </form>

      {/* Quick Example Tracking Code Chips */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <Sparkles className="w-3.5 h-3.5 text-teal-700" />
          <span>Quick Example Tracking Codes:</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {EXAMPLE_CODES.map((ex) => (
            <button
              key={ex.code}
              type="button"
              onClick={() => handleSelectExample(ex.code)}
              className="inline-flex items-center gap-1.5 bg-white hover:bg-teal-50 active:bg-teal-100 border border-slate-200 hover:border-teal-700/50 text-xs px-2.5 py-1 rounded-lg transition-colors font-mono font-bold text-slate-800 shadow-2xs"
            >
              <Tag className="w-3 h-3 text-teal-700" />
              {ex.code}
              <span className="font-sans text-[10px] text-slate-500 font-normal">({ex.label})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Report Result Display */}
      {report && (
        <div className="bg-white border border-saro-line rounded-xl overflow-hidden shadow-sm">
          
          {/* Card Header */}
          <div className="bg-saro-slate text-white p-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-saro-secondary uppercase tracking-wider">Tracking Code</div>
              <div className="text-base font-mono font-bold text-white flex items-center gap-2">
                {report.tracking_code}
                <button
                  onClick={handleCopyCode}
                  className="text-slate-400 hover:text-white transition-colors"
                  title="Copy code"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {copied && <span className="text-[10px] bg-teal-800 text-teal-200 px-1.5 py-0.5 rounded">Copied</span>}
              </div>
            </div>
            <span className={`saro-pill saro-pill-status-${report.status} font-bold text-xs uppercase px-3 py-1`}>
              {STATUS_LABELS[report.status]}
            </span>
          </div>

          {/* Stepper Progress */}
          <div className="p-4 bg-saro-mist border-b border-saro-line">
            <div className="flex items-center justify-between relative">
              {STATUS_STEPS.map((step, i) => {
                const isComplete = i <= currentStepIndex;
                const isCurrent = i === currentStepIndex;
                return (
                  <div key={step} className="flex flex-col items-center flex-1 relative">
                    {i > 0 && (
                      <div
                        className={`absolute top-3 right-1/2 w-full h-0.5 -z-10 ${
                          i <= currentStepIndex ? "bg-saro-primary" : "bg-saro-line"
                        }`}
                      ></div>
                    )}
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                        isComplete
                          ? "bg-saro-primary border-saro-primary text-white"
                          : "bg-white border-saro-line text-saro-secondary"
                      } ${isCurrent ? "ring-4 ring-saro-primary/20" : ""}`}
                    >
                      {isComplete ? "✓" : i + 1}
                    </div>
                    <span className={`text-[10px] font-semibold mt-1.5 text-center leading-tight ${
                      isComplete ? "text-saro-primary" : "text-saro-secondary"
                    }`}>
                      {STATUS_LABELS[step]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Details */}
          <div className="px-4 py-3 space-y-2.5">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-saro-secondary shrink-0 mt-0.5" />
              <div className="text-xs">
                <span className="text-saro-secondary font-medium">Category:</span>{" "}
                <span className="text-saro-ink font-semibold">{getCatName(report.category_id)}</span>
              </div>
            </div>

            {report.barangay_id && (
              <div className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-saro-primary shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="text-saro-secondary font-medium">Location:</span>{" "}
                  <span className="text-saro-ink font-semibold">{getBrgyName(report.barangay_id)}</span>
                </div>
              </div>
            )}

            {report.office_id && (
              <div className="flex items-start gap-2">
                <Building2 className="w-3.5 h-3.5 text-saro-secondary shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="text-saro-secondary font-medium">Assigned to:</span>{" "}
                  <span className="text-saro-primary font-semibold">{getOfficeFullName(report.office_id)}</span>
                </div>
              </div>
            )}

            {report.description && (
              <p className="text-xs text-saro-secondary leading-relaxed bg-saro-mist border border-saro-line rounded-lg p-3 mt-2">
                "{report.description}"
              </p>
            )}

            <div className="flex items-center gap-3 text-[11px] text-saro-secondary">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                Filed {timeSince(report.created_at)}
              </span>
              {report.resolved_at && (
                <span className="text-saro-green font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Resolved {timeSince(report.resolved_at)}
                </span>
              )}
            </div>
          </div>

          {/* Activity Timeline */}
          {history.length > 0 && (
            <div className="border-t border-saro-line px-4 py-3">
              <h4 className="text-[11px] font-bold text-saro-secondary uppercase tracking-wider mb-2.5">Activity Timeline</h4>
              <div className="space-y-2.5 pl-3 border-l-2 border-saro-line ml-1">
                {history.map((h) => (
                  <div key={h.id} className="relative pl-4">
                    <div className={`absolute -left-[9px] top-1 w-3.5 h-3.5 rounded-full border-2 border-white ${
                      h.to_status === "resolved" ? "bg-saro-green" : "bg-saro-primary"
                    }`}></div>
                    <div className="text-xs text-saro-ink font-medium">{h.note}</div>
                    <div className="text-[11px] text-saro-secondary mt-0.5 flex items-center gap-2">
                      <span className={`saro-pill saro-pill-status-${h.from_status}`}>{STATUS_LABELS[h.from_status]}</span>
                      <ArrowRight className="w-3 h-3 text-saro-secondary" />
                      <span className={`saro-pill saro-pill-status-${h.to_status}`}>{STATUS_LABELS[h.to_status]}</span>
                      <span className="text-saro-gray ml-1">{timeSince(h.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!report && !error && !hasSearched && (
        <div className="bg-white border border-saro-line rounded-xl p-6 text-center space-y-3">
          <Inbox className="w-10 h-10 text-saro-secondary mx-auto opacity-60" />
          <div>
            <h3 className="text-sm font-semibold text-saro-ink mb-1">No report selected</h3>
            <p className="text-xs text-saro-secondary leading-relaxed max-w-xs mx-auto">
              Select one of the example tracking codes above or type your code to view the live dispatch timeline.
            </p>
          </div>
        </div>
      )}

      {/* Recent Reports for signed-in users */}
      {!report && !error && profile && recentReports.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-bold text-saro-ink uppercase tracking-wider mb-2">Your Recent Reports</h3>
          <div className="space-y-2">
            {recentReports.slice(0, 5).map((r) => (
              <button
                key={r.id}
                onClick={() => { setTrackingCode(r.tracking_code); handleSearch(r.tracking_code); }}
                className="w-full bg-white border border-saro-line rounded-lg px-3.5 py-3 flex items-center justify-between text-left hover:border-saro-primary/40 transition-colors min-h-[44px]"
              >
                <div>
                  <span className="text-xs font-mono font-bold text-saro-ink">{r.tracking_code}</span>
                  <span className="text-[11px] text-saro-secondary ml-2">{getCatName(r.category_id)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`saro-pill saro-pill-status-${r.status}`}>{STATUS_LABELS[r.status]}</span>
                  <span className="text-[11px] text-saro-gray">{timeSince(r.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

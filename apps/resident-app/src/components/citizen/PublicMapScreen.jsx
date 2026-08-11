import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { HazardMap, IncidentPinCard } from "@saro/ui";
import PublicReportDetail from "./PublicReportDetail";
import {
  getPublicMapReports, getCategories, getBarangays,
  getRainfall, getEvacuationCenters, getAccidentBlackspots,
  LEGAZPI_CENTER, saroEvents, isReportActiveOnMap,
  groupReportsIntoPins, groupPinsByLocation, countReportsByStatus, getCategoryTier,
  useAuth,
} from "@saro/shared";
import {
  loadMyReportKeys, matchOwnership, decorateGroupsWithOwnership, EMPTY_REPORT_KEYS,
} from "../../lib/myReports";

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

function timeSince(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function PublicMapScreen() {
  const navigate = useNavigate();
  const { isResident } = useAuth();
  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [hiddenLayers] = useState([]);
  const [rainfall, setRainfall] = useState([]);
  const [evacuationCenters, setEvacuationCenters] = useState([]);
  const [accidentBlackspots, setAccidentBlackspots] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  /* The full report opened from a pin. A tracking code goes to Check a report;
     everything else opens the read-only public detail by id. */
  const [detailReport, setDetailReport] = useState(null);
  /* Every hazard at one point, when the popup's short list is not the whole
     story. */
  const [locationList, setLocationList] = useState(null);
  /* Which pins are the reader's own. Ids only — the map never carries codes. */
  const [myKeys, setMyKeys] = useState(EMPTY_REPORT_KEYS);

  /* Only the reader's own report goes to Track, because Track is where a report
     is confirmed or disputed. Everyone else's opens the read-only detail by id. */
  const openFullReport = useCallback(({ trackingCode, reportId, report, isMine }) => {
    setLocationList(null);
    if (isMine && trackingCode) {
      navigate(`/track?code=${encodeURIComponent(trackingCode)}`);
      return;
    }
    if (reportId) setDetailReport({ id: reportId, report });
  }, [navigate]);

  const loadData = useCallback(async () => {
    setLoadError("");
    const [rRes, cRes, bRes, rainRes, ecRes, bsRes] = await Promise.all([
      getPublicMapReports(),
      getCategories(),
      getBarangays(),
      getRainfall(),
      getEvacuationCenters(),
      getAccidentBlackspots(),
    ]);

    setLoading(false);
    if (rRes.error) {
      setLoadError(rRes.error);
      return;
    }

    if (rRes.data) setReports(rRes.data);
    if (cRes.data) setCategories(cRes.data);
    if (bRes.data) setBarangays(bRes.data);
    if (rainRes.data) setRainfall(rainRes.data);
    if (ecRes.data) setEvacuationCenters(ecRes.data);
    if (bsRes.data) setAccidentBlackspots(bsRes.data);
    setLoading(false);
  }, []);

  const loadOwnership = useCallback(async () => {
    setMyKeys(await loadMyReportKeys({ isResident }));
  }, [isResident]);

  useEffect(() => {
    loadData();
    const unsub1 = saroEvents.on("report:created", loadData);
    const unsub2 = saroEvents.on("report:updated", loadData);
    return () => { unsub1(); unsub2(); };
  }, [loadData]);

  useEffect(() => {
    loadOwnership();
    /* A report filed from this session is the reader's the moment it exists. */
    const unsub = saroEvents.on("report:created", loadOwnership);
    return () => { unsub(); };
  }, [loadOwnership]);

  const getCategoryName = (catId) => {
    const cat = categories.find((c) => c.id === catId);
    return cat ? cat.name : catId;
  };

  const getBarangayName = (brgyId) => {
    const brgy = barangays.find((b) => b.id === brgyId);
    return brgy ? brgy.name : "Legazpi City";
  };

  /* Time-based visibility: the long-standing archive rule for resolved reports,
     plus the shorter emergency clock for hazards that expire on their own.
     Nothing is deleted — an expired pin is still readable by tracking code. */
  const activeReports = reports.filter((r) => isReportActiveOnMap(r));

  // Apply status filter
  const filteredReports = statusFilter
    ? activeReports.filter((r) => r.status === statusFilter)
    : activeReports;

  /* Grouping lives in @saro/shared so this screen, the desktop map and the
     staff landing page all draw the same pins from the same rows. `count` is
     always `members.length` — never a separate score column.

     The second pass collapses pins that share a rounded coordinate into one
     marker per location: at ~110 m of precision unrelated reports land on the
     same point, and drawing them separately stacks markers nobody can pick
     apart. */
  const displayReports = groupPinsByLocation(groupReportsIntoPins(filteredReports), {
    tierOf: (r) => getCategoryTier(r?.category_id || r?.category),
  });
  const statusCounts = countReportsByStatus(activeReports, STATUS_ORDER);

  return (
    <div className="flex flex-col h-full w-full relative overflow-hidden">
      {/* Map Container */}
      <div className="flex-1 relative overflow-hidden border-b border-line">
        {loading && (
          <div
            role="status"
            className="absolute inset-x-0 top-0 z-[600] flex items-center justify-center gap-2 bg-surface/95 py-2 backdrop-blur border-b border-line"
          >
            <Loader2 width={14} height={14} className="animate-spin text-brand" aria-hidden="true" />
            <span className="t-body-sm text-ink-muted">Loading the map…</span>
          </div>
        )}

        {loadError && (
          <div
            role="alert"
            className="absolute inset-x-3 top-3 z-[600] border border-alert bg-alert-wash p-3 rounded-xs shadow-card"
          >
            <p className="t-body-sm text-alert">{loadError}</p>
            <button onClick={loadData} className="saro-btn saro-btn-secondary saro-btn-sm mt-2">
              Try again
            </button>
          </div>
        )}

        {!loading && !loadError && displayReports.length === 0 && (
          <div className="absolute inset-x-3 bottom-20 z-[600] border border-line bg-surface/95 p-3 rounded-xs backdrop-blur shadow-card">
            <p className="t-body-sm text-ink">
              {statusFilter
                ? "No active reports with that status."
                : "No active hazard reports in Legazpi City right now."}
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
          selectedId={selectedReport?.pinId ?? null}
          onClearSelectedReport={() => setSelectedReport(null)}
          renderReportPopup={(pin, { close }) => (
            <IncidentPinCard
              report={pin}
              categoryName={pin.categoryName || getCategoryName(pin.category_id || pin.category)}
              barangayName={pin.barangayName || getBarangayName(pin.barangay_id) || "Legazpi City"}
              timeSinceStr={pin.timeSinceStr}
              maxRows={2}
              onClose={() => {
                close();
                setSelectedReport(null);
              }}
              onViewReport={openFullReport}
              onShowAll={(locationPin) => {
                close();
                setLocationList(locationPin);
              }}
            />
          )}
          zoom={13}
          rainfall={rainfall}
          evacuationCenters={evacuationCenters}
          accidentBlackspots={accidentBlackspots}
          showToggles={true}
          hidden={hiddenLayers}
          reports={displayReports.map(({ id, report: r, count, members, groups }) => {
            const lead = matchOwnership(myKeys, r);
            const owned = decorateGroupsWithOwnership(
              myKeys,
              (groups ?? []).map((group) => ({
                ...group,
                report: {
                  ...group.report,
                  report_id: group.report.id,
                  categoryName: getCategoryName(group.report.category_id || group.report.category),
                  barangayName: getBarangayName(group.report.barangay_id) || group.report.barangay || "Legazpi City",
                  timeSinceStr: timeSince(group.report.created_at),
                },
              }))
            );

            return {
              id,
              /* The row id, kept beside the pin id so the popup can load this
                 report's photo evidence. */
              report_id: r.id,
              /* One entry per kind of hazard filed at this point; the popup draws
                 a row and an action for each. */
              groups: owned.groups,
              /* Ownership: the marker is ringed when anything under it is the
                 reader's, and the card carries the code that opens it in Track. */
              isMine: lead.isMine || owned.anyMine,
              is_mine: lead.isMine,
              my_tracking_code: lead.trackingCode,
              lat: r.lat,
              lng: r.lng,
              priority: r.priority,
              color: STATUS_COLORS[r.status] || STATUS_COLORS.received,
              count: count,
              category: r.category_id || r.category,
              categoryName: getCategoryName(r.category_id || r.category),
              barangayName: getBarangayName(r.barangay_id) || r.barangay || "Legazpi City",
              timeSinceStr: timeSince(r.created_at),
              status: r.status,
              tracking_code: r.tracking_code,
              description: r.description,
              created_at: r.created_at,
              members,
              onSelect: () => setSelectedReport({ ...r, pinId: id, report_id: r.id, clusterCount: count, members }),
            };
          })}
        />

        {/* Top Control Bar: Status Filter Chips with smooth horizontal scroll & gradient fade mask */}
        <div className="relative w-full z-20">
          {/* The layers button owns the top-right corner, so the chip rail stops
              short of it instead of scrolling underneath. */}
          <div className="pointer-events-none absolute right-14 top-3 h-9 w-10 bg-gradient-to-l from-white via-white/70 to-transparent z-30" aria-hidden="true" />
          <div className="absolute left-0 top-3 right-14 z-20 overflow-x-auto overscroll-x-contain px-3 no-scrollbar">
            <div className="flex w-max items-center gap-1.5 pb-1 pr-6">
              <button
                onClick={() => setStatusFilter("")}
                className={`px-3 py-1.5 rounded-full t-label font-bold transition-all shadow-xs cursor-pointer border ${
                  !statusFilter
                    ? "bg-ink text-white border-ink"
                    : "bg-white/95 backdrop-blur text-ink border-line hover:bg-white hover:border-ink/30"
                }`}
              >
                All ({activeReports.length})
              </button>
              {STATUS_ORDER.map((status) => {
                const isActive = statusFilter === status;
                const color = STATUS_COLORS[status];
                const count = statusCounts[status];
                return (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(isActive ? "" : status)}
                    className={`px-3 py-1.5 rounded-full t-label font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5 border ${
                      isActive
                        ? "bg-ink text-white border-ink"
                        : "bg-white/95 backdrop-blur text-ink border-line hover:bg-white hover:border-ink/30"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }}></span>
                    <span>{STATUS_LABELS[status]} ({count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

      </div>
      {/* No detail panel below the map: a pin's popup is the only place a
          report is described, so there is no second copy to fall out of step. */}

      {locationList && (
        <PublicReportDetail
          locationGroups={locationList.groups}
          locationLabel={locationList.barangayName}
          onOpenReport={openFullReport}
          onClose={() => setLocationList(null)}
        />
      )}

      {detailReport && (
        <PublicReportDetail
          reportId={detailReport.id}
          fallbackReport={detailReport.report}
          onClose={() => setDetailReport(null)}
        />
      )}
    </div>
  );
}

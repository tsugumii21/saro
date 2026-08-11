import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, MapPin, BadgeCheck } from "lucide-react";
import { HazardMap, AlertLevelBadge, IncidentPinCard, StatusTag } from "@saro/ui";
import PublicReportDetail from "../PublicReportDetail";
import {
  getPublicMapReports, getCategories, getBarangays,
  getRainfall, getVolcanicAlert, getEvacuationCenters, getAccidentBlackspots,
  LEGAZPI_CENTER, saroEvents, isReportActiveOnMap,
  groupReportsIntoPins, groupPinsByLocation, countReportsByStatus, getCategoryTier,
  useAuth,
} from "@saro/shared";
import {
  loadMyReportKeys, matchOwnership, decorateGroupsWithOwnership, EMPTY_REPORT_KEYS,
} from "../../../lib/myReports";

const LEGAZPI_CENTER_LNGLAT = [LEGAZPI_CENTER[1], LEGAZPI_CENTER[0]];

const STATUS_LABELS = {
  received: "Received",
  assigned: "Assigned",
  in_progress: "In Progress",
  resolved: "Resolved",
};

const STATUS_COLORS = {
  received: "#94A3B8",
  assigned: "#F59E0B",
  in_progress: "#0060A9",
  resolved: "#22C55E",
};

const STATUS_ORDER = ["received", "assigned", "in_progress", "resolved"];

function timeSince(dateStr) {
  if (!dateStr) return "";
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (isNaN(seconds) || seconds < 0) return "";
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Desktop Map — D1 layout.
 *
 * Left panel (340px): Status filters, Mayon Alert status, and scrollable Active Incidents Feed.
 * Right panel (flex-1): Full height HazardMap with layer controls.
 */
export default function MapDesktop() {
  const navigate = useNavigate();
  const { isResident } = useAuth();
  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [mapCenter, setMapCenter] = useState(LEGAZPI_CENTER_LNGLAT);
  const [statusFilter, setStatusFilter] = useState("");
  const [hiddenLayers] = useState([]);
  const [rainfall, setRainfall] = useState([]);
  const [evacuationCenters, setEvacuationCenters] = useState([]);
  const [accidentBlackspots, setAccidentBlackspots] = useState([]);
  const [alert, setAlert] = useState(null);
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
    const [rRes, cRes, bRes, rainRes, alertRes, ecRes, bsRes] = await Promise.all([
      getPublicMapReports(),
      getCategories(),
      getBarangays(),
      getRainfall(),
      getVolcanicAlert(),
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
    if (alertRes.data) setAlert(alertRes.data);
    if (ecRes.data) setEvacuationCenters(ecRes.data);
    if (bsRes.data) setAccidentBlackspots(bsRes.data);
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

  /* Same time-based visibility rule as the mobile map, so both agree. */
  const activeReports = reports.filter((r) => isReportActiveOnMap(r));
  const filteredReports = statusFilter
    ? activeReports.filter((r) => r.status === statusFilter)
    : activeReports;

  /* Same shared grouping the mobile map uses, so both surfaces draw the same
     pins with the same counts from the same rows — including the second pass
     that collapses everything sharing a rounded coordinate into one marker, so
     this list and the map can never point at different reports. */
  const displayReports = groupPinsByLocation(groupReportsIntoPins(filteredReports), {
    tierOf: (r) => getCategoryTier(r?.category_id || r?.category),
  });
  const statusCounts = countReportsByStatus(activeReports, STATUS_ORDER);

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas font-sans">
      {/* ── Left Sidebar (340px) ──────────────────────────────────────── */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-line bg-surface overflow-y-auto">
        {/* Header */}
        <div className="border-b border-line px-5 py-3.5 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-ink">Public Hazard Map</h1>
            <p className="text-xs text-ink-faint mt-0.5">Legazpi City DRRM & Incident Feed</p>
          </div>
          {loading && <Loader2 className="w-4 h-4 text-brand animate-spin" />}
        </div>

        <div className="flex flex-col gap-4 p-4">
          {/* Mayon Volcanic Alert Status Card */}
          {alert && (
            <div className="flex flex-col gap-1.5 p-3 rounded-md border border-line bg-surface shadow-2xs">
              <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">
                Volcanic Advisory
              </span>
              <AlertLevelBadge alert={alert} compact />
            </div>
          )}

          {/* Status Filter Pills */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">
              Filter Status
              {statusFilter ? ` — showing ${filteredReports.length} of ${activeReports.length}` : ""}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setStatusFilter("")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all border ${
                  !statusFilter
                    ? "bg-ink text-white border-ink"
                    : "bg-surface text-ink border-line hover:bg-raised"
                }`}
              >
                All ({activeReports.length})
              </button>
              {STATUS_ORDER.map((status) => {
                const isActive = statusFilter === status;
                const count = statusCounts[status];
                return (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(isActive ? "" : status)}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 border ${
                      isActive
                        ? "bg-ink text-white border-ink"
                        : "bg-surface text-ink border-line hover:bg-raised"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: STATUS_COLORS[status] }}
                    />
                    <span>{STATUS_LABELS[status]}</span>
                    <span className="text-[10px] opacity-75 font-mono">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Incidents List Feed */}
          <div className="flex flex-col gap-2 pt-2 border-t border-line">
            <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider flex items-center justify-between">
              <span>Active Incidents</span>
              <span className="font-mono text-brand">{displayReports.length} pins</span>
            </span>

            {loadError && (
              <div className="p-3 border border-alert bg-alert-wash text-alert text-xs rounded-xs">
                {loadError}
              </div>
            )}

            {!loading && displayReports.length === 0 && (
              <div className="p-4 text-center border border-line bg-raised rounded-xs">
                <p className="text-xs font-bold text-ink">No incidents found</p>
                <p className="text-[11px] text-ink-muted mt-1">
                  {statusFilter ? "Try clearing status filters." : "No active hazard reports."}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              {displayReports.map(({ id: pinId, report: r, count, members, groups }) => {
                /* A pin can stand for several kinds of hazard filed on the same
                   point, so the card says so rather than naming only the lead
                   one and quietly disagreeing with the marker. */
                const otherHazards = (groups?.length ?? 1) - 1;
                /* Pins carry a stable id from the shared grouping, so selection
                   is one comparison rather than a chain of coordinate guesses. */
                const isSelected = selectedReport?.pinId === pinId;
                /* The feed says whose report a row is for the same reason the
                   marker does: this list and the map point at the same pins. */
                const feedIsMine =
                  matchOwnership(myKeys, r).isMine ||
                  (groups ?? []).some((group) => matchOwnership(myKeys, group.report).isMine);

                const handleCardClick = () => {
                  if (isSelected) {
                    setSelectedReport(null);
                    return;
                  }
                  const lat = typeof r.lat === "string" ? parseFloat(r.lat) : Number(r.lat);
                  const lng = typeof r.lng === "string" ? parseFloat(r.lng) : Number(r.lng);
                  setSelectedReport({
                    ...r,
                    pinId,
                    clusterCount: count,
                    members,
                    categoryName: getCategoryName(r.category_id || r.category),
                    barangayName: getBarangayName(r.barangay_id) || r.barangay || "Legazpi City",
                    timeSinceStr: timeSince(r.created_at),
                  });
                  if (!isNaN(lat) && !isNaN(lng) && lat && lng) {
                    setMapCenter([lng, lat]);
                  }
                };

                return (
                  <button
                    key={pinId}
                    type="button"
                    onClick={handleCardClick}
                    aria-current={isSelected ? "true" : undefined}
                    className={`flex flex-col gap-2 p-3.5 text-left rounded-lg transition-all cursor-pointer ${
                      isSelected
                        ? "bg-brand-wash border-2 border-brand ring-2 ring-brand/40 shadow-md shadow-brand/10 scale-[1.01]"
                        : "bg-surface border border-line hover:border-brand-edge hover:bg-raised/60 active:bg-brand-wash active:border-brand active:scale-[0.99] shadow-2xs"
                    }`}
                  >
                    {/* Header Row: Dot + Title + StatusTag */}
                    <div className="flex items-center justify-between gap-2 w-full">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: STATUS_COLORS[r.status] || STATUS_COLORS.received }}
                        />
                        <span className={`text-xs leading-tight truncate ${
                          isSelected ? "font-extrabold text-brand" : "font-semibold text-ink"
                        }`}>
                          {getCategoryName(r.category_id || r.category)}
                          {otherHazards > 0 ? ` +${otherHazards} more` : ""}
                        </span>
                        {feedIsMine && (
                          <span className="flex shrink-0 items-center gap-1 rounded border border-brand-edge bg-brand-wash px-1.5 py-px text-[10px] font-bold text-brand">
                            <BadgeCheck className="h-2.5 w-2.5" aria-hidden="true" />
                            Yours
                          </span>
                        )}
                      </div>
                      <div className="pointer-events-none shrink-0">
                        <StatusTag status={r.status} size="sm" />
                      </div>
                    </div>

                    {/* Footer Row: Location + Time + Cluster Pill */}
                    <div className="flex items-center justify-between gap-2 w-full text-[11px] text-ink-muted">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <MapPin className="w-3 h-3 text-brand shrink-0" />
                        <span className="truncate">{getBarangayName(r.barangay_id) || r.barangay || "Legazpi City"}</span>
                        <span className="text-ink-faint">·</span>
                        <span className="shrink-0 text-ink-faint">{timeSince(r.created_at)}</span>
                      </div>
                      {count > 1 && (
                        <span className="text-[10px] font-mono font-bold bg-brand-wash text-brand border border-brand-edge/60 px-2 py-0.5 rounded-full shrink-0 shadow-2xs">
                          ⚡ {count} reports
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </aside>

      {/* ── Right Map View (flex-1) ───────────────────────────────────── */}
      <div className="relative min-w-0 flex-1 h-full overflow-hidden">
        <HazardMap
          className="h-full w-full"
          center={mapCenter}
          selectedId={selectedReport?.pinId ?? null}
          renderReportPopup={(pin, { close }) => (
            <IncidentPinCard
              report={pin}
              categoryName={pin.categoryName || getCategoryName(pin.category_id || pin.category)}
              barangayName={pin.barangayName || getBarangayName(pin.barangay_id) || "Legazpi City"}
              timeSinceStr={pin.timeSinceStr}
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
              onSelect: () => {
                const lat = typeof r.lat === "string" ? parseFloat(r.lat) : Number(r.lat);
                const lng = typeof r.lng === "string" ? parseFloat(r.lng) : Number(r.lng);
                setSelectedReport({ ...r, pinId: id, report_id: r.id, clusterCount: count, members });
                if (!isNaN(lat) && !isNaN(lng) && lat && lng) {
                  setMapCenter([lng, lat]);
                }
              },
            };
          })}
        />
        {/* The floating detail card that used to sit over the map is gone: the
            pin popup carries the whole report, photo evidence included. */}
      </div>

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

import { useState, useEffect, useCallback, useMemo } from "react";
import { Layers, Split, MapPin, Clock } from "lucide-react";
import { StatusTag, TrackingCode, HazardMap } from "@saro/ui";
import {
  getClustersWithReports, splitFromCluster, getReports, saroEvents, REALTIME_EVENTS,
  useAuth, LEGAZPI_CENTER, CLUSTER_RADIUS_METERS, CLUSTER_WINDOW_MINUTES,
} from "@saro/shared";

/**
 * Cluster review.
 *
 * Several people reporting the same thing is the strongest corroboration a
 * dispatcher gets — it is the difference between one anonymous claim of a fire
 * and six independent ones. So duplicates are not noise to be suppressed; they
 * are evidence, and this screen presents them as one incident with a confidence
 * attached rather than as a list to be deduplicated away.
 *
 * The clustering itself happens in Postgres on insert: same category, within
 * 150m, within 60 minutes. Deliberately dumb rules, because a dispatcher has to
 * be able to say why two reports were joined, and "they were 40 metres and 8
 * minutes apart" is an answer a person can check.
 *
 * Which is why Split exists and is one click. A rule that simple will
 * sometimes be wrong — two genuinely separate fires on the same street within
 * the hour — and the cost of a wrong merge is a real incident hidden inside
 * another card. Splitting never deletes anything; it removes a link.
 */

/**
 * Recurring-hazard map.
 *
 * Radius encodes how many reports landed at a spot, so a place the city keeps
 * being told about is physically bigger on the map. Not a GIS build and not
 * trying to be: a dispatcher wants to know which corner keeps flooding, not to
 * run spatial statistics.
 */
function HotspotMap({ reports }) {
  const spots = useMemo(() => {
    // Grid to ~3 decimal places (about 110m), which is the same resolution the
    // public map rounds to, so a "spot" here means the same thing there.
    const buckets = new Map();
    for (const r of reports) {
      if (typeof r.lat !== "number" || typeof r.lng !== "number") continue;
      const key = `${r.lat.toFixed(3)},${r.lng.toFixed(3)}`;
      if (!buckets.has(key)) buckets.set(key, { lat: r.lat, lng: r.lng, reports: [] });
      buckets.get(key).reports.push(r);
    }
    return [...buckets.values()].sort((a, b) => b.reports.length - a.reports.length);
  }, [reports]);

  return (
    <div className="saro-card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-2.5">
        <h2 className="t-label text-ink-faint">Recurring spots</h2>
        <span className="t-body-sm text-ink-muted">
          {spots.length} location{spots.length === 1 ? "" : "s"} · larger circle means more reports
        </span>
      </div>
      <div className="h-[380px]">
        <HazardMap
          className="h-full w-full"
          center={[LEGAZPI_CENTER[1], LEGAZPI_CENTER[0]]}
          zoom={12}
          hidden={["rain"]}
          reports={spots.map((spot) => ({
            id: `${spot.lat},${spot.lng}`,
            lat: spot.lat,
            lng: spot.lng,
            // A spot reported more than twice is drawn as high priority, which
            // gives it the round marker — so recurrence reads as shape, not
            // only as position.
            priority: spot.reports.length > 2 ? "high" : "normal",
            color: "var(--color-brand-bright)",
          }))}
        />
      </div>
    </div>
  );
}

export default function ClusterReview() {
  const { isBarangayOfficial } = useAuth();
  const [clusters, setClusters] = useState([]);
  const [reports, setReports] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([getClustersWithReports(), getReports()]);
    if (c.data) setClusters(c.data);
    if (r.data) setReports(r.data);
  }, []);

  useEffect(() => {
    load();
    // Clustering happens in a trigger on insert, so a new report can create or
    // grow a group without any cluster row changing in a way this screen would
    // otherwise notice. Both events are needed.
    const offCluster = saroEvents.on(REALTIME_EVENTS.CLUSTER_UPDATED, load);
    const offReport = saroEvents.on(REALTIME_EVENTS.REPORT_CREATED, load);
    return () => { offCluster(); offReport(); };
  }, [load]);

  const split = async (clusterId, reportId) => {
    setBusy(reportId);
    setError("");
    const { error: splitError } = await splitFromCluster(clusterId, reportId);
    setBusy("");
    if (splitError) return setError(splitError);
    await load();
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="t-heading">Duplicate review</h1>
        <p className="t-body-sm mt-1 text-ink-muted">
          Reports of the same category within {CLUSTER_RADIUS_METERS}m and{" "}
          {CLUSTER_WINDOW_MINUTES} minutes of each other are grouped as one incident. More
          independent reports means higher confidence it is real.
        </p>
      </div>

      {error && (
        <p role="alert" className="t-body-sm border border-alert bg-alert-wash p-3 text-alert">{error}</p>
      )}

      <HotspotMap reports={reports} />

      {clusters.length === 0 ? (
        <div className="saro-card flex flex-col items-center gap-2 px-6 py-14 text-center">
          <Layers width={24} height={24} className="text-ink-faint" aria-hidden="true" />
          <span className="t-subhead">No duplicate groups right now</span>
          <span className="t-body-sm max-w-[46ch] text-ink-muted">
            Groups appear on their own when several people report the same thing in the same
            place at the same time.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {clusters.map((cluster) => (
            <article key={cluster.id} className="saro-clip saro-card overflow-hidden">
              <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule p-4">
                <div>
                  <span className="t-subhead font-bold">
                    {cluster.reports[0]?.category_label ?? cluster.category ?? "Incident"}
                  </span>
                  <span className="t-body-sm ml-2 text-ink-muted">
                    {cluster.report_count} report{cluster.report_count === 1 ? "" : "s"}
                  </span>
                </div>
                <ConfidenceBadge value={cluster.confidence} count={cluster.report_count} />
              </header>

              <ul className="flex flex-col">
                {cluster.reports.map((report) => (
                  <li
                    key={report.id}
                    className="flex flex-wrap items-center gap-3 border-b border-line p-3 last:border-0"
                  >
                    <TrackingCode code={report.tracking_code} />
                    <StatusTag status={report.status} size="sm" />
                    <span className="t-body-sm min-w-0 flex-1 truncate text-ink-muted">
                      {report.description}
                    </span>
                    <span className="t-data-sm flex items-center gap-1 text-ink-faint">
                      <Clock width={11} height={11} aria-hidden="true" />
                      {new Date(report.created_at).toLocaleString("en-PH", {
                        dateStyle: "short", timeStyle: "short",
                      })}
                    </span>
                    <span className="t-data-sm flex items-center gap-1 text-ink-faint">
                      <MapPin width={11} height={11} aria-hidden="true" />
                      {report.barangays?.name ?? "—"}
                    </span>
                    {!isBarangayOfficial && (
                      <button
                        onClick={() => split(cluster.id, report.id)}
                        disabled={busy === report.id}
                        className="saro-btn saro-btn-secondary saro-btn-sm"
                        title="Not the same incident — separate this report"
                      >
                        <Split width={13} height={13} />
                        {busy === report.id ? "Splitting…" : "Not the same"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              <p className="t-body-sm border-t border-rule bg-raised px-4 py-2.5 text-ink-faint">
                Splitting a report removes it from this group. It is never deleted, and the group
                dissolves if only one report is left.
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Confidence as a bar plus a sentence, never a bare percentage.
 *
 * "0.80" invites a dispatcher to treat a heuristic as a measurement. The number
 * is stated, but so is what produced it, because the only thing that actually
 * matters here is how many separate people reported it.
 */
function ConfidenceBadge({ value, count }) {
  const pct = Math.round(value * 100);
  const strong = count >= 3;

  return (
    <div className="flex items-center gap-2">
      <span className="h-1.5 w-24 bg-sunken" aria-hidden="true">
        <span
          className="block h-full"
          style={{
            width: `${pct}%`,
            background: strong ? "var(--color-status-resolved-tab)" : "var(--color-status-assigned-tab)",
          }}
        />
      </span>
      <span className="t-body-sm text-ink-muted">
        {count} independent report{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

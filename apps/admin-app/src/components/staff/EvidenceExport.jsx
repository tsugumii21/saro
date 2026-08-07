import { useState, useCallback } from "react";
import { FileDown, Table, Crosshair, Loader2 } from "lucide-react";
import { StatusTag, TrackingCode, HazardMap } from "@saro/ui";
import {
  getReportsNearPoint, getReportMedia, useAuth,
  LEGAZPI_CENTER, RESOLUTION_REASON_LABELS, STATUS_LABELS,
} from "@saro/shared";

/**
 * Per-location evidence export.
 *
 * What this is for: a barangay captain asking the city for drainage money, an
 * office answering a complaint that nothing was ever done, a councillor asked
 * why the same corner floods every June. All of those need the same thing —
 * everything SARO knows about one spot, in a form you can hand to someone who
 * does not have a SARO login.
 *
 * Two artefacts, because they serve two different readers:
 *
 *   the sheet   a self-contained HTML file with the photos embedded as data
 *               URIs. Opens in any browser with no network, prints straight to
 *               PDF, and survives being emailed. It is evidence you can put on
 *               a table.
 *
 *   the CSV     the same rows for anyone who wants to do their own counting.
 *
 * Photos are embedded rather than linked on purpose. Storage URLs are signed
 * and expire in minutes; an export whose evidence goes blank next Tuesday is
 * not evidence.
 *
 * The query runs against an already-RLS-scoped read, so an office exports what
 * an office can see. Nothing here widens anyone's access.
 */

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function monthKey(iso) {
  return new Date(iso).toLocaleString("en-PH", { month: "short", year: "numeric" });
}

export default function EvidenceExport() {
  const { profile, officeName, barangayName } = useAuth();
  const [point, setPoint] = useState(null);
  const [radius, setRadius] = useState(150);
  const [rows, setRows] = useState([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState("");
  const [error, setError] = useState("");

  const search = useCallback(async () => {
    if (!point) return;
    setBusy(true);
    setError("");
    const { data, error: searchError } = await getReportsNearPoint({ ...point, radiusMeters: radius });
    setBusy(false);
    setSearched(true);
    if (searchError) return setError(searchError);
    setRows(data ?? []);
  }, [point, radius]);

  const byMonth = rows.reduce((acc, r) => {
    const key = monthKey(r.created_at);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const peak = Math.max(1, ...Object.values(byMonth));

  const exportCsv = () => {
    const header = [
      "tracking_code", "filed_at", "category", "status", "office", "barangay",
      "distance_m", "lat", "lng", "resolved_at", "resolution_reason", "resolution_reference",
      "description",
    ];
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      header.join(","),
      ...rows.map((r) => [
        r.tracking_code, r.created_at, r.routing_table?.label ?? r.category, r.status,
        r.offices?.short_name ?? "", r.barangays?.name ?? "", r.distance_m, r.lat, r.lng,
        r.resolved_at ?? "", r.resolution_reason ?? "", r.resolution_reference ?? "",
        r.description ?? "",
      ].map(escape).join(",")),
    ];

    download(
      new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }),
      `saro-evidence-${point.lat.toFixed(4)}-${point.lng.toFixed(4)}.csv`
    );
  };

  const exportSheet = async () => {
    setExporting("Collecting photos…");

    // Photos are fetched and inlined one report at a time. Slower than firing
    // them all at once, but a city-hall connection pulling forty images in
    // parallel tends to time some of them out, and a sheet with holes in it is
    // worse than a sheet that took twenty seconds.
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
        } catch { /* a photo that will not load is omitted, not fatal */ }
      }
      withPhotos.push({ ...row, images });
    }

    setExporting("Building sheet…");

    const scope = officeName || barangayName || "City-wide";
    const html = buildSheet({ rows: withPhotos, point, radius, byMonth, peak, profile, scope });

    download(new Blob([html], { type: "text/html;charset=utf-8" }),
      `saro-evidence-${point.lat.toFixed(4)}-${point.lng.toFixed(4)}.html`);
    setExporting("");
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="t-heading">Evidence for a location</h1>
        <p className="t-body-sm mt-1 text-ink-muted">
          Everything SARO holds about one spot — how many reports, when, and the photos —
          as a sheet you can print or hand to someone without a login.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="saro-card overflow-hidden">
          <div className="h-[420px]">
            <HazardMap
              className="h-full w-full"
              center={point ? [point.lng, point.lat] : [LEGAZPI_CENTER[1], LEGAZPI_CENTER[0]]}
              zoom={point ? 15 : 12}
              onPick={(p) => { setPoint(p); setSearched(false); }}
              picked={point}
              hidden={["rain"]}
              reports={rows.map((r) => ({
                id: r.id, lat: r.lat, lng: r.lng, priority: r.priority,
                color: "var(--color-brand)",
              }))}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="saro-card p-4">
            <span className="t-label flex items-center gap-1.5 text-ink-faint">
              <Crosshair width={13} height={13} aria-hidden="true" />
              The spot
            </span>
            {point ? (
              <p className="t-data mt-2">
                {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
              </p>
            ) : (
              <p className="t-body-sm mt-2 text-ink-muted">Click the map to choose one.</p>
            )}

            <label className="mt-4 block">
              <span className="t-label text-ink-faint">Radius · {radius}m</span>
              <input
                type="range"
                min="50"
                max="500"
                step="25"
                value={radius}
                onChange={(e) => { setRadius(Number(e.target.value)); setSearched(false); }}
                className="mt-1.5 w-full"
              />
            </label>

            <button
              onClick={search}
              disabled={!point || busy}
              className="saro-btn saro-btn-primary saro-btn-block mt-3"
            >
              {busy ? "Searching…" : "Find reports here"}
            </button>
          </div>

          {searched && (
            <div className="saro-card p-4">
              <span className="t-label text-ink-faint">Found</span>
              <p className="t-display mt-1">{rows.length}</p>
              <p className="t-body-sm text-ink-muted">
                report{rows.length === 1 ? "" : "s"} within {radius}m
              </p>

              {rows.length > 0 && (
                <>
                  <div className="mt-4 flex flex-col gap-1.5">
                    {Object.entries(byMonth).map(([month, count]) => (
                      <div key={month} className="flex items-center gap-2">
                        <span className="t-data-sm w-20 shrink-0 text-ink-faint">{month}</span>
                        <span className="h-3 flex-1 bg-sunken" aria-hidden="true">
                          <span
                            className="block h-full bg-brand"
                            style={{ width: `${(count / peak) * 100}%` }}
                          />
                        </span>
                        <span className="t-data-sm w-5 shrink-0 text-right">{count}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-col gap-2">
                    <button
                      onClick={exportSheet}
                      disabled={Boolean(exporting)}
                      className="saro-btn saro-btn-primary saro-btn-block"
                    >
                      {exporting
                        ? <><Loader2 width={15} height={15} className="animate-spin" />{exporting}</>
                        : <><FileDown width={15} height={15} />Evidence sheet</>}
                    </button>
                    <button onClick={exportCsv} className="saro-btn saro-btn-secondary saro-btn-block">
                      <Table width={15} height={15} />
                      CSV
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="saro-card overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-raised">
                {["Code", "Filed", "Incident", "Status", "Distance"].map((h) => (
                  <th key={h} className="t-label px-3 py-2.5 text-left text-ink-faint">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2.5"><TrackingCode code={r.tracking_code} /></td>
                  <td className="t-data-sm px-3 py-2.5">
                    {new Date(r.created_at).toLocaleDateString("en-PH", { dateStyle: "medium" })}
                  </td>
                  <td className="t-body-sm px-3 py-2.5">{r.routing_table?.label ?? r.category}</td>
                  <td className="px-3 py-2.5"><StatusTag status={r.status} size="sm" /></td>
                  <td className="t-data-sm px-3 py-2.5">{r.distance_m}m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {searched && rows.length === 0 && !error && (
        <p className="saro-card p-6 t-body-sm text-ink-muted">
          No reports within {radius}m of that point — in the reports you have access to.
        </p>
      )}

      {error && (
        <p role="alert" className="t-body-sm border border-alert bg-alert-wash p-3 text-alert">{error}</p>
      )}
    </div>
  );
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** The printable sheet. Styled inline — it has to survive with no stylesheet. */
function buildSheet({ rows, point, radius, byMonth, peak, profile, scope }) {
  const generated = new Date().toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" });
  const span = rows.length
    ? `${new Date(rows[0].created_at).toLocaleDateString("en-PH", { dateStyle: "medium" })} – ${new Date(rows[rows.length - 1].created_at).toLocaleDateString("en-PH", { dateStyle: "medium" })}`
    : "—";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>SARO evidence — ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}</title>
<style>
  @page { margin: 18mm; }
  body { font-family: "Public Sans", system-ui, sans-serif; color: #101725; margin: 0; padding: 32px; background: #fff; }
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
<p class="meta">${escapeHtml(point.lat.toFixed(5))}, ${escapeHtml(point.lng.toFixed(5))} · ${radius}m radius</p>
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
  <p class="row">Filed ${escapeHtml(new Date(r.created_at).toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" }))} · ${escapeHtml(r.distance_m)}m from the marked point</p>
  <p class="row">${escapeHtml(r.offices?.full_name ?? "Unrouted")}${r.barangays?.name ? ` · ${escapeHtml(r.barangays.name)}` : ""}</p>
  ${r.description ? `<p class="row">${escapeHtml(r.description)}</p>` : ""}
  ${r.resolution_reason ? `<p class="row">Closed as ${escapeHtml(RESOLUTION_REASON_LABELS[r.resolution_reason] ?? r.resolution_reason)} · ${escapeHtml(r.resolution_reference ?? "")}</p>` : ""}
  ${r.images.length ? `<div class="shots">${r.images.map((img) =>
    `<figure><img src="${img.dataUrl}" alt="${escapeHtml(r.tracking_code)} ${escapeHtml(img.kind)}"><figcaption>${escapeHtml(img.kind)}</figcaption></figure>`
  ).join("")}</div>` : ""}
</div>`).join("")}
<footer>
  Generated from SARO, the City of Legazpi incident reporting system. Photographs are embedded
  in this file and remain viewable offline. Report descriptions are as submitted by residents.
</footer>
</body></html>`;
}

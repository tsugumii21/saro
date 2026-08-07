import { useEffect, useRef, useState, useCallback } from "react";
// Named imports, not a default. maplibre-gl v5's ESM build has no default
// export, and importing one builds fine in dev but fails the production bundle
// with MISSING_EXPORT.
import { Map as MapLibreMap, Marker, Popup, NavigationControl, AttributionControl, addProtocol } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * The one map in SARO.
 *
 * Both apps render this. It replaces six separate Leaflet surfaces that had
 * each grown their own marker helpers and their own idea of what a pin looks
 * like — and, more importantly, it can draw the hazard overlays, which
 * Leaflet's raster-first model could not do from vector tiles without a second
 * rendering stack.
 *
 * ── Why MapLibre ────────────────────────────────────────────────────────────
 *
 * Open source (BSD-3), no API key, no account, no usage tier. It reads Mapbox
 * Vector Tiles natively, which is what PMTiles contains, and it renders them on
 * the GPU — the flood layer is tens of thousands of polygons and a canvas
 * renderer would stutter on the phones this has to work on.
 *
 * ── Why PMTiles ─────────────────────────────────────────────────────────────
 *
 * One file, served as a static asset with HTTP range requests. No tile server,
 * nothing to run, nothing to pay for, and the service worker can cache the
 * whole archive for offline use. The `Protocol` below teaches MapLibre to speak
 * `pmtiles://` URLs; everything after that is ordinary vector-tile styling.
 *
 * ── Basemap ─────────────────────────────────────────────────────────────────
 *
 * Raster tiles from OpenStreetMap's Carto style. Free, no key. It is the one
 * piece here that needs the network — the hazard layers and the report pins
 * work offline, and the map degrades to hazard geometry on a blank ground
 * rather than failing.
 */

/* The PMTiles protocol is global to maplibre, so it is registered once per
 * page rather than per map instance. Registering it twice throws. */
let protocolRegistered = false;
function ensureProtocol() {
  if (protocolRegistered) return;
  addProtocol("pmtiles", new Protocol().tile);
  protocolRegistered = true;
}

export const HAZARD_LAYERS = [
  { id: "danger_zones", label: "Mayon danger zones", defaultOn: true },
  { id: "volcanic_paths", label: "Lahar & pyroclastic paths", defaultOn: true },
  { id: "flood", label: "Flood hazard", defaultOn: true },
  { id: "rain", label: "Live rainfall", defaultOn: false },
  { id: "reports", label: "Citizen reports", defaultOn: true },
];

const PMTILES_URL = "pmtiles:///hazard/legazpi-hazards.pmtiles";

/**
 * Colours come from the design tokens, resolved at runtime rather than
 * hard-coded, so the map cannot drift away from the rest of the product.
 * MapLibre needs literal colour values — it does not resolve CSS variables.
 */
function token(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export default function HazardMap({
  center = [123.7438, 13.1391],
  zoom = 12,
  reports = [],
  rainfall = [],
  /** Called with { lat, lng } when the map is clicked, if picking is enabled. */
  onPick,
  picked,
  /** Layer ids to force off regardless of the toggles. */
  hidden = [],
  showToggles = true,
  className = "",
  style,
  children,
}) {
  const container = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(() =>
    Object.fromEntries(HAZARD_LAYERS.map((l) => [l.id, l.defaultOn && !hidden.includes(l.id)]))
  );

  /* ── Init ───────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (map.current || !container.current) return;
    ensureProtocol();

    const ink = token("--color-ink", "#101725");
    const panic = token("--color-panic", "#E2231A");

    map.current = new MapLibreMap({
      container: container.current,
      style: {
        version: 8,
        // Rendered text is not used, so no glyph server is needed — one less
        // network dependency and one less thing to pay for.
        sources: {
          basemap: {
            type: "raster",
            tiles: ["https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors, © CARTO",
          },
          hazards: { type: "vector", url: PMTILES_URL },
        },
        layers: [
          { id: "basemap", type: "raster", source: "basemap" },

          /* Flood, drawn first so volcanic hazards sit above it. Colour by
             depth class rather than one flat fill: "over 1.5 m" and "ankle
             deep" are different decisions. */
          {
            id: "flood",
            type: "fill",
            source: "hazards",
            "source-layer": "legazpi_flood",
            filter: ["==", ["get", "return_period_years"], 5],
            paint: {
              "fill-color": [
                "match", ["get", "depth_class"],
                1, "#7FB3D5",
                2, "#3F7EA6",
                3, "#1F4E79",
                "#7FB3D5",
              ],
              "fill-opacity": 0.42,
            },
          },

          /* Lahar and pyroclastic paths. */
          {
            id: "volcanic_paths",
            type: "fill",
            source: "hazards",
            "source-layer": "mayon_volcanic",
            filter: ["in", ["get", "layer"], ["literal", ["lahar", "pyroclastic", "lava"]]],
            paint: {
              "fill-color": [
                "match", ["get", "layer"],
                "pyroclastic", "#B4460F",
                "lahar", "#8A5300",
                "lava", "#74110C",
                "#8A5300",
              ],
              "fill-opacity": 0.38,
            },
          },

          /* The danger zones read as boundaries, not areas — an outline you can
             see which side of, rather than a wash that hides the town under it.
             The PDZ gets the panic vermilion; it is the one place on a map
             where that colour is not a reservation violation, because being
             inside it IS the emergency. */
          {
            id: "danger_zones_fill",
            type: "fill",
            source: "hazards",
            "source-layer": "mayon_volcanic",
            filter: ["==", ["get", "layer"], "danger_zone"],
            paint: {
              "fill-color": ["match", ["get", "zone_id"], "pdz", panic, "#C77700"],
              "fill-opacity": 0.1,
            },
          },
          {
            id: "danger_zones",
            type: "line",
            source: "hazards",
            "source-layer": "mayon_volcanic",
            filter: ["==", ["get", "layer"], "danger_zone"],
            paint: {
              "line-color": ["match", ["get", "zone_id"], "pdz", panic, "#C77700"],
              "line-width": ["match", ["get", "zone_id"], "pdz", 2.5, 1.75],
              "line-dasharray": ["match", ["get", "zone_id"], "pdz", ["literal", [1]], ["literal", [3, 2]]],
            },
          },

          /* Rain, as graduated circles. Radius carries 24-hour total because
             that is what fills a lahar channel; the hour figure is in the
             popup. */
          {
            id: "rain",
            type: "circle",
            source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            paint: {
              "circle-radius": [
                "interpolate", ["linear"], ["get", "mm24"],
                0, 6, 25, 12, 100, 26,
              ],
              "circle-color": [
                "interpolate", ["linear"], ["get", "mm24"],
                0, "#CFE3F2", 25, "#3F7EA6", 100, "#1F4E79",
              ],
              "circle-opacity": 0.75,
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#FFFFFF",
            },
          },
        ],
      },
      center,
      zoom,
      attributionControl: false,
      // The map is a reference surface, not a 3D toy. Rotation and pitch make a
      // hazard boundary harder to read against a street, so they are off.
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: true,
    });

    map.current.touchZoomRotate.disableRotation();
    map.current.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.current.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: "Data: PHIVOLCS, LiPAD (UP Diliman), Open-Meteo",
      }),
      "bottom-right"
    );

    map.current.on("load", () => setReady(true));

    // A rain circle is the one thing on this map with detail worth a tap.
    map.current.on("click", "rain", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      new Popup({ closeButton: false, offset: 12 })
        .setLngLat(f.geometry.coordinates)
        .setHTML(
          `<div style="font:600 12px/1.4 system-ui;color:${ink}">${f.properties.label}` +
          `<div style="font-weight:400;color:#4E596E">${f.properties.mm1} mm last hour<br>` +
          `${f.properties.mm24} mm in 24 h</div></div>`
        )
        .addTo(map.current);
    });
    map.current.on("mouseenter", "rain", () => { map.current.getCanvas().style.cursor = "pointer"; });
    map.current.on("mouseleave", "rain", () => { map.current.getCanvas().style.cursor = ""; });

    return () => {
      map.current?.remove();
      map.current = null;
    };
    // Deliberately mount-only: re-running this would tear down and rebuild the
    // map on every prop change. Centre and zoom updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Picking ────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!map.current || !onPick) return;
    const handler = (e) => onPick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    map.current.on("click", handler);
    map.current.getCanvas().style.cursor = "crosshair";
    return () => {
      map.current?.off("click", handler);
      if (map.current) map.current.getCanvas().style.cursor = "";
    };
  }, [onPick]);

  /* ── Layer visibility ───────────────────────────────────────────────────── */

  useEffect(() => {
    if (!ready || !map.current) return;
    const set = (layerId, on) => {
      if (map.current.getLayer(layerId)) {
        map.current.setLayoutProperty(layerId, "visibility", on ? "visible" : "none");
      }
    };
    const on = (id) => active[id] && !hidden.includes(id);

    set("flood", on("flood"));
    set("volcanic_paths", on("volcanic_paths"));
    set("danger_zones", on("danger_zones"));
    set("danger_zones_fill", on("danger_zones"));
    set("rain", on("rain"));

    for (const marker of markers.current) {
      marker.getElement().style.display = on("reports") ? "" : "none";
    }
  }, [active, hidden, ready, reports]);

  /* ── Rainfall data ──────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource("rain");
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: rainfall.map((r) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        properties: {
          label: r.station_label,
          mm1: Number(r.precip_1h_mm ?? 0),
          mm24: Number(r.precip_24h_mm ?? 0),
        },
      })),
    });
  }, [rainfall, ready]);

  /* ── Report pins ────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!ready || !map.current) return;

    for (const marker of markers.current) marker.remove();
    markers.current = [];

    for (const report of reports) {
      if (typeof report.lat !== "number" || typeof report.lng !== "number") continue;

      const el = document.createElement("div");
      el.style.cssText =
        `width:${report.priority === "high" ? 18 : 14}px;` +
        `height:${report.priority === "high" ? 18 : 14}px;` +
        `background:${report.color ?? token("--color-brand", "#1B2E6B")};` +
        "border:2px solid #fff;box-shadow:0 1px 4px rgba(16,23,37,.45);cursor:pointer;" +
        // High-priority reports are round; everything else is square. Shape, not
        // just colour, so the distinction survives a colourblind viewer and a
        // sunlit screen.
        (report.priority === "high" ? "border-radius:50%;" : "");

      const marker = new Marker({ element: el })
        .setLngLat([report.lng, report.lat])
        .addTo(map.current);

      if (report.onSelect) el.addEventListener("click", () => report.onSelect(report));
      markers.current.push(marker);
    }
  }, [reports, ready]);

  /* ── Picked pin ─────────────────────────────────────────────────────────── */

  const pickedMarker = useRef(null);
  useEffect(() => {
    if (!ready || !map.current) return;
    pickedMarker.current?.remove();
    pickedMarker.current = null;
    if (!picked) return;

    const el = document.createElement("div");
    el.style.cssText =
      "width:20px;height:20px;background:var(--color-brand,#1B2E6B);" +
      "border:3px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(16,23,37,.5)";
    pickedMarker.current = new Marker({ element: el })
      .setLngLat([picked.lng, picked.lat])
      .addTo(map.current);
  }, [picked, ready]);

  /* ── Recentre ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.easeTo({ center, zoom, duration: 500 });
    // center is a new array each render; comparing by value avoids a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1], zoom, ready]);

  const toggle = useCallback((id) => {
    setActive((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const visibleToggles = HAZARD_LAYERS.filter((l) => !hidden.includes(l.id));

  return (
    <div className={`relative ${className}`} style={style}>
      <div ref={container} className="h-full w-full" />

      {showToggles && visibleToggles.length > 0 && (
        <div className="absolute left-2.5 top-2.5 z-10 border border-line bg-surface/95 p-2 backdrop-blur">
          <span className="t-label block px-1 pb-1.5 text-ink-faint">Layers</span>
          <div className="flex flex-col gap-0.5">
            {visibleToggles.map((layer) => (
              <label
                key={layer.id}
                className="t-body-sm flex cursor-pointer items-center gap-2 px-1 py-1"
              >
                <input
                  type="checkbox"
                  checked={Boolean(active[layer.id])}
                  onChange={() => toggle(layer.id)}
                  className="h-3.5 w-3.5 accent-brand"
                />
                {layer.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {children}
    </div>
  );
}

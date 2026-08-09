import { useEffect, useRef, useState, useCallback } from "react";
import { Map as MapLibreMap, Marker, Popup, addProtocol } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { Layers, X, Plus, Minus, Footprints, Loader2, Navigation } from "lucide-react";
import { LEGAZPI_CENTER, getEvacuationRoute } from "@saro/shared";
import "maplibre-gl/dist/maplibre-gl.css";

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
  { id: "accident_prone", label: "Accident-Prone Areas", defaultOn: true },
  { id: "evacuation_centers", label: "Evacuation Centers", defaultOn: true },
  { id: "reports", label: "Citizen reports", defaultOn: true },
];

const PMTILES_URL = "pmtiles:///hazard/legazpi-hazards.pmtiles";

// Mayon Summit Coordinates: [123.6858, 13.2568]
const MAYON_SUMMIT = [123.6858, 13.2568];

function createCirclePolygon(centerLng, centerLat, radiusKm, points = 64) {
  const coords = [];
  const kmInDegreesLat = 1 / 111.32;
  const kmInDegreesLng = 1 / (111.32 * Math.cos((centerLat * Math.PI) / 180));

  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const lng = centerLng + radiusKm * kmInDegreesLng * Math.cos(theta);
    const lat = centerLat + radiusKm * kmInDegreesLat * Math.sin(theta);
    coords.push([lng, lat]);
  }
  return [coords];
}

// Automated coordinate geofence check
export function checkInDangerZone(lat, lng) {
  const numLat = typeof lat === "string" ? parseFloat(lat) : Number(lat);
  const numLng = typeof lng === "string" ? parseFloat(lng) : Number(lng);
  if (isNaN(numLat) || isNaN(numLng)) return { inZone: false, zone: null };

  const dLat = (numLat - MAYON_SUMMIT[1]) * 111.32;
  const dLng = (numLng - MAYON_SUMMIT[0]) * 111.32 * Math.cos((MAYON_SUMMIT[1] * Math.PI) / 180);
  const distKm = Math.sqrt(dLat * dLat + dLng * dLng);

  if (distKm <= 6.0) return { inZone: true, zone: "PDZ", priority: "high", label: "Inside PHIVOLCS 6km Permanent Danger Zone" };
  if (distKm <= 7.5) return { inZone: true, zone: "EDZ", priority: "high", label: "Inside 7.5km Extended Danger Zone" };
  return { inZone: false, zone: null, priority: "normal", label: "Outside active danger zone" };
}

// GeoJSON Overlays for 100% Guaranteed Rendering
const FALLBACK_DANGER_ZONES = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { zone_id: "pdz", name: "Mayon 6km Permanent Danger Zone (PHIVOLCS)" },
      geometry: { type: "Polygon", coordinates: createCirclePolygon(MAYON_SUMMIT[0], MAYON_SUMMIT[1], 6.0) },
    },
    {
      type: "Feature",
      properties: { zone_id: "edz", name: "Mayon 7.5km Extended Danger Zone" },
      geometry: { type: "Polygon", coordinates: createCirclePolygon(MAYON_SUMMIT[0], MAYON_SUMMIT[1], 7.5) },
    },
  ],
};

const FALLBACK_VOLCANIC_PATHS = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { layer: "lahar", name: "Bonga & Miisi Lahar Channels" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [123.6858, 13.2568], [123.7100, 13.2100], [123.7350, 13.1700],
          [123.7500, 13.1500], [123.7300, 13.1500], [123.7000, 13.2000], [123.6858, 13.2568]
        ]],
      },
    },
    {
      type: "Feature",
      properties: { layer: "pyroclastic", name: "Buyuan Pyroclastic Flow Corridor" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [123.6858, 13.2568], [123.7400, 13.2300], [123.7700, 13.1900],
          [123.7500, 13.1900], [123.7200, 13.2200], [123.6858, 13.2568]
        ]],
      },
    },
  ],
};

const FALLBACK_FLOOD_ZONES = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { depth_class: 3, name: "Macabalo Coastal & River Basin Flood Corridor" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [123.7430, 13.1365], [123.7490, 13.1350], [123.7555, 13.1360],
          [123.7610, 13.1395], [123.7595, 13.1430], [123.7535, 13.1415],
          [123.7475, 13.1395], [123.7430, 13.1385], [123.7430, 13.1365]
        ]],
      },
    },
    {
      type: "Feature",
      properties: { depth_class: 2, name: "Bitano Creek Drainage Inundation Zone" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [123.7390, 13.1445], [123.7445, 13.1420], [123.7510, 13.1435],
          [123.7520, 13.1470], [123.7475, 13.1480], [123.7410, 13.1465],
          [123.7390, 13.1445]
        ]],
      },
    },
  ],
};

const DEFAULT_ACCIDENT_BLACKSPOTS = [
  { id: "bs-1", name: "Yawa Bridge Intersection Blackspot", location_label: "Yawa Bridge, Rawis Highway", lat: 13.1550, lng: 123.7480, incident_count: 14, severity: "critical", radius_km: 0.38, last_reported: "2 hours ago" },
  { id: "bs-2", name: "Legazpi Port-Tahao Road Curve", location_label: "Tahao Road, Barangay 15", lat: 13.1385, lng: 123.7410, incident_count: 9, severity: "high", radius_km: 0.28, last_reported: "1 day ago" },
  { id: "bs-3", name: "Washington Drive Junction", location_label: "Washington Drive, Bitano", lat: 13.1460, lng: 123.7380, incident_count: 6, severity: "moderate", radius_km: 0.20, last_reported: "3 days ago" },
];

function createAccidentBufferGeoJSON(blackspots = DEFAULT_ACCIDENT_BLACKSPOTS) {
  const spots = blackspots && blackspots.length > 0 ? blackspots : DEFAULT_ACCIDENT_BLACKSPOTS;
  return {
    type: "FeatureCollection",
    features: spots.map((spot) => {
      const lat = Number(spot.lat);
      const lng = Number(spot.lng);
      const count = Number(spot.incident_count || 1);
      const radiusKm = spot.radius_km || Math.min(0.42, Math.max(0.18, 0.14 + count * 0.018));
      const severity = spot.severity || (count >= 10 ? "critical" : count >= 7 ? "high" : "moderate");
      return {
        type: "Feature",
        properties: {
          id: spot.id,
          name: spot.name,
          incident_count: count,
          severity,
        },
        geometry: {
          type: "Polygon",
          coordinates: createCirclePolygon(lng, lat, radiusKm),
        },
      };
    }),
  };
}

const DEFAULT_EVACUATION_CENTERS = [
  { id: "ec-1", name: "Legazpi City Evacuation Center (Ibalong Center)", address: "Bitano, Legazpi City", lat: 13.1425, lng: 123.7485, capacity: 800, current_occupancy: 0, status: "Ready", notes: "Primary multi-purpose disaster shelter" },
  { id: "ec-2", name: "Rawis Multi-Purpose Evacuation Center", address: "Barangay Rawis, Legazpi City", lat: 13.1610, lng: 123.7540, capacity: 500, current_occupancy: 0, status: "Ready", notes: "Barangay disaster resilience hall" },
  { id: "ec-3", name: "Banquerohan Disaster Operations Center", address: "Banquerohan, Legazpi City", lat: 13.1180, lng: 123.7220, capacity: 650, current_occupancy: 0, status: "Ready", notes: "High-ground shelter for Mayon evacuees" },
  { id: "ec-4", name: "Tapo-Tapo Elementary Shelter", address: "Barangay Tapo-Tapo, Legazpi City", lat: 13.1350, lng: 123.7150, capacity: 350, current_occupancy: 0, status: "Ready", notes: "Secondary designated evacuation site" },
];

const DEFAULT_RAINFALL_STATIONS = [
  { station_label: "Legazpi City Center Station", lat: 13.1391, lng: 123.7438, precip_1h_mm: 14.2, precip_24h_mm: 48.5 },
  { station_label: "Mayon Resthouse Observatory", lat: 13.2100, lng: 123.6900, precip_1h_mm: 22.0, precip_24h_mm: 85.0 },
  { station_label: "Rawis Telemetry Post", lat: 13.1620, lng: 123.7520, precip_1h_mm: 9.5, precip_24h_mm: 32.0 },
  { station_label: "Camalig DRRM Station", lat: 13.1700, lng: 123.6300, precip_1h_mm: 18.0, precip_24h_mm: 64.0 },
];

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
  evacuationCenters = [],
  accidentBlackspots = [],
  onPick,
  onSelectLocation,
  picked,
  hidden = [],
  showToggles = true,
  className = "",
  style,
  children,
}) {
  const container = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const evacuationMarkers = useRef([]);
  const accidentMarkers = useRef([]);
  const popoverRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [placementVersion, setPlacementVersion] = useState(0);
  const [togglesOpen, setTogglesOpen] = useState(false);
  const [active, setActive] = useState(() =>
    Object.fromEntries(HAZARD_LAYERS.map((l) => [l.id, l.defaultOn]))
  );

  const [activeRoute, setActiveRoute] = useState(null);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [routingError, setRoutingError] = useState("");

  const startEvacuationNavigation = useCallback(async (center) => {
    setRoutingLoading(true);
    setRoutingError("");

    const destLat = Number(center.lat);
    const destLng = Number(center.lng);

    const proceedWithCoords = async (startLat, startLng) => {
      const res = await getEvacuationRoute(startLng, startLat, destLng, destLat);
      setRoutingLoading(false);

      if (res.error || !res.data) {
        setRoutingError(res.error || "Route unavailable.");
        return;
      }

      setActiveRoute({
        centerName: center.name,
        startCoords: [startLng, startLat],
        destCoords: [destLng, destLat],
        ...res.data,
      });
    };

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => proceedWithCoords(pos.coords.latitude, pos.coords.longitude),
        () => proceedWithCoords(LEGAZPI_CENTER[0], LEGAZPI_CENTER[1]),
        { timeout: 5000, enableHighAccuracy: true }
      );
    } else {
      proceedWithCoords(LEGAZPI_CENTER[0], LEGAZPI_CENTER[1]);
    }
  }, []);

  const clearRoute = useCallback(() => {
    setActiveRoute(null);
    setRoutingError("");
  }, []);

  /* ── Route Line Rendering on MapLibre Surface ───────────────────────────── */
  useEffect(() => {
    if (!ready || !map.current) return;

    if (map.current.getLayer("evac-route-line")) map.current.removeLayer("evac-route-line");
    if (map.current.getLayer("evac-route-casing")) map.current.removeLayer("evac-route-casing");
    if (map.current.getSource("evac-route-source")) map.current.removeSource("evac-route-source");

    if (!activeRoute || !activeRoute.geometry) return;

    map.current.addSource("evac-route-source", {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: activeRoute.geometry,
      },
    });

    map.current.addLayer({
      id: "evac-route-casing",
      type: "line",
      source: "evac-route-source",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 },
    });

    map.current.addLayer({
      id: "evac-route-line",
      type: "line",
      source: "evac-route-source",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#0284C7", "line-width": 5 },
    });

    const coords = activeRoute.coordinates || activeRoute.geometry?.coordinates;
    if (coords && coords.length > 0) {
      const bounds = coords.reduce(
        (acc, coord) => [
          [Math.min(acc[0][0], coord[0]), Math.min(acc[0][1], coord[1])],
          [Math.max(acc[1][0], coord[0]), Math.max(acc[1][1], coord[1])],
        ],
        [[coords[0][0], coords[0][1]], [coords[0][0], coords[0][1]]]
      );
      map.current.fitBounds(bounds, { padding: 60, maxZoom: 16 });
    }
  }, [activeRoute, ready]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setTogglesOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
        sources: {
          basemap: {
            type: "raster",
            tiles: ["https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"],
            tileSize: 256,
          },
          hazards: { type: "vector", url: PMTILES_URL },
          fallback_danger: { type: "geojson", data: FALLBACK_DANGER_ZONES },
          fallback_volcanic: { type: "geojson", data: FALLBACK_VOLCANIC_PATHS },
          fallback_flood: { type: "geojson", data: FALLBACK_FLOOD_ZONES },
          fallback_accident_buffers: { type: "geojson", data: createAccidentBufferGeoJSON(accidentBlackspots) },
          rain: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          { id: "basemap", type: "raster", source: "basemap" },

          /* Flood extent uses light, low-opacity fills & thin border stroke. */
          {
            id: "flood_soft",
            type: "fill",
            source: "fallback_flood",
            paint: {
              "fill-color": "#2563EB",
              "fill-opacity": 0.025,
            },
          },
          {
            id: "flood",
            type: "fill",
            source: "fallback_flood",
            paint: {
              "fill-color": [
                "match", ["get", "depth_class"],
                3, "#1D4ED8",
                2, "#3B82F6",
                "#60A5FA",
              ],
              "fill-opacity": [
                "match", ["get", "depth_class"],
                3, 0.11,
                2, 0.07,
                0.04,
              ],
            },
          },
          {
            id: "flood_outline",
            type: "line",
            source: "fallback_flood",
            paint: {
              "line-color": "#2563EB",
              "line-width": 1.0,
              "line-opacity": 0.45,
            },
          },

          /* Accident-Prone Area Circular Buffer Zones */
          {
            id: "accident_buffers_fill",
            type: "fill",
            source: "fallback_accident_buffers",
            paint: {
              "fill-color": [
                "match", ["get", "severity"],
                "critical", "#E11D48",
                "high", "#F43F5E",
                "#FB7185",
              ],
              "fill-opacity": [
                "match", ["get", "severity"],
                "critical", 0.16,
                "high", 0.12,
                0.08,
              ],
            },
          },
          {
            id: "accident_buffers_outline",
            type: "line",
            source: "fallback_accident_buffers",
            paint: {
              "line-color": [
                "match", ["get", "severity"],
                "critical", "#BE123C",
                "high", "#E11D48",
                "#F43F5E",
              ],
              "line-width": [
                "match", ["get", "severity"],
                "critical", 1.6,
                "high", 1.3,
                1.0,
              ],
              "line-dasharray": [3, 2],
              "line-opacity": 0.85,
            },
          },

          /* Volcanic corridors read as bounded paths, not solid wedges. */
          {
            id: "volcanic_paths_soft",
            type: "fill",
            source: "fallback_volcanic",
            paint: {
              "fill-color": "#A55B2A",
              "fill-opacity": 0.045,
            },
          },
          {
            id: "volcanic_paths",
            type: "fill",
            source: "fallback_volcanic",
            paint: {
              "fill-color": [
                "match", ["get", "layer"],
                "pyroclastic", "#B4460F",
                "#8A5300",
              ],
              "fill-opacity": 0.13,
            },
          },
          {
            id: "volcanic_paths_outline",
            type: "line",
            source: "fallback_volcanic",
            paint: {
              "line-color": "#995026",
              "line-width": 1.25,
              "line-opacity": 0.72,
            },
          },

          /* Mayon zones use a feathered low-opacity boundary treatment. */
          {
            id: "danger_zones_soft",
            type: "fill",
            source: "fallback_danger",
            paint: {
              "fill-color": ["match", ["get", "zone_id"], "pdz", panic, "#C77700"],
              "fill-opacity": 0.035,
            },
          },
          {
            id: "danger_zones_fill",
            type: "fill",
            source: "fallback_danger",
            paint: {
              "fill-color": ["match", ["get", "zone_id"], "pdz", panic, "#C77700"],
              "fill-opacity": 0.075,
            },
          },
          {
            id: "danger_zones",
            type: "line",
            source: "fallback_danger",
            paint: {
              "line-color": ["match", ["get", "zone_id"], "pdz", panic, "#C77700"],
              "line-width": ["match", ["get", "zone_id"], "pdz", 1.8, 1.25],
              "line-opacity": 0.8,
            },
          },

          /* Live Rainfall Circles */
          {
            id: "rain",
            type: "circle",
            source: "rain",
            paint: {
              "circle-radius": [
                "interpolate", ["linear"], ["get", "mm24"],
                0, 7, 25, 14, 100, 28,
              ],
              "circle-color": [
                "interpolate", ["linear"], ["get", "mm24"],
                0, "#CFE3F2", 25, "#3F7EA6", 100, "#1F4E79",
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#FFFFFF",
            },
          },
        ],
      },
      center,
      zoom,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: true,
    });

    map.current.touchZoomRotate.disableRotation();

    if (map.current.loaded() || map.current.isStyleLoaded()) {
      setReady(true);
    } else {
      map.current.on("load", () => setReady(true));
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    const refreshPlacement = () => setPlacementVersion((value) => value + 1);
    map.current.on("zoomend", refreshPlacement);
    return () => map.current?.off("zoomend", refreshPlacement);
  }, [ready]);

  /* ── Picking ────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const handlePick = onPick || onSelectLocation;
    if (!map.current || !handlePick) return;
    const handler = (e) => handlePick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    map.current.on("click", handler);
    map.current.getCanvas().style.cursor = "crosshair";
    return () => {
      map.current?.off("click", handler);
      if (map.current) map.current.getCanvas().style.cursor = "";
    };
  }, [onPick, onSelectLocation]);

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
    set("flood_soft", on("flood"));
    set("flood_outline", on("flood"));
    set("accident_buffers_fill", on("accident_prone"));
    set("accident_buffers_outline", on("accident_prone"));
    set("volcanic_paths", on("volcanic_paths"));
    set("volcanic_paths_soft", on("volcanic_paths"));
    set("volcanic_paths_outline", on("volcanic_paths"));
    set("danger_zones", on("danger_zones"));
    set("danger_zones_fill", on("danger_zones"));
    set("danger_zones_soft", on("danger_zones"));
    set("rain", on("rain"));

    for (const marker of markers.current) {
      marker.getElement().style.display = on("reports") ? "flex" : "none";
    }
    for (const marker of evacuationMarkers.current) {
      marker.getElement().style.display = on("evacuation_centers") ? "flex" : "none";
    }
    for (const marker of accidentMarkers.current) {
      marker.getElement().style.display = on("accident_prone") ? "flex" : "none";
    }
  }, [active, hidden, ready, reports]);

  /* ── Evacuation Center Markers ─────────────────────────────────────────── */

  const _legacyEvacuationMarkers = useRef([]);
  useEffect(() => {
    if (!ready || !map.current) return;
    if (placementVersion >= 0) return;
    /* Legacy independent marker renderer retained only for historical reference.

    for (const m of evacuationMarkers.current) m.remove();
    evacuationMarkers.current = [];

    const centers = evacuationCenters && evacuationCenters.length > 0 ? evacuationCenters : DEFAULT_EVACUATION_CENTERS;
    const isVisible = active.evacuation_centers && !hidden.includes("evacuation_centers");

    for (const center of centers) {
      const lat = typeof center.lat === "string" ? parseFloat(center.lat) : Number(center.lat);
      const lng = typeof center.lng === "string" ? parseFloat(center.lng) : Number(center.lng);
      if (isNaN(lat) || isNaN(lng) || !lat || !lng) continue;

      const el = document.createElement("div");
      el.className = "saro-evacuation-marker";
      el.style.cssText =
        "background:#059669;color:#ffffff;padding:4px 8px;border-radius:12px;" +
        "font-size:11px;font-weight:800;font-family:system-ui,-apple-system,sans-serif;" +
        "border:2px solid #ffffff;box-shadow:0 2px 6px rgba(5,150,105,0.4);" +
        `display:${isVisible ? "flex" : "none"};align-items:center;gap:4px;cursor:pointer;`;

      el.innerHTML = `<span style="font-size:12px">🏠</span> <span>${center.name?.split(" ")[0] || "Shelter"}</span>`;

      const popup = new Popup({ offset: 12, closeButton: true }).setHTML(
        `<div style="font-family:system-ui,-apple-system,sans-serif;padding:2px">` +
        `<div style="font-weight:700;font-size:13px;color:#059669">${center.name}</div>` +
        `<div style="font-size:11px;color:#101725;margin-top:2px">${center.address}</div>` +
        `<div style="font-size:11px;color:#4E596E;margin-top:4px">Capacity: <strong style="color:#101725">${center.capacity || 500} persons</strong> · Status: <strong style="color:#059669">${center.status || "Ready"}</strong></div>` +
        `${center.notes ? `<div style="font-size:10px;color:#64748B;margin-top:4px;font-style:italic">${center.notes}</div>` : ""}` +
        `</div>`
      );

      const marker = new Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(map.current);

      evacuationMarkers.current.push(marker);
    }
    */
  }, [evacuationCenters, ready, active, hidden, placementVersion]);

  /* ── Accident Blackspot Buffer Zones ────────────────────────────────────── */

  const _legacyAccidentMarkers = useRef([]);
  useEffect(() => {
    if (!ready || !map.current) return;
    if (placementVersion >= 0) return;
    /* Legacy independent marker renderer retained only for historical reference.

    for (const m of accidentMarkers.current) m.remove();
    accidentMarkers.current = [];

    const blackspots = accidentBlackspots && accidentBlackspots.length > 0 ? accidentBlackspots : DEFAULT_ACCIDENT_BLACKSPOTS;
    const isVisible = active.accident_prone && !hidden.includes("accident_prone");

    for (const spot of blackspots) {
      const lat = typeof spot.lat === "string" ? parseFloat(spot.lat) : Number(spot.lat);
      const lng = typeof spot.lng === "string" ? parseFloat(spot.lng) : Number(spot.lng);
      if (isNaN(lat) || isNaN(lng) || !lat || !lng) continue;

      const severity = spot.severity || "high";
      const count = spot.incident_count || 5;

      const el = document.createElement("div");
      el.className = "saro-blackspot-marker";
      el.style.cssText =
        "background:rgba(217, 119, 6, 0.25);" +
        "border:2px dashed #D97706;" +
        "border-radius:50%;" +
        "width:44px;height:44px;" +
        "box-shadow:0 0 12px rgba(217, 119, 6, 0.4);" +
        `display:${isVisible ? "flex" : "none"};align-items:center;justify-content:center;cursor:pointer;`;

      const innerDot = document.createElement("span");
      innerDot.style.cssText =
        "background:#D97706;color:#ffffff;font-size:10px;font-weight:900;" +
        "width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;" +
        "border:1.5px solid #ffffff;";
      innerDot.textContent = String(count);
      el.appendChild(innerDot);


    for (const m of accidentMarkers.current) m.remove();
    accidentMarkers.current = [];

    const blackspots = accidentBlackspots && accidentBlackspots.length > 0 ? accidentBlackspots : DEFAULT_ACCIDENT_BLACKSPOTS;
    const isVisible = active.accident_prone && !hidden.includes("accident_prone");

    for (const spot of blackspots) {
      const lat = typeof spot.lat === "string" ? parseFloat(spot.lat) : Number(spot.lat);
      const lng = typeof spot.lng === "string" ? parseFloat(spot.lng) : Number(spot.lng);
      if (isNaN(lat) || isNaN(lng) || !lat || !lng) continue;

      const severity = spot.severity || "high";
      const count = spot.incident_count || 5;

      const el = document.createElement("div");
      el.className = "saro-blackspot-marker";
      el.style.cssText =
        "background:rgba(217, 119, 6, 0.25);" +
        "border:2px dashed #D97706;" +
        "border-radius:50%;" +
        "width:44px;height:44px;" +
        "box-shadow:0 0 12px rgba(217, 119, 6, 0.4);" +
        `display:${isVisible ? "flex" : "none"};align-items:center;justify-content:center;cursor:pointer;`;

      const innerDot = document.createElement("span");
      innerDot.style.cssText =
        "background:#D97706;color:#ffffff;font-size:10px;font-weight:900;" +
        "width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;" +
        "border:1.5px solid #ffffff;";
      innerDot.textContent = String(count);
      el.appendChild(innerDot);

      const popup = new Popup({ offset: 12, closeButton: true }).setHTML(
        `<div style="font-family:system-ui,-apple-system,sans-serif;padding:2px">` +
        `<div style="font-weight:700;font-size:13px;color:#D97706">${spot.name}</div>` +
        `<div style="font-size:11px;color:#101725;margin-top:2px">${spot.location_label || "Blackspot Zone"}</div>` +
        `<div style="font-size:11px;color:#B45309;font-weight:700;margin-top:4px">⚠️ ${severity.toUpperCase()} ACCIDENT BLACKSPOT</div>` +
        `<div style="font-size:11px;color:#4E596E;margin-top:2px">${count} reported incidents · Last reported ${spot.last_reported || "recently"}</div>` +
        `</div>`
      );

      const marker = new Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(map.current);

      accidentMarkers.current.push(marker);
    }
    */
  }, [accidentBlackspots, ready, active, hidden, placementVersion]);

  /* ── Rainfall telemetry data ────────────────────────────────────────────── */

  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource("rain");
    if (!source) return;

    const dataPoints = rainfall && rainfall.length > 0 ? rainfall : DEFAULT_RAINFALL_STATIONS;

    source.setData({
      type: "FeatureCollection",
      features: dataPoints.map((r) => ({
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

  /* ── Report pins (True Ground-Bound Map Markers) ────────────────────────── */

  useEffect(() => {
    if (!ready || !map.current) return;

    for (const marker of markers.current) marker.remove();
    for (const marker of evacuationMarkers.current) marker.remove();
    for (const marker of accidentMarkers.current) marker.remove();
    markers.current = [];
    evacuationMarkers.current = [];
    accidentMarkers.current = [];

    const reportsVisible = active.reports && !hidden.includes("reports");
    const centersVisible = active.evacuation_centers && !hidden.includes("evacuation_centers");
    const blackspotsVisible = active.accident_prone && !hidden.includes("accident_prone");

    for (const report of reports) {
      const lat = typeof report.lat === "string" ? parseFloat(report.lat) : Number(report.lat);
      const lng = typeof report.lng === "string" ? parseFloat(report.lng) : Number(report.lng);
      if (isNaN(lat) || isNaN(lng) || !lat || !lng) continue;

      const count = report.count || report.clusterCount || 1;
      const isClustered = count > 1;
      const size = isClustered ? 26 : (report.priority === "high" ? 18 : 15);

      const el = document.createElement("div");
      el.className = "saro-map-pin";
      el.style.cssText =
        `width:${size}px;` +
        `height:${size}px;` +
        `background:${report.color ?? token("--color-brand", "#1B2E6B")};` +
        "border:2px solid #ffffff;" +
        "border-radius:50%;" +
        "box-shadow:0 2px 5px rgba(16,23,37,0.32);" +
        "cursor:pointer;" +
        `display:${reportsVisible ? "flex" : "none"};` +
        "align-items:center;justify-content:center;font:800 11px/1 system-ui,-apple-system,sans-serif;";

      if (isClustered) {
        el.textContent = String(count);
      }

      const marker = new Marker({
        element: el,
        anchor: "center",
      })
        .setLngLat([lng, lat])
        .addTo(map.current);

      if (report.title || report.categoryName || isClustered) {
        const catName = report.categoryName || "Incident Report";
        const brgy = report.barangayName || "Legazpi City";
        const timeStr = report.timeSinceStr || "";
        const statusLabel = (report.status || "received").toUpperCase();
        const headingText = isClustered
          ? `${count} Reports in this Area (${catName})`
          : catName;
        const summaryText = isClustered
          ? `Cluster Summary (${count} Reports): Multiple citizen reports submitted for ${catName} in ${brgy}. Active hazard area under monitoring.`
          : `Single incident report for ${catName} in ${brgy}.`;

        const reportId = String(report.id || `rep-${lat}-${lng}`).replace(/[^a-zA-Z0-9_-]/g, "_");

        const popupHTML = `
          <div style="font-family:system-ui,-apple-system,sans-serif;padding:6px;width:300px;max-width:100%">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px">
              <span style="font-size:10px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:${report.color || '#0060A9'};background:rgba(0,96,169,0.08);padding:2.5px 7px;border-radius:4px;border:1px solid rgba(0,96,169,0.2)">
                ${statusLabel}
              </span>
              ${isClustered ? `<span style="font-size:10px;font-weight:900;letter-spacing:0.04em;text-transform:uppercase;color:#FFFFFF;background:#101725;padding:2.5px 7px;border-radius:4px">⚡ ${count} REPORTS IN CLUSTER</span>` : ''}
            </div>
            <div style="font-size:13px;font-weight:800;color:#101725;line-height:1.3;margin-bottom:4px">
              ${headingText}
            </div>
            <div style="font-size:11px;color:#64748B;margin-bottom:10px;display:flex;align-items:center;gap:4px">
              <span>📍 ${brgy}</span>
              ${timeStr ? `<span>· ${timeStr}</span>` : ''}
            </div>
            <div style="font-size:11px;color:#334155;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:8px;margin-bottom:10px;line-height:1.4">
              <div style="font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">Summarized Context</div>
              ${summaryText}
            </div>
            <button id="btn-report-${reportId}" style="width:100%;background:#1B2E6B;color:#FFFFFF;border:none;border-radius:6px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.15s ease">
              Report a Hazard in This Area
            </button>
          </div>
        `;

        const popup = new Popup({ offset: 16, closeButton: true, maxWidth: "340px" })
          .setHTML(popupHTML);

        popup.on("open", () => {
          const btn = document.getElementById(`btn-report-${reportId}`);
          if (btn) {
            btn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (report.onActionClick) {
                report.onActionClick();
              } else if (typeof window !== "undefined") {
                window.location.href = `/report?category=${encodeURIComponent(report.category || '')}`;
              }
            };
          }
        });

        marker.setPopup(popup);
      }

      if (report.onSelect) el.addEventListener("click", () => report.onSelect(report));
      markers.current.push(marker);
    }

    const blackspots = accidentBlackspots.length > 0 ? accidentBlackspots : DEFAULT_ACCIDENT_BLACKSPOTS;
    for (const spot of blackspots) {
      const lat = Number(spot.lat);
      const lng = Number(spot.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const el = document.createElement("div");
      el.className = "saro-blackspot-marker";
      el.title = `${spot.name}: accident-prone area`;
      el.textContent = "!";
      el.style.cssText =
        "width:24px;height:24px;background:#C66A16;color:#ffffff;border:2px solid #ffffff;" +
        "border-radius:7px;box-shadow:0 2px 5px rgba(76,43,15,0.28);cursor:pointer;" +
        `display:${blackspotsVisible ? "flex" : "none"};align-items:center;justify-content:center;` +
        "font:900 15px/1 system-ui,-apple-system,sans-serif;";

      const popup = new Popup({ offset: 14, closeButton: true }).setHTML(
        `<div style="font-family:system-ui,-apple-system,sans-serif;padding:2px">` +
        `<div style="font-weight:700;font-size:13px;color:#99520E">${spot.name}</div>` +
        `<div style="font-size:11px;color:#101725;margin-top:2px">${spot.location_label || "Accident-prone area"}</div>` +
        `<div style="font-size:11px;color:#4E596E;margin-top:4px">${spot.incident_count || 0} reported incidents. ${spot.last_reported || "Recently reported"}</div>` +
        `</div>`
      );

      const marker = new Marker({
        element: el,
        anchor: "center",
      }).setLngLat([lng, lat]).setPopup(popup).addTo(map.current);
      accidentMarkers.current.push(marker);
    }

    const centers = evacuationCenters.length > 0 ? evacuationCenters : DEFAULT_EVACUATION_CENTERS;
    for (let i = 0; i < centers.length; i++) {
      const center = centers[i];
      const lat = Number(center.lat);
      const lng = Number(center.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const el = document.createElement("div");
      el.className = "saro-evacuation-marker";
      el.title = `${center.name}: evacuation center`;
      el.style.cssText =
        "width:28px;height:28px;background:#087E6B;color:#ffffff;border:2px solid #ffffff;" +
        "border-radius:8px;box-shadow:0 2px 6px rgba(5,92,78,0.35);cursor:pointer;" +
        `display:${centersVisible ? "flex" : "none"};align-items:center;justify-content:center;`;
      el.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      `;

      const centerId = center.id || `ec-${lat}-${lng}`;
      const popup = new Popup({ offset: 14, closeButton: true }).setHTML(
        `<div style="font-family:system-ui,-apple-system,sans-serif;padding:4px;min-width:210px">` +
        `<div style="font-weight:700;font-size:13px;color:#087E6B;display:flex;align-items:center;gap:6px">` +
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#087E6B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>` +
        `<span>${center.name}</span></div>` +
        `<div style="font-size:11px;color:#101725;margin-top:3px">${center.address}</div>` +
        `<div style="font-size:11px;color:#4E596E;margin-top:4px">Capacity: <strong style="color:#101725">${center.capacity || 500}</strong> · Status: <strong style="color:#087E6B">${center.status || "Ready"}</strong></div>` +
        `${center.notes ? `<div style="font-size:10px;color:#64748B;margin-top:3px;font-style:italic">${center.notes}</div>` : ""}` +
        `<button id="btn-navigate-${centerId}" style="margin-top:8px;width:100%;background:#087E6B;color:#ffffff;border:none;border-radius:6px;padding:6px 10px;font-weight:700;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">` +
        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>` +
        `Get Directions (Walking)</button>` +
        `</div>`
      );

      popup.on("open", () => {
        const btn = document.getElementById(`btn-navigate-${centerId}`);
        if (btn) {
          btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            startEvacuationNavigation(center);
            popup.remove();
          };
        }
      });

      const marker = new Marker({
        element: el,
        anchor: "center",
      }).setLngLat([lng, lat]).setPopup(popup).addTo(map.current);
      evacuationMarkers.current.push(marker);
    }
  }, [reports, evacuationCenters, accidentBlackspots, ready, active, hidden, placementVersion, startEvacuationNavigation]);

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
    pickedMarker.current = new Marker({ element: el, anchor: "center" })
      .setLngLat([picked.lng, picked.lat])
      .addTo(map.current);
  }, [picked, ready]);

  /* ── Recentre ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.easeTo({ center, duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1], ready]);

  const toggle = useCallback((id) => {
    setActive((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const visibleToggles = HAZARD_LAYERS.filter((l) => !hidden.includes(l.id));

  const handleZoomIn = () => {
    map.current?.zoomIn();
  };

  const handleZoomOut = () => {
    map.current?.zoomOut();
  };

  return (
    <div className={`relative ${className}`} style={style}>
      <div ref={container} className="h-full w-full" />

      {/* Reusable Layers Dropdown Popover */}
      {showToggles && visibleToggles.length > 0 && (
        <div ref={popoverRef} className="absolute top-16 right-3 z-30">
          <button
            type="button"
            onClick={() => setTogglesOpen(!togglesOpen)}
            className="bg-white/95 backdrop-blur border border-line rounded-full p-2 shadow-xs hover:bg-white text-ink transition-all active:scale-95 flex items-center justify-center cursor-pointer"
            aria-label={togglesOpen ? "Close layers panel" : "Open layers panel"}
          >
            {togglesOpen ? <X className="w-4 h-4 text-ink" /> : <Layers className="w-4 h-4 text-brand" />}
          </button>

          {togglesOpen && (
            <div className="absolute top-11 right-0 z-30 bg-white/95 backdrop-blur border border-line rounded-md p-3 shadow-card min-w-[210px] max-h-[calc(100vh-140px)] overflow-y-auto animate-fade-in text-ink">
              <span className="t-label block px-1 pb-2 font-bold text-ink uppercase tracking-wider text-[10px] border-b border-line mb-1.5">
                Map Layers
              </span>
              <div className="flex flex-col gap-1">
                {visibleToggles.map((layer) => (
                  <label
                    key={layer.id}
                    className="t-body-sm flex cursor-pointer items-center gap-2 px-1 py-1 hover:bg-sunken rounded-xs transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(active[layer.id])}
                      onChange={() => toggle(layer.id)}
                      className="h-3.5 w-3.5 accent-brand"
                    />
                    <span className="text-xs font-medium text-ink">{layer.label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-2 border-t border-line pt-2">
                <span className="t-label block px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  Map key
                </span>
                <div className="space-y-1.5 px-1 text-[11px] text-ink-muted">
                  <div className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm border border-dashed border-[#E11D48] bg-[#E11D48]/20" /> Accident blackspot zone</div>
                  <div className="flex items-center gap-2"><span className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-white bg-[#C66A16] text-[10px] font-black text-white">!</span> Accident spot marker</div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-white bg-[#087E6B] text-white">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                    </span> Evacuation shelter
                  </div>
                  <div className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm border border-[#2563EB] bg-[#3B82F6]/15" /> Flood extent</div>
                  <div className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm border border-[#995026] bg-[#A55B2A]/15" /> Volcanic corridor</div>
                  <div className="flex items-center gap-2"><span className="h-0 w-5 border-t-2 border-alert" /> Mayon danger boundary</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dual Zoom Controls (+ and -) */}
      <div className="absolute bottom-4 right-3 z-30 flex flex-col rounded-md shadow-card border border-line bg-white/95 backdrop-blur overflow-hidden">
        <button
          type="button"
          onClick={handleZoomIn}
          className="p-2 hover:bg-sunken active:bg-line text-ink transition-colors border-b border-line flex items-center justify-center min-w-[36px] min-h-[36px]"
          aria-label="Zoom in"
        >
          <Plus className="w-4 h-4 text-ink font-bold" />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          className="p-2 hover:bg-sunken active:bg-line text-ink transition-colors flex items-center justify-center min-w-[36px] min-h-[36px]"
          aria-label="Zoom out"
        >
          <Minus className="w-4 h-4 text-ink font-bold" />
        </button>
      </div>

      {/* Floating Active Evacuation Route Summary Card */}
      {activeRoute && (
        <div className="absolute top-4 left-3 right-3 sm:left-auto sm:right-14 sm:w-80 z-30 bg-white/95 backdrop-blur border border-line p-3.5 rounded-sm shadow-lift flex flex-col gap-2 font-sans animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-teal-50 text-[#087E6B] border border-teal-200 flex items-center justify-center font-bold shrink-0 shadow-xs">
                <Footprints width={16} height={16} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="t-label font-bold text-ink block leading-snug truncate">{activeRoute.centerName}</span>
                <span className="t-body-sm text-[#087E6B] font-bold font-mono">
                  {activeRoute.distanceLabel} · {activeRoute.durationLabel}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={clearRoute}
              className="saro-btn saro-btn-ghost saro-btn-sm text-ink-muted hover:text-ink font-bold gap-1 cursor-pointer shrink-0 ml-2"
              aria-label="Clear navigation route"
            >
              <X width={14} height={14} /> Clear
            </button>
          </div>
        </div>
      )}

      {routingLoading && (
        <div className="absolute top-4 left-3 z-30 bg-white/95 backdrop-blur border border-line px-3.5 py-2 rounded-full shadow-card flex items-center gap-2 font-sans">
          <Loader2 width={14} height={14} className="animate-spin text-[#087E6B]" />
          <span className="t-body-sm text-ink font-medium">Calculating walking directions…</span>
        </div>
      )}

      {routingError && (
        <div className="absolute top-4 left-3 z-30 bg-rose-50 border border-rose-200 text-rose-800 px-3.5 py-2 rounded-md shadow-card flex items-center gap-2 text-xs font-medium font-sans">
          <span>{routingError}</span>
          <button type="button" onClick={() => setRoutingError("")} className="hover:opacity-75">
            <X width={12} height={12} />
          </button>
        </div>
      )}

      {children}
    </div>
  );
}

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Map as MapLibreMap, Marker, Popup, addProtocol } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { Layers, X, Plus, Minus, Footprints, Loader2 } from "lucide-react";
import {
  LEGAZPI_CENTER, getEvacuationRoute, evaluateAccidentArea,
  ACCIDENT_ROLLING_WINDOW_MONTHS,
} from "@saro/shared";
import { fetchRoadSegments, MIN_HALF_LENGTH_M } from "./roadSegments";
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

/* Report pin colours, named for the map key. These match the status palette the
   resident and staff maps pass in as `report.color`; the key exists to say what
   a colour means, so it has to be read from the same four values. */
const REPORT_STATUS_KEY = [
  { label: "Report received", color: "#94A3B8" },
  { label: "Assigned to an office", color: "#F59E0B" },
  { label: "Being worked on", color: "#0060A9" },
  { label: "Resolved", color: "#22C55E" },
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

/* The highlighted road must reach at least 50 m either side of the report. A
   little past that keeps the segment readable as a stretch of road rather than a
   dash sitting under the marker. */
const ACCIDENT_SEGMENT_HALF_LENGTH_M = Math.max(MIN_HALF_LENGTH_M, 70);

const DEFAULT_ACCIDENT_BLACKSPOTS = [
  { id: "bs-1", name: "Yawa Bridge Intersection Blackspot", location_label: "Yawa Bridge, Rawis Highway", lat: 13.1550, lng: 123.7480, incident_count: 14, severity: "critical", radius_km: 0.38, last_reported: "2 hours ago" },
  { id: "bs-2", name: "Legazpi Port-Tahao Road Curve", location_label: "Tahao Road, Barangay 15", lat: 13.1385, lng: 123.7410, incident_count: 9, severity: "high", radius_km: 0.28, last_reported: "1 day ago" },
  { id: "bs-3", name: "Washington Drive Junction", location_label: "Washington Drive, Bitano", lat: 13.1460, lng: 123.7380, incident_count: 6, severity: "moderate", radius_km: 0.20, last_reported: "3 days ago" },
];

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

function spotKey(spot) {
  return spot.id ?? `${spot.lat},${spot.lng}`;
}

function spotSeverity(spot) {
  const count = Number(spot.incident_count || 1);
  return spot.severity || (count >= 10 ? "critical" : count >= 7 ? "high" : "moderate");
}

/**
 * Circular buffers are now only the fallback shape. A spot whose road segment
 * resolved is drawn as that road instead, so it is excluded here — otherwise the
 * disc we set out to remove would sit underneath the highlighted carriageway.
 */
function createAccidentBufferGeoJSON(blackspots = [], resolvedKeys = null) {
  /* No defaulting to the built-in list: the caller has already filtered out
     locations that do not meet the recurrence threshold, and an empty list
     means "nothing qualifies" rather than "nothing supplied". */
  const spots = blackspots ?? [];
  return {
    type: "FeatureCollection",
    features: spots
      .filter((spot) => !resolvedKeys || !resolvedKeys.has(spotKey(spot)))
      .map((spot) => {
        const lat = Number(spot.lat);
        const lng = Number(spot.lng);
        const count = Number(spot.incident_count || 1);
        const radiusKm = spot.radius_km || Math.min(0.42, Math.max(0.18, 0.14 + count * 0.018));
        return {
          type: "Feature",
          properties: {
            id: spot.id,
            name: spot.name,
            incident_count: count,
            severity: spotSeverity(spot),
          },
          geometry: {
            type: "Polygon",
            coordinates: createCirclePolygon(lng, lat, radiusKm),
          },
        };
      }),
  };
}

/**
 * The accident-prone area as a stretch of road: the OSM carriageway the report
 * was filed on, clipped to at least MIN_HALF_LENGTH_M either side of the pin.
 */
function createAccidentRoadGeoJSON(blackspots, segmentsByKey) {
  if (!segmentsByKey || segmentsByKey.size === 0) return EMPTY_FEATURE_COLLECTION;
  const spots = blackspots ?? [];

  return {
    type: "FeatureCollection",
    features: spots.reduce((features, spot) => {
      const segment = segmentsByKey.get(spotKey(spot));
      if (!segment) return features;
      features.push({
        type: "Feature",
        properties: {
          id: spot.id,
          name: spot.name,
          road_name: segment.roadName,
          length_m: segment.lengthM,
          incident_count: Number(spot.incident_count || 1),
          severity: spotSeverity(spot),
        },
        geometry: { type: "LineString", coordinates: segment.coordinates },
      });
      return features;
    }, []),
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

function reportIconSvg(category) {
  const value = String(category || "").toLowerCase();
  if (value.includes("fire") || value.includes("gas")) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2.5c.6 3-1.8 4.3-.8 6.3.6 1.2 1.8 1.3 2.5.1.5 3.1 3.3 4.4 3.3 7.5A6.5 6.5 0 1 1 7.2 12c.2 2 1.5 2.8 2.7 2.6 1.8-.4 1.9-2.4 1.6-3.7 2 1.2 3.1 3.4 2.4 5.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  if (value.includes("flood") || value.includes("water") || value.includes("coastal") || value.includes("typhoon")) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8c2.2 0 2.2 1.5 4.5 1.5S9.8 8 12 8s2.2 1.5 4.5 1.5S18.8 8 21 8M3 13c2.2 0 2.2 1.5 4.5 1.5S9.8 13 12 13s2.2 1.5 4.5 1.5S18.8 13 21 13M3 18c2.2 0 2.2 1.5 4.5 1.5S9.8 18 12 18s2.2 1.5 4.5 1.5S18.8 18 21 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }
  if (value.includes("medical") || value.includes("accident")) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor"/></svg>';
  }
  if (value.includes("crime") || value.includes("order")) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 20 6v5c0 5.2-3.4 9.2-8 11-4.6-1.8-8-5.8-8-11V6l8-4Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="m9 12 2 2 4-4" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a7 7 0 0 0-7 7c0 5 7 11 7 11s7-6 7-11a7 7 0 0 0-7-7Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2" fill="currentColor"/></svg>';
}

/**
 * Every popup on this map opens upward from its marker and stays there.
 *
 * MapLibre's default is to choose an anchor from the space around the point and
 * to keep choosing while the map moves. On a phone, where a card is most of the
 * viewport, that recalculation flips the card from one side of the pin to the
 * other mid-pan — the popup appears to swim across the screen while the map is
 * being dragged. A fixed anchor costs nothing and holds the card still; what
 * keeps it on screen is `makeRoomForPopup` below, which is deliberate rather
 * than emergent.
 */
const POPUP_ANCHORING = { anchor: "bottom" };

/**
 * Park the marker low enough that a popup opening above it fits on screen.
 *
 * Called when a popup opens rather than on every frame: recentring is a
 * response to opening something, not something the reader fights while panning.
 */
function makeRoomForPopup(mapInstance, lngLat, { zoom } = {}) {
  if (!mapInstance || !lngLat) return;
  const height = mapInstance.getContainer()?.clientHeight ?? 0;
  const downshift = Math.min(150, Math.round(height * 0.2));
  mapInstance.easeTo({
    center: [lngLat.lng ?? lngLat[0], lngLat.lat ?? lngLat[1]],
    ...(zoom ? { zoom } : {}),
    offset: [0, downshift],
    duration: 450,
  });
}

/**
 * Fallback popup for report pins when the host passes no `renderReportPopup`.
 *
 * Report detail now lives in the pin popup and nowhere else — there is no
 * second panel beside the map to keep in sync — so a host that renders its own
 * card (see `renderReportPopup`) gets that card inside this popup instead.
 */
function createReportPopup(report) {
  const node = document.createElement("div");
  node.style.cssText = "font-family:var(--font-sans,system-ui,-apple-system,sans-serif);padding:6px;width:292px;max-width:100%";

  const add = (text, css) => {
    const item = document.createElement("div");
    item.textContent = text;
    item.style.cssText = css;
    node.appendChild(item);
  };

  add(String(report.status || "received").replaceAll("_", " "), "display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#334155;background:#F1F5F9;border:1px solid #CBD5E1;padding:3px 7px;margin-bottom:8px");
  add(report.tracking_code || report.trackingCode || report.code || "Tracking unavailable", "font:700 10px/1.4 var(--font-mono,monospace);color:#64748B;margin-bottom:4px");
  add(report.categoryName || report.category_label || report.category || "Hazard Report", "font-size:14px;font-weight:800;line-height:1.3;color:#101725;margin-bottom:7px;padding-right:18px");
  add(report.barangayName || report.barangay || "Legazpi City", "font-size:11px;color:#475569;margin-bottom:3px");
  add(report.timeSinceStr || (report.created_at ? new Date(report.created_at).toLocaleString("en-PH") : "Filed recently"), "font-size:11px;color:#64748B;margin-bottom:9px");
  add(report.description?.trim() || "Description not available for this pin.", "font-size:12px;line-height:1.45;color:#334155;background:#F8FAFC;border:1px solid #E2E8F0;padding:9px;margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden");

  const action = document.createElement("button");
  action.type = "button";
  action.textContent = "View Full Report";
  action.disabled = !report.onSelect;
  action.style.cssText = "width:100%;border:0;background:#1B2E6B;color:#fff;padding:9px 12px;font-size:11px;font-weight:800;cursor:pointer";
  action.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    report.onSelect?.(report);
  });
  node.appendChild(action);
  return node;
}

export default function HazardMap({
  center = [123.7438, 13.1391],
  zoom = 12,
  reports = [],
  rainfall = [],
  evacuationCenters = [],
  accidentBlackspots = [],
  selectedId = null,
  inspectedReport = null,
  onClearSelectedReport,
  /* Renders the contents of a report pin's popup. Given the pin's report and a
     `close` callback, it returns React content that is portalled into the
     MapLibre popup — so the pin popup is the single place report detail
     (including photo evidence) is displayed. */
  renderReportPopup,
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
  const activeLayerPopup = useRef(null);
  const popoverRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [placementVersion, setPlacementVersion] = useState(0);
  /* One popup, created once and moved between pins, rather than one popup per
     marker. Markers are torn down and rebuilt whenever the caller hands over a
     freshly built `reports` array — a popup owned by a marker dies with it, and
     the report being read would blink out from under the reader. This one is
     owned by the map and keyed only to the selection.

     Its content is React, portalled into `reportPopupHostRef`, so the popup is
     part of the component tree instead of a hand-built string of HTML. */
  const [reportPopup, setReportPopup] = useState(null);
  const [popupHost, setPopupHost] = useState(null);
  const [popupReport, setPopupReport] = useState(null);
  const closeReportPopup = useCallback(() => reportPopup?.remove(), [reportPopup]);
  const [togglesOpen, setTogglesOpen] = useState(false);
  const [panelTab, setPanelTab] = useState("layers"); // "layers" | "key"
  const [active, setActive] = useState(() =>
    Object.fromEntries(HAZARD_LAYERS.map((l) => [l.id, l.defaultOn]))
  );

  /* Read inside MapLibre event handlers, which outlive the render that created
     them — a ref keeps them looking at current values instead of stale props.
     Synced in effects, declared above the marker effect so the values are
     current by the time any handler can fire. */
  const renderReportPopupRef = useRef(renderReportPopup);
  const selectedIdRef = useRef(selectedId);
  const clearSelectedReportRef = useRef(onClearSelectedReport);
  /* True only while markers are being torn down and rebuilt. It separates "the
     reader closed this popup" from "the popup went away because the pins were
     redrawn" — without it, a background refresh would look like a dismissal. */
  const rebuildingMarkersRef = useRef(false);

  useEffect(() => {
    renderReportPopupRef.current = renderReportPopup;
  }, [renderReportPopup]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    clearSelectedReportRef.current = onClearSelectedReport;
  }, [onClearSelectedReport]);

  /* Callers commonly pass a literal like hidden={["rain"]}, which is a new array
     on every one of their renders. Keying on the contents keeps that from
     rebuilding every marker on the map for no reason. */
  const hiddenKey = hidden.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableHidden = useMemo(() => hidden, [hiddenKey]);

  const [activeRoute, setActiveRoute] = useState(null);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [routingError, setRoutingError] = useState("");

  /* null while the road lookup is still in flight, a Map once it has settled.
     An empty Map means "asked and got nothing" — every spot falls back to its
     circular buffer. */
  const [roadSegments, setRoadSegments] = useState(null);

  /* Only locations with a real recurrence record are drawn as accident-prone.
     Two thresholds apply together: how many incidents (MIN_INCIDENTS_FOR_
     ACCIDENT_AREA) and how recently (ACCIDENT_ROLLING_WINDOW_MONTHS). A junction
     that was bad three years ago and has been quiet since no longer qualifies,
     without a single row being deleted. The in-window count is carried onto the
     spot so the popup can report the number the decision was actually made on. */
  const activeBlackspots = useMemo(() => {
    const source = accidentBlackspots?.length > 0 ? accidentBlackspots : DEFAULT_ACCIDENT_BLACKSPOTS;
    return source
      .map((spot) => ({ spot, verdict: evaluateAccidentArea(spot) }))
      .filter(({ verdict }) => verdict.qualifies)
      .map(({ spot, verdict }) => ({
        ...spot,
        in_window_incident_count: verdict.inWindowCount,
        incident_count_is_windowed: verdict.windowed,
      }));
  }, [accidentBlackspots]);

  /* Callers commonly pass a fresh array literal every render, so the lookup is
     keyed on the coordinates themselves rather than on array identity. */
  const blackspotSignature = useMemo(
    () => activeBlackspots.map((s) => `${s.id ?? ""}:${s.lat},${s.lng}`).join("|"),
    [activeBlackspots]
  );
  const blackspotsRef = useRef(activeBlackspots);
  useEffect(() => { blackspotsRef.current = activeBlackspots; }, [activeBlackspots]);

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
          /* The basemap is split into ground and lettering so hazard overlays can
             be sandwiched between them. Drawn as one combined raster, every
             overlay painted over the top of the street names — an accident
             segment along Rizal Avenue hid the words "Rizal Avenue". */
          basemap: {
            type: "raster",
            tiles: ["https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png"],
            tileSize: 256,
          },
          basemap_labels: {
            type: "raster",
            tiles: ["https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png"],
            tileSize: 256,
          },
          hazards: { type: "vector", url: PMTILES_URL },
          fallback_danger: { type: "geojson", data: FALLBACK_DANGER_ZONES },
          fallback_volcanic: { type: "geojson", data: FALLBACK_VOLCANIC_PATHS },
          fallback_flood: { type: "geojson", data: FALLBACK_FLOOD_ZONES },
          /* Both accident sources start empty: the circular buffer is only ever
             filled for spots whose road segment could not be resolved, and that
             is not known until the lookup settles. */
          fallback_accident_buffers: { type: "geojson", data: EMPTY_FEATURE_COLLECTION },
          accident_road_segments: { type: "geojson", data: EMPTY_FEATURE_COLLECTION },
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

          /* Accident-Prone Road Segments — the carriageway the report was filed
             on, clipped either side of the pin. A white casing underneath keeps
             the highlight legible where it crosses dark basemap features. */
          {
            id: "accident_roads_casing",
            type: "line",
            source: "accident_road_segments",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              /* Held back so it separates the segment from the carriageway
                 without diluting the red into pink underneath it. */
              "line-color": "#FFFFFF",
              "line-opacity": 0.4,
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                12, 6, 15, 12, 18, 28,
              ],
            },
          },
          {
            id: "accident_roads",
            type: "line",
            source: "accident_road_segments",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              /* A saturated warning red, not the muted rose it started as. With
                 street names now painting over the top, the segment can carry
                 real weight without costing legibility. */
              "line-color": [
                "match", ["get", "severity"],
                "critical", "#A30B1E",
                "high", "#C1121F",
                "#D62839",
              ],
              "line-opacity": 0.82,
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                12, 3, 15, 8, 18, 20,
              ],
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

          /* Street names and place labels ride above every overlay, so a hazard
             can shade a road without ever hiding which road it is. Last in the
             array means last painted. */
          { id: "basemap_labels", type: "raster", source: "basemap_labels" },
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

  /* ── Accident-prone road segments ───────────────────────────────────────────
   * A blackspot is a point, but the hazard is a stretch of road. Snap each spot
   * onto the road it sits on and highlight that carriageway instead of drawing a
   * radius over every house and side street around it.
   */

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    fetchRoadSegments(blackspotsRef.current, {
      halfLengthM: ACCIDENT_SEGMENT_HALF_LENGTH_M,
      signal: controller.signal,
    })
      .then((resolved) => { if (!cancelled) setRoadSegments(resolved); })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        /* Road data unavailable — fall back to the circular buffers rather than
           leaving the accident layer blank. */
        console.warn("SARO: road segment lookup failed, using circular accident buffers.", err);
        if (!cancelled) setRoadSegments(new Map());
      });

    return () => { cancelled = true; controller.abort(); };
  }, [blackspotSignature]);

  useEffect(() => {
    if (!ready || !map.current || !roadSegments) return;
    const spots = blackspotsRef.current;

    const roads = map.current.getSource("accident_road_segments");
    if (roads) roads.setData(createAccidentRoadGeoJSON(spots, roadSegments));

    const buffers = map.current.getSource("fallback_accident_buffers");
    if (buffers) buffers.setData(createAccidentBufferGeoJSON(spots, new Set(roadSegments.keys())));
  }, [roadSegments, blackspotSignature, ready]);

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
    set("accident_roads_casing", on("accident_prone"));
    set("accident_roads", on("accident_prone"));
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
  }, [active, stableHidden, ready, reports]);

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
  }, [evacuationCenters, ready, active, stableHidden, placementVersion]);

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
  }, [accidentBlackspots, ready, active, stableHidden, placementVersion]);

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

    rebuildingMarkersRef.current = true;
    for (const marker of markers.current) marker.remove();
    for (const marker of evacuationMarkers.current) marker.remove();
    for (const marker of accidentMarkers.current) marker.remove();
    markers.current = [];
    evacuationMarkers.current = [];
    accidentMarkers.current = [];

    const reportsVisible = active.reports && !hidden.includes("reports");
    const centersVisible = active.evacuation_centers && !hidden.includes("evacuation_centers");
    const blackspotsVisible = active.accident_prone && !hidden.includes("accident_prone");

    const renderedReports = [...reports];
    if (inspectedReport && !renderedReports.some((report) => report.id === inspectedReport.id)) {
      renderedReports.push(inspectedReport);
    }

    for (const report of renderedReports) {
      const lat = typeof report.lat === "string" ? parseFloat(report.lat) : Number(report.lat);
      const lng = typeof report.lng === "string" ? parseFloat(report.lng) : Number(report.lng);
      if (isNaN(lat) || isNaN(lng) || !lat || !lng) continue;

      const count = report.count || report.clusterCount || 1;
      const isClustered = count > 1;

      /* Cluster pins grow a little with their count so a busy location reads as
         busier at a glance, but stay bounded so a large group cannot swallow the
         streets underneath it. */
      const size = isClustered
        ? Math.min(34, 24 + Math.round(Math.log2(count) * 3))
        : (report.priority === "high" ? 28 : 25);

      const fill = report.color ?? token("--color-brand", "#1B2E6B");

      /* A pin the reader filed themselves wears a solid brand ring, so their own
         report is findable on a map of everybody's. The ring is drawn outside the
         white border rather than replacing the status fill: whose report it is and
         what is happening to it are two different facts, and the pin says both. */
      const isMine = Boolean(report.isMine);
      const mineRing = token("--color-brand", "#1B2E6B");

      const el = document.createElement("div");
      el.className = isMine ? "saro-map-pin saro-map-pin-mine" : "saro-map-pin";
      el.style.cssText =
        `width:${size}px;` +
        `height:${size}px;` +
        `background:${fill};` +
        "border:2px solid #ffffff;" +
        "border-radius:50%;" +
        /* Clusters carry a soft halo in their own status colour so they read as
           a group rather than as one oversized dot. */
        (isMine
          ? `box-shadow:0 2px 5px rgba(16,23,37,0.32),0 0 0 3px ${mineRing},0 0 0 6px ${mineRing}33;`
          : isClustered
          ? `box-shadow:0 2px 5px rgba(16,23,37,0.32),0 0 0 4px ${fill}33;`
          : "box-shadow:0 2px 5px rgba(16,23,37,0.32);") +
        "cursor:pointer;" +
        `display:${reportsVisible ? "flex" : "none"};` +
        "align-items:center;justify-content:center;" +
        /* The colour is explicit because the marker element lives outside the app's
           cascade: without it the count inherited the page's dark ink and a light
           "received" pin looked like a small dark circle inside a big grey one. */
        "color:#ffffff;text-shadow:0 1px 1px rgba(16,23,37,0.45);" +
        "font:800 12px/1 system-ui,-apple-system,sans-serif;";

      if (isClustered) {
        el.textContent = String(count);
        el.title = isMine
          ? `${count} reports in this area, including yours`
          : `${count} reports in this area`;
      } else {
        el.innerHTML = reportIconSvg(report.categoryName || report.category);
        el.title = isMine
          ? `Your ${report.categoryName || report.category || "hazard"} report`
          : `${report.categoryName || report.category || "Hazard"} report`;
        const svg = el.querySelector("svg");
        if (svg) svg.style.cssText = "width:14px;height:14px;display:block";
      }

      const marker = new Marker({
        element: el,
        anchor: "center",
      })
        .setLngLat([lng, lat])
        .addTo(map.current);

      marker._saroId = report.id;

      /* One popup, one source of truth. When the host supplies popup content,
         clicking a pin only announces the selection — the map's single popup
         follows it. The old split (a hand-built DOM popup here, a richer card
         rendered beside the map there) is what let the two drift out of
         agreement. */
      if (renderReportPopupRef.current) {
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          if (String(report.id) === String(selectedIdRef.current)) {
            clearSelectedReportRef.current?.();
            return;
          }
          report.onSelect?.(report);
        });
      } else if (isClustered) {
        const popupNode = document.createElement("div");
        popupNode.style.cssText =
          "font-family:var(--font-sans,system-ui,-apple-system,sans-serif);padding:6px;" +
          "width:300px;max-width:100%;max-height:360px;overflow-y:auto";

        const heading = document.createElement("div");
        heading.textContent = `${count} Reports in this Area`;
        heading.style.cssText =
          "font-size:13px;font-weight:800;color:#101725;line-height:1.3;margin-bottom:4px";
        popupNode.appendChild(heading);

        const location = document.createElement("div");
        location.textContent = report.barangayName || "Legazpi City";
        location.style.cssText = "font-size:11px;color:#5E6776;margin-bottom:10px";
        popupNode.appendChild(location);

        /* Every member is listed, not only the ones carrying a tracking code.
           The public map RPC returns no codes at all, so filtering on them left
           this list empty under a heading claiming sixteen reports. */
        const members = Array.isArray(report.members) ? report.members : [];
        if (members.length > 0) {
          const label = document.createElement("div");
          label.textContent = "Reports in this area";
          label.style.cssText =
            "font-size:10px;font-weight:800;color:#5E6776;text-transform:uppercase;" +
            "letter-spacing:0.05em;margin-bottom:6px";
          popupNode.appendChild(label);

          for (const member of members) {
            const memberCode = member.tracking_code || member.trackingCode || member.code;
            const memberButton = document.createElement("button");
            memberButton.type = "button";
            memberButton.disabled = !report.onSelectMember;
            memberButton.style.cssText =
              "width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;" +
              "background:#FFFFFF;color:#101725;border:1px solid #C6D2E0;padding:8px 10px;" +
              "margin-top:6px;text-align:left;cursor:pointer";

            const memberText = document.createElement("span");
            memberText.style.cssText = "min-width:0;display:flex;flex-direction:column;gap:2px";

            const memberTitle = document.createElement("span");
            memberTitle.textContent =
              member.category_label || member.categoryName || member.category || "Hazard Report";
            memberTitle.style.cssText =
              "font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
            memberText.appendChild(memberTitle);

            /* Public rows are anonymised and carry no code, so the time filed
               stands in as the line that tells two members apart. */
            const code = document.createElement("span");
            code.textContent = memberCode || member.timeSinceStr || "Filed recently";
            code.style.cssText =
              "font-family:var(--font-mono,monospace);font-size:10px;color:#5E6776";
            memberText.appendChild(code);

            const action = document.createElement("span");
            action.textContent = "Inspect Pin";
            action.style.cssText =
              "flex-shrink:0;font-size:10px;font-weight:800;color:#1B2E6B;text-transform:uppercase";

            memberButton.appendChild(memberText);
            memberButton.appendChild(action);
            memberButton.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!report.onSelectMember) return;
              popup.remove();
              report.onSelectMember(member);
            });
            popupNode.appendChild(memberButton);
          }
        }

        const popup = new Popup({ ...POPUP_ANCHORING, offset: 16, closeButton: true, maxWidth: "340px" })
          .setDOMContent(popupNode);
        marker.setPopup(popup);
      } else {
        const popup = new Popup({ ...POPUP_ANCHORING, offset: 14, closeButton: true, maxWidth: "330px" })
          .setDOMContent(createReportPopup(report));
        marker.setPopup(popup);
      }

      markers.current.push(marker);
    }

    /* The same qualifying list the segments are drawn from, so a marker never
       claims a blackspot that has no highlighted area behind it. */
    for (const spot of blackspotsRef.current) {
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

      const segment = roadSegments?.get(spot.id ?? `${spot.lat},${spot.lng}`);

      const popup = new Popup({ ...POPUP_ANCHORING, offset: 14, closeButton: true, maxWidth: "300px" }).setHTML(
        `<div style="font-family:system-ui,-apple-system,sans-serif;padding:4px;width:260px;max-width:100%">` +
        `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">` +
        `<span style="font-size:10px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#C66A16;background:rgba(198,106,22,0.08);padding:2.5px 7px;border-radius:4px;border:1px solid rgba(198,106,22,0.2)">` +
        `⚠️ ACCIDENT BLACKSPOT` +
        `</span>` +
        `</div>` +
        `<div style="font-size:13px;font-weight:800;color:#101725;line-height:1.3;margin-bottom:4px;padding-right:20px">` +
        `${spot.name}` +
        `</div>` +
        `<div style="font-size:11px;color:#64748B;margin-bottom:10px;display:flex;align-items:center;gap:4px">` +
        `<span>📍 ${spot.location_label || "Accident-prone area"}</span>` +
        `</div>` +
        (segment
          ? `<div style="font-size:11px;color:#334155;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;padding:8px 10px;margin-bottom:8px;line-height:1.4">` +
            `<div style="font-size:10px;font-weight:800;color:#9F1239;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">Highlighted Road Segment</div>` +
            `<strong>${segment.roadName}</strong> — ${segment.lengthM} m of carriageway around this point.` +
            `</div>`
          : "") +
        `<div style="font-size:11px;color:#334155;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:8px 10px;line-height:1.4">` +
        `<div style="font-size:10px;font-weight:800;color:#92400E;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">Incident Record</div>` +
        /* The windowed figure is the one the marking was decided on, so it is
           the one shown. The all-time total sits beside it rather than replacing
           it — older crashes are excluded from the threshold, not from history. */
        (spot.incident_count_is_windowed
          ? `<strong>${spot.in_window_incident_count} incidents in the last ${ACCIDENT_ROLLING_WINDOW_MONTHS} months</strong>` +
            (Number(spot.incident_count ?? 0) > Number(spot.in_window_incident_count ?? 0)
              ? ` (${spot.incident_count} recorded all-time)`
              : "")
          : `<strong>${spot.incident_count || 0} reported incidents</strong> (all-time)`) +
        `. ${spot.last_reported || "Recently reported"}. High caution advised.` +
        `</div>` +
        `</div>`
      );

      popup.on("open", () => {
        if (activeLayerPopup.current && activeLayerPopup.current !== popup) {
          activeLayerPopup.current.remove();
        }
        activeLayerPopup.current = popup;
        if (onClearSelectedReport) onClearSelectedReport();
        makeRoomForPopup(map.current, { lng, lat });
      });

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
      const popup = new Popup({ ...POPUP_ANCHORING, offset: 14, closeButton: true, maxWidth: "320px" }).setHTML(
        `<div style="font-family:system-ui,-apple-system,sans-serif;padding:4px;width:270px;max-width:100%">` +
        `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">` +
        `<span style="font-size:10px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#087E6B;background:rgba(8,126,107,0.08);padding:2.5px 7px;border-radius:4px;border:1px solid rgba(8,126,107,0.2);display:inline-flex;align-items:center;gap:4px">` +
        `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#087E6B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>` +
        `EVACUATION CENTER` +
        `</span>` +
        `</div>` +
        `<div style="font-size:14px;font-weight:800;color:#101725;line-height:1.3;margin-bottom:4px;padding-right:20px;overflow-wrap:anywhere">` +
        `${center.name}` +
        `</div>` +
        `<div style="font-size:11px;color:#64748B;margin-bottom:10px;display:flex;align-items:center;gap:4px">` +
        `<span>📍 ${center.address}</span>` +
        `</div>` +
        `<div style="font-size:11px;color:#334155;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:8px 10px;margin-bottom:12px;line-height:1.4">` +
        `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px">` +
        `<span>Capacity: <strong style="color:#101725">${center.capacity || 500}</strong></span>` +
        `<span style="color:#087E6B;font-weight:700;background:rgba(8,126,107,0.1);padding:1px 6px;border-radius:4px">● ${center.status || "Ready"}</span>` +
        `</div>` +
        `${center.notes ? `<div style="font-size:10px;color:#64748B;margin-top:4px;font-style:italic">${center.notes}</div>` : ""}` +
        `</div>` +
        `<button id="btn-navigate-${centerId}" style="width:100%;background:#087E6B;color:#ffffff;border:none;border-radius:8px;padding:9px 12px;font-weight:700;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 1px 3px rgba(8,126,107,0.3);transition:all 0.15s ease">` +
        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>` +
        `Get Directions (Walking)</button>` +
        `</div>`
      );

      popup.on("open", () => {
        if (activeLayerPopup.current && activeLayerPopup.current !== popup) {
          activeLayerPopup.current.remove();
        }
        activeLayerPopup.current = popup;
        if (onClearSelectedReport) onClearSelectedReport();
        makeRoomForPopup(map.current, { lng, lat });

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

    /* Re-mark the selected pin inside the same rebuild that cleared it, so the
       highlight survives a data refresh. */
    if (selectedIdRef.current) {
      for (const marker of markers.current) {
        if (String(marker._saroId) !== String(selectedIdRef.current)) continue;
        const element = marker.getElement();
        element.style.outline = "4px solid rgba(27,46,107,.32)";
        element.style.outlineOffset = "4px";
        element.style.animation = "saro-pulse 1.2s ease-in-out infinite";
        break;
      }
    }

    rebuildingMarkersRef.current = false;
  }, [reports, inspectedReport, evacuationCenters, accidentBlackspots, roadSegments, ready, active, stableHidden, placementVersion, startEvacuationNavigation, onClearSelectedReport]);

  /* ── The map's single report popup ────────────────────────────────────── */

  /* The selected pin's data, taken from the same arrays the markers are drawn
     from, so the popup can never describe something the map is not showing. */
  const selectedReport = useMemo(() => {
    if (!selectedId) return null;
    const candidates = inspectedReport ? [...reports, inspectedReport] : reports;
    return candidates.find((report) => String(report.id) === String(selectedId)) ?? null;
  }, [selectedId, reports, inspectedReport]);

  /* Built once, then reused for every selection. */
  useEffect(() => {
    if (!ready || !renderReportPopup || reportPopup) return;
    const host = document.createElement("div");
    const popup = new Popup({
      ...POPUP_ANCHORING,
      offset: 16,
      closeButton: false,
      maxWidth: "none",
      className: "saro-report-popup",
      focusAfterOpen: false,
    }).setDOMContent(host);
    /* Closing includes clicking the map, which is a dismissal: the selection
       goes with it so nothing reopens on the next refresh. */
    popup.on("close", () => clearSelectedReportRef.current?.());
    setPopupHost(host);
    setReportPopup(popup);
  }, [ready, renderReportPopup, reportPopup]);

  useEffect(() => {
    if (!map.current || !reportPopup) return;

    const popup = reportPopup;
    const lat = Number(selectedReport?.lat);
    const lng = Number(selectedReport?.lng);

    if (!selectedReport || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      popup.remove();
      setPopupReport(null);
      return;
    }

    if (activeLayerPopup.current) {
      activeLayerPopup.current.remove();
      activeLayerPopup.current = null;
    }

    setPopupReport(selectedReport);
    popup.setLngLat([lng, lat]);
    if (!popup.isOpen()) popup.addTo(map.current);
  }, [selectedReport, reportPopup]);

  /* ── Selected pin highlight & fly ─────────────────────────────────────── */

  /* Recentring belongs to a *change* of selection, not to every marker rebuild —
     otherwise a background data refresh yanks the map back under the reader. */
  const recentredForRef = useRef(null);

  useEffect(() => {
    if (!ready || !map.current) return;

    for (const marker of markers.current) {
      const element = marker.getElement();
      element.style.outline = "none";
      element.style.animation = "none";
    }
    if (!selectedId) {
      recentredForRef.current = null;
      return;
    }

    if (activeLayerPopup.current && !activeLayerPopup.current.isOpen()) {
      activeLayerPopup.current = null;
    }

    for (const marker of markers.current) {
      if (String(marker._saroId) === String(selectedId)) {
        const element = marker.getElement();
        element.style.outline = "4px solid rgba(27,46,107,.32)";
        element.style.outlineOffset = "4px";
        element.style.animation = "saro-pulse 1.2s ease-in-out infinite";
        const popup = marker.getPopup();
        const lngLat = marker.getLngLat();
        if (popup && !popup.isOpen() && !renderReportPopupRef.current) {
          marker.togglePopup();
        }
        if (lngLat?.lng && lngLat?.lat && recentredForRef.current !== String(selectedId)) {
          recentredForRef.current = String(selectedId);
          /* The popup opens upward from the pin, so the pin is parked below
             centre — otherwise a tall card runs off the top of a phone screen. */
          if (renderReportPopupRef.current) {
            makeRoomForPopup(map.current, lngLat, { zoom: 16 });
          } else {
            map.current.easeTo({ center: [lngLat.lng, lngLat.lat], zoom: 16, duration: 500 });
          }
        }
        break;
      }
    }
  }, [selectedId, ready]);

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
      <style>{`
        .maplibregl-popup-content {
          background: #ffffff !important;
          border: 1px solid #E2E8F0 !important;
          border-radius: 12px !important;
          padding: 12px 14px !important;
          box-shadow: 0 10px 25px -5px rgba(16, 23, 37, 0.15), 0 8px 10px -6px rgba(16, 23, 37, 0.1) !important;
        }
        .maplibregl-popup-close-button {
          width: 28px !important;
          height: 28px !important;
          border-radius: 8px !important;
          top: 8px !important;
          right: 8px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-size: 16px !important;
          color: #64748B !important;
          background: transparent !important;
          border: none !important;
          cursor: pointer !important;
          transition: all 0.15s ease !important;
        }
        .maplibregl-popup-close-button:hover {
          background: #F1F5F9 !important;
          color: #101725 !important;
        }
        .maplibregl-popup-tip {
          border-top-color: #ffffff !important;
          border-bottom-color: #ffffff !important;
        }
        /* The popup is repositioned every frame while the map moves. Promoting
           it to its own layer keeps that as one transform instead of a relayout,
           and killing inherited transitions stops the card from easing towards
           each new position a beat behind the map underneath it. */
        .maplibregl-popup {
          will-change: transform;
          transition: none !important;
        }
        /* The report popup carries a full card, which brings its own frame —
           the popup shell gets out of its way and only supplies the tip. */
        .saro-report-popup .maplibregl-popup-content {
          padding: 0 !important;
          border: none !important;
          background: transparent !important;
          box-shadow: none !important;
          width: min(300px, calc(100vw - 40px)) !important;
        }
        @media (min-width: 640px) {
          .saro-report-popup .maplibregl-popup-content {
            width: min(340px, calc(100vw - 28px)) !important;
          }
        }
      `}</style>
      <div ref={container} className="h-full w-full" />

      {/* Layers and map key. Top corner on every size: the button used to sit a
          row lower to clear the resident map's filter chips, which left it
          stranded mid-map on desktop. The chips now reserve the corner. */}
      {showToggles && visibleToggles.length > 0 && (
        <div ref={popoverRef} className="absolute top-3 right-3 z-40">
          <button
            type="button"
            onClick={() => setTogglesOpen(!togglesOpen)}
            className="bg-white/95 backdrop-blur border border-line rounded-full p-2 shadow-xs hover:bg-white text-ink transition-all active:scale-95 flex items-center justify-center cursor-pointer"
            aria-label={togglesOpen ? "Close layers panel" : "Open layers panel"}
          >
            {togglesOpen ? <X className="w-4 h-4 text-ink" /> : <Layers className="w-4 h-4 text-brand" />}
          </button>

          {togglesOpen && (
            <div className="absolute top-11 right-0 z-30 bg-white/95 backdrop-blur border border-line rounded-md p-2.5 shadow-card w-56 sm:w-60 max-h-[calc(100vh-160px)] overflow-y-auto animate-fade-in text-ink">
              {/* Header with Tab Switcher & Explicit Close Button */}
              <div className="flex items-center justify-between border-b border-line pb-1.5 mb-2">
                <div className="flex items-center gap-1 bg-sunken p-0.5 rounded border border-line">
                  <button
                    type="button"
                    onClick={() => setPanelTab("layers")}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${
                      panelTab === "layers" ? "bg-white text-ink shadow-xs" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    Map Layers
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelTab("key")}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${
                      panelTab === "key" ? "bg-white text-ink shadow-xs" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    Map Key
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setTogglesOpen(false)}
                  className="text-ink-muted hover:text-ink p-1 rounded hover:bg-sunken transition-colors"
                  aria-label="Close map settings"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Tab 1: Map Layers */}
              {panelTab === "layers" && (
                <div className="flex flex-col gap-1 max-h-52 overflow-y-auto pr-1">
                  {visibleToggles.map((layer) => (
                    <label
                      key={layer.id}
                      className="t-body-sm flex cursor-pointer items-center gap-2 px-1.5 py-1 hover:bg-sunken rounded-xs transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(active[layer.id])}
                        onChange={() => toggle(layer.id)}
                        className="h-3.5 w-3.5 accent-brand shrink-0"
                      />
                      <span className="text-[11px] font-medium text-ink leading-tight">{layer.label}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* Tab 2: Map Key */}
              {panelTab === "key" && (
                <div className="space-y-1.5 px-0.5 text-[10px] text-ink-muted max-h-52 overflow-y-auto pr-1">
                  {REPORT_STATUS_KEY.map((entry) => (
                    <div key={entry.label} className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border-2 border-white"
                        style={{ backgroundColor: entry.color, boxShadow: "0 1px 2px rgba(16,23,37,0.3)" }}
                      />
                      {entry.label}
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 border-white bg-ink-muted text-[7px] font-black text-white"
                      style={{ boxShadow: "0 0 0 2px rgba(16,23,37,0.18)" }}
                    >
                      3
                    </span>
                    Several reports at one location
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border-2 border-white bg-ink-muted"
                      style={{ boxShadow: "0 0 0 2px var(--color-brand, #1B2E6B)" }}
                    />
                    Your own report
                  </div>
                  <div className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full border border-white bg-[#C1121F]/80 shrink-0" /> Accident-prone road segment</div>
                  <div className="flex items-center gap-2"><span className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-white bg-[#C66A16] text-[9px] font-black text-white shrink-0">!</span> Accident spot marker</div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-white bg-[#087E6B] text-white shrink-0">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                    </span> Evacuation shelter
                  </div>
                  <div className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border border-[#2563EB] bg-[#3B82F6]/15 shrink-0" /> Flood extent</div>
                  <div className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border border-[#995026] bg-[#A55B2A]/15 shrink-0" /> Volcanic corridor</div>
                  <div className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-alert shrink-0" /> Mayon danger boundary</div>
                  <div className="flex items-center gap-1.5">
                    <span className="flex w-4 shrink-0 items-center gap-0.5">
                      <span className="h-1.5 w-1.5 rounded-full border border-white bg-[#CFE3F2]" />
                      <span className="h-2.5 w-2.5 rounded-full border border-white bg-[#1F4E79]" />
                    </span>
                    Rainfall, light to heavy
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-1 w-4 shrink-0 rounded-full bg-[#0284C7] ring-1 ring-white" />
                    Walking route to a shelter
                  </div>
                </div>
              )}
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
        <div className="absolute top-4 left-3 right-14 sm:left-auto sm:w-80 z-30 bg-white/95 backdrop-blur border border-line p-3.5 rounded-sm shadow-lift flex flex-col gap-2 font-sans animate-fade-in">
          <div className="flex items-start justify-between gap-2">
            {/* min-w-0 is what keeps a long shelter name inside the card: without
                it this flex item refuses to shrink below its text and the name
                runs past the rounded edge instead of wrapping. */}
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-teal-50 text-[#087E6B] border border-teal-200 flex items-center justify-center font-bold shrink-0 shadow-xs">
                <Footprints width={16} height={16} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="t-label font-bold text-ink block leading-snug line-clamp-2 break-words">{activeRoute.centerName}</span>
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
        <div className="absolute top-4 left-3 right-14 sm:right-auto sm:max-w-sm z-30 bg-rose-50 border border-rose-200 text-rose-800 px-3.5 py-2 rounded-md shadow-card flex items-start gap-2 text-xs font-medium font-sans">
          <span className="min-w-0 flex-1 break-words">{routingError}</span>
          <button type="button" onClick={() => setRoutingError("")} className="hover:opacity-75">
            <X width={12} height={12} />
          </button>
        </div>
      )}

      {/* Report detail, rendered into the open pin's popup and nowhere else. */}
      {popupReport && renderReportPopup && popupHost
        ? createPortal(renderReportPopup(popupReport, { close: closeReportPopup }), popupHost)
        : null}

      {children}
    </div>
  );
}

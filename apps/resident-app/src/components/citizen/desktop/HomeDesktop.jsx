import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  PencilLine, Search, PhoneCall, MapPin, ChevronRight,
  CloudOff, Flame, Activity, Shield, CloudRain,
  Sparkles, Bot, Crosshair,
} from "lucide-react";
import { AlertLevelBadge, HazardMap } from "@saro/ui";
import {
  createReport, registerPanicFlag, addReportMedia,
  enqueueReport, removeFromOutbox, rememberReport, requestBackgroundSync,
  PANIC_CATEGORY, getVolcanicAlert, getPublicMapReports,
  getRainfall, getEvacuationCenters, getAccidentBlackspots,
  LEGAZPI_CENTER,
} from "@saro/shared";
import PanicControl from "../PanicControl";
import ReportTicket from "../ReportTicket";
import ConsentNotice, { consentAcknowledged } from "../ConsentNotice";
import {
  placeEmergencyCall, currentPosition, mayCaptureSilently,
  captureSilentPhoto, deviceId, noteRapidRepeat, FALLBACK_POSITION,
} from "../../../lib/panic";

const CALLBACK_HINT = "Panic alert. No detail given yet.";
const LEGAZPI_CENTER_LNGLAT = [LEGAZPI_CENTER[1], LEGAZPI_CENTER[0]];

const SAFETY_TIPS = [
  {
    id: 1, title: "Monsoon & Flood Safety", category: "Weather Advisory",
    IconComp: CloudRain,
    tip: "Keep house gutters clear and monitor Legazpi River water levels during heavy downpours. Avoid walking through floodwaters.",
  },
  {
    id: 2, title: "Mayon Volcanic Protocol", category: "Ashfall Preparedness",
    IconComp: Flame,
    tip: "Keep clean drinking water sealed and N95 dust masks ready in case of sudden wind shifts or volcanic alert changes.",
  },
  {
    id: 3, title: "Emergency Go-Bag Kit", category: "Disaster Preparedness",
    IconComp: Shield,
    tip: "Pack 3 days of non-perishable food, water, first aid supplies, flashlight, and extra batteries for every household member.",
  },
  {
    id: 4, title: "Civic Damage Reporting", category: "Community Action",
    IconComp: Sparkles,
    tip: "Report broken street drains or fallen branches via 'Describe a Hazard' so City Engineering can resolve issues fast.",
  },
];

function timeSince(dateStr) {
  if (!dateStr) return "recently";
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (isNaN(seconds) || seconds < 0) return "recently";
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Desktop Home — Standardized 400px Left Panel + Flex-1 Live DRRM Map.
 *
 * Left panel (400px): Panic control + situation cards + civic action links + safety tips grid.
 * Right panel (flex-1): Interactive live HazardMap (flex-col layout, zero top-offset bugs).
 */
export default function HomeDesktop() {
  const navigate = useNavigate();

  // Panic state
  const [panicState, setPanicState] = useState("idle");
  const [sent, setSent] = useState(null);
  const [imprecise, setImprecise] = useState(false);
  const [photoAttached, setPhotoAttached] = useState(false);
  const [showConsent, setShowConsent] = useState(false);

  // Situational awareness
  const [volcanicAlert, setVolcanicAlert] = useState(null);
  const [reportStats, setReportStats] = useState({ received: 0, assigned: 0, in_progress: 0, total: 0 });

  // Interactive map center/zoom state
  const [mapCenter, setMapCenter] = useState(LEGAZPI_CENTER_LNGLAT);
  const [mapZoom, setMapZoom] = useState(12);

  // Map data
  const [reports, setReports] = useState([]);
  const [rainfall, setRainfall] = useState([]);
  const [evacuationCenters, setEvacuationCenters] = useState([]);
  const [accidentBlackspots, setAccidentBlackspots] = useState([]);

  useEffect(() => {
    let active = true;

    getVolcanicAlert().then(({ data }) => {
      if (active && data) setVolcanicAlert(data);
    });

    getPublicMapReports().then(({ data }) => {
      if (!active || !data) return;
      const counts = { received: 0, assigned: 0, in_progress: 0, total: data.length };
      data.forEach((r) => {
        if (r.status === "received") counts.received++;
        if (r.status === "assigned") counts.assigned++;
        if (r.status === "in_progress") counts.in_progress++;
      });
      setReportStats(counts);
      setReports(data);
    });

    getRainfall().then(({ data }) => { if (active && data) setRainfall(data); });
    getEvacuationCenters().then(({ data }) => { if (active && data) setEvacuationCenters(data); });
    getAccidentBlackspots().then(({ data }) => { if (active && data) setAccidentBlackspots(data); });

    return () => { active = false; };
  }, []);

  // Panic warmup refs
  const positionRef = useRef(null);
  const photoRef = useRef(null);
  const warmingRef = useRef(false);

  const warmUp = useCallback(() => {
    if (warmingRef.current) return;
    warmingRef.current = true;
    positionRef.current = currentPosition();
    photoRef.current = mayCaptureSilently()
      .then((allowed) => (allowed ? captureSilentPhoto() : null))
      .catch(() => null);
  }, []);

  const handlePanic = useCallback(async () => {
    setPanicState("sending");

    // 1. Call first
    placeEmergencyCall();
    const id = deviceId();
    const wasRapid = noteRapidRepeat();
    registerPanicFlag(id).catch(() => {});

    // 2. Position
    const position = await Promise.race([
      positionRef.current ?? currentPosition(),
      new Promise((resolve) => setTimeout(() => resolve({ ...FALLBACK_POSITION }), 2500)),
    ]);
    setImprecise(!position.precise);

    const payload = {
      category: PANIC_CATEGORY,
      description: wasRapid
        ? `${CALLBACK_HINT} Repeat press within 15 minutes.`
        : CALLBACK_HINT,
      lat: position.lat,
      lng: position.lng,
      anonymous: true,
      device_fingerprint: id,
    };

    // 3. Queue locally
    const queueId = await enqueueReport(payload, { kind: "panic" });
    requestBackgroundSync();

    // 4. Try network delivery
    const { data, error } = await createReport(payload);
    if (error || !data) {
      setPanicState("queued");
      return;
    }

    await removeFromOutbox(queueId);
    await rememberReport({
      tracking_code: data.tracking_code,
      category: data.category,
      status: data.status,
      kind: "panic",
      created_at: data.created_at,
    });

    setSent(data);
    setPanicState("sent");
    if (!consentAcknowledged()) setShowConsent(true);

    const photo = await photoRef.current;
    if (photo) {
      const { error: mediaError } = await addReportMedia(data.id, photo);
      if (!mediaError) setPhotoAttached(true);
    }
  }, []);

  useEffect(() => {
    if (panicState === "idle") {
      warmingRef.current = false;
      positionRef.current = null;
      photoRef.current = null;
    }
  }, [panicState]);

  const reset = () => {
    setPanicState("idle");
    setSent(null);
    setPhotoAttached(false);
    setImprecise(false);
  };

  // Fly map to selected report or city center
  const handleFocusMapReport = (rep) => {
    if (rep?.lat && rep?.lng) {
      setMapCenter([parseFloat(rep.lng), parseFloat(rep.lat)]);
      setMapZoom(14);
    } else {
      navigate("/map");
    }
  };

  const showReceipt = panicState === "sent" || panicState === "queued";
  const queued = panicState === "queued";

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas text-ink font-sans">

      {/* ── Left panel (Standardized 400px) ───────────────────────────────── */}
      <aside
        className="flex w-[400px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface"
        aria-label="Home — situation and reporting"
      >
        {/* Panel header */}
        <div className="border-b border-line px-5 py-3.5">
          <h1 className="text-sm font-bold text-ink">Legazpi City · Live Situation</h1>
          <p className="text-xs text-ink-faint mt-0.5">Real-time hazard map and civic emergency portal</p>
        </div>

        <div className="flex flex-col gap-4.5 p-5">

          {/* ── Panic receipt or Panic control ──────────────────────────── */}
          {showReceipt ? (
            <div className="flex flex-col gap-3">
              <div
                className="p-4 border border-line"
                style={{ background: "var(--color-panic-wash)" }}
              >
                <span
                  className="saro-stamp block mb-2"
                  style={{ color: "var(--color-panic-strong)" }}
                >
                  {queued ? "Call placed · alert waiting to send" : "Call placed · alert sent"}
                </span>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {queued
                    ? "You are through to 911 by phone. Your location could not be sent yet — SARO will keep trying and send it the moment signal returns, even if you close this app."
                    : "Legazpi 911 has your location. Stay on the call if you can."}
                </p>
              </div>

              {queued ? (
                <div className="saro-clip saro-card p-4" style={{ borderColor: "var(--color-ink)" }}>
                  <span className="t-label flex items-center gap-2 text-ink-faint">
                    <CloudOff width={14} height={14} aria-hidden="true" />
                    Waiting to send
                  </span>
                  <p className="t-body-sm mt-2 text-ink-muted">
                    A tracking code is issued when the alert reaches the city.
                  </p>
                </div>
              ) : (
                <ReportTicket
                  code={sent.tracking_code}
                  categoryLabel="Emergency — Panic Alert"
                  filedAt={sent.created_at}
                  tone="panic"
                />
              )}

              {imprecise && (
                <p className="text-xs flex items-start gap-2 text-alert">
                  <MapPin width={14} height={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  Location services were off, so the city centre was sent instead. Add where you actually are below.
                </p>
              )}
              {photoAttached && (
                <p className="text-xs text-ink-faint">A photo from your camera was attached.</p>
              )}

              <a href="tel:911" className="saro-btn saro-btn-secondary saro-btn-block py-2.5">
                <PhoneCall width={15} height={15} />
                Call 911 Again
              </a>

              {!queued && (
                <button
                  type="button"
                  onClick={() => navigate(`/report?panic=${sent.tracking_code}`)}
                  className="saro-btn saro-btn-primary saro-btn-block py-2.5"
                >
                  Add What Is Happening
                  <ChevronRight width={15} height={15} />
                </button>
              )}

              {showConsent && (
                <ConsentNotice dismissible onAcknowledge={() => setShowConsent(false)} />
              )}

              <button type="button" onClick={reset} className="saro-btn saro-btn-ghost saro-btn-block">
                Back
              </button>
            </div>
          ) : (
            <PanicControl
              onFire={handlePanic}
              onHoldStart={warmUp}
              state={panicState === "sending" ? "sending" : "idle"}
            />
          )}

          {/* ── Section: Live Monitoring ─────────────────────────────────── */}
          <div className="flex flex-col gap-2.5">
            <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">
              Live Monitoring &amp; Situation
            </span>

            {/* Mayon Alert */}
            <div className="flex flex-col gap-2 p-3.5 border border-line bg-surface rounded-xs hover:border-brand-edge transition-colors shadow-2xs">
              <div className="flex items-center justify-between gap-2 w-full">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 bg-amber-50 text-status-assigned-ink border border-amber-200 flex items-center justify-center shrink-0 rounded-xs">
                    <Flame className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-bold text-ink leading-tight">
                      Mayon Volcanic Status
                    </span>
                    <span className="text-xs text-ink-muted mt-0.5">
                      {volcanicAlert?.last_verified_at ? timeSince(volcanicAlert.last_verified_at) : "1d ago"} · PHIVOLCS Bulletin
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {volcanicAlert ? (
                    <AlertLevelBadge alert={volcanicAlert} compact />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold font-mono bg-emerald-50 text-emerald-900 border border-emerald-300 rounded-xs">
                      <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse shrink-0" />
                      Level 0 · Normal
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Active Reports */}
            <div className="flex flex-col gap-2.5 p-3.5 border border-line bg-surface rounded-xs shadow-2xs">
              <div className="flex items-center justify-between gap-2 w-full">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 bg-brand-wash text-brand border border-brand-edge flex items-center justify-center shrink-0 rounded-xs">
                    <Activity className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-xs font-bold text-ink leading-tight">
                      Active City Reports
                    </span>
                    <span className="text-xs font-mono font-bold text-brand bg-brand-wash px-2 py-0.5 border border-brand-edge rounded-xs shrink-0">
                      {reportStats.total} active
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/map")}
                  className="text-xs font-bold text-brand hover:underline flex items-center gap-0.5 shrink-0"
                >
                  View Map
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 w-full border-t border-line pt-2.5">
                {[
                  { label: "Received", value: reportStats.received, cls: "text-ink" },
                  { label: "Assigned", value: reportStats.assigned, cls: "text-status-assigned-ink" },
                  { label: "In Progress", value: reportStats.in_progress, cls: "text-brand" },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="bg-sunken px-2.5 py-1.5 border border-line flex items-center justify-between rounded-xs">
                    <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">{label}</span>
                    <span className={`text-xs font-bold font-mono ${cls}`}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Section: Civic Services ──────────────────────────────────── */}
          <div className="flex flex-col gap-2.5">
            <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">
              Civic Services &amp; Action
            </span>

            <button
              type="button"
              onClick={() => navigate("/report")}
              className="group flex w-full items-center gap-3.5 p-3.5 border border-line bg-white hover:border-brand-edge transition-colors text-left rounded-xs"
              style={{ borderLeft: "4px solid var(--color-brand)" }}
            >
              <div className="w-9 h-9 flex items-center justify-center shrink-0 rounded-xs" style={{ background: "var(--color-brand-wash)" }}>
                <PencilLine className="w-4 h-4" style={{ color: "var(--color-brand)" }} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-bold text-ink block leading-tight group-hover:text-brand transition-colors">
                  Describe a Hazard
                </span>
                <span className="text-xs text-ink-muted block mt-0.5">
                  Report flooding, road damage, structural risk
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-brand group-hover:translate-x-0.5 transition-all shrink-0" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => navigate("/track")}
              className="group flex w-full items-center gap-3.5 p-3.5 border border-line bg-white hover:border-brand-edge transition-colors text-left rounded-xs"
              style={{ borderLeft: "4px solid var(--color-brand)" }}
            >
              <div className="w-9 h-9 flex items-center justify-center shrink-0 rounded-xs" style={{ background: "var(--color-brand-wash)" }}>
                <Search className="w-4 h-4" style={{ color: "var(--color-brand)" }} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-bold text-ink block leading-tight group-hover:text-brand transition-colors">
                  Track a Report
                </span>
                <span className="text-xs text-ink-muted block mt-0.5">
                  Check status with your 8-char tracking code
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-brand group-hover:translate-x-0.5 transition-all shrink-0" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => navigate("/assistant")}
              className="group flex w-full items-center gap-3.5 p-3.5 border border-line bg-white hover:border-brand-edge transition-colors text-left rounded-xs"
              style={{ borderLeft: "4px solid var(--color-brand)" }}
            >
              <div className="w-9 h-9 flex items-center justify-center shrink-0 rounded-xs" style={{ background: "var(--color-brand-wash)" }}>
                <Bot className="w-4 h-4" style={{ color: "var(--color-brand)" }} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-bold text-ink block leading-tight group-hover:text-brand transition-colors">
                  Ask the AI Assistant
                </span>
                <span className="text-xs text-ink-muted block mt-0.5">
                  City hotlines, evacuation centers, guidelines
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-brand group-hover:translate-x-0.5 transition-all shrink-0" aria-hidden="true" />
            </button>
          </div>

          {/* ── Safety Advisory Grid (Clean 2x2 Desktop Grid) ───────────── */}
          <div className="flex flex-col gap-2.5 pt-2 border-t border-line">
            <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">
              Disaster Preparedness &amp; Safety
            </span>
            <div className="grid grid-cols-2 gap-2">
              {SAFETY_TIPS.map((tip) => {
                const Icon = tip.IconComp;
                return (
                  <div
                    key={tip.id}
                    className="p-3 border border-line bg-raised rounded-xs flex flex-col gap-1.5 hover:border-brand-edge transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 bg-brand-wash text-brand border border-brand-edge flex items-center justify-center shrink-0 rounded-xs">
                        <Icon className="w-3 h-3" />
                      </div>
                      <span className="text-xs font-bold text-ink leading-tight truncate">
                        {tip.title}
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-muted leading-relaxed line-clamp-3">
                      {tip.tip}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Command Center Footer ───────────────────────────────────── */}
          <div
            className="border border-line p-3.5 flex items-center justify-between gap-3 rounded-xs"
            style={{ background: "var(--color-brand-wash)" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 flex items-center justify-center shrink-0 rounded-xs" style={{ background: "var(--color-brand)", color: "white" }}>
                <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
              </div>
              <div>
                <span className="text-xs font-bold text-ink leading-tight block">Legazpi Command Center</span>
                <span className="text-xs text-ink-muted flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-status-resolved-ink animate-pulse inline-block shrink-0" />
                  Online · CDRRMO 24/7 EOC
                </span>
              </div>
            </div>
            <a
              href="tel:911"
              className="saro-btn saro-btn-primary saro-btn-sm text-xs py-1.5 px-3"
            >
              Call 911
            </a>
          </div>

        </div>
      </aside>

      {/* ── Right panel: flex-col live DRRM map (Zero top-offset bug) ───────── */}
      <div className="flex flex-col flex-1 h-full min-w-0 overflow-hidden relative">
        {/* Map header strip */}
        <div className="shrink-0 border-b border-line bg-surface px-5 py-3 flex items-center justify-between z-10 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-status-resolved-ink animate-pulse inline-block" aria-hidden="true" />
            <span className="text-sm font-bold text-ink">Live City Hazard Map</span>
            <span className="text-xs text-ink-faint">· Mayon 6km PDZ / 7.5km EDZ, rainfall, evacuation, incident pins</span>
          </div>
          <button
            type="button"
            onClick={() => navigate("/map")}
            className="saro-btn saro-btn-ghost saro-btn-sm text-xs font-bold flex items-center gap-1 text-brand hover:text-brand-strong"
          >
            Full Interactive Map
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Map fills the remaining flex-1 container */}
        <div className="flex-1 relative overflow-hidden">
          <HazardMap
            center={mapCenter}
            zoom={mapZoom}
            reports={reports}
            rainfall={rainfall}
            evacuationCenters={evacuationCenters}
            accidentBlackspots={accidentBlackspots}
            volcanicAlert={volcanicAlert}
            interactiveFeatures={true}
            className="h-full w-full"
          />
        </div>
      </div>

    </div>
  );
}

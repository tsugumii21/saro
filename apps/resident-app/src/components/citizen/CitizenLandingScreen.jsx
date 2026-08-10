import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PencilLine, Search, PhoneCall, MapPin, ChevronRight, CloudOff, Flame, Activity, Lightbulb, ChevronLeft, Shield, CloudRain, Sparkles, RefreshCw } from "lucide-react";
import { Wordmark, AlertLevelBadge } from "@saro/ui";
import {
  createReport, registerPanicFlag, addReportMedia, enqueueReport, removeFromOutbox,
  rememberReport, requestBackgroundSync, PANIC_CATEGORY,
  getVolcanicAlert, getPublicMapReports,
} from "@saro/shared";
import PanicControl from "./PanicControl";
import ReportTicket from "./ReportTicket";
import ConsentNotice, { consentAcknowledged } from "./ConsentNotice";
import {
  placeEmergencyCall, currentPosition, mayCaptureSilently, captureSilentPhoto,
  deviceId, noteRapidRepeat, FALLBACK_POSITION,
} from "../../lib/panic";

/**
 * Resident home — the Panic screen.
 *
 * One object, one decision. Panic occupies roughly half the viewport and is the
 * only saturated colour anywhere in the app. Describe and Check sit below it,
 * reachable but never competing. If you arrive here in an emergency you do not
 * read this screen; you press the red thing.
 *
 * ── What a press actually does, and in what order ────────────────────────────
 *
 * The requirement is that the call and the silent report happen *simultaneously*
 * rather than one after the other. Naively that reads as "fire both at once",
 * but a browser is single-threaded and a tel: handoff can suspend the page, so
 * "at once" has to be engineered rather than wished for. What happens:
 *
 *   during the hold   Location and, where allowed, a camera frame are already
 *                     being fetched. The 1.2s hold is dead time otherwise, and
 *                     a GPS fix is the slowest part of this flow. By the time
 *                     the button fills, the payload is usually complete.
 *
 *   t + 0ms           The call is handed to the dialer. FIRST, before anything
 *                     that can fail. It is not gated on consent, on login, on
 *                     having a location, on having signal, or on the report
 *                     insert succeeding — cellular voice works where data does
 *                     not, which is the entire reason this ordering matters.
 *
 *   t + ~1ms          The report is written to IndexedDB. Local, synchronous in
 *                     effect, cannot fail for lack of network. From this instant
 *                     the report exists and SARO owes the person delivery.
 *
 *   t + ~2ms          The network insert starts. If it succeeds the queued copy
 *                     is dropped. If it fails — or the page is suspended by the
 *                     dialer mid-request — the queued copy is still there, and
 *                     the service worker delivers it when signal returns, even
 *                     if SARO is never reopened.
 *
 * So the person sees a dialer immediately and a tracking code as soon as one
 * exists. Neither waits for the other, and neither can lose the other's work.
 */

const CALLBACK_HINT = "Panic alert. No detail given yet.";

const SAFETY_TIPS = [
  {
    id: 1,
    title: "Monsoon & Flood Safety",
    category: "Weather Advisory",
    IconComp: CloudRain,
    tip: "Keep house gutters clear and monitor Legazpi River water levels during heavy downpours. Avoid walking through floodwaters.",
  },
  {
    id: 2,
    title: "Mayon Volcanic Protocol",
    category: "Ashfall Preparedness",
    IconComp: Flame,
    tip: "Keep clean drinking water sealed and N95 dust masks ready in case of sudden wind shifts or volcanic alert changes.",
  },
  {
    id: 3,
    title: "Emergency Go-Bag Kit",
    category: "Disaster Preparedness",
    IconComp: Shield,
    tip: "Pack 3 days of non-perishable food, water, first aid supplies, flashlight, and extra batteries for every household member.",
  },
  {
    id: 4,
    title: "Civic Damage Reporting",
    category: "Community Action",
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

export default function CitizenLandingScreen() {
  const navigate = useNavigate();

  // idle | sending | sent | queued | failed
  const [state, setState] = useState("idle");
  const [sent, setSent] = useState(null);
  const [imprecise, setImprecise] = useState(false);
  const [photoAttached, setPhotoAttached] = useState(false);
  const [showConsent, setShowConsent] = useState(false);

  // Live situation & advisory state
  const [volcanicAlert, setVolcanicAlert] = useState(null);
  const [reportStats, setReportStats] = useState({ received: 0, assigned: 0, in_progress: 0, total: 0 });
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    let active = true;
    getVolcanicAlert().then(({ data }) => {
      if (active && data) setVolcanicAlert(data);
    });
    getPublicMapReports().then(({ data }) => {
      if (active && data) {
        const counts = { received: 0, assigned: 0, in_progress: 0, total: data.length };
        data.forEach((r) => {
          if (r.status === "received") counts.received++;
          if (r.status === "assigned") counts.assigned++;
          if (r.status === "in_progress") counts.in_progress++;
        });
        setReportStats(counts);
      }
    });
    return () => { active = false; };
  }, []);

  const handleNextTip = () => {
    setTipIndex((prev) => (prev + 1) % SAFETY_TIPS.length);
  };

  const handlePrevTip = () => {
    setTipIndex((prev) => (prev - 1 + SAFETY_TIPS.length) % SAFETY_TIPS.length);
  };

  // Warm-up results, filled during the hold and read at fire time.
  const positionRef = useRef(null);
  const photoRef = useRef(null);
  const warmingRef = useRef(false);

  /**
   * Start fetching everything the payload needs, while the button is held.
   * Idempotent and never throws — a failed warm-up simply means the fire path
   * falls back to fetching (or doing without) whatever is missing.
   */
  const warmUp = useCallback(() => {
    if (warmingRef.current) return;
    warmingRef.current = true;

    positionRef.current = currentPosition();

    photoRef.current = mayCaptureSilently()
      .then((allowed) => (allowed ? captureSilentPhoto() : null))
      .catch(() => null);
  }, []);

  const handlePanic = useCallback(async () => {
    setState("sending");

    // ── 1. The call. Nothing above this line can block it. ──────────────────
    placeEmergencyCall();

    const id = deviceId();
    const wasRapid = noteRapidRepeat();

    // Advisory only, for dispatchers. Fire and forget — a counter must never
    // sit between a person and their alert.
    registerPanicFlag(id).catch(() => { });

    // ── 2. Position: whatever the warm-up got, or the fallback. ─────────────
    // Capped so a stalled fix cannot hold up the write. The warm-up has usually
    // resolved this already; this is the guard for when it has not.
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
      anonymous: true,           // Panic is always anonymous, even when signed in.
      device_fingerprint: id,
    };

    // ── 3. Queue locally BEFORE the network is touched. ─────────────────────
    const queueId = await enqueueReport(payload, { kind: "panic" });
    requestBackgroundSync();

    // ── 4. Now try to deliver it. ──────────────────────────────────────────
    const { data, error } = await createReport(payload);

    if (error || !data) {
      // The row stays queued. This is not a failure the person needs to act on
      // beyond the call they are already on, so it is stated calmly.
      setState("queued");
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
    setState("sent");

    // Consent is shown here — after the call is placed and the alert is
    // routing — and never before. See ConsentNotice.
    if (!consentAcknowledged()) setShowConsent(true);

    // The photo attaches last, on purpose. It is the least important part of
    // the payload and the most likely to fail on a bad connection; nothing
    // above waits for it.
    const photo = await photoRef.current;
    if (photo) {
      const { error: mediaError } = await addReportMedia(data.id, photo);
      if (!mediaError) setPhotoAttached(true);
    }
  }, []);

  // Reset warm-up state whenever we return to idle, so a second press starts a
  // fresh position read rather than reusing a fix from ten minutes ago.
  useEffect(() => {
    if (state === "idle") {
      warmingRef.current = false;
      positionRef.current = null;
      photoRef.current = null;
    }
  }, [state]);

  const reset = () => {
    setState("idle");
    setSent(null);
    setPhotoAttached(false);
    setImprecise(false);
  };

  /* ── Sent, or queued: the receipt ──────────────────────────────────────── */
  if (state === "sent" || state === "queued") {
    const queued = state === "queued";

    return (
      <div className="flex min-h-full flex-col gap-5 px-4 pb-8 pt-5">
        <div className="saro-rise">
          <span className="saro-stamp" style={{ color: "var(--color-panic-strong)" }}>
            {queued ? "Call placed · alert waiting to send" : "Call placed · alert sent"}
          </span>
          <p className="t-body mt-3 text-ink-muted">
            {queued
              ? "You are through to 911 by phone. Your location could not be sent yet — SARO will keep trying and send it the moment signal returns, even if you close this app."
              : "Legazpi 911 has your location. Stay on the call if you can."}
          </p>
        </div>

        {queued ? (
          <div className="saro-clip saro-card p-5" style={{ borderColor: "var(--color-ink)" }}>
            <span className="t-label flex items-center gap-2 text-ink-faint">
              <CloudOff width={14} height={14} aria-hidden="true" />
              Waiting to send
            </span>
            <p className="t-body-sm mt-2 text-ink-muted">
              A tracking code is issued when the alert reaches the city. Check back here or
              on the Report tab.
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
          <p className="t-body-sm flex items-start gap-2 text-alert">
            <MapPin width={15} height={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            Location services were off, so the city centre was sent instead. Add where you
            actually are below.
          </p>
        )}

        {photoAttached && (
          <p className="t-body-sm text-ink-faint">A photo from your camera was attached.</p>
        )}

        <a href="tel:911" className="saro-btn saro-btn-secondary saro-btn-lg saro-btn-block">
          <PhoneCall width={16} height={16} />
          Call 911 Again
        </a>

        {!queued && (
          <button
            type="button"
            onClick={() => navigate(`/report?panic=${sent.tracking_code}`)}
            className="saro-btn saro-btn-primary saro-btn-lg saro-btn-block"
          >
            Add What Is Happening
            <ChevronRight width={16} height={16} />
          </button>
        )}

        {showConsent && (
          <ConsentNotice dismissible onAcknowledge={() => setShowConsent(false)} />
        )}

        <button type="button" onClick={reset} className="saro-btn saro-btn-ghost saro-btn-block">
          Back
        </button>
      </div>
    );
  }

  /* ── Idle ──────────────────────────────────────────────────────────────── */
  const currentTip = SAFETY_TIPS[tipIndex];
  const TipIcon = currentTip.IconComp;

  return (
    <div className="flex min-h-full flex-col px-4 pb-5 pt-3 gap-3.5 bg-surface">
      {/* ── 1. Primary Safety Focus: Panic Button Card ──────────────────── */}
      <PanicControl
        onFire={handlePanic}
        onHoldStart={warmUp}
        state={state === "sending" ? "sending" : "idle"}
      />

      {state === "failed" && (
        <p role="alert" className="t-body-sm saro-card border-alert p-3 text-alert bg-alert-wash">
          Something went wrong sending that. Call 911 directly — do not wait for this to work.
        </p>
      )}

      {/* ── 2. Live Monitoring & City Situation Snippets ────────────────── */}
      <div className="flex flex-col gap-2 w-full">
        <span className="t-label font-bold text-ink-muted uppercase tracking-wider text-[10px]">
          Live Monitoring &amp; Situation
        </span>

        <div className="flex flex-col gap-2.5 w-full">
          {/* Mayon Alert Status Card */}
          <div
            onClick={() => navigate("/map")}
            className="group flex w-full flex-col gap-2.5 p-3.5 rounded-md bg-surface border border-line hover:border-brand-edge transition-all cursor-pointer shadow-2xs"
          >
            {/* Top Row: Icon + Title + Chevron */}
            <div className="flex items-center justify-between gap-2.5 w-full">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-md bg-amber-50 text-status-assigned-ink border border-amber-200 flex items-center justify-center shrink-0">
                  <Flame className="w-4 h-4" aria-hidden="true" />
                </div>
                <span className="text-[13px] font-bold text-ink leading-tight group-hover:text-brand transition-colors truncate">
                  Mayon Alert Status
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-brand group-hover:translate-x-0.5 transition-all shrink-0" aria-hidden="true" />
            </div>

            {/* Bottom Row: Status Pill + Meta Subtext */}
            <div className="flex items-center justify-between gap-2 w-full pt-2 border-t border-line-faint">
              <div className="flex items-center gap-1.5 shrink-0">
                {volcanicAlert ? (
                  <AlertLevelBadge alert={volcanicAlert} compact />
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-mono bg-emerald-50 text-emerald-800 border border-emerald-200">
                    <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse shrink-0" />
                    <span>Level 0 · Normal</span>
                  </span>
                )}
              </div>
              <span className="text-[11px] text-ink-muted text-right truncate">
                Updated {volcanicAlert?.last_verified_at ? timeSince(volcanicAlert.last_verified_at) : "1d ago"} · PHIVOLCS Bulletin
              </span>
            </div>
          </div>

          {/* Active City Reports Activity Card */}
          <div
            onClick={() => navigate("/map")}
            className="group flex w-full flex-col gap-2.5 p-3.5 rounded-md bg-surface border border-line hover:border-brand-edge transition-all cursor-pointer shadow-2xs"
          >
            <div className="flex items-center justify-between gap-2 w-full">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-md bg-brand-wash text-brand border border-brand-edge flex items-center justify-center shrink-0">
                  <Activity className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[13px] font-bold text-ink leading-tight group-hover:text-brand transition-colors">
                    Active City Reports
                  </span>
                  <span className="text-[10px] font-mono font-bold text-brand bg-brand-wash px-2 py-0.5 rounded border border-brand-edge shrink-0">
                    {reportStats.total} active
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-brand group-hover:translate-x-0.5 transition-all shrink-0" aria-hidden="true" />
            </div>

            <div className="grid grid-cols-3 gap-1.5 w-full pt-1.5 border-t border-line-faint">
              <div className="bg-sunken px-2 py-1.5 rounded border border-line-faint flex flex-col sm:flex-row items-start sm:items-center justify-between gap-0.5 min-w-0">
                <span className="text-[9px] font-bold text-ink-faint uppercase tracking-wider truncate">Received</span>
                <span className="text-xs font-bold font-mono text-ink">{reportStats.received}</span>
              </div>
              <div className="bg-sunken px-2 py-1.5 rounded border border-line-faint flex flex-col sm:flex-row items-start sm:items-center justify-between gap-0.5 min-w-0">
                <span className="text-[9px] font-bold text-ink-faint uppercase tracking-wider truncate">Assigned</span>
                <span className="text-xs font-bold font-mono text-status-assigned-ink">{reportStats.assigned}</span>
              </div>
              <div className="bg-sunken px-2 py-1.5 rounded border border-line-faint flex flex-col sm:flex-row items-start sm:items-center justify-between gap-0.5 min-w-0">
                <span className="text-[9px] font-bold text-ink-faint uppercase tracking-wider truncate">In Progress</span>
                <span className="text-xs font-bold font-mono text-brand">{reportStats.in_progress}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. Civic Services & Reporting ───────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className="t-label font-bold text-ink-muted uppercase tracking-wider text-[10px]">
          Civic Services &amp; Reporting
        </span>

        <div className="grid grid-cols-1 gap-2">
          {/* Describe a Hazard */}
          <button
            type="button"
            onClick={() => navigate("/report")}
            className="group flex w-full items-center gap-3.5 p-3 rounded-md bg-white border border-line border-l-4 border-l-brand hover:border-brand-edge hover:bg-brand-wash/40 transition-all text-left shadow-2xs"
          >
            <div className="w-9 h-9 rounded-md bg-brand-wash text-brand border border-brand-edge flex items-center justify-center shrink-0">
              <PencilLine className="w-4.5 h-4.5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-bold text-ink block leading-tight group-hover:text-brand transition-colors">
                Describe a Hazard
              </span>
              <span className="text-[11px] text-ink-muted block mt-0.5 leading-snug">
                Flooding, road debris, infrastructure damage
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-brand group-hover:translate-x-0.5 transition-all shrink-0" aria-hidden="true" />
          </button>

          {/* Track a Report */}
          <button
            type="button"
            onClick={() => navigate("/track")}
            className="group flex w-full items-center gap-3.5 p-3 rounded-md bg-white border border-line border-l-4 border-l-brand hover:border-brand-edge hover:bg-brand-wash/40 transition-all text-left shadow-2xs"
          >
            <div className="w-9 h-9 rounded-md bg-brand-wash text-brand border border-brand-edge flex items-center justify-center shrink-0">
              <Search className="w-4.5 h-4.5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-bold text-ink block leading-tight group-hover:text-brand transition-colors">
                Track a Report
              </span>
              <span className="text-[11px] text-ink-muted block mt-0.5 leading-snug">
                Check status with your tracking code
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-ink-faint group-hover:text-brand group-hover:translate-x-0.5 transition-all shrink-0" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ── 4. Rotating Safety Advisory Card ────────────────────────────── */}
      <div className="p-3.5 rounded-md border border-line bg-gradient-to-r from-slate-50 to-brand-wash/40 flex flex-col gap-2 shadow-2xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-brand-wash text-brand flex items-center justify-center shrink-0">
              <TipIcon className="w-3.5 h-3.5" aria-hidden="true" />
            </div>
            <div>
              <span className="text-[11px] font-extrabold text-ink block leading-tight">
                {currentTip.title}
              </span>
              <span className="text-[9px] font-semibold text-brand tracking-wide uppercase">
                {currentTip.category}
              </span>
            </div>
          </div>

          {/* Carousel controls */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrevTip}
              className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-md hover:bg-white text-ink-muted active:bg-brand-wash transition-colors"
              aria-label="Previous safety tip"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[10px] font-bold text-ink-faint px-0.5">
              {tipIndex + 1}/{SAFETY_TIPS.length}
            </span>
            <button
              type="button"
              onClick={handleNextTip}
              className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-md hover:bg-white text-ink-muted active:bg-brand-wash transition-colors"
              aria-label="Next safety tip"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <p className="text-[11px] text-ink-muted leading-relaxed">
          {currentTip.tip}
        </p>
      </div>

      {/* ── 5. Command Center Status ─────────────────────────────────────────── */}
      <div className="p-3 rounded-md border border-brand-edge bg-brand-wash flex items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center shrink-0">
            <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <span className="text-[12px] font-bold text-ink leading-tight">Legazpi Command Center</span>
            <span className="text-[10px] text-ink-muted leading-tight mt-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-status-resolved-ink animate-pulse shrink-0 inline-block" />
              Online — CDRRMO 24/7
            </span>
          </div>
        </div>
        <a href="tel:911" className="text-[11px] font-bold px-3 py-1.5 rounded bg-brand text-white hover:bg-brand-mid transition-colors shadow-xs">
          Call 911
        </a>
      </div>

      {/* ── 6. Footer ────────────────────────────────────────────────────────── */}
      <p className="text-[11px] text-ink-faint text-center leading-relaxed pt-0.5">
        SARO is Bikol for &ldquo;one&rdquo;. One front door for emergency reporting &amp; hazard tracking in Legazpi City.
      </p>
    </div>
  );
}

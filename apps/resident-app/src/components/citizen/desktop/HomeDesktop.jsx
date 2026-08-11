import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  PencilLine, Search, PhoneCall, MapPin, ChevronRight,
  CloudOff, Flame, Shield, CloudRain,
  Sparkles, Bot,
} from "lucide-react";
import { AlertLevelBadge } from "@saro/ui";
import {
  createReport, registerPanicFlag, addReportMedia,
  enqueueReport, removeFromOutbox, rememberReport, requestBackgroundSync,
  PANIC_CATEGORY, getVolcanicAlert, getPublicMapReports,
  getCategories, getOffices,
  saroEvents, isReportActiveOnMap, countReportsByStatus,
  listEmergencyCategories, resolveEmergencyRouting,
} from "@saro/shared";
import PanicControl from "../PanicControl";
import ReportTicket from "../ReportTicket";
import ConsentNotice, { consentAcknowledged } from "../ConsentNotice";
import {
  placeEmergencyCall, currentPosition, mayCaptureSilently,
  captureSilentPhoto, deviceId, noteRapidRepeat, FALLBACK_POSITION,
} from "../../../lib/panic";

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
export default function HomeDesktop({ onToggleAccount: _onToggleAccount }) {
  const navigate = useNavigate();

  // Panic state
  const [panicState, setPanicState] = useState("idle");
  const [sent, setSent] = useState(null);
  /** Which agency this S.O.S was routed to — shown on the receipt. */
  const [routed, setRouted] = useState(null);
  /** Routing data for the S.O.S picker, fetched on mount rather than on press. */
  const [categories, setCategories] = useState([]);
  const [offices, setOffices] = useState([]);
  const [imprecise, setImprecise] = useState(false);
  const [photoAttached, setPhotoAttached] = useState(false);
  const [showConsent, setShowConsent] = useState(false);

  // Situational awareness
  const [volcanicAlert, setVolcanicAlert] = useState(null);
  /* Derived, never stored: a second copy of these totals is exactly how this
     card drifted away from the map's own counts. */

  // Live report data for desktop monitoring totals.
  const [reports, setReports] = useState([]);

  useEffect(() => {
    let active = true;

    getVolcanicAlert().then(({ data }) => {
      if (active && data) setVolcanicAlert(data);
    });

    const loadReports = () => {
      getPublicMapReports().then(({ data }) => {
        if (active && data) setReports(data);
      });
    };
    loadReports();

    getCategories().then(({ data }) => { if (active && data) setCategories(data); });
    getOffices().then(({ data }) => { if (active && data) setOffices(data); });

    /* The map screens already refresh on these; without them this card kept
       showing the total from whenever the page happened to load. */
    const offCreated = saroEvents.on("report:created", loadReports);
    const offUpdated = saroEvents.on("report:updated", loadReports);

    return () => { active = false; offCreated(); offUpdated(); };
  }, []);

  /* Straight from routing_table's is_emergency flag, so the picker and the
     dispatcher queue read the same rows. */
  const emergencyCategories = useMemo(
    () => listEmergencyCategories(categories),
    [categories]
  );

  /* Counted over exactly the set the map's "All" chip counts — same source,
     same archive rule — so the two screens can never disagree. */
  const activeReports = useMemo(() => reports.filter((r) => isReportActiveOnMap(r)), [reports]);
  const reportStats = useMemo(() => ({
    ...countReportsByStatus(activeReports, ["received", "assigned", "in_progress", "resolved"]),
    total: activeReports.length,
  }), [activeReports]);

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

  /**
   * The resident has chosen what kind of emergency this is. Same ordering as
   * before — the voice call goes first — but the number now comes from the
   * city's own routing rather than a single generic line.
   */
  const handleEmergency = useCallback(async (categoryId) => {
    setPanicState("sending");

    const routing = resolveEmergencyRouting(categoryId, { categories, offices });
    setRouted(routing);

    // 1. Call first
    placeEmergencyCall(routing.dial);
    const id = deviceId();
    const wasRapid = noteRapidRepeat();
    registerPanicFlag(id).catch(() => {});

    // 2. Position
    const position = await Promise.race([
      positionRef.current ?? currentPosition(),
      new Promise((resolve) => setTimeout(() => resolve({ ...FALLBACK_POSITION }), 2500)),
    ]);
    setImprecise(!position.precise);

    const hint = `S.O.S — ${routing.categoryLabel}. Routed to ${routing.agencyName}.`;
    const payload = {
      /* The chosen category, so the report lands in the same office queue the
         call just reached. */
      category: routing.categoryId || PANIC_CATEGORY,
      description: wasRapid ? `${hint} Repeat press within 15 minutes.` : hint,
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
  }, [categories, offices]);

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
    setRouted(null);
  };

  const showReceipt = panicState === "sent" || panicState === "queued";
  const queued = panicState === "queued";

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas text-ink font-sans">

      {/* ── Left panel (Expanded 440px / xl:460px) ─────────────────────────── */}
      {/* The desk panel holds one control, so it gives width back to the
          dashboard on narrower laptops instead of squeezing it to a column
          where the stat labels truncate. */}
      <aside
        className="flex w-[340px] lg:w-[380px] xl:w-[400px] 2xl:w-[440px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface"
        aria-label="Home — situation and reporting"
      >
        {/* Panel header */}
        <div className="border-b border-line px-5 py-3.5">
          <h1 className="text-sm font-bold text-ink">Legazpi City Emergency Desk</h1>
          <p className="text-xs text-ink-faint mt-0.5">Call, alert, and receive your tracking record</p>
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
                {/* Naming the agency matters: the person needs to know who is
                    on the other end of the call they are now on. */}
                <p className="text-xs text-ink-muted leading-relaxed">
                  {queued
                    ? `You are through to ${routed?.agencyName ?? "Legazpi 911"} by phone. Your location could not be sent yet — SARO will keep trying and send it the moment signal returns, even if you close this app.`
                    : `${routed?.agencyName ?? "Legazpi 911"} has your location. Stay on the call if you can.`}
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
                  categoryLabel={
                    routed?.categoryLabel
                      ? `Emergency S.O.S — ${routed.categoryLabel}`
                      : "Emergency — S.O.S Alert"
                  }
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

              {/* Redials the agency this S.O.S actually routed to, not a
                  generic line the caller was never connected to. */}
              <a
                href={`tel:${routed?.dial ?? "911"}`}
                className="saro-btn saro-btn-secondary saro-btn-block py-2.5"
              >
                <PhoneCall width={15} height={15} />
                Call {routed?.agencyName ?? "911"} Again
              </a>

              {!queued && (
                <button
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams({
                      panic: sent.tracking_code,
                      sos_id: sent.id,
                      category: sent.category,
                    });
                    navigate(`/report?${params}`, {
                      state: {
                        sosReport: {
                          id: sent.id,
                          tracking_code: sent.tracking_code,
                          category: sent.category,
                          status: sent.status,
                          created_at: sent.created_at,
                        },
                      },
                    });
                  }}
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
            /* The desk column exists for one control, and a lone red card at the
               top of an empty column read as an accident of layout. The S.O.S
               now sits in a labelled section with the three things it does
               underneath it — the same behaviour, given a reason to occupy the
               space it takes up. */
            <div className="flex flex-col gap-5">
              <PanicControl
                onSelectEmergency={handleEmergency}
                onHoldStart={warmUp}
                state={panicState === "sending" ? "sending" : "idle"}
                emergencyCategories={emergencyCategories}
              />

              <section aria-label="What pressing S.O.S does" className="saro-card overflow-hidden">
                <h2 className="border-b border-line bg-raised px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  What happens when you press it
                </h2>
                <ol className="divide-y divide-line">
                  {[
                    [PhoneCall, "Your phone dials first", "The call is placed to the office that handles that emergency — not a general line."],
                    [MapPin, "Your location goes with it", "Sent as the call connects, so responders are not asking you where you are."],
                    [Sparkles, "You get a tracking record", "One report is created and given a code you can check later."],
                  ].map(([Icon, title, copy]) => (
                    <li key={title} className="flex items-start gap-3 px-4 py-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-brand-edge bg-brand-wash text-brand">
                        <Icon width={14} height={14} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold leading-tight text-ink">{title}</span>
                        <span className="mt-1 block text-[11px] leading-relaxed text-ink-muted">{copy}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              <p className="text-[11px] leading-relaxed text-ink-faint">
                No account is needed for an emergency. If the hazard is not urgent, use{" "}
                <button
                  type="button"
                  onClick={() => navigate("/report")}
                  className="font-bold text-brand hover:underline"
                >
                  Describe a Hazard
                </button>{" "}
                instead so it reaches the right office with the detail they need.
              </p>
            </div>
          )}

        </div>
      </aside>

      {/* ── Right panel: the resident's command view ────────────────────────
       *
       * Three bands, in the order somebody actually reads them: what the city
       * looks like right now, what they can do about it, and what to prepare
       * for. Each band is one bordered surface with internal hairline
       * divisions rather than a stack of separately floating cards — the
       * dashboard reads as one instrument panel that way, and the eye has a
       * single left edge to travel down.
       */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-canvas">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-7 p-6 xl:p-8">
          <header className="flex items-end justify-between gap-6 border-b border-line pb-5">
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-faint">Resident command view</span>
              <h2 className="mt-1 text-2xl font-bold leading-tight text-ink">City situation and civic services</h2>
              <p className="mt-1.5 text-sm text-ink-muted">Report a concern, follow city response, or open the full operational map.</p>
            </div>
            <button type="button" onClick={() => navigate("/map")} className="saro-btn saro-btn-secondary shrink-0">
              <MapPin width={15} height={15} /> Open full hazard map
            </button>
          </header>

          {/* ── Band 1: live situation ─────────────────────────────────────
           * The counts and the advisory that qualifies them share one card:
           * they answer the same question and are read together. The status
           * dots repeat the map's own colours so a number here and a pin
           * there are recognisably the same thing.
           */}
          <section aria-label="Live city situation" className="saro-card overflow-hidden shadow-2xs">
            <div className="grid grid-cols-4">
              {[
                ["Active reports", reportStats.total, "text-ink", null],
                ["Received", reportStats.received, "text-ink", "#94A3B8"],
                ["Assigned", reportStats.assigned, "text-status-assigned-ink", "#F59E0B"],
                ["In progress", reportStats.in_progress, "text-brand", "#0060A9"],
              ].map(([label, value, tone, dot], index) => (
                <div key={label} className={`flex flex-col gap-1 px-4 py-4 xl:px-5 ${index ? "border-l border-line" : ""}`}>
                  <span className={`font-mono text-[30px] font-bold leading-none xl:text-[32px] ${tone}`}>{value ?? 0}</span>
                  {/* Labels wrap rather than truncate: "Active reports" losing
                      its second word is worse than taking a second line. */}
                  <span className="flex items-start gap-1.5 text-[11px] font-bold uppercase leading-tight tracking-wide text-ink-faint">
                    {dot && <span className="mt-[3px] h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden="true" />}
                    <span>{label}</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-start justify-between gap-5 border-t border-line bg-raised px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-sm font-bold text-ink">Mayon volcanic advisory</h3>
                  {volcanicAlert
                    ? <AlertLevelBadge alert={volcanicAlert} compact />
                    : <span className="text-xs font-bold text-status-resolved-ink">Level 0 · Normal</span>}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                  Verified {volcanicAlert?.last_verified_at ? timeSince(volcanicAlert.last_verified_at) : "recently"}. The hazard map carries danger zones, rainfall, evacuation centers, and live incident pins.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/map")}
                className="shrink-0 whitespace-nowrap text-xs font-bold text-brand hover:underline"
              >
                Review all live layers →
              </button>
            </div>
          </section>

          {/* ── Band 2: what the resident can do ───────────────────────── */}
          <section aria-labelledby="civic-services-heading">
            <h3 id="civic-services-heading" className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              Civic services
            </h3>
            <div className="saro-card grid grid-cols-3 overflow-hidden shadow-2xs">
              {[
                [PencilLine, "Describe a Hazard", "Report flooding, road damage, or structural risk.", "/report"],
                [Search, "Track a Report", "Follow progress using your tracking code.", "/track"],
                [Bot, "Ask the Assistant", "Find hotlines, centers, and preparedness guidance.", "/assistant"],
              ].map(([Icon, title, copy, path], index) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => navigate(path)}
                  className={`group flex flex-col p-5 text-left transition-colors hover:bg-raised ${index ? "border-l border-line" : ""}`}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-md border border-brand-edge bg-brand-wash text-brand">
                    <Icon width={18} height={18} aria-hidden="true" />
                  </span>
                  <span className="mt-4 flex items-baseline gap-1.5 text-sm font-bold text-ink group-hover:text-brand">
                    <span className="min-w-0">{title}</span>
                    <ChevronRight width={14} height={14} className="shrink-0 translate-y-0.5 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden="true" />
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{copy}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ── Band 3: what to prepare for ────────────────────────────── */}
          <section aria-labelledby="preparedness-heading">
            <h3 id="preparedness-heading" className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              Preparedness desk
            </h3>
            {/* gap-px over a line-coloured bed draws hairline rules between the
                tips without doubling borders where two cards meet. */}
            <div className="saro-card grid grid-cols-2 gap-px overflow-hidden bg-line shadow-2xs">
              {SAFETY_TIPS.map((tip) => {
                const Icon = tip.IconComp;
                return (
                  <article key={tip.id} className="flex flex-col bg-surface p-5">
                    <div className="flex items-center gap-2">
                      <Icon width={15} height={15} className="shrink-0 text-brand" aria-hidden="true" />
                      <h4 className="text-xs font-bold text-ink">{tip.title}</h4>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-ink-muted">{tip.tip}</p>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </main>

    </div>
  );
}

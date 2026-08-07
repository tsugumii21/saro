import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PencilLine, Search, PhoneCall, MapPin, ChevronRight, CloudOff } from "lucide-react";
import { Wordmark } from "@saro/ui";
import {
  createReport, registerPanicFlag, addReportMedia, enqueueReport, removeFromOutbox,
  rememberReport, requestBackgroundSync, PANIC_CATEGORY,
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

export default function CitizenLandingScreen() {
  const navigate = useNavigate();

  // idle | sending | sent | queued | failed
  const [state, setState] = useState("idle");
  const [sent, setSent] = useState(null);
  const [imprecise, setImprecise] = useState(false);
  const [photoAttached, setPhotoAttached] = useState(false);
  const [showConsent, setShowConsent] = useState(false);

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
    registerPanicFlag(id).catch(() => {});

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
          Call 911 again
        </a>

        {!queued && (
          <button
            type="button"
            onClick={() => navigate(`/report?panic=${sent.tracking_code}`)}
            className="saro-btn saro-btn-primary saro-btn-lg saro-btn-block"
          >
            Add what is happening
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
  return (
    <div className="flex min-h-full flex-col px-4 pb-6 pt-4">
      <header className="mb-4 flex items-center justify-between">
        <Wordmark size="sm" />
        <a href="tel:911" className="t-label inline-flex items-center gap-1.5 px-2 py-1 text-ink-muted">
          <PhoneCall width={13} height={13} aria-hidden="true" />
          Call 911
        </a>
      </header>

      <PanicControl
        onFire={handlePanic}
        onHoldStart={warmUp}
        state={state === "sending" ? "sending" : "idle"}
      />

      {state === "failed" && (
        <p role="alert" className="t-body-sm saro-card mt-4 border-alert p-3 text-alert">
          Something went wrong sending that. Call 911 directly — do not wait for this to work.
        </p>
      )}

      <div className="mt-7">
        <span className="t-label text-ink-faint">Not an emergency</span>

        <div className="mt-3 flex flex-col">
          <button
            type="button"
            onClick={() => navigate("/report")}
            className="flex w-full items-center gap-4 border-b border-line py-4 text-left"
          >
            <PencilLine width={20} height={20} className="text-brand" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="t-subhead block">Describe a problem</span>
              <span className="t-body-sm block text-ink-muted">
                Flooding, a broken drain, a pothole, debris
              </span>
            </span>
            <ChevronRight width={18} height={18} className="text-ink-faint" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => navigate("/track")}
            className="flex w-full items-center gap-4 border-b border-line py-4 text-left"
          >
            <Search width={20} height={20} className="text-brand" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="t-subhead block">Check a code</span>
              <span className="t-body-sm block text-ink-muted">
                See what happened to a report you filed
              </span>
            </span>
            <ChevronRight width={18} height={18} className="text-ink-faint" aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="t-body-sm mt-auto pt-8 text-ink-faint">
        SARO is Bikol for “one”. One place to report anything in Legazpi City — we send it
        to the right office for you.
      </p>
    </div>
  );
}

import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PencilLine, Search, PhoneCall, MapPin, ChevronRight } from "lucide-react";
import { Wordmark, TrackingCode } from "@saro/ui";
import { createReport, registerPanicFlag, CLIENT_STORAGE_KEYS } from "@saro/shared";
import PanicControl from "./PanicControl";

/**
 * Resident home — the Panic screen.
 *
 * What the old version was: a scrolling stack of eight equal-weight cards —
 * hero, quick stats, four action tiles, an office directory, a hotline list.
 * Nothing dominated, so under stress everything had to be read. That is the
 * failure this screen exists to fix.
 *
 * What it is now: one object, one decision. Panic occupies roughly half the
 * viewport and is the only saturated colour on the screen. Everything else is
 * ink on card and deliberately quiet — Describe and Check sit below the fold
 * line of attention, reachable but never competing. If you arrive here in an
 * emergency you do not read this screen; you press the red thing.
 *
 * The hotline row stays because a phone call is still the right answer for
 * some people, and hiding it to push app usage would be a product lying about
 * its own purpose.
 */

const EMERGENCY_CATEGORY = "emergency_unspecified";

function deviceId() {
  let id = localStorage.getItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT);
  if (!id) {
    id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT, id);
  }
  return id;
}

/** Legazpi city centre, used only when the device refuses or delays a fix. */
const FALLBACK = { lat: 13.1391, lng: 123.7438 };

function currentPosition(timeout = 6000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ ...FALLBACK, precise: false });
    const done = setTimeout(() => resolve({ ...FALLBACK, precise: false }), timeout);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(done);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, precise: true });
      },
      () => {
        clearTimeout(done);
        resolve({ ...FALLBACK, precise: false });
      },
      { enableHighAccuracy: true, timeout, maximumAge: 30000 }
    );
  });
}

export default function CitizenLandingScreen() {
  const navigate = useNavigate();
  const [state, setState] = useState("idle"); // idle | sending | sent | failed
  const [sent, setSent] = useState(null);
  const [imprecise, setImprecise] = useState(false);

  const handlePanic = useCallback(async () => {
    setState("sending");
    const id = deviceId();

    // Fire and forget: the counter must never delay the report itself.
    registerPanicFlag(id).catch(() => {});

    const pos = await currentPosition();
    setImprecise(!pos.precise);

    const { data, error } = await createReport({
      category: EMERGENCY_CATEGORY,
      description: "Panic alert. No detail given yet.",
      lat: pos.lat,
      lng: pos.lng,
      anonymous: true,
      device_fingerprint: id,
    });

    if (error || !data) {
      setState("failed");
      return;
    }
    setSent(data);
    setState("sent");
  }, []);

  /* ── Sent: the receipt ────────────────────────────────────────────────
   * One card, one code, one next step. The relief state is calm on purpose —
   * no celebration, no green tick theatre. Someone is still in trouble.
   */
  if (state === "sent" && sent) {
    return (
      <div className="flex min-h-full flex-col gap-5 px-4 pb-8 pt-5">
        <div className="saro-clip saro-rise saro-card p-5" style={{ borderColor: "var(--color-panic)" }}>
          <span className="saro-stamp" style={{ color: "var(--color-panic-strong)" }}>
            Alert sent
          </span>

          <p className="t-body mt-4" style={{ color: "var(--color-ink-muted)" }}>
            Legazpi 911 has your location. Keep this code — it is how you and
            anyone helping you can check this alert.
          </p>

          <div className="mt-5 border-t pt-5" style={{ borderColor: "var(--color-rule)" }}>
            <span className="t-label" style={{ color: "var(--color-ink-faint)" }}>
              Your code
            </span>
            <div className="mt-2">
              <TrackingCode code={sent.tracking_code} size="xl" />
            </div>
          </div>

          {imprecise && (
            <p className="t-body-sm mt-4 flex items-start gap-2" style={{ color: "var(--color-alert)" }}>
              <MapPin width={15} height={15} className="mt-0.5 shrink-0" />
              Location services were off, so we sent the city centre. Add the real
              place below if you can.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => navigate(`/report?panic=${sent.tracking_code}`)}
          className="saro-btn saro-btn-primary saro-btn-lg saro-btn-block"
        >
          Add what is happening
          <ChevronRight width={16} height={16} />
        </button>

        <a href="tel:911" className="saro-btn saro-btn-secondary saro-btn-lg saro-btn-block">
          <PhoneCall width={16} height={16} />
          Call 911 now
        </a>

        <button
          type="button"
          onClick={() => { setState("idle"); setSent(null); }}
          className="saro-btn saro-btn-ghost saro-btn-block"
        >
          Back
        </button>
      </div>
    );
  }

  /* ── Idle: Panic first, everything else after ─────────────────────────── */
  return (
    <div className="flex min-h-full flex-col px-4 pb-6 pt-4">
      <header className="mb-4 flex items-center justify-between">
        <Wordmark size="sm" />
        <a
          href="tel:911"
          className="t-label inline-flex items-center gap-1.5 px-2 py-1"
          style={{ color: "var(--color-ink-muted)" }}
        >
          <PhoneCall width={13} height={13} />
          Call 911
        </a>
      </header>

      <PanicControl onFire={handlePanic} state={state === "sending" ? "sending" : "idle"} />

      {state === "failed" && (
        <p
          role="alert"
          className="t-body-sm saro-card mt-4 p-3"
          style={{ color: "var(--color-alert)", borderColor: "var(--color-alert)" }}
        >
          We could not send that. Call 911 directly — do not wait for this to work.
        </p>
      )}

      {/* Everything below is deliberately quiet: hairline rules, ink on card,
          no fills. Two routes, in the order people actually need them. */}
      <div className="mt-7">
        <span className="t-label" style={{ color: "var(--color-ink-faint)" }}>
          Not an emergency
        </span>

        <div className="mt-3 divide-y" style={{ borderColor: "var(--color-line)" }}>
          <button
            type="button"
            onClick={() => navigate("/report")}
            className="flex w-full items-center gap-4 py-4 text-left"
            style={{ borderColor: "var(--color-line)" }}
          >
            <PencilLine width={20} height={20} style={{ color: "var(--color-brand)" }} />
            <span className="min-w-0 flex-1">
              <span className="t-subhead block">Describe a problem</span>
              <span className="t-body-sm block" style={{ color: "var(--color-ink-muted)" }}>
                Flooding, a broken drain, a pothole, debris
              </span>
            </span>
            <ChevronRight width={18} height={18} style={{ color: "var(--color-ink-faint)" }} />
          </button>

          <button
            type="button"
            onClick={() => navigate("/track")}
            className="flex w-full items-center gap-4 py-4 text-left"
            style={{ borderTop: "1px solid var(--color-line)" }}
          >
            <Search width={20} height={20} style={{ color: "var(--color-brand)" }} />
            <span className="min-w-0 flex-1">
              <span className="t-subhead block">Check a code</span>
              <span className="t-body-sm block" style={{ color: "var(--color-ink-muted)" }}>
                See what happened to a report you filed
              </span>
            </span>
            <ChevronRight width={18} height={18} style={{ color: "var(--color-ink-faint)" }} />
          </button>
        </div>
      </div>

      <p className="t-body-sm mt-auto pt-8" style={{ color: "var(--color-ink-faint)" }}>
        SARO is Bikol for “one”. One place to report anything in Legazpi City —
        we send it to the right office for you.
      </p>
    </div>
  );
}

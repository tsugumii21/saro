/**
 * The mechanics of a Panic press: placing the call, warming up the payload,
 * and capturing the scene.
 *
 * Split out of the screen because these are the parts where getting the
 * ordering wrong has consequences, and they deserve to be readable on their
 * own.
 */

import { EMERGENCY_NUMBER, CLIENT_STORAGE_KEYS, PANIC_REPEAT_WINDOW_MS } from "@saro/shared";
import { consentAcknowledged } from "../components/citizen/ConsentNotice.jsx";

/** Legazpi city centre. Used only when the device gives us nothing better. */
export const FALLBACK_POSITION = { lat: 13.1391, lng: 123.7438, precise: false };

/* ── Placing the call ─────────────────────────────────────────────────────── */

/**
 * Hand 911 to the system dialer.
 *
 * What the web can and cannot do here, stated plainly because the difference
 * matters for a safety feature: a browser cannot dial a number. It can only
 * hand the number to the OS. Android opens the dialer with 911 filled in and
 * generally places the call; iOS shows a "Call 911?" confirmation the person
 * must accept. Neither is SARO placing a call, and no web app can do better —
 * the platforms forbid it precisely so a web page cannot swat someone.
 *
 * What SARO CAN guarantee, and does:
 *   - the handoff happens over cellular voice, which needs no data at all, so
 *     it works when the report cannot be sent
 *   - it is never gated on consent, login, geolocation, or the report insert
 *   - it happens first
 *
 * Implemented as a synthetic anchor click rather than `location.href = ...`
 * because assigning to location during a pointer event is treated as a
 * navigation by some mobile browsers and can tear down the page mid-flight,
 * taking the queued payload's in-progress work with it. An anchor with
 * target="_self" and a tel: scheme is handled by the OS as an external handoff
 * and leaves the document alone.
 *
 * The number comes from the city's own routing — routing_table picks the office
 * for the chosen emergency and offices.hotline supplies its line. It defaults to
 * the national emergency number so a missing or unrouted category still reaches
 * somebody rather than dialling nothing.
 *
 * @param {string} [number] Digits to hand the dialer. Defaults to EMERGENCY_NUMBER.
 * @returns {boolean} whether the handoff was attempted
 */
export function placeEmergencyCall(number = EMERGENCY_NUMBER) {
  try {
    const dial = String(number || EMERGENCY_NUMBER).trim() || EMERGENCY_NUMBER;
    const link = document.createElement("a");
    link.href = `tel:${dial}`;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch {
    return false;
  }
}

/* ── Location ─────────────────────────────────────────────────────────────── */

/**
 * A position, always. Never rejects, never hangs.
 *
 * The timeout is the point. `getCurrentPosition` can sit for a minute indoors
 * with no error, and an alert that waits for a perfect fix is an alert that
 * never sends. Six seconds, then the city centre with `precise: false` so the
 * UI can tell the person their exact location was not included and ask them to
 * add it.
 */
export function currentPosition(timeout = 6000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ ...FALLBACK_POSITION });

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => finish({ ...FALLBACK_POSITION }), timeout);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        finish({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          precise: true,
        });
      },
      () => {
        clearTimeout(timer);
        finish({ ...FALLBACK_POSITION });
      },
      { enableHighAccuracy: true, timeout, maximumAge: 30_000 }
    );
  });
}

/* ── The silent photo ─────────────────────────────────────────────────────── */

/**
 * Whether SARO may take a photo without asking, right now.
 *
 * Two conditions, both required:
 *
 *   1. The RA 10173 notice has been acknowledged on this device. This is why
 *      the very first Panic press on a new phone never captures: at that moment
 *      the person has not yet been told SARO does this. Location on a first
 *      press is defensible without prior notice — it is what makes help
 *      arrive — but a camera frame is not, and taking one anyway would make
 *      the notice a formality shown after the fact.
 *
 *   2. Camera permission is ALREADY granted. Never prompted for. A permission
 *      dialog during a panic press is a modal between a frightened person and
 *      their emergency, and "Block" is one tap away.
 *
 * The Permissions API is missing on Safari, which reports `undefined` for the
 * camera query. That returns false here: no capture rather than a surprise
 * prompt. Fewer photos is the correct failure direction.
 */
export async function mayCaptureSilently() {
  try {
    if (!consentAcknowledged()) return false;
    if (!navigator.mediaDevices?.getUserMedia) return false;
    if (!navigator.permissions?.query) return false;

    const status = await navigator.permissions.query({ name: "camera" });
    return status.state === "granted";
  } catch {
    return false;
  }
}

/**
 * Grab a single frame from the rear camera and shut it down again.
 *
 * Total camera-on time is a few hundred milliseconds. Resolution is capped and
 * the JPEG heavily compressed because this travels over whatever signal is left
 * during an emergency, and a photo that does not arrive is worth nothing.
 *
 * @returns {Promise<string|null>} a data URL, or null if anything went wrong
 */
export async function captureSilentPhoto() {
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    // One frame of settle time. Grabbing at t=0 reliably yields black.
    await new Promise((resolve) => setTimeout(resolve, 220));

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

    video.pause();
    video.srcObject = null;

    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

/* ── Device identity and the repeat window ───────────────────────────────── */

export function deviceId() {
  try {
    let id = localStorage.getItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT);
    if (!id) {
      id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT, id);
    }
    return id;
  } catch {
    // Storage blocked. A per-session id still satisfies the database's
    // exactly-one-reporter rule, so the report files; it just will not appear
    // in "reports from this device" later. Filing wins.
    return `dev_session_${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * Was there another press within the last 15 minutes?
 *
 * Local, advisory, and reported to `panic_flags` for dispatchers only. It never
 * blocks, delays, warns, or changes anything the person sees. A device pressing
 * repeatedly is far more likely to be someone whose first alert brought nobody
 * than an abuser, and a panic control that argues with you is not one.
 */
export function noteRapidRepeat() {
  try {
    const previous = Number(localStorage.getItem(CLIENT_STORAGE_KEYS.PANIC_LAST_AT) || 0);
    const now = Date.now();
    localStorage.setItem(CLIENT_STORAGE_KEYS.PANIC_LAST_AT, String(now));
    return previous > 0 && now - previous < PANIC_REPEAT_WINDOW_MS;
  } catch {
    return false;
  }
}

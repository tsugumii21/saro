/**
 * Web Push subscription.
 *
 * Opt-in, and opt-in in the strict sense: this module is never called on app
 * open. A browser permission prompt fired at someone who has not asked for
 * notifications is one tap from "Blocked forever", and a resident who blocks
 * SARO on their first visit cannot be told their report was resolved. The
 * prompt appears only after an explicit "Notify me" tap.
 *
 * No phone number is involved at any point. A subscription is tied to an
 * account when there is one and to the device id when there is not, which is
 * the same exactly-one rule reports follow.
 */

import { supabase } from "./supabase/client.js";
import { CLIENT_STORAGE_KEYS } from "./constants.js";

/** Public half of the VAPID pair. Safe to ship — it is the identifier the push
 *  service checks the private-key signature against. The private half is a
 *  Supabase secret and exists nowhere in this repository. */
const VAPID_PUBLIC_KEY = import.meta.env?.VITE_VAPID_PUBLIC_KEY ?? "";

/** Push services want the application server key as a Uint8Array. */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Whether this browser can do Web Push at all. iOS supports it only from an
 *  installed home-screen app, so this is false in Safari until SARO is added. */
export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    Boolean(VAPID_PUBLIC_KEY)
  );
}

/** @returns {"granted"|"denied"|"default"|"unsupported"} */
export function pushPermission() {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

/** The active subscription, or null. Used to render the toggle's real state
 *  rather than a remembered one — permissions change outside the app. */
export async function currentPushSubscription() {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Ask for permission, subscribe, and store the subscription in Supabase.
 *
 * Call this from a click handler and nowhere else.
 *
 * @returns {Promise<{ data: object|null, error: string|null }>}
 */
export async function subscribeToPush() {
  if (!pushSupported()) {
    return { data: null, error: "This browser can't do notifications. On iPhone, add SARO to your Home Screen first." };
  }

  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { data: null, error: "Could not ask for notification permission." };
  }

  if (permission !== "granted") {
    return {
      data: null,
      error:
        permission === "denied"
          ? "Notifications are blocked for SARO. You can turn them back on in your browser's site settings."
          : "Notifications were not enabled.",
    };
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        // Required by Chrome: SARO may only push messages the resident sees.
        // No silent background pushes, which is the right constraint for a
        // civic app — every push here corresponds to a real status change.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = subscription.toJSON();

    let deviceId = null;
    try {
      deviceId = localStorage.getItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT);
      if (!deviceId) {
        deviceId = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT, deviceId);
      }
    } catch { /* private mode; the RPC falls back to the account id */ }

    // Written through an RPC rather than a table upsert. anon has no UPDATE on
    // this table on purpose — granting it would let any anonymous caller
    // deactivate or repoint somebody else's subscription, since RLS cannot
    // verify a client-supplied device id. See migration 13.
    const { error } = await supabase.rpc("upsert_push_subscription", {
      p_endpoint: subscription.endpoint,
      p_p256dh: json.keys?.p256dh ?? bufferToBase64Url(subscription.getKey("p256dh")),
      p_auth_key: json.keys?.auth ?? bufferToBase64Url(subscription.getKey("auth")),
      p_device_id: deviceId,
      p_user_agent: navigator.userAgent.slice(0, 300),
    });

    if (error) return { data: null, error: error.message };
    return { data: { endpoint: subscription.endpoint }, error: null };
  } catch (err) {
    return { data: null, error: err?.message ?? "Could not enable notifications." };
  }
}

/** Unsubscribe locally and mark the row inactive. The row is kept, not deleted,
 *  so a dead endpoint is not silently re-created by a stale service worker. */
export async function unsubscribeFromPush() {
  try {
    const subscription = await currentPushSubscription();
    if (!subscription) return { data: null, error: null };

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await supabase.rpc("deactivate_push_subscription", { p_endpoint: endpoint });

    return { data: null, error: null };
  } catch (err) {
    return { data: null, error: err?.message ?? "Could not turn notifications off." };
  }
}

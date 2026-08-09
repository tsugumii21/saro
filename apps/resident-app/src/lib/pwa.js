/**
 * Service-worker registration and the handoff of config into IndexedDB.
 *
 * Called once from main.jsx. Everything here is best-effort: SARO must work
 * identically in a browser with no service-worker support, in a private window
 * where registration is refused, and on the first load before the worker has
 * activated. Nothing in the reporting path is conditional on any of it.
 */

import { setSyncConfig } from "@saro/shared";

export function registerServiceWorker() {
  if (typeof window === "undefined") return;

  // Hand the worker the project URL and publishable key. It is served from
  // public/ and never sees import.meta.env, so this is the only way it can
  // deliver a queued report after the tab is gone.
  setSyncConfig({
    url: import.meta.env.VITE_SUPABASE_URL,
    key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  }).catch(() => {});

  if (!("serviceWorker" in navigator)) return;

  // In development mode (localhost), unregister any active service worker to
  // prevent stale asset caching that causes blank white screen on normal refresh.
  if (import.meta.env.DEV || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    });
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err?.message);
    });
  });
}

/**
 * Ask for Periodic Background Sync.
 *
 * Chromium-only, installed PWAs only, and granted on a site-engagement score
 * the app cannot influence. When it works, a report queued during a blackout
 * can be delivered hours later without anyone reopening SARO. When it does not,
 * one-shot Background Sync and the page's own triggers still cover it.
 */
export async function requestPeriodicSync() {
  try {
    if (!("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    if (!("periodicSync" in registration)) return false;

    const status = await navigator.permissions.query({ name: "periodic-background-sync" });
    if (status.state !== "granted") return false;

    await registration.periodicSync.register("saro-outbox", {
      minInterval: 60 * 60 * 1000,
    });
    return true;
  } catch {
    return false;
  }
}

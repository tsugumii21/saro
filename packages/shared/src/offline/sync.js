/**
 * Draining the outbox.
 *
 * There are two drainers and they do not overlap by accident:
 *
 *   this file            runs in the page. Has a Supabase client, a live auth
 *                        session, and can therefore deliver BOTH anonymous and
 *                        signed-in reports.
 *
 *   public/sw.js         runs in the service worker, woken by Background Sync
 *                        after the page is closed. Has no session, so it
 *                        delivers ANONYMOUS reports only — which is precisely
 *                        the set that matters most: Panic and every emergency
 *                        Describe are anonymous by design.
 *
 * A signed-in resident's standard, non-urgent report is the one case that waits
 * for the app to be opened again. That is the correct thing to trade away: it
 * is by definition not urgent, and the alternative is stashing a refresh token
 * in IndexedDB for a background process to use, which is a much worse idea than
 * a pothole report arriving an hour later.
 */

import { listOutbox, removeFromOutbox, recordOutboxFailure } from "./db.js";
import { createReport, updateSosReportDetails } from "../api/index.js";
import { rememberReport } from "./db.js";

/** Errors that mean "try again later" rather than "this will never work". */
function isTransient(message = "") {
  const m = message.toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("load failed") ||
    m.includes("timeout") ||
    m.includes("fetch failed")
  );
}

let flushing = false;

/**
 * Attempt delivery of everything in the outbox, oldest first.
 *
 * Safe to call repeatedly and from several triggers at once — the `flushing`
 * guard means a page that fires `online`, a visibility change and a manual
 * retry in the same second still only runs one pass.
 *
 * @returns {Promise<{ sent: Array<object>, remaining: number }>}
 */
export async function flushOutbox() {
  if (flushing) return { sent: [], remaining: await pendingCount() };
  flushing = true;

  const sent = [];
  try {
    const queued = await listOutbox();

    for (const row of queued) {
      const write = row.operation === "update_sos"
        ? updateSosReportDetails
        : createReport;
      const { data, error } = await write(row.payload);

      if (!error && data) {
        await removeFromOutbox(row.id);
        if (row.operation !== "update_sos") {
          await rememberReport({
            tracking_code: data.tracking_code,
            category: data.category,
            status: data.status,
            kind: row.kind,
            created_at: data.created_at,
          });
        }
        sent.push({ ...data, queueId: row.id, kind: row.kind });
        continue;
      }

      await recordOutboxFailure(row.id, error);

      // A permanent failure is still kept, not dropped. A report the database
      // rejected is a bug in SARO, not a mistake by the person who filed it,
      // and silently deleting their report to keep the queue tidy is the worst
      // possible response. It stays visible in "Waiting to send" with its error
      // so it can be retried after a fix ships.
      if (isTransient(error)) break;   // network is down; stop trying the rest
    }
  } finally {
    flushing = false;
  }

  return { sent, remaining: await pendingCount() };
}

async function pendingCount() {
  return (await listOutbox()).length;
}

/**
 * Wire the page's drain triggers. Returns a teardown function.
 *
 * Three triggers, because each covers a case the others miss:
 *   online            the obvious one — signal came back while the app is open
 *   visibilitychange  the phone was in a pocket with the screen off; `online`
 *                     may have fired while the tab was frozen and been missed
 *   interval          a connection that reports `navigator.onLine === true`
 *                     while sitting behind a captive portal or a dead cell
 *                     never fires an event at all
 *
 * @param {(result: { sent: Array<object>, remaining: number }) => void} [onResult]
 */
export function startOutboxSync(onResult) {
  const run = () => flushOutbox().then((result) => {
    if (result.sent.length || result.remaining) onResult?.(result);
  });

  const onOnline = () => run();
  const onVisible = () => { if (document.visibilityState === "visible") run(); };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(run, 60_000);

  run();

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(timer);
  };
}

/**
 * Ask the service worker to retry after the page closes.
 *
 * Background Sync is Chromium-only. Where it is missing (every iOS browser,
 * Firefox) this resolves false and the page-side triggers above are the whole
 * story — the report still sends, just only while SARO is open. Nothing is
 * conditional on this succeeding.
 *
 * @returns {Promise<boolean>} whether a background retry was actually scheduled
 */
export async function requestBackgroundSync() {
  try {
    if (!("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    if (!("sync" in registration)) return false;
    await registration.sync.register("saro-outbox");
    return true;
  } catch {
    return false;
  }
}

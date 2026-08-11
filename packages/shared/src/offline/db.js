/**
 * IndexedDB for SARO's resident app.
 *
 * Two stores, two different jobs:
 *
 *   outbox      Reports that have been created but not yet accepted by
 *               Supabase. A row here means "this person has reported
 *               something and we owe them delivery". Drained by the service
 *               worker's background sync, or by the page on `online`.
 *
 *   my_reports  Tracking codes seen on this device. Pure convenience — losing
 *               it loses nothing, because the report itself lives in Postgres
 *               and is recoverable by code forever. The UI says so explicitly.
 *
 * No wrapper library. `idb` is 4KB and pleasant, but this file is the thing
 * standing between a person's report and the void when the network is gone,
 * and it is small enough to read in full. Fewer moving parts is the feature.
 *
 * Everything degrades rather than throws. A browser in private mode with
 * IndexedDB disabled must still be able to file a report when it HAS signal —
 * losing the queue is bad, but a crash on page load is worse.
 */

const DB_NAME = "saro";
const DB_VERSION = 2;
export const STORE_OUTBOX = "outbox";
export const STORE_MY_REPORTS = "my_reports";
export const STORE_CONFIG = "config";

let dbPromise = null;

/** @returns {Promise<IDBDatabase|null>} null when IndexedDB is unavailable. */
function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const outbox = db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
        outbox.createIndex("created_at", "created_at");
      }

      if (!db.objectStoreNames.contains(STORE_MY_REPORTS)) {
        const mine = db.createObjectStore(STORE_MY_REPORTS, { keyPath: "tracking_code" });
        mine.createIndex("saved_at", "saved_at");
      }

      if (!db.objectStoreNames.contains(STORE_CONFIG)) {
        db.createObjectStore(STORE_CONFIG, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

/**
 * Run one transaction and resolve, or resolve `fallback` if anything at all
 * goes wrong. Callers never have to guard.
 */
async function withStore(storeName, mode, fn, fallback = null) {
  const db = await openDb();
  if (!db) return fallback;

  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch {
      return resolve(fallback);
    }
    const store = tx.objectStore(storeName);
    let result = fallback;

    try {
      const request = fn(store);
      if (request) request.onsuccess = () => { result = request.result; };
    } catch {
      return resolve(fallback);
    }

    tx.oncomplete = () => resolve(result === undefined ? fallback : result);
    tx.onerror = () => resolve(fallback);
    tx.onabort = () => resolve(fallback);
  });
}

/* ── Outbox ──────────────────────────────────────────────────────────────── */

/**
 * Put a report in the outbox. Called BEFORE the network is attempted, always,
 * for every report — Panic included. The write is local and takes under a
 * millisecond, so it costs the user nothing and means no report can be lost to
 * a connection that dies mid-request.
 *
 * @param {object} payload createReport() or updateSosReportDetails() arguments
 * @param {object} [meta]  { kind: "panic" | "describe" | "sos_details", operation?: "update_sos" }
 * @returns {Promise<string>} the queue id
 */
export async function enqueueReport(payload, meta = {}) {
  const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    id,
    payload,
    kind: meta.kind ?? "describe",
    operation: meta.operation ?? "create",
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
  };
  await withStore(STORE_OUTBOX, "readwrite", (store) => store.put(row));
  return id;
}

/** @returns {Promise<Array<object>>} oldest first — delivery order is filing order. */
export async function listOutbox() {
  const rows = await withStore(STORE_OUTBOX, "readonly", (store) => store.getAll(), []);
  return (rows ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function outboxCount() {
  return (await withStore(STORE_OUTBOX, "readonly", (store) => store.count(), 0)) ?? 0;
}

export async function removeFromOutbox(id) {
  await withStore(STORE_OUTBOX, "readwrite", (store) => store.delete(id));
}

/** Record a failed attempt so the UI can distinguish "waiting" from "stuck". */
export async function recordOutboxFailure(id, message) {
  const db = await openDb();
  if (!db) return;
  const existing = await withStore(STORE_OUTBOX, "readonly", (store) => store.get(id));
  if (!existing) return;
  await withStore(STORE_OUTBOX, "readwrite", (store) =>
    store.put({
      ...existing,
      attempts: (existing.attempts ?? 0) + 1,
      last_error: message ?? "Unknown error",
    })
  );
}

/* ── My reports ──────────────────────────────────────────────────────────── */

/**
 * Remember a tracking code on this device.
 *
 * Convenience only. This is stated in the UI rather than left implied, because
 * a resident who thinks clearing their browser deletes their report will be
 * afraid to clear their browser — and one who assumes this list IS the report
 * will panic when a new phone shows an empty list. It is a bookmark, and it is
 * labelled as one.
 */
export async function rememberReport(entry) {
  if (!entry?.tracking_code) return;
  await withStore(STORE_MY_REPORTS, "readwrite", (store) =>
    store.put({
      tracking_code: entry.tracking_code,
      category: entry.category ?? null,
      category_label: entry.category_label ?? null,
      status: entry.status ?? "received",
      kind: entry.kind ?? "describe",
      created_at: entry.created_at ?? new Date().toISOString(),
      saved_at: new Date().toISOString(),
    })
  );
}

/** @returns {Promise<Array<object>>} newest first. */
export async function listRememberedReports() {
  const rows = await withStore(STORE_MY_REPORTS, "readonly", (store) => store.getAll(), []);
  return (rows ?? []).sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}

export async function forgetReport(trackingCode) {
  await withStore(STORE_MY_REPORTS, "readwrite", (store) => store.delete(trackingCode));
}

/* ── Config handed to the service worker ─────────────────────────────────── */

/**
 * Give the service worker what it needs to deliver a queued report on its own.
 *
 * The SW lives in `public/` and is served verbatim, so Vite never substitutes
 * `import.meta.env` inside it — it cannot be built with the project URL baked
 * in. IndexedDB is the handoff: the page writes this once on startup, and the
 * worker reads it whenever Background Sync wakes it, including long after the
 * tab is gone.
 *
 * Only the publishable key is passed. It is the same key already in the page
 * bundle and is safe by design; RLS is what protects the data. Nothing here is
 * a credential for anything a visitor to the site could not already do.
 */
export async function setSyncConfig({ url, key }) {
  if (!url || !key) return;
  await withStore(STORE_CONFIG, "readwrite", (store) =>
    store.put({ key: "supabase", url, anonKey: key })
  );
}

/** Refresh a cached status after a lookup, so the list is not stale on open. */
export async function updateRememberedStatus(trackingCode, status) {
  const existing = await withStore(STORE_MY_REPORTS, "readonly", (store) => store.get(trackingCode));
  if (!existing) return;
  await withStore(STORE_MY_REPORTS, "readwrite", (store) =>
    store.put({ ...existing, status })
  );
}

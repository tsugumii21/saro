/* SARO service worker.
 *
 * Three jobs, in order of how much they matter:
 *
 *   1. Deliver queued reports after the tab is closed (Background Sync).
 *   2. Show status-change notifications (Web Push).
 *   3. Keep the app shell openable with no network at all.
 *
 * Served verbatim from public/, so Vite never touches it: no imports, no
 * `import.meta.env`, no build step. Everything it needs about the project comes
 * out of IndexedDB, written by the page. That constraint is why this file
 * re-implements a little IndexedDB access instead of importing @saro/shared.
 *
 * Deliberate limit: this worker delivers ANONYMOUS reports only — Panic and
 * every emergency Describe. It has no auth session and never will, because
 * keeping a refresh token where a background process can read it is a far worse
 * risk than a signed-in resident's non-urgent pothole report waiting until they
 * next open the app. The page drains those (see offline/sync.js).
 */

const CACHE = "saro-shell-v1";

/* The shell, not the app. Enough to open SARO offline and reach Panic; the
 * hashed JS/CSS bundles are added opportunistically as they are fetched, since
 * their filenames change every build and cannot be listed here. */
const SHELL = ["/", "/index.html", "/manifest.json", "/icon.svg", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one 404 cannot fail the whole install and leave the
      // app with no worker at all.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ────────────────────────────────────────────────────────────────── */

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache Supabase. A stale report status is worse than no status, and a
  // cached auth response is a security problem.
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, fall back to the cached shell. A single-page
  // app means any path can be answered by index.html.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // Everything else: cache first, then network, filling the cache as it goes.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});

/* ── IndexedDB, minimal ───────────────────────────────────────────────────── */

function openDb() {
  return new Promise((resolve) => {
    // Version 2 must match packages/shared/src/offline/db.js. The worker never
    // upgrades the schema — if it somehow opens first, it takes what is there.
    const request = indexedDB.open("saro", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function txAll(db, storeName, mode, fn, fallback) {
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch {
      return resolve(fallback);
    }
    let result = fallback;
    const request = fn(tx.objectStore(storeName));
    if (request) request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result === undefined ? fallback : result);
    tx.onerror = () => resolve(fallback);
    tx.onabort = () => resolve(fallback);
  });
}

/* ── Background sync ──────────────────────────────────────────────────────── */

async function drainOutbox() {
  const db = await openDb();
  if (!db) return;

  const config = await txAll(db, "config", "readonly", (s) => s.get("supabase"), null);
  if (!config?.url || !config?.anonKey) return;

  const queued = await txAll(db, "outbox", "readonly", (s) => s.getAll(), []);
  if (!queued.length) return;

  queued.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  for (const row of queued) {
    const payload = row.payload || {};
    const deviceId = payload.device_fingerprint || payload.reporter_device_id;

    // Signed-in reports are left for the page, which has the session.
    if (!deviceId) continue;

    const insert = {
      category: payload.category,
      description: (payload.description || "").trim(),
      lat: Number(payload.lat),
      lng: Number(payload.lng),
      callback_number: payload.callback_number || null,
      is_proxy_report: Boolean(payload.is_proxy_report),
      photo_url: payload.photo_url || null,
      reporter_device_id: deviceId,
    };
    if (payload.barangay_id) insert.barangay_id = payload.barangay_id;

    let response;
    try {
      response = await fetch(`${config.url}/rest/v1/reports`, {
        method: "POST",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(insert),
      });
    } catch {
      // Still offline. Throwing rejects the sync event, which asks the browser
      // to retry this later with its own backoff — the whole point of Sync.
      throw new Error("offline");
    }

    if (response.ok) {
      const [created] = await response.json();
      await txAll(db, "outbox", "readwrite", (s) => s.delete(row.id), null);

      if (created?.tracking_code) {
        await txAll(db, "my_reports", "readwrite", (s) =>
          s.put({
            tracking_code: created.tracking_code,
            category: created.category ?? null,
            category_label: null,
            status: created.status ?? "received",
            kind: row.kind || "describe",
            created_at: created.created_at ?? new Date().toISOString(),
            saved_at: new Date().toISOString(),
          }), null);

        await self.registration.showNotification("Report sent", {
          body: `Your report went through. Code ${created.tracking_code}.`,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: `sent-${created.tracking_code}`,
          data: { url: `/track?code=${created.tracking_code}` },
        });
      }
      continue;
    }

    if (response.status >= 500) throw new Error("server unavailable");

    // 4xx: the server will never accept this row. It stays in the outbox with
    // its error rather than being deleted — a report SARO cannot deliver is
    // SARO's bug, and quietly discarding somebody's report to tidy the queue is
    // the worst available response.
    const body = await response.text().catch(() => "");
    await txAll(db, "outbox", "readwrite", (s) =>
      s.put({ ...row, attempts: (row.attempts || 0) + 1, last_error: body.slice(0, 300) }), null);
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "saro-outbox") event.waitUntil(drainOutbox());
});

// Periodic Sync where it exists (installed PWAs on Chromium). Catches the case
// where signal returned hours ago and SARO was never reopened.
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "saro-outbox") event.waitUntil(drainOutbox());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "saro-flush") event.waitUntil(drainOutbox());
});

/* ── Push ─────────────────────────────────────────────────────────────────── */

self.addEventListener("push", (event) => {
  // A push whose body is not JSON still has to produce a notification: Chrome
  // shows a generic "This site has been updated in the background" if the
  // handler finishes without calling showNotification, which is worse than
  // whatever text arrived.
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "SARO", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "SARO";
  const code = payload.tracking_code;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Keyed by report, so five updates to one report replace each other
      // instead of stacking into a wall of notifications.
      tag: code ? `report-${code}` : "saro",
      renotify: true,
      data: { url: code ? `/track?code=${code}` : "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse an open SARO tab rather than piling up new ones.
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

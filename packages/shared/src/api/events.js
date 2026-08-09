// Live data change events, backed by Supabase Realtime.
//
// Keeps the on() / off() / emit() surface the prototype's cross-tab emitter
// had, so components subscribe exactly as before. What changed underneath: the
// prototype listened to the browser's `storage` event and only ever saw changes
// this device made. Now the events come from Postgres, so an office marking a
// report resolved reaches every open dashboard in the city.
//
// Realtime respects RLS. A subscriber is delivered a row only if their policies
// would have let them SELECT it, so anonymous clients receive nothing from
// `reports` even though the table is published.

import { supabase } from "../supabase/client.js";

const EVENTS = {
  REPORT_CREATED: "report:created",
  REPORT_UPDATED: "report:updated",
  CLUSTER_UPDATED: "cluster:updated",
  STATUS_APPENDED: "status:appended",
};

class SaroEvents {
  constructor() {
    this.listeners = new Map();
    this.channel = null;
    this.subscriberCount = 0;
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);

    this.subscriberCount += 1;
    this.#ensureChannel();

    return () => this.off(event, callback);
  }

  off(event, callback) {
    const set = this.listeners.get(event);
    if (!set?.delete(callback)) return;

    this.subscriberCount = Math.max(0, this.subscriberCount - 1);
    if (this.subscriberCount === 0) this.#teardownChannel();
  }

  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`Error in listener for ${event}:`, err);
      }
    }
  }

  /** Open the websocket lazily — a resident who never subscribes never connects. */
  #ensureChannel() {
    if (this.channel) return;

    this.channel = supabase
      .channel("saro-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reports" },
        (payload) => this.emit(EVENTS.REPORT_CREATED, { report: payload.new })
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "reports" },
        (payload) =>
          this.emit(EVENTS.REPORT_UPDATED, { report: payload.new, previous: payload.old })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clusters" },
        (payload) => this.emit(EVENTS.CLUSTER_UPDATED, { cluster: payload.new ?? payload.old })
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "report_status_history" },
        (payload) => this.emit(EVENTS.STATUS_APPENDED, { entry: payload.new })
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.info(`[SARO] Realtime channel status (${status}); active polling RPC fallback is enabled.`);
        }
      });
  }

  #teardownChannel() {
    if (!this.channel) return;
    supabase.removeChannel(this.channel);
    this.channel = null;
  }
}

export const saroEvents = new SaroEvents();
export const REALTIME_EVENTS = EVENTS;

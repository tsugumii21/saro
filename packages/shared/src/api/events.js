// Event Emitter for SARO Data Changes & Cross-Tab Synchronization

class EventEmitter {
  constructor() {
    this.listeners = new Map();
    this.initStorageListener();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((cb) => {
        try {
          cb(data);
        } catch (err) {
          console.error(`Error in event listener for ${event}:`, err);
        }
      });
    }
  }

  // Cross-tab synchronization via browser native 'storage' event
  initStorageListener() {
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("storage", (e) => {
        if (e.key === "saro_mock_reports" && e.newValue) {
          try {
            const reports = JSON.parse(e.newValue);
            this.emit("report:updated", { reports, source: "external_tab" });
          } catch (err) {
            console.error("Error parsing storage sync payload:", err);
          }
        }
      });
    }
  }
}

export const mockEvents = new EventEmitter();

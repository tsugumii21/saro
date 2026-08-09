import { useState } from "react";
import { ShieldCheck, MapPin, Mic, PhoneCall, CheckCircle2, ChevronRight, XCircle } from "lucide-react";
import { Wordmark } from "@saro/ui";
import {
  getPermissionsState,
  requestBrowserPermission,
  setPermissionState,
  markPrimingCompleted,
} from "../../lib/permissions";

export default function PermissionPrimingScreen({ onComplete }) {
  const [permissions, setPermissions] = useState(getPermissionsState());
  const [busyKey, setBusyKey] = useState(null);

  const handleToggleAllow = async (key) => {
    setBusyKey(key);
    const result = await requestBrowserPermission(key);
    const updated = getPermissionsState();
    setPermissions(updated);
    setBusyKey(null);
  };

  const handleSkipPermission = (key) => {
    const updated = setPermissionState(key, "skipped");
    setPermissions(updated);
  };

  const handleFinish = () => {
    markPrimingCompleted();
    onComplete?.();
  };

  const handleSkipAll = () => {
    markPrimingCompleted();
    onComplete?.();
  };

  return (
    <div className="flex min-h-full flex-col bg-surface text-ink px-4 py-6 font-sans justify-between overflow-y-auto">
      {/* Header section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Wordmark size="sm" />
          <button
            type="button"
            onClick={handleSkipAll}
            className="text-xs font-semibold text-ink-muted hover:text-ink transition-colors px-2 py-1"
          >
            Skip for now
          </button>
        </div>

        <div className="saro-rise mt-2">
          <div className="w-10 h-10 rounded-full bg-brand-wash flex items-center justify-center text-brand mb-3">
            <ShieldCheck className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-extrabold text-ink leading-tight">
            App Permissions &amp; Setup
          </h1>
          <p className="text-xs text-ink-muted mt-1 leading-relaxed">
            SARO uses your device hardware to share live location during emergencies, enable hands-free voice reporting, and dial 911 directly.
          </p>
        </div>

        {/* Permission Cards */}
        <div className="flex flex-col gap-3 mt-2">
          {/* Location Permission Card */}
          <div className="p-3.5 rounded-lg border border-line bg-white shadow-2xs flex flex-col gap-2.5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-brand-wash text-brand shrink-0 mt-0.5">
                <MapPin className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-ink">Location Access</span>
                  {permissions.location === "granted" && (
                    <span className="text-[10px] font-bold text-status-resolved-ink bg-status-resolved-wash px-2 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Allowed
                    </span>
                  )}
                  {permissions.location === "denied" && (
                    <span className="text-[10px] font-bold text-alert bg-alert-wash px-2 py-0.5 rounded-full flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> Denied
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">
                  Shares your exact position with Legazpi 911 during Panic alerts and hazard reports.
                </p>
              </div>
            </div>

            {permissions.location !== "granted" && (
              <div className="flex items-center justify-end gap-2 pt-1 border-t border-line/60">
                <button
                  type="button"
                  onClick={() => handleSkipPermission("location")}
                  className="text-[11px] text-ink-faint hover:text-ink-muted font-medium px-2 py-1"
                >
                  Skip
                </button>
                <button
                  type="button"
                  disabled={busyKey === "location"}
                  onClick={() => handleToggleAllow("location")}
                  className="saro-btn saro-btn-primary saro-btn-sm text-xs py-1 px-3"
                >
                  {busyKey === "location" ? "Allowing..." : "Allow Location"}
                </button>
              </div>
            )}
          </div>

          {/* Microphone Permission Card */}
          <div className="p-3.5 rounded-lg border border-line bg-white shadow-2xs flex flex-col gap-2.5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-brand-wash text-brand shrink-0 mt-0.5">
                <Mic className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-ink">Microphone Access</span>
                  {permissions.microphone === "granted" && (
                    <span className="text-[10px] font-bold text-status-resolved-ink bg-status-resolved-wash px-2 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Allowed
                    </span>
                  )}
                  {permissions.microphone === "denied" && (
                    <span className="text-[10px] font-bold text-alert bg-alert-wash px-2 py-0.5 rounded-full flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> Denied
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">
                  Enables voice-to-text input in Bikol or Tagalog when describing a hazard report.
                </p>
              </div>
            </div>

            {permissions.microphone !== "granted" && (
              <div className="flex items-center justify-end gap-2 pt-1 border-t border-line/60">
                <button
                  type="button"
                  onClick={() => handleSkipPermission("microphone")}
                  className="text-[11px] text-ink-faint hover:text-ink-muted font-medium px-2 py-1"
                >
                  Skip
                </button>
                <button
                  type="button"
                  disabled={busyKey === "microphone"}
                  onClick={() => handleToggleAllow("microphone")}
                  className="saro-btn saro-btn-primary saro-btn-sm text-xs py-1 px-3"
                >
                  {busyKey === "microphone" ? "Allowing..." : "Allow Microphone"}
                </button>
              </div>
            )}
          </div>

          {/* Phone Permission Card */}
          <div className="p-3.5 rounded-lg border border-line bg-white shadow-2xs flex flex-col gap-2.5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-brand-wash text-brand shrink-0 mt-0.5">
                <PhoneCall className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-ink">Phone / Emergency Call</span>
                  {permissions.phone === "granted" && (
                    <span className="text-[10px] font-bold text-status-resolved-ink bg-status-resolved-wash px-2 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Allowed
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">
                  Allows the Panic button to open your phone dialer directly to 911 in emergencies.
                </p>
              </div>
            </div>

            {permissions.phone !== "granted" && (
              <div className="flex items-center justify-end gap-2 pt-1 border-t border-line/60">
                <button
                  type="button"
                  onClick={() => handleSkipPermission("phone")}
                  className="text-[11px] text-ink-faint hover:text-ink-muted font-medium px-2 py-1"
                >
                  Skip
                </button>
                <button
                  type="button"
                  disabled={busyKey === "phone"}
                  onClick={() => handleToggleAllow("phone")}
                  className="saro-btn saro-btn-primary saro-btn-sm text-xs py-1 px-3"
                >
                  {busyKey === "phone" ? "Allowing..." : "Allow Phone Call"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="flex flex-col gap-2 pt-6 pb-2">
        <button
          type="button"
          onClick={handleFinish}
          className="saro-btn saro-btn-primary saro-btn-lg saro-btn-block flex items-center justify-center gap-2"
        >
          <span>Continue to App</span>
          <ChevronRight className="w-4 h-4" />
        </button>
        <p className="text-[10px] text-ink-faint text-center">
          You can change these permissions anytime in Settings.
        </p>
      </div>
    </div>
  );
}

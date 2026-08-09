import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, PhoneCall, ShieldAlert, X, Lock } from "lucide-react";

const HOLD_MS = 2000; // 2.0 seconds deliberate hold requirement

export default function PanicControl({ onFire, onHoldStart, disabled, state = "idle" }) {
  // Stage 1: "disarmed" | Stage 2: "armed"
  const [stage, setStage] = useState("disarmed");
  const [held, setHeld] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const raf = useRef(null);
  const start = useRef(0);
  const autoDisarmTimer = useRef(null);

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);

  const release = useCallback(() => {
    if (!held) return;
    stop();
    setHeld(false);
    if (progress < 1) {
      setCancelled(true);
      setTimeout(() => setCancelled(false), 2600);
    }
    setProgress(0);
  }, [held, progress, stop]);

  const handleArm = () => {
    setStage("armed");
    setCancelled(false);
    // Auto-disarm back to disarmed stage after 8s of inactivity to prevent accidental pocket press later
    if (autoDisarmTimer.current) clearTimeout(autoDisarmTimer.current);
    autoDisarmTimer.current = setTimeout(() => {
      setStage("disarmed");
      setProgress(0);
      setHeld(false);
    }, 8000);
  };

  const handleDisarm = () => {
    stop();
    setStage("disarmed");
    setHeld(false);
    setProgress(0);
    setCancelled(false);
    if (autoDisarmTimer.current) clearTimeout(autoDisarmTimer.current);
  };

  const begin = useCallback(() => {
    if (disabled || state === "sending") return;
    setCancelled(false);
    setHeld(true);
    start.current = performance.now();

    if (autoDisarmTimer.current) clearTimeout(autoDisarmTimer.current);

    onHoldStart?.();

    const tick = (now) => {
      const p = Math.min((now - start.current) / HOLD_MS, 1);
      setProgress(p);
      if (p >= 1) {
        stop();
        setHeld(false);
        setProgress(0);
        setStage("disarmed");
        if (navigator.vibrate) navigator.vibrate([40, 60, 120, 80, 160]);
        onFire?.();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [disabled, state, onFire, onHoldStart, stop]);

  useEffect(() => {
    return () => {
      stop();
      if (autoDisarmTimer.current) clearTimeout(autoDisarmTimer.current);
    };
  }, [stop]);

  const sending = state === "sending";

  return (
    <div className="w-full flex flex-col gap-1.5 font-sans">
      <div className="relative overflow-hidden bg-gradient-to-br from-panic via-panic to-panic-strong text-white shadow-lift border border-white/20 rounded-lg">
        {/* Fill animation bar during hold */}
        <div
          aria-hidden="true"
          className="absolute inset-0 origin-left bg-white/20 transition-all pointer-events-none"
          style={{
            transform: `scaleX(${progress})`,
            transition: held ? "none" : "transform 180ms ease-out",
          }}
        />

        <div className="relative z-10 flex flex-col p-5 gap-3">
          {/* Top Label & Icon */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6 text-white" aria-hidden="true" />
              </div>
              <div>
                <span className="text-sm font-extrabold uppercase tracking-wide text-white block leading-tight">
                  Emergency Panic
                </span>
                <span className="text-[11px] text-white/75 leading-tight block mt-0.5">
                  Calls 911 &amp; sends your location
                </span>
              </div>
            </div>

            {stage === "armed" && (
              <button
                type="button"
                onClick={handleDisarm}
                className="px-2.5 py-1 rounded-full bg-black/30 hover:bg-black/40 text-white text-[11px] font-bold flex items-center gap-1 border border-white/20 transition-colors"
                aria-label="Disarm Panic"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>

          {/* Stage 1: DISARMED — Tap to Arm Safeguard */}
          {stage === "disarmed" && (
            <div className="pt-0.5">
              <button
                type="button"
                onClick={handleArm}
                disabled={disabled || sending}
                className="w-full py-3 px-4 rounded-md bg-white text-panic font-extrabold text-xs shadow-md hover:bg-surface active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer border border-white/50"
              >
                <Lock className="w-4 h-4 text-panic" />
                <span>{sending ? "SENDING ALERT…" : "TAP TO UNLOCK PANIC BUTTON"}</span>
              </button>
            </div>
          )}

          {/* Stage 2: ARMED — Hold 2s to Confirm Trigger */}
          {stage === "armed" && (
            <div className="pt-0.5 flex flex-col items-center gap-2">
              <button
                type="button"
                disabled={disabled || sending}
                onPointerDown={begin}
                onPointerUp={release}
                onPointerLeave={release}
                onPointerCancel={release}
                onKeyDown={(e) => {
                  if ((e.key === " " || e.key === "Enter") && !e.repeat) begin();
                }}
                onKeyUp={release}
                className="w-full py-3.5 px-4 rounded-md bg-white text-panic font-extrabold text-xs shadow-lg hover:bg-surface active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer select-none touch-none border-2 border-white"
                style={{ touchAction: "none" }}
              >
                <PhoneCall className="w-4.5 h-4.5 text-panic animate-bounce" />
                <span>
                  {sending
                    ? "CALLING 911 NOW…"
                    : held
                    ? `HOLDING... ${Math.round(progress * 100)}%`
                    : "PRESS & HOLD 2 SECONDS TO CALL 911"}
                </span>
              </button>

              {/* Real-time Progress Bar Indicator */}
              <div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden mt-1">
                <div
                  className="bg-white h-full transition-all duration-75"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Guidance and Cancel Notice */}
      <p
        className="text-[11px] px-1 font-medium leading-relaxed"
        style={{ color: cancelled ? "var(--color-panic-strong)" : "var(--color-ink-muted)" }}
        role={cancelled ? "alert" : undefined}
      >
        {cancelled
          ? "⚠️ Released too early — no call was placed. Hold for full 2 seconds."
          : stage === "armed"
          ? "🔒 Button unlocked. Press & hold for 2 full seconds to connect 911."
          : "Protected against accidental touch. Tap to unlock, then hold to call."}
      </p>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneCall, ShieldAlert, X, Lock, ChevronLeft, HelpCircle } from "lucide-react";
import { PANIC_CATEGORY } from "@saro/shared";
import { getCategoryIcon } from "../../lib/categoryIcons.js";

const HOLD_MS = 2000; // 2.0 seconds deliberate hold requirement

/**
 * Emergency S.O.S — hold to unlock, then choose who answers.
 *
 * Two things changed from the older control, both for the same reason: a single
 * tap is not a safeguard, and a single number is not a dispatch.
 *
 * 1. The guard is now a two-second hold rather than a tap. A tap is exactly the
 *    gesture a pocket, a toddler, or a fumbled grab produces; a sustained hold is
 *    not. Releasing early cancels and says so, so the person learns the gesture
 *    from failing at it rather than from instructions.
 *
 * 2. Completing the hold does not dial. It opens a picker of emergency types,
 *    and the chosen type decides which agency answers — fire reaches BFP, crime
 *    reaches PNP — using the same routing_table the dispatcher queue uses.
 *
 * What did not change: location still goes out on every S.O.S regardless of the
 * type chosen, and the warm-up still starts the moment the hold begins, so the
 * position is already in hand by the time a type is picked.
 */
export default function PanicControl({
  onSelectEmergency,
  onHoldStart,
  disabled,
  state = "idle",
  emergencyCategories = [],
}) {
  // "locked" -> holding to unlock | "choosing" -> picking who answers
  const [stage, setStage] = useState("locked");
  const [held, setHeld] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cancelled, setCancelled] = useState(false);

  const raf = useRef(null);
  const start = useRef(0);
  const autoLockTimer = useRef(null);

  const sending = state === "sending";

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);

  const relock = useCallback(() => {
    stop();
    setStage("locked");
    setHeld(false);
    setProgress(0);
    setCancelled(false);
    if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
  }, [stop]);

  /**
   * Released before the hold completed. Nothing fires, and the person is told
   * plainly why — silent failure would read as a broken button.
   */
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

  const begin = useCallback(() => {
    if (disabled || sending) return;
    setCancelled(false);
    setHeld(true);
    start.current = performance.now();

    // Position and photo start resolving now, during the hold, so choosing a
    // type a moment later costs no extra time.
    onHoldStart?.();

    const tick = (now) => {
      const p = Math.min((now - start.current) / HOLD_MS, 1);
      setProgress(p);

      if (p >= 1) {
        stop();
        setHeld(false);
        setProgress(0);
        setStage("choosing");
        if (navigator.vibrate) navigator.vibrate([40, 60, 120]);

        // Re-lock if the picker is left open and untouched, so an S.O.S cannot
        // sit half-armed in a pocket.
        if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
        autoLockTimer.current = setTimeout(() => relock(), 30000);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [disabled, sending, onHoldStart, stop, relock]);

  useEffect(() => {
    return () => {
      stop();
      if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
    };
  }, [stop]);

  const handleChoose = (categoryId) => {
    if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
    setStage("locked");
    onSelectEmergency?.(categoryId);
  };

  const pct = Math.round(progress * 100);

  return (
    <div className="w-full flex flex-col gap-1.5 font-sans">
      <div className="relative overflow-hidden bg-gradient-to-br from-panic via-panic to-panic-strong text-white shadow-lift border border-white/20 rounded-lg">
        {/* Colour sweep across the whole card while held. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 origin-left bg-white/25 pointer-events-none"
          style={{
            transform: `scaleX(${progress})`,
            transition: held ? "none" : "transform 200ms ease-out",
          }}
        />

        <div className="relative z-10 flex flex-col p-5 gap-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6 text-white" aria-hidden="true" />
              </div>
              <div>
                <span className="text-sm font-extrabold uppercase tracking-wide text-white block leading-tight">
                  Emergency S.O.S
                </span>
                <span className="text-[11px] text-white/75 leading-tight block mt-0.5">
                  Calls the right responder &amp; sends your location
                </span>
              </div>
            </div>

            {stage === "choosing" && (
              <button
                type="button"
                onClick={relock}
                className="px-2.5 py-1 rounded-full bg-black/30 hover:bg-black/40 text-white text-[11px] font-bold flex items-center gap-1 border border-white/20 transition-colors"
                aria-label="Cancel S.O.S"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>

          {/* ── Stage 1: hold to unlock ─────────────────────────────────── */}
          {stage === "locked" && (
            <div className="pt-0.5 flex flex-col gap-2">
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
                aria-label="Press and hold two seconds to activate Emergency S.O.S"
                // Progress is announced rather than only drawn, so the hold is
                // followable without seeing the fill.
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                role="slider"
                className="relative w-full overflow-hidden py-3.5 px-4 rounded-md bg-white text-panic font-extrabold text-xs shadow-md hover:bg-surface active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer select-none touch-none border border-white/50"
                style={{ touchAction: "none" }}
              >
                {/* Fill sweeping across the button itself. Scaled, not resized:
                    this repaints every frame for two seconds on a phone that may
                    also be acquiring a GPS fix, and transform stays on the
                    compositor where width would force layout each frame. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 w-full origin-left bg-panic/15"
                  style={{
                    transform: `scaleX(${progress})`,
                    transition: held ? "none" : "transform 200ms ease-out",
                  }}
                />
                <Lock className="relative w-4 h-4 text-panic" />
                <span className="relative">
                  {sending
                    ? "SENDING ALERT…"
                    : held
                    ? `KEEP HOLDING… ${pct}%`
                    : "HOLD TO ACTIVATE S.O.S"}
                </span>
              </button>

              {/* Progress rail — the same value, readable at a glance. */}
              <div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-white h-full w-full origin-left"
                  style={{
                    transform: `scaleX(${progress})`,
                    transition: held ? "none" : "transform 200ms ease-out",
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Stage 2: who is this for? ───────────────────────────────── */}
          {stage === "choosing" && (
            <div className="pt-0.5 flex flex-col gap-2.5">
              <div className="flex items-center gap-1.5">
                <ChevronLeft className="w-3.5 h-3.5 text-white/70" aria-hidden="true" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-white/90">
                  What is the emergency?
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Emergency type">
                {emergencyCategories.map((cat) => {
                  const Icon = getCategoryIcon(cat);
                  const id = cat.id ?? cat.category;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={disabled || sending}
                      onClick={() => handleChoose(id)}
                      className="min-h-[64px] p-3 rounded-md bg-white text-panic hover:bg-surface active:scale-[0.98] transition-all flex flex-col items-start justify-center gap-1.5 text-left cursor-pointer border border-white/50 shadow-md"
                    >
                      <Icon className="w-5 h-5 text-panic shrink-0" aria-hidden="true" />
                      <span className="text-[11px] font-extrabold leading-tight">
                        {cat.short_label ?? cat.name ?? cat.label ?? id}
                      </span>
                    </button>
                  );
                })}

                {/* Always last, always available. Someone who cannot classify
                    what is happening must still be able to send an S.O.S. */}
                <button
                  type="button"
                  disabled={disabled || sending}
                  onClick={() => handleChoose(PANIC_CATEGORY)}
                  className="min-h-[64px] p-3 rounded-md bg-black/25 text-white hover:bg-black/35 active:scale-[0.98] transition-all flex flex-col items-start justify-center gap-1.5 text-left cursor-pointer border border-white/30"
                >
                  <HelpCircle className="w-5 h-5 text-white shrink-0" aria-hidden="true" />
                  <span className="text-[11px] font-extrabold leading-tight">
                    Not sure / Other
                  </span>
                </button>
              </div>

              <span className="text-[11px] text-white/80 leading-snug flex items-center gap-1.5">
                <PhoneCall className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                Your location is sent whichever you choose.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Guidance, and the early-release notice */}
      <p
        className="text-[11px] px-1 font-medium leading-relaxed"
        style={{ color: cancelled ? "var(--color-panic-strong)" : "var(--color-ink-muted)" }}
        role={cancelled ? "alert" : undefined}
      >
        {cancelled
          ? "⚠️ Released too early — nothing was sent. Hold for the full 2 seconds."
          : stage === "choosing"
          ? "🔓 Unlocked. Choose the emergency to reach the right responder."
          : "Protected against accidental touch. Press and hold, release to cancel."}
      </p>
    </div>
  );
}

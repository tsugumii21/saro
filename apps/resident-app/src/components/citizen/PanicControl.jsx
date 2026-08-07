import { useCallback, useEffect, useRef, useState } from "react";

const HOLD_MS = 1200;

/**
 * The Panic control.
 *
 * Design decisions, all of them about one moment: someone frightened, holding
 * a phone in one hand, possibly in the dark, possibly in rain.
 *
 * - It is the largest object on the screen by a wide margin. Under stress the
 *   eye does not search; it takes whatever is biggest. Nothing else on the
 *   home screen is allowed to compete with it.
 * - Hold, not tap. A tap fires in a pocket and floods dispatch with ghosts; a
 *   1.2s hold cannot happen by accident but costs a frightened person nothing
 *   they will notice. The fill sweep is the receipt that the hold is working,
 *   which is why it is one slow deliberate sweep and not a decorative pulse.
 * - Releasing early cancels and says so. No silent failure — the worst
 *   possible outcome here is believing you called for help when you did not.
 * - The whole control is one button, not a button inside a card. There is
 *   nothing to aim at.
 * - It is the only vermilion object in the product.
 */
export default function PanicControl({ onFire, disabled, state = "idle" }) {
  const [held, setHeld] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const raf = useRef(null);
  const start = useRef(0);

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

  const begin = useCallback(() => {
    if (disabled || state === "sending") return;
    setCancelled(false);
    setHeld(true);
    start.current = performance.now();

    const tick = (now) => {
      const p = Math.min((now - start.current) / HOLD_MS, 1);
      setProgress(p);
      if (p >= 1) {
        stop();
        setHeld(false);
        setProgress(0);
        if (navigator.vibrate) navigator.vibrate([40, 60, 120]);
        onFire?.();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [disabled, state, onFire, stop]);

  useEffect(() => stop, [stop]);

  const sending = state === "sending";

  return (
    <div className="flex flex-col items-stretch gap-3">
      <button
        type="button"
        disabled={disabled || sending}
        onPointerDown={begin}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) begin(); }}
        onKeyUp={release}
        aria-label="Hold to send an emergency alert with your location"
        aria-describedby="panic-help"
        className="saro-clip-lg relative flex w-full select-none flex-col items-center justify-center overflow-hidden text-white transition-transform active:scale-[0.995] disabled:opacity-70"
        style={{
          background: "var(--color-panic)",
          minHeight: "min(46vh, 340px)",
          touchAction: "none",
        }}
      >
        {/* The hold sweep. Sits under the label, fills from the left edge. */}
        <span
          aria-hidden="true"
          className="absolute inset-0 origin-left"
          style={{
            background: "var(--color-panic-strong)",
            transform: `scaleX(${progress})`,
            transition: held ? "none" : "transform 180ms ease-out",
          }}
        />

        <span className="relative flex flex-col items-center gap-4 px-6">
          <span
            className="font-bold"
            style={{
              fontFamily: "var(--font-brand)",
              fontSize: "clamp(44px, 15vw, 68px)",
              lineHeight: 1,
              letterSpacing: "0.02em",
            }}
          >
            {sending ? "SENDING" : "PANIC"}
          </span>
          <span className="t-label" style={{ color: "rgba(255,255,255,0.82)" }}>
            {sending ? "Do not close this screen" : held ? "Keep holding" : "Hold for 1 second"}
          </span>
        </span>
      </button>

      <p
        id="panic-help"
        className="t-body-sm px-1"
        style={{ color: cancelled ? "var(--color-panic-strong)" : "var(--color-ink-muted)" }}
        role={cancelled ? "alert" : undefined}
      >
        {cancelled
          ? "Released too early — nothing was sent. Hold until the button fills."
          : "Sends your location to Legazpi 911 straight away. No account, no form, no name required."}
      </p>
    </div>
  );
}

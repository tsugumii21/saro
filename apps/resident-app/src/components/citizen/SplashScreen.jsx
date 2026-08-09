import { useEffect, useState } from "react";
import { Logo } from "@saro/ui";
import { ShieldCheck } from "lucide-react";

/**
 * Executive Staggered Splash Loading Screen.
 * 1. Logo scales up with a subtle radial aura (0ms).
 * 2. SARO brand title glides up cleanly after the logo (250ms delay).
 * 3. Legazpi Civic Portal tag fades in with a pulse dot (500ms delay).
 * 4. Dissolves seamlessly into the main app (1400ms).
 */
export default function SplashScreen({ onFinish }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setFading(true);
    }, 1400);

    const finishTimer = setTimeout(() => {
      onFinish?.();
    }, 1800);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(finishTimer);
    };
  }, [onFinish]);

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-[#1B2E6B] flex flex-col items-center justify-center p-6 transition-opacity duration-500 font-sans select-none overflow-hidden ${
        fading ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      {/* Background radial aura */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center gap-3 text-center">

        {/* Phase 1: Logo enters first with spring scale-up (0ms) */}
        <div className="animate-in zoom-in-90 fade-in duration-300 ease-out flex items-center justify-center">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-white/15 blur-xl animate-pulse" />
            <Logo tone="inverse" className="w-20 h-20 sm:w-24 sm:h-24 relative z-10 drop-shadow-md" />
          </div>
        </div>

        {/* Phase 2: SARO Wordmark glides up after logo (250ms delay) */}
        <h1 className="text-3xl sm:text-4xl font-black text-white tracking-widest uppercase font-sans mt-1 animate-in slide-in-from-bottom-2 fade-in duration-300 delay-200 fill-mode-backwards">
          SARO
        </h1>

        {/* Phase 3: Subtitle badge & pulse dot fade in (500ms delay) */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white/90 text-xs font-semibold tracking-wide animate-in slide-in-from-bottom-2 fade-in duration-300 delay-500 fill-mode-backwards mt-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Legazpi City Civic Safety Portal</span>
        </div>

      </div>
    </div>
  );
}

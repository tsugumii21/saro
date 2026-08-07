import { useState, useEffect } from "react";
import { CLIENT_STORAGE_KEYS } from "@saro/shared";
import LandingPage from "./components/common/LandingPage";
import CitizenShell from "./components/citizen/CitizenShell";

// Adapted from the prototype's DeviceGate. The staff branches are gone — this
// app only ever renders the resident experience. The "officer" call to action
// on LandingPage now leaves for the separately deployed admin app.
const ADMIN_APP_URL = import.meta.env.VITE_ADMIN_APP_URL || "";

function ResidentGateContent() {
  // No auth here at all — this app never signs anyone in.

  // Viewport breakpoint (768px)
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  // Presentation mode for mobile frame prototyping on desktop
  const [isPresentationMode, setIsPresentationMode] = useState(false);

  // Unauthenticated flow selection: "landing" | "resident"
  const [unauthView, setUnauthView] = useState(() => {
    if (typeof sessionStorage !== "undefined") {
      const saved = sessionStorage.getItem(CLIENT_STORAGE_KEYS.UNAUTH_VIEW);
      if (saved) return saved;
    }
    return "landing";
  });

  const handleSelectResident = () => {
    if (isDesktop && !isPresentationMode) {
      // On desktop, show the resident app inside a phone frame
      setIsPresentationMode(true);
    } else {
      sessionStorage.setItem(CLIENT_STORAGE_KEYS.UNAUTH_VIEW, "resident");
      setUnauthView("resident");
    }
  };

  const handleSelectOfficer = () => {
    // Officers live in a different deployment now.
    // TODO: set VITE_ADMIN_APP_URL once the admin app has a Vercel domain.
    if (ADMIN_APP_URL) {
      window.location.href = ADMIN_APP_URL;
      return;
    }
    console.warn("VITE_ADMIN_APP_URL is not set — cannot route to the admin app.");
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const handleChange = (e) => setIsDesktop(e.matches);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }

    // Shortcut listener for Ctrl+Shift+P / Cmd+Shift+P
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setIsPresentationMode((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // 1. Presentation Mode (Simulated 390px Mobile Phone Frame on Desktop)
  if (isPresentationMode) {
    return (
      <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[9999] flex items-center justify-center p-4 overflow-auto font-sans">
        <button
          onClick={() => setIsPresentationMode(false)}
          className="absolute top-4 right-6 text-xs text-white/80 hover:text-white bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 font-semibold"
        >
          Exit Mobile Preview (Esc / Ctrl+Shift+P)
        </button>

        {/* 390x844 Mobile Phone Device Frame */}
        <div className="w-[390px] h-[844px] bg-slate-900 rounded-[48px] border-[12px] border-slate-800 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] relative overflow-hidden flex flex-col shrink-0 transform-gpu translate-z-0">
          {/* Phone Top Notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-36 h-6 bg-slate-800 rounded-b-2xl z-[500] flex items-center justify-center pointer-events-none">
            <div className="w-3 h-3 rounded-full bg-slate-950 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
            </div>
          </div>
          {/* Real 390px Viewport Content */}
          <div className="w-full h-full relative overflow-hidden bg-slate-50 pt-3 flex flex-col transform-gpu translate-z-0">
            <CitizenShell />
          </div>
        </div>
      </div>
    );
  }

  // 2. Desktop Viewport (>= 768px): Landing Page only
  if (isDesktop) {
    return (
      <LandingPage
        onSelectResident={handleSelectResident}
        onSelectOfficer={handleSelectOfficer}
      />
    );
  }

  // 3. Mobile Viewport (< 768px): Resident App or Landing Page
  if (unauthView === "resident") {
    return <CitizenShell />;
  }

  return (
    <LandingPage
      onSelectResident={handleSelectResident}
      onSelectOfficer={handleSelectOfficer}
    />
  );
}

export default function ResidentGate() {
  return <ResidentGateContent />;
}

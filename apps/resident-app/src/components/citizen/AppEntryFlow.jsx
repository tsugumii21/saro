import { useState, useEffect } from "react";
import { CLIENT_STORAGE_KEYS, useAuth } from "@saro/shared";
import SplashScreen from "./SplashScreen";
import WelcomeScreen from "./WelcomeScreen";
import PermissionPrimingScreen from "./PermissionPrimingScreen";
import CitizenShell from "./CitizenShell";
import { isPrimingCompleted } from "../../lib/permissions";

export default function AppEntryFlow() {
  const { isResident } = useAuth();

  // Splash screen state (shows on initial launch)
  const [showSplash, setShowSplash] = useState(true);

  // Flow state: "welcome" | "permissions" | "app"
  const [flowState, setFlowState] = useState(() => {
    if (typeof sessionStorage !== "undefined") {
      const saved = sessionStorage.getItem(CLIENT_STORAGE_KEYS.UNAUTH_VIEW);
      if (saved === "resident") return "app";
    }
    return "welcome";
  });

  useEffect(() => {
    if (isResident) {
      if (!isPrimingCompleted() && flowState === "welcome") {
        setFlowState("permissions");
      } else {
        setFlowState("app");
      }
    }
  }, [isResident]);

  const handleContinueGuest = () => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(CLIENT_STORAGE_KEYS.UNAUTH_VIEW, "resident");
    }
    if (!isPrimingCompleted()) {
      setFlowState("permissions");
    } else {
      setFlowState("app");
    }
  };

  const handleSignedIn = () => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(CLIENT_STORAGE_KEYS.UNAUTH_VIEW, "resident");
    }
    if (!isPrimingCompleted()) {
      setFlowState("permissions");
    } else {
      setFlowState("app");
    }
  };

  const handlePermissionsComplete = () => {
    setFlowState("app");
  };

  const handleReturnToWelcome = () => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(CLIENT_STORAGE_KEYS.UNAUTH_VIEW);
    }
    setFlowState("welcome");
  };

  return (
    <div className="w-full h-screen min-h-screen bg-[#0B1220] lg:bg-canvas flex items-center justify-center p-0 sm:py-6 sm:px-4 lg:p-0 font-sans select-none overflow-hidden">
      {/* Outer Phone Mockup Chassis (only visible on tablet viewports < 1024px) */}
      <div className="relative w-full h-screen sm:w-[410px] sm:max-w-[410px] sm:h-[840px] sm:max-h-[94vh] sm:bg-[#1E293B] sm:p-[12px] sm:rounded-[52px] sm:shadow-[0_25px_80px_-15px_rgba(0,0,0,0.85)] sm:border sm:border-slate-700/60 lg:w-full lg:max-w-none lg:h-full lg:max-h-none lg:bg-transparent lg:p-0 lg:rounded-none lg:border-none lg:shadow-none flex flex-col items-center justify-center">
        
        {/* Top iPhone / Smartphone Notch (hidden on desktop lg:) */}
        <div className="hidden sm:flex lg:hidden absolute top-[12px] inset-x-0 z-50 justify-center pointer-events-none">
          <div className="w-[136px] h-[28px] bg-[#0F172A] rounded-b-[18px] flex items-center justify-center gap-2.5 px-3 shadow-md">
            <div className="w-3 h-3 rounded-full bg-[#1E293B] border border-white/10 shrink-0 shadow-inner" />
            <div className="w-10 h-1 rounded-full bg-[#1E293B] shrink-0" />
          </div>
        </div>

        {/* Inner Screen Boundary (Fills 100% on lg: desktop viewports) */}
        <div className="w-full h-full relative overflow-hidden bg-canvas flex flex-col sm:rounded-[40px] lg:rounded-none shadow-inner lg:shadow-none">
          {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}

          {!showSplash && (
            <>
              {flowState === "permissions" ? (
                <PermissionPrimingScreen onComplete={handlePermissionsComplete} />
              ) : flowState === "app" || isResident ? (
                <CitizenShell onReturnToWelcome={handleReturnToWelcome} />
              ) : (
                <WelcomeScreen
                  onContinueGuest={handleContinueGuest}
                  onSignedIn={handleSignedIn}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}



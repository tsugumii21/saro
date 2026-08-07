import { useState, useEffect } from "react";
import { Wifi, WifiOff } from "lucide-react";

/**
 * Floating online/offline connection indicator for the citizen app.
 * Shows a persistent banner when offline, auto-hides when online.
 */
export default function ConnectionIndicator() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [showOnlineToast, setShowOnlineToast] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasOffline) {
        setShowOnlineToast(true);
        setTimeout(() => setShowOnlineToast(false), 3000);
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [wasOffline]);

  if (isOnline && !showOnlineToast) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold transition-all animate-fade-in ${
        isOnline
          ? "bg-saro-green/10 text-saro-green border-b border-saro-green/20"
          : "bg-saro-amber/10 text-amber-800 border-b border-saro-amber/20"
      }`}
      role="status"
      aria-live="polite"
    >
      {isOnline ? (
        <>
          <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Connection restored — syncing queued reports</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
          <span>You are offline — reports will be saved and submitted when connection returns</span>
        </>
      )}
    </div>
  );
}

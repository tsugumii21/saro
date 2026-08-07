import { useState, useEffect } from "react";
import { WifiOff, Check } from "lucide-react";

/**
 * Offline banner.
 *
 * Deliberately a plain ink bar, not an alarm. Losing signal in Legazpi during
 * a typhoon is expected, and the app still works — reports queue locally and
 * send when the connection returns. Styling this as a warning would spend the
 * user's alarm budget on something that is not going wrong.
 *
 * It takes the full width at the very top so it never covers a control, and it
 * announces politely rather than assertively: a screen reader should not
 * interrupt someone mid-Panic to mention the network.
 */
export default function ConnectionIndicator() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [showRestored, setShowRestored] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasOffline) {
        setShowRestored(true);
        setTimeout(() => setShowRestored(false), 3000);
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

  if (isOnline && !showRestored) return null;

  const offline = !isOnline;

  return (
    <div
      role="status"
      aria-live="polite"
      className="saro-rise flex shrink-0 items-center justify-center gap-2 px-4 py-1.5"
      style={{
        background: offline ? "var(--color-ink)" : "var(--color-status-resolved-wash)",
        color: offline ? "#FFFFFF" : "var(--color-status-resolved-ink)",
      }}
    >
      {offline ? (
        <WifiOff width={13} height={13} aria-hidden="true" />
      ) : (
        <Check width={13} height={13} aria-hidden="true" />
      )}
      <span className="t-micro">
        {offline ? "Offline — reports will send when you reconnect" : "Back online"}
      </span>
    </div>
  );
}

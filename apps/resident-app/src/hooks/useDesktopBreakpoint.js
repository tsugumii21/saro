import { useState, useEffect } from "react";

/**
 * Returns true when the viewport is >= 1024px (Tailwind `lg:`).
 *
 * Uses matchMedia so it reacts to resize without polling. The initial value
 * is resolved synchronously on the same tick so there is no flash of the
 * wrong layout on mount.
 */
export function useDesktopBreakpoint() {
  const QUERY = "(min-width: 1024px)";

  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}

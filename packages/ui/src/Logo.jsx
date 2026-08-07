/**
 * The SARO mark.
 *
 * A filed run card with one door cut through it.
 *
 * Two ideas, one shape. The outer form is a dispatch card with its top-left
 * corner clipped — the index cut that told a clerk, without reading anything,
 * which drawer a card belonged to. Routing, solved in card stock. The void is
 * a doorway opening off the bottom edge: the one front door that replaced
 * twenty hotline numbers. Because the aperture is a single tall slot, it also
 * reads as the numeral 1 — saro, "one" in Bikol — without the mark ever having
 * to spell it.
 *
 * Deliberately not: a shield, a siren, a warning triangle, an exclamation
 * mark, a location pin, a speech bubble. Those are the stock parts every
 * civic-safety product is assembled from, and none of them say anything about
 * this one.
 *
 * Drawn on a 32 grid with 3px minimum stroke mass so the door survives at
 * 16px in a browser tab.
 */

const CARD_PATH = "M11 2 H27 A1 1 0 0 1 28 3 V29 A1 1 0 0 1 27 30 H5 A1 1 0 0 1 4 29 V9 Z";
const DOOR_PATH = "M13.5 30 V15.5 A2.5 2.5 0 0 1 16 13 A2.5 2.5 0 0 1 18.5 15.5 V30 Z";

export default function Logo({ className = "w-8 h-8", tone = "brand", title }) {
  // `tone` picks the ink; the aperture is always cut from it, never filled.
  const inks = {
    brand: "var(--color-brand, #1B2E6B)",
    ink: "var(--color-ink, #101725)",
    inverse: "#FFFFFF",
    panic: "var(--color-panic, #E2231A)",
    current: "currentColor",
  };
  const fill = inks[tone] || inks.brand;

  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : "true"}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* One path, evenodd: the door is cut out of the card rather than drawn
          on top of it, so the mark works on any ground including photography. */}
      <path d={`${CARD_PATH} ${DOOR_PATH}`} fill={fill} fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}

export { CARD_PATH, DOOR_PATH };

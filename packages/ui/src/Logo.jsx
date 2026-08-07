import React from "react";

/**
 * SARO brand icon — three converging branches into one trunk with a terminal dot.
 * Represents "saro" (one) — many paths converging to a single front door.
 *
 * @param {string} variant - "teal" (on light), "white" (on dark), "mono" (currentColor)
 * @param {string} className - Tailwind size/spacing classes
 */
export default function Logo({ className = "w-8 h-8", variant = "teal" }) {
  const colorMap = {
    teal: "#0F766E",
    white: "#FFFFFF",
    mono: "currentColor"
  };
  const color = colorMap[variant] || colorMap.teal;

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Left branch — wider angle for clarity at small sizes */}
      <line x1="5" y1="7" x2="16" y2="17" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
      {/* Center branch */}
      <line x1="16" y1="4" x2="16" y2="17" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
      {/* Right branch — wider angle for clarity */}
      <line x1="27" y1="7" x2="16" y2="17" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
      {/* Trunk */}
      <line x1="16" y1="17" x2="16" y2="24" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
      {/* Terminal dot */}
      <circle cx="16" cy="27" r="3.5" fill={color} />
    </svg>
  );
}

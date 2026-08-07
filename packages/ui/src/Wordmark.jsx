import React from "react";
import Logo from "./Logo.jsx";

/**
 * Locked icon + wordmark lockup.
 * @param {"teal"|"white"|"mono"} variant — Color variant
 * @param {"sm"|"md"|"lg"} size — Size preset
 */
export default function Wordmark({ variant = "teal", size = "md" }) {
  const sizeMap = {
    sm: { logo: "w-5 h-5", text: "text-sm" },
    md: { logo: "w-7 h-7", text: "text-lg" },
    lg: { logo: "w-10 h-10", text: "text-2xl" }
  };
  const textColorMap = {
    teal: "text-saro-ink",
    white: "text-white",
    mono: "text-current"
  };
  const s = sizeMap[size] || sizeMap.md;
  const textColor = textColorMap[variant] || textColorMap.teal;

  return (
    <div className="inline-flex items-center gap-2">
      <Logo className={s.logo} variant={variant} />
      <span className={`${textColor} font-bold ${s.text} tracking-tight`}>SARO</span>
    </div>
  );
}

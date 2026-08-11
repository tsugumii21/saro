import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * The one code.
 *
 * This is the single thing a resident leaves with, and the thing they will
 * later read down a phone line to someone in an office. So it is set in
 * Atkinson Hyperlegible Mono at generous tracking, and the prefix is held back
 * in a lighter ink so the four characters that actually vary are what the eye
 * lands on.
 *
 * The alphabet already excludes 0/O and 1/I at generation time; the typeface
 * is the second line of defence for the characters that remain.
 */
export default function TrackingCode({ code, size = "md", onCopy, showCopy = true }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;

  const [prefix, body] = code.includes("-") ? code.split(/-(.*)/s) : ["", code];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      onCopy?.(code);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — the code is on screen regardless */
    }
  };

  if (size === "xl") {
    return (
      <div className="flex items-center gap-3">
        <span className="t-code-xl">
          <span style={{ color: "var(--color-ink-faint)" }}>{prefix}-</span>
          <span style={{ color: "var(--color-ink)" }}>{body}</span>
        </span>
        {showCopy && (
          <button
            type="button"
            onClick={handleCopy}
            className="saro-btn saro-btn-secondary saro-btn-sm"
            aria-label={copied ? "Code copied" : `Copy tracking code ${code}`}
          >
            {copied ? <Check width={13} height={13} /> : <Copy width={13} height={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    );
  }

  return (
    <span className="t-code" style={{ color: "var(--color-ink)" }}>
      <span style={{ color: "var(--color-ink-faint)" }}>{prefix}-</span>
      {body}
    </span>
  );
}

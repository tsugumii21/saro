import Logo from "./Logo.jsx";

/**
 * The SARO lockup.
 *
 * The name is set in Atkinson Hyperlegible, the face the Braille Institute
 * drew to make characters unmistakable from one another. Using it for the
 * wordmark puts the product's own thesis in its name: this is a service that
 * has to be read correctly the first time, by someone under stress.
 *
 * `context` labels the deployment. The admin app says OPERATIONS next to the
 * name, because a dispatcher and a resident should never be one glance away
 * from mistaking which system they are looking at.
 */
export default function Wordmark({
  size = "md",
  tone = "brand",
  context,
  className = "",
}) {
  const sizes = {
    sm: { logo: "w-5 h-5", name: "text-[15px]", gap: "gap-2", ctx: "text-[9px]" },
    md: { logo: "w-7 h-7", name: "text-[19px]", gap: "gap-2.5", ctx: "text-[10px]" },
    lg: { logo: "w-11 h-11", name: "text-[30px]", gap: "gap-3", ctx: "text-[12px]" },
  };
  const s = sizes[size] || sizes.md;

  const nameColor =
    tone === "inverse" ? "text-white"
    : tone === "ink" ? "text-[color:var(--color-ink)]"
    : "text-[color:var(--color-brand)]";

  const ctxColor =
    tone === "inverse" ? "text-white/55" : "text-[color:var(--color-ink-faint)]";

  return (
    <span className={`inline-flex items-center ${s.gap} ${className}`}>
      <Logo className={s.logo} tone={tone} />
      <span className="inline-flex flex-col leading-none">
        <span
          className={`${s.name} ${nameColor} font-bold`}
          style={{ fontFamily: "var(--font-brand)", letterSpacing: "0.06em" }}
        >
          SARO
        </span>
        {context && (
          <span
            className={`${s.ctx} ${ctxColor} font-bold mt-1`}
            style={{ letterSpacing: "0.16em" }}
          >
            {context}
          </span>
        )}
      </span>
    </span>
  );
}

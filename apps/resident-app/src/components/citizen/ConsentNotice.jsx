import { ShieldCheck, X, MapPin, Clock, FileText, Smartphone, Lock, Eye, Scale, Building2, CheckCircle2, Shield, AlertTriangle, Check } from "lucide-react";
import { CLIENT_STORAGE_KEYS, CONSENT_VERSION } from "@saro/shared";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";

/**
 * RA 10173 (Data Privacy Act of 2012) notice.
 *
 * Plain language is a legal requirement under RA 10173.
 * Acknowledgement is stored per device against CONSENT_VERSION.
 */

export function consentAcknowledged() {
  try {
    return Number(localStorage.getItem(CLIENT_STORAGE_KEYS.CONSENT_ACK)) >= CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function acknowledgeConsent() {
  try {
    localStorage.setItem(CLIENT_STORAGE_KEYS.CONSENT_ACK, String(CONSENT_VERSION));
  } catch { /* storage blocked */ }
}

const COLLECTED_ITEMS = [
  {
    icon: MapPin,
    title: "GPS Location Data",
    detail: "Your exact coordinates when submitting, allowing emergency teams to pinpoint the hazard location.",
  },
  {
    icon: Clock,
    title: "Incident Timestamp",
    detail: "The exact date and time your report was filed for emergency dispatch timeline logging.",
  },
  {
    icon: FileText,
    title: "Report Content & Photos",
    detail: "Your description of the situation and any media files attached as evidence.",
  },
  {
    icon: Smartphone,
    title: "Device Token Label",
    detail: "A randomized browser token for tracking your report. Not your name, phone number, or IMEI.",
  },
];

const AGENCIES = [
  { shortName: "911 Action Center", fullName: "911 Emergency Action Center", badge: "24/7 Hotline" },
  { shortName: "Legazpi CDRRMO", fullName: "City Disaster Risk Reduction & Mgt Office", badge: "Disaster Control" },
  { shortName: "PNP Police", fullName: "Philippine National Police", badge: "Public Safety" },
  { shortName: "BFP Fire & Rescue", fullName: "Bureau of Fire Protection", badge: "Fire & Rescue" },
  { shortName: "Barangay Hall", fullName: "Local Barangay Administration", badge: "Community" },
  { shortName: "Assigned City Office", fullName: "Engineering, Health, or Social Welfare", badge: "Hazard Action" },
];

/**
 * @param {object}   props
 * @param {() => void} props.onAcknowledge
 * @param {boolean}  [props.dismissible]
 */
export default function ConsentNotice({ onAcknowledge, dismissible = false }) {
  const isDesktop = useDesktopBreakpoint();

  const accept = () => {
    acknowledgeConsent();
    onAcknowledge?.();
  };

  /* ── Desktop Executive View (≥ 1024px) ────────────────────────────────── */
  if (isDesktop) {
    return (
      <section
        role="region"
        aria-labelledby="consent-heading-desktop"
        className="w-full font-sans text-ink animate-in fade-in duration-200"
      >
        <div className="grid grid-cols-12 gap-8 items-start">
          {/* Left Column: Executive Summary & CTA Card */}
          <aside className="col-span-4 lg:col-span-4 sticky top-6 space-y-4 max-h-[calc(100vh-5rem)] overflow-y-auto pr-1">
            <div className="bg-surface border border-line rounded-xl p-6 shadow-xl space-y-5">
              <div className="relative flex items-center justify-between border-b border-line pb-4 pr-8">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2.5 rounded-xl bg-brand-wash border border-brand/20 text-brand shrink-0">
                    <ShieldCheck className="w-6 h-6 stroke-[2.2]" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-brand/10 text-brand border border-brand/20 block w-fit mb-1 whitespace-nowrap shrink-0">
                      RA 10173 Compliant
                    </span>
                    <h2 id="consent-heading-desktop" className="text-base font-bold text-ink leading-tight">
                      Data Privacy Governance
                    </h2>
                  </div>
                </div>
                {dismissible && (
                  <button
                    type="button"
                    onClick={accept}
                    aria-label="Close and acknowledge"
                    className="absolute top-0 right-0 p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-sunken transition-colors focus:outline-none focus:ring-2 focus:ring-brand/30"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              <p className="text-xs text-ink-muted leading-relaxed">
                Clear, transparent privacy governance required by the <strong>Data Privacy Act of 2012 (RA 10173)</strong> for Legazpi City civic reporting.
              </p>

              {/* Quick Pillars Checklist */}
              <div className="space-y-2.5 pt-1 border-t border-line text-xs">
                <span className="font-bold text-ink uppercase tracking-wider text-[11px] block">
                  Core Privacy Pillars
                </span>
                <div className="flex items-center gap-2 text-ink">
                  <Check className="w-4 h-4 text-brand shrink-0" />
                  <span><strong>100% Anonymous</strong> by default</span>
                </div>
                <div className="flex items-center gap-2 text-ink">
                  <Check className="w-4 h-4 text-brand shrink-0" />
                  <span><strong>Zero Advertising</strong> &amp; no data sales</span>
                </div>
                <div className="flex items-center gap-2 text-ink">
                  <Check className="w-4 h-4 text-brand shrink-0" />
                  <span><strong>Official City Responders</strong> routing</span>
                </div>
                <div className="flex items-center gap-2 text-ink">
                  <Check className="w-4 h-4 text-brand shrink-0" />
                  <span><strong>3-Year Audit Retention</strong>, then purged</span>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={accept}
                  className="saro-btn saro-btn-primary saro-btn-lg w-full flex items-center justify-center gap-2 font-bold shadow-md hover:shadow-lg transition-all text-xs px-4 py-3"
                >
                  <ShieldCheck className="w-4.5 h-4.5 shrink-0" />
                  <span>I Understand &amp; Acknowledge</span>
                </button>
              </div>
            </div>

            {/* Emergency Handoff Notice */}
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/80 text-amber-950 text-xs flex items-start gap-3 shadow-2xs">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Emergency Guarantee:</strong> Panic alerts and 911 dispatch operate 24/7 unconditionally to save lives, regardless of privacy notice status.
              </p>
            </div>
          </aside>

          {/* Right Column: Detailed Governance Content */}
          <main className="col-span-8 lg:col-span-8 space-y-6">
            {/* Section 1: What We Collect */}
            <div className="bg-surface border border-line rounded-xl p-6 shadow-md space-y-4">
              <div className="flex items-center gap-2 border-b border-line pb-3">
                <Lock className="w-5 h-5 text-brand shrink-0" />
                <h3 className="text-sm font-bold text-ink uppercase tracking-wider">
                  1. What We Collect
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {COLLECTED_ITEMS.map(({ icon: Icon, title, detail }) => (
                  <div
                    key={title}
                    className="p-4 rounded-lg border border-line bg-white hover:border-brand-edge transition-colors flex items-start gap-3.5 shadow-2xs"
                  >
                    <div className="p-2.5 rounded-lg bg-sunken text-brand shrink-0 mt-0.5">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-ink leading-snug">{title}</h4>
                      <p className="text-xs text-ink-muted leading-relaxed mt-1">{detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Anonymity Assurance Callout */}
              <div className="p-3.5 rounded-lg bg-brand-wash/40 border border-brand/20 text-xs text-ink flex items-start gap-2.5">
                <CheckCircle2 className="w-4.5 h-4.5 text-brand shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong>No Mandatory Name or Phone Number:</strong> Incident reporting is completely anonymous by default. Providing contact details is strictly optional for officer callbacks.
                </p>
              </div>
            </div>

            {/* Section 2: Non-Commercial Policy */}
            <div className="bg-surface border border-line rounded-xl p-6 shadow-md space-y-4">
              <div className="flex items-center gap-2 border-b border-line pb-3">
                <Shield className="w-5 h-5 text-brand shrink-0" />
                <h3 className="text-sm font-bold text-ink uppercase tracking-wider">
                  2. Strict Civic Purpose Guarantee
                </h3>
              </div>

              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/70 text-emerald-950 text-xs space-y-2 shadow-2xs">
                <div className="flex items-center gap-2 font-bold text-emerald-900 text-sm">
                  <CheckCircle2 className="w-4.5 h-4.5 text-emerald-700 shrink-0" />
                  <span>Zero Advertising &amp; Non-Commercial Policy</span>
                </div>
                <p className="leading-relaxed text-emerald-800 text-xs">
                  Your information is exclusively used to route emergency assistance and coordinate hazard repairs with official Legazpi City responders. SARO <strong>never displays ads, never sells data, and never shares information with commercial third parties</strong>.
                </p>
              </div>
            </div>

            {/* Section 3: Authorized City Responders */}
            <div className="bg-surface border border-line rounded-xl p-6 shadow-md space-y-4">
              <div className="flex items-center gap-2 border-b border-line pb-3">
                <Eye className="w-5 h-5 text-brand shrink-0" />
                <h3 className="text-sm font-bold text-ink uppercase tracking-wider">
                  3. Authorized Responding Agencies
                </h3>
              </div>
              <p className="text-xs text-ink-muted">
                Reports are strictly routed to the verified government agency or barangay office designated to act on your specific hazard type:
              </p>

              <div className="grid grid-cols-3 gap-3">
                {AGENCIES.map(({ shortName, fullName, badge }) => (
                  <div
                    key={shortName}
                    className="p-3.5 rounded-lg border border-line bg-white flex flex-col justify-between gap-2 shadow-2xs hover:border-brand-edge transition-colors"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-brand shrink-0" />
                        <span className="text-xs font-bold text-ink leading-snug">{shortName}</span>
                      </div>
                      <p className="text-[11px] text-ink-muted leading-tight pl-6">{fullName}</p>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sunken text-ink-faint border border-line w-fit mt-1">
                      {badge}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 4: Data Retention & Rights */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface border border-line rounded-xl p-5 shadow-md space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-ink border-b border-line pb-2">
                  <Clock className="w-4 h-4 text-brand shrink-0" />
                  <span>How Long Data Is Kept</span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Reports are safely retained for <strong>3 years after resolution</strong> to fulfill municipal disaster audit standards, after which data is permanently deleted.
                </p>
              </div>

              <div className="bg-surface border border-line rounded-xl p-5 shadow-md space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-ink border-b border-line pb-2">
                  <Scale className="w-4 h-4 text-brand shrink-0" />
                  <span>Your Rights Under RA 10173</span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  You have the right to inspect, correct, or request deletion of your records. Inquire at the Legazpi City Hall Records Office using your tracking code.
                </p>
              </div>
            </div>
          </main>
        </div>
      </section>
    );
  }

  /* ── Mobile View (< 1024px) ─────────────────────────────────────────────── */
  return (
    <section
      role="region"
      aria-labelledby="consent-heading-mobile"
      className="w-full max-w-md mx-auto my-2 bg-surface border border-line rounded-md shadow-xl overflow-hidden font-sans text-ink transition-all animate-in fade-in duration-200"
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-3 border-b border-line p-4 bg-sunken/40">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 rounded-md bg-brand-wash border border-brand/20 text-brand shrink-0 mt-0.5">
            <ShieldCheck className="w-5 h-5 stroke-[2.2]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand/10 text-brand border border-brand/20">
                RA 10173 Compliant
              </span>
              <span className="text-[10px] font-bold text-ink-muted">Data Privacy Act</span>
            </div>
            <h2 id="consent-heading-mobile" className="text-base font-bold text-ink leading-tight">
              Data Privacy &amp; Governance
            </h2>
          </div>
        </div>

        {dismissible && (
          <button
            type="button"
            onClick={accept}
            aria-label="Close and acknowledge"
            className="saro-btn saro-btn-ghost saro-btn-sm shrink-0 -mr-1 -mt-1 text-ink-muted hover:text-ink"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </header>

      {/* Main Content List */}
      <div className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
        {/* Section 1: What We Collect */}
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-brand shrink-0" />
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider">
              1. What We Collect
            </h3>
          </div>

          <div className="space-y-2">
            {COLLECTED_ITEMS.map(({ icon: Icon, title, detail }) => (
              <div
                key={title}
                className="p-3 rounded-md border border-line bg-white flex items-start gap-3 shadow-2xs"
              >
                <div className="p-1.5 rounded bg-sunken text-brand shrink-0 mt-0.5">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-ink leading-snug">{title}</h4>
                  <p className="text-[11px] text-ink-muted leading-relaxed mt-0.5">{detail}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-2.5 rounded-md bg-brand-wash/40 border border-brand/20 text-[11px] text-ink flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>Anonymous by Default:</strong> Providing your name or phone number is strictly optional for officer callbacks.
            </p>
          </div>
        </div>

        {/* Section 2: Non-Commercial Policy */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-brand shrink-0" />
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider">
              2. Non-Commercial Policy
            </h3>
          </div>

          <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50/70 text-emerald-950 text-xs space-y-1 shadow-2xs">
            <div className="flex items-center gap-1.5 font-bold text-emerald-900 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>Zero Advertising &amp; No Data Sales</span>
            </div>
            <p className="leading-relaxed text-emerald-800 text-[11px]">
              Your data is exclusively used for disaster response and hazard repairs with official city responders. SARO <strong>never displays ads or sells data</strong>.
            </p>
          </div>
        </div>

        {/* Section 3: Responders List */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-brand shrink-0" />
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider">
              3. Responding Agencies
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {AGENCIES.map(({ shortName, badge }) => (
              <div
                key={shortName}
                className="p-2.5 rounded-md border border-line bg-white flex flex-col justify-between gap-1 shadow-2xs"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Building2 className="w-3.5 h-3.5 text-brand shrink-0" />
                  <span className="text-[11px] font-bold text-ink truncate">{shortName}</span>
                </div>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sunken text-ink-faint border border-line w-fit">
                  {badge}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4: Data Retention & Rights */}
        <div className="space-y-2 pt-2 border-t border-line">
          <div className="p-3 rounded-md border border-line bg-white space-y-1 shadow-2xs">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <Clock className="w-4 h-4 text-brand shrink-0" />
              <span>3-Year Audit Retention</span>
            </div>
            <p className="text-[11px] text-ink-muted leading-relaxed">
              Reports are retained for 3 years post-resolution for municipal audit compliance, then permanently deleted.
            </p>
          </div>

          <div className="p-3 rounded-md border border-line bg-white space-y-1 shadow-2xs">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <Scale className="w-4 h-4 text-brand shrink-0" />
              <span>Your Rights Under RA 10173</span>
            </div>
            <p className="text-[11px] text-ink-muted leading-relaxed">
              Inquire, inspect, or request record corrections at Legazpi City Hall Records Office using your tracking code.
            </p>
          </div>
        </div>

        {/* Emergency Exemption Notice */}
        <div className="p-3 rounded-md border border-amber-200 bg-amber-50/70 text-amber-950 text-[11px] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Emergency Exemption:</strong> Panic alerts and 911 dispatch operate unconditionally to save lives.
          </p>
        </div>

        {/* Action Button */}
        <div className="pt-1">
          <button
            type="button"
            onClick={accept}
            className="saro-btn saro-btn-primary w-full flex items-center justify-center gap-2 font-bold min-h-[48px] py-3.5 px-4 rounded-md shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-all text-xs"
          >
            <ShieldCheck className="w-5 h-5" />
            <span>I Understand &amp; Acknowledge</span>
          </button>
        </div>
      </div>
    </section>
  );
}



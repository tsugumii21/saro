import { ShieldCheck, X, MapPin, Clock, FileText, Smartphone, Lock, Eye, Scale, Building2, CheckCircle2, Shield, AlertTriangle } from "lucide-react";
import { CLIENT_STORAGE_KEYS, CONSENT_VERSION } from "@saro/shared";

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
    detail: "Your exact coordinates when submitting, allowing emergency teams to pinpoint the hazard.",
  },
  {
    icon: Clock,
    title: "Incident Timestamp",
    detail: "The exact date and time your report was filed for emergency dispatch logging.",
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
  { name: "911 Emergency Action Center", badge: "24/7 Hotline" },
  { name: "Legazpi City CDRRMO", badge: "Disaster Control" },
  { name: "Philippine National Police (PNP)", badge: "Public Safety" },
  { name: "Bureau of Fire Protection (BFP)", badge: "Fire & Rescue" },
  { name: "Your Local Barangay Hall", badge: "Community" },
  { name: "Assigned City Office", badge: "Hazard Action" },
];

/**
 * @param {object}   props
 * @param {() => void} props.onAcknowledge
 * @param {boolean}  [props.dismissible]
 */
export default function ConsentNotice({ onAcknowledge, dismissible = false }) {
  const accept = () => {
    acknowledgeConsent();
    onAcknowledge?.();
  };

  return (
    <section
      role="region"
      aria-labelledby="consent-heading"
      className="w-full bg-surface border border-line rounded-xl shadow-xl overflow-hidden font-sans text-ink transition-all animate-in fade-in duration-200"
    >
      {/* Executive Header */}
      <header className="flex items-start justify-between gap-4 border-b border-line p-5 md:p-6 bg-sunken/40">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="p-2.5 rounded-xl bg-brand-wash border border-brand/20 text-brand shrink-0 mt-0.5">
            <ShieldCheck className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-brand/10 text-brand border border-brand/20">
                RA 10173 Compliant
              </span>
              <span className="text-[11px] font-bold text-ink-muted">Data Privacy Act of 2012</span>
            </div>
            <h2 id="consent-heading" className="text-lg md:text-xl font-bold text-ink leading-tight">
              How SARO Handles Your Data &amp; Privacy
            </h2>
            <p className="text-xs md:text-sm text-ink-muted mt-1 leading-relaxed">
              Transparent data governance designed for civic safety and Philippine privacy compliance.
            </p>
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

      {/* Main Content Grid */}
      <div className="p-5 md:p-6 space-y-6 max-h-[75vh] overflow-y-auto">
        {/* Section 1: What We Collect */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4.5 h-4.5 text-brand shrink-0" />
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider">
              1. What We Collect
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {COLLECTED_ITEMS.map(({ icon: Icon, title, detail }) => (
              <div
                key={title}
                className="p-3.5 rounded-lg border border-line bg-white hover:border-brand-edge transition-colors flex items-start gap-3 shadow-2xs"
              >
                <div className="p-2 rounded-md bg-sunken text-brand shrink-0 mt-0.5">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-ink leading-snug">{title}</h4>
                  <p className="text-[11px] text-ink-muted leading-relaxed mt-0.5">{detail}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Anonymity Assurance Callout */}
          <div className="p-3 rounded-lg bg-brand-wash/40 border border-brand/20 text-xs text-ink flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>No Mandatory Name or Phone Number:</strong> Filing is completely anonymous by default. Providing contact info is strictly optional so responders can call you back.
            </p>
          </div>
        </div>

        {/* Section 2: Non-Commercial Guarantee */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4.5 h-4.5 text-brand shrink-0" />
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider">
              2. Strict Civic Purpose Guarantee
            </h3>
          </div>

          <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/70 text-emerald-950 text-xs space-y-1.5 shadow-2xs">
            <div className="flex items-center gap-2 font-bold text-emerald-900 text-sm">
              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-700 shrink-0" />
              <span>Zero Advertising &amp; Non-Commercial Policy</span>
            </div>
            <p className="leading-relaxed text-emerald-800">
              Your information is exclusively used to route emergency assistance and coordinate hazard repairs with official Legazpi City responders. SARO <strong>never displays ads, never sells data, and never shares information with commercial entities</strong>.
            </p>
          </div>
        </div>

        {/* Section 3: Who Receives Your Data */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Eye className="w-4.5 h-4.5 text-brand shrink-0" />
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider">
              3. Authorized City Responders
            </h3>
          </div>
          <p className="text-xs text-ink-muted">
            Reports are strictly routed to the verified government agency or barangay office designated to act on your specific hazard type:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {AGENCIES.map(({ name, badge }) => (
              <div
                key={name}
                className="p-3 rounded-lg border border-line bg-white flex items-center justify-between gap-2 shadow-2xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 text-brand shrink-0" />
                  <span className="text-xs font-bold text-ink truncate">{name}</span>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sunken text-ink-faint border border-line shrink-0">
                  {badge}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4: Data Retention & Rights */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-line">
          {/* Retention */}
          <div className="p-4 rounded-lg border border-line bg-white space-y-1.5 shadow-2xs">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <Clock className="w-4 h-4 text-brand shrink-0" />
              <span>How Long Data Is Kept</span>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              Reports are safely retained for <strong>3 years after resolution</strong> to fulfill municipal disaster audit standards, after which data is permanently deleted.
            </p>
          </div>

          {/* User Rights under DPA */}
          <div className="p-4 rounded-lg border border-line bg-white space-y-1.5 shadow-2xs">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <Scale className="w-4 h-4 text-brand shrink-0" />
              <span>Your Rights Under RA 10173</span>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              You have the right to inspect, correct, or request deletion of your records. Inquire at the Legazpi City Hall Records Office using your tracking code.
            </p>
          </div>
        </div>

        {/* Emergency Handoff Notice */}
        <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/70 text-amber-950 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Emergency Exemption:</strong> Panic alerts and 911 dispatch operate unconditionally to save lives, regardless of whether you have reviewed this privacy notice.
          </p>
        </div>

        {/* Action Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={accept}
            className="saro-btn saro-btn-primary saro-btn-lg w-full flex items-center justify-center gap-2 font-bold shadow-md hover:shadow-lg transition-all"
          >
            <ShieldCheck className="w-5 h-5" />
            I Understand &amp; Acknowledge Privacy Terms
          </button>
        </div>
      </div>
    </section>
  );
}


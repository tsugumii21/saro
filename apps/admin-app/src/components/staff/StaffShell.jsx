import { useState } from "react";
import {
  Mail, Lock, LogOut, LayoutDashboard, Building2, ArrowRight, ArrowLeft,
  Layers, Siren, FileDown, MapPin, Map, MessageCircleQuestion, Users,
  BarChart3, Shield,
} from "lucide-react";
import ResponderDashboard from "./ResponderDashboard.jsx";
import AdminDashboard from "./AdminDashboard.jsx";
import RoutingEditor from "./RoutingEditor.jsx";
import LiveMap from "./LiveMap.jsx";
import PanicReview from "./PanicReview.jsx";
import EvidenceExport from "./EvidenceExport.jsx";
import GapLog from "./GapLog.jsx";
import OfficesAndAccounts from "./OfficesAndAccounts.jsx";
import AlertLevelEditor from "./AlertLevelEditor.jsx";
import EvacuationCentersEditor from "./EvacuationCentersEditor.jsx";
import { Wordmark } from "@saro/ui";
import { useAuth, STAFF_ROLES } from "@saro/shared";

/**
 * Operations shell.
 * Flat, single-level navigation bar for operations staff and administrators.
 */

const SECTIONS = [
  { id: "dispatch",   Icon: LayoutDashboard,        label: "Dispatch",           roles: ["admin", "office", "barangay_official"] },
  { id: "clusters",   Icon: Map,                    label: "Live Map",           roles: ["admin", "office", "barangay_official"] },
  { id: "analytics",  Icon: BarChart3,              label: "Analytics",          roles: ["admin", "office", "barangay_official"] },
  { id: "evidence",   Icon: FileDown,               label: "Evidence",           roles: ["admin", "office", "barangay_official"] },
  { id: "routing",    Icon: Building2,              label: "Routing & Data",     roles: ["admin"] },
  { id: "evacuation", Icon: Shield,                 label: "Evacuation Centers", roles: ["admin", "office", "barangay_official"] },
  { id: "accounts",   Icon: Users,                  label: "Offices & Accounts", roles: ["admin"] },
  { id: "panic",      Icon: Siren,                  label: "Panic Review",       roles: ["admin", "office"] },
  { id: "gaplog",     Icon: MessageCircleQuestion,  label: "Gap Log",            roles: ["admin", "office"] },
];

export default function StaffShell() {
  const { profile, role, isAdmin, canManageAccounts, canManageRouting, officeName, barangayName, loading, signOut } = useAuth();
  const [tab, setTab] = useState("dispatch");

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="t-body-sm text-ink-muted">Checking your session…</p>
      </div>
    );
  }

  // Authenticated is not authorized: a user with no profile row has no role.
  if (!profile || !STAFF_ROLES.includes(role)) return <StaffLogin />;

  const scope = officeName || barangayName || "City-wide";
  const visibleSections = SECTIONS.filter((s) => s.roles.includes(role));

  // A tab the current role cannot see falls back to Dispatch rather than
  // rendering nothing — reachable only if the stored tab outlives a role change.
  const active = visibleSections.some((s) => s.id === tab) ? tab : "dispatch";

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="flex w-full items-center justify-between gap-4 px-5 py-2.5">
          <div className="flex items-center gap-5">
            <Wordmark size="sm" context="OPERATIONS" />
            <span className="hidden items-center gap-2 border-l border-line pl-5 sm:flex">
              <span className="t-label text-ink">{scope}</span>
              <span className="t-micro border border-line bg-raised px-1.5 py-0.5 capitalize text-ink-muted">
                {role.replace("_", " ")}
              </span>
            </span>
          </div>

          <nav className="flex flex-wrap items-center gap-px border border-line bg-line" aria-label="Sections">
            {visibleSections.map(({ id, Icon, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={tab === id ? "page" : undefined}
                className="saro-btn saro-btn-sm"
                style={{
                  background: tab === id ? "var(--color-brand)" : "var(--color-surface)",
                  color: tab === id ? "#fff" : "var(--color-ink-muted)",
                }}
              >
                <Icon width={14} height={14} />
                {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden text-right md:block">
              <span className="t-body-sm block font-semibold leading-tight">{profile.full_name}</span>
              <span className="t-data-sm block text-ink-faint">{profile.mobile_number || "Legazpi EOC"}</span>
            </span>
            <button onClick={signOut} className="saro-btn saro-btn-secondary saro-btn-sm">
              <LogOut width={14} height={14} />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-5">
        {active === "dispatch"   && <ResponderDashboard />}
        {active === "clusters"   && <LiveMap />}
        {active === "analytics"  && <AdminDashboard />}
        {active === "evidence"   && <EvidenceExport />}
        {active === "panic"      && <PanicReview />}
        {active === "gaplog"     && <GapLog />}
        {active === "evacuation" && <EvacuationCentersEditor />}
        {active === "accounts"   && (canManageAccounts || isAdmin) && <OfficesAndAccounts />}
        {active === "routing"    && (canManageRouting || isAdmin) && (
          <div className="flex flex-col gap-8">
            <AlertLevelEditor />
            <RoutingEditor />
          </div>
        )}
      </main>
    </div>
  );
}

export function StaffLogin({ onBack }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForgotNotice, setShowForgotNotice] = useState(false);

  const fillAccount = (accountEmail) => {
    setEmail(accountEmail);
    setPassword("demo123");
    setError("");
    setShowForgotNotice(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setShowForgotNotice(false);
    if (!email.trim()) return setError("Enter your work email address.");
    if (!password) return setError("Enter your account password.");
    setBusy(true);
    const { error: signInError } = await signIn(email, password);
    setBusy(false);
    if (signInError) setError(signInError);
  };

  return (
    <div className="flex min-h-screen flex-col bg-canvas font-sans selection:bg-brand-wash selection:text-brand">
      {/* Operations Portal Header */}
      <div className="flex items-center justify-between border-b border-line bg-white px-5 py-4 shadow-2xs">
        <Wordmark size="sm" context="OPERATIONS PORTAL" />
        {onBack ? (
          <button
            onClick={onBack}
            className="saro-btn saro-btn-ghost saro-btn-sm font-semibold text-xs text-ink-muted hover:text-ink flex items-center gap-1.5"
          >
            <ArrowLeft width={14} height={14} />
            Back to Overview
          </button>
        ) : (
          <span className="t-label text-ink-faint text-xs font-semibold">Legazpi City Emergency Portal</span>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="saro-clip saro-card w-full max-w-[420px] p-6 sm:p-8 bg-white border border-line shadow-card rounded-xs">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand">Staff & Official Access</span>
          </div>
          <h1 className="text-2xl font-extrabold text-ink tracking-tight">Sign In to SARO Operations</h1>
          <p className="t-body-sm mt-1.5 text-ink-muted leading-relaxed">
            Authorized portal for City Directors, Department Responders, and Barangay Officials.
          </p>

          {/* Quick-Select Demo Accounts for Testing */}
          <div className="mt-5 p-3 rounded-xs border border-brand-wash bg-brand-wash/40 space-y-2">
            <span className="t-label block text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              Select Test Account Role:
            </span>
            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => fillAccount("admin@saro.legazpi.gov.ph")}
                className="px-2 py-1.5 bg-white hover:bg-brand hover:text-white border border-line rounded text-ink font-bold transition-colors truncate"
                title="City Director / Admin"
              >
                Director (Admin)
              </button>
              <button
                type="button"
                onClick={() => fillAccount("cdrrmo@saro.legazpi.gov.ph")}
                className="px-2 py-1.5 bg-white hover:bg-brand hover:text-white border border-line rounded text-ink font-bold transition-colors truncate"
                title="CDRRMO Office Staff"
              >
                CDRRMO (Office)
              </button>
              <button
                type="button"
                onClick={() => fillAccount("bitano@saro.legazpi.gov.ph")}
                className="px-2 py-1.5 bg-white hover:bg-brand hover:text-white border border-line rounded text-ink font-bold transition-colors truncate"
                title="Barangay Official"
              >
                Bitano (Official)
              </button>
            </div>
          </div>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            <label className="block">
              <span className="t-label text-xs font-bold text-ink-muted">Work Email</span>
              <span className="mt-1.5 flex items-center gap-2 border border-line-strong bg-surface px-3 focus-within:border-brand rounded-xs">
                <Mail width={15} height={15} className="shrink-0 text-ink-faint" aria-hidden="true" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  className="t-body w-full bg-transparent py-2.5 outline-none text-xs font-medium text-ink placeholder:text-ink-faint/60"
                  placeholder="you@saro.legazpi.gov.ph"
                />
              </span>
            </label>

            <label className="block">
              <div className="flex items-center justify-between">
                <span className="t-label text-xs font-bold text-ink-muted">Password</span>
                <button
                  type="button"
                  onClick={() => setShowForgotNotice((prev) => !prev)}
                  className="text-[11px] font-semibold text-brand hover:underline cursor-pointer"
                >
                  Forgot Password?
                </button>
              </div>
              <span className="mt-1.5 flex items-center gap-2 border border-line-strong bg-surface px-3 focus-within:border-brand rounded-xs">
                <Lock width={15} height={15} className="shrink-0 text-ink-faint" aria-hidden="true" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="t-body w-full bg-transparent py-2.5 outline-none text-xs font-medium text-ink placeholder:text-ink-faint/60"
                />
              </span>
            </label>

            {/* Forgot Password Notice Box */}
            {showForgotNotice && (
              <div className="p-3 bg-raised border border-line rounded-xs text-xs text-ink-muted space-y-1 animate-fadeIn">
                <span className="font-bold text-ink block">Staff Password Reset</span>
                <p className="leading-relaxed text-[11px]">
                  Staff credentials are administration-issued. Please contact the City DRRMO Administrator at <strong className="text-brand font-mono">eoc@legazpi.gov.ph</strong> or call <strong className="text-ink font-mono">+63 (52) 742-2162</strong> to request a password reset.
                </p>
              </div>
            )}

            {/* Error Feedback Alert */}
            {error && (
              <div role="alert" className="t-body-sm border border-alert/80 bg-alert-wash px-3.5 py-2.5 rounded-xs text-alert text-xs font-semibold flex items-center gap-2">
                <span className="shrink-0 font-extrabold">✕</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="saro-btn-primary w-full min-h-[44px] rounded-xs font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-transform active:scale-[0.99]"
            >
              {busy ? "Signing In…" : "Sign In to Operations"}
              {!busy && <ArrowRight width={15} height={15} />}
            </button>
          </form>

          <p className="t-body-sm mt-6 border-t border-rule pt-4 text-[11px] text-ink-faint leading-relaxed">
            Unauthorized access attempts are monitored and logged by the Legazpi City EOC Security System.
          </p>
        </div>
      </div>
    </div>
  );
}

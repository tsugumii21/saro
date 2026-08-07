import { useState } from "react";
import { Mail, Lock, LogOut, LayoutDashboard, Building2, ArrowRight, ArrowLeft } from "lucide-react";
import ResponderDashboard from "./ResponderDashboard.jsx";
import AdminDashboard from "./AdminDashboard.jsx";
import { Wordmark } from "@saro/ui";
import { useAuth, STAFF_ROLES } from "@saro/shared";

/**
 * Operations shell.
 *
 * Two changes worth naming. The header used to carry a near-black bar with a
 * teal glow, a pill for the role, a pill group for the tabs and a red sign-out
 * button — control-room cosplay. It is now one ink rule at the top of a light
 * page, because the people using this sit under office lighting for six hours
 * and the interface should not be shouting the whole time.
 *
 * The login screen used to be a two-panel marketing layout with a gradient
 * grid, feature bullets and a demo-credentials hint. It is now a form. The
 * only thing that page has to do is let six people in.
 */

const RESIDENT_APP_URL = import.meta.env.VITE_RESIDENT_APP_URL || "";

export default function StaffShell() {
  const { profile, role, isAdmin, officeName, barangayName, loading, signOut } = useAuth();
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

          {isAdmin && (
            <nav className="flex items-center gap-px border border-line bg-line" aria-label="Sections">
              {[
                { id: "dispatch", Icon: LayoutDashboard, label: "Dispatch" },
                { id: "admin", Icon: Building2, label: "Routing & data" },
              ].map(({ id, Icon, label }) => (
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
          )}

          <div className="flex items-center gap-3">
            <span className="hidden text-right md:block">
              <span className="t-body-sm block font-semibold leading-tight">{profile.full_name}</span>
              <span className="t-data-sm block text-ink-faint">{profile.mobile_number || "Legazpi EOC"}</span>
            </span>
            <button onClick={signOut} className="saro-btn saro-btn-secondary saro-btn-sm">
              <LogOut width={14} height={14} />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-5">
        {tab === "admin" && isAdmin ? <AdminDashboard /> : <ResponderDashboard />}
      </main>
    </div>
  );
}

function StaffLogin() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) return setError("Enter your work email.");
    if (!password) return setError("Enter your password.");
    setBusy(true);
    const { error: signInError } = await signIn(email, password);
    setBusy(false);
    if (signInError) setError(signInError);
    // On success the auth listener swaps this screen out.
  };

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="flex items-center justify-between px-5 py-4">
        <Wordmark size="sm" context="OPERATIONS" />
        <button
          onClick={() => {
            // TODO: set VITE_RESIDENT_APP_URL once the resident app has a domain.
            if (RESIDENT_APP_URL) { window.location.href = RESIDENT_APP_URL; return; }
            console.warn("VITE_RESIDENT_APP_URL is not set.");
          }}
          className="saro-btn saro-btn-ghost saro-btn-sm"
        >
          <ArrowLeft width={14} height={14} />
          Public site
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center px-5 pb-16">
        <div className="saro-clip saro-card w-full max-w-[380px] p-7">
          <h1 className="t-title">Sign in</h1>
          <p className="t-body-sm mt-1.5 text-ink-muted">
            Accounts are issued by the city administrator. There is no public sign-up here.
          </p>

          <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
            <label className="block">
              <span className="t-label text-ink-faint">Work email</span>
              <span className="mt-1.5 flex items-center gap-2 border border-line-strong bg-surface px-3 focus-within:border-brand-bright">
                <Mail width={15} height={15} className="shrink-0 text-ink-faint" aria-hidden="true" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  className="t-body w-full bg-transparent py-2.5 outline-none"
                  placeholder="you@saro.legazpi.gov.ph"
                />
              </span>
            </label>

            <label className="block">
              <span className="t-label text-ink-faint">Password</span>
              <span className="mt-1.5 flex items-center gap-2 border border-line-strong bg-surface px-3 focus-within:border-brand-bright">
                <Lock width={15} height={15} className="shrink-0 text-ink-faint" aria-hidden="true" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="t-body w-full bg-transparent py-2.5 outline-none"
                />
              </span>
            </label>

            {error && (
              <p role="alert" className="t-body-sm border border-alert bg-alert-wash px-3 py-2 text-alert">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className="saro-btn saro-btn-primary saro-btn-lg saro-btn-block mt-1">
              {busy ? "Signing in…" : "Sign in"}
              {!busy && <ArrowRight width={16} height={16} />}
            </button>
          </form>

          <p className="t-body-sm mt-6 border-t border-rule pt-4 text-ink-faint">
            Lost access? Ask the city administrator to reissue your password. Sign-in attempts
            are recorded.
          </p>
        </div>
      </div>
    </div>
  );
}

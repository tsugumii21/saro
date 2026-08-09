import { useState } from "react";
import { ShieldCheck, Mail, Lock, User, ArrowRight, ArrowLeft, MailCheck, UserCheck } from "lucide-react";
import { Wordmark } from "@saro/ui";
import { useAuth } from "@saro/shared";

/**
 * Unified Resident Authentication & Entry Screen.
 * Reuses the single canonical sign-in / sign-up flow across the app:
 * - On initial launch after Splash screen
 * - Reopened from Account / Settings panel
 * - Inline auth wall when submitting standard reports as a guest
 */

const MIN_PASSWORD_LENGTH = 8;

export default function ResidentAuthScreen({
  mode: initialMode = "sign-in",
  onCancel,
  onSignedIn,
  onContinueGuest,
  reason,
}) {
  const { signIn, signUp, resendConfirmation } = useAuth();

  const [mode, setMode] = useState(initialMode); // "sign-in" | "sign-up" | "check-email"
  const [fullName, setFullName] = useState("");
  const [accountInput, setAccountInput] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!accountInput.trim()) return setError("Enter your email or mobile number.");
    if (!password) return setError("Enter your password.");

    if (mode === "sign-up") {
      if (!fullName.trim()) return setError("Enter your full name.");
      if (password.length < MIN_PASSWORD_LENGTH) {
        return setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      }
    }

    setBusy(true);

    if (mode === "sign-up") {
      const { error: signUpError, needsConfirmation } = await signUp(accountInput.trim(), password, fullName.trim());
      setBusy(false);
      if (signUpError) return setError(signUpError);
      if (needsConfirmation) return setMode("check-email");
      onSignedIn?.();
      return;
    }

    const { error: signInError } = await signIn(accountInput.trim(), password);
    setBusy(false);
    if (signInError) return setError(signInError);
    onSignedIn?.();
  };

  const handleResend = async () => {
    setBusy(true);
    const { error: resendError } = await resendConfirmation(accountInput.trim());
    setBusy(false);
    setError(resendError || "");
    setNotice(resendError ? "" : "Confirmation email sent again.");
  };

  const handleGuestAction = () => {
    if (onContinueGuest) {
      onContinueGuest();
    } else if (onCancel) {
      onCancel();
    }
  };

  // ── Post-signup: waiting on email confirmation ────────────────────────────
  if (mode === "check-email") {
    return (
      <div className="h-full min-h-full w-full bg-gradient-to-br from-ink via-brand-strong to-ink flex flex-col items-center justify-center p-3 sm:p-4 overflow-y-auto relative font-sans">
        <div className="w-full max-w-[340px] bg-white rounded-lg p-4 sm:p-5 shadow-lift text-ink border border-line animate-slide-up relative z-10 my-auto">
          <div className="flex flex-col items-center text-center gap-2.5 mb-3.5">
            <Wordmark size="sm" />

            <div className="p-2.5 bg-brand-wash border border-brand-edge rounded-full text-brand mt-0.5">
              <MailCheck className="w-5 h-5" />
            </div>

            <div className="space-y-1">
              <h1 className="text-sm sm:text-base font-bold text-ink leading-snug">Confirm Your Email</h1>
              <p className="text-xs text-ink-muted leading-relaxed">
                We sent a link to <span className="font-mono font-semibold text-ink">{accountInput}</span>.
                Open it to finish setting up your account.
              </p>
              <p className="text-[10px] text-ink-faint leading-relaxed pt-1">
                You can keep using SARO without an account in the meantime. Reporting an
                emergency never requires signing in.
              </p>
            </div>
          </div>

          {notice && (
            <p className="text-xs text-brand bg-brand-wash border border-brand-edge rounded-xs px-2.5 py-1.5 mb-2.5">
              {notice}
            </p>
          )}
          {error && (
            <p className="text-xs text-alert bg-alert-wash border border-alert rounded-xs px-2.5 py-1.5 mb-2.5">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={handleResend}
              disabled={busy}
              className="w-full py-2 bg-sunken hover:bg-line text-ink text-xs font-bold rounded-xs transition-colors disabled:opacity-50 min-h-[38px]"
            >
              {busy ? "Sending…" : "Resend Confirmation Email"}
            </button>
            <button
              type="button"
              onClick={handleGuestAction}
              className="w-full py-2 text-xs font-bold text-ink-muted hover:text-ink transition-colors min-h-[38px]"
            >
              Continue as Guest
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isSignUp = mode === "sign-up";

  return (
    <div className="h-full min-h-full w-full bg-gradient-to-br from-ink via-brand-strong to-ink flex flex-col items-center justify-center p-3 sm:p-4 overflow-y-auto relative font-sans">
      {/* Background radial accent */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-brand/20 via-transparent to-transparent pointer-events-none" />

      {/* Main Auth Card (Sleek max-w-[340px] for Phone View & Webview Modals) */}
      <div className="w-full max-w-[340px] bg-white rounded-lg p-4 sm:p-5 shadow-lift text-ink border border-line animate-slide-up relative z-10 my-auto">
        
        {/* Back button if triggered in-app with onCancel */}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink transition-colors mb-2.5 -mt-0.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        )}

        {/* Top Header: Single Wordmark Lockup (Logo + SARO) */}
        <div className="flex flex-col items-center text-center gap-2 mb-4">
          <Wordmark size="sm" />

          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-brand-wash text-brand border border-brand-edge">
            <ShieldCheck className="w-3 h-3 text-brand" />
            Legazpi Resident Portal
          </span>

          {reason && (
            <p className="text-xs text-brand-strong bg-brand-wash border border-brand-edge rounded-xs p-2 text-left leading-relaxed mt-0.5">
              {reason}
            </p>
          )}

          <h1 className="text-sm sm:text-base font-bold text-ink leading-tight mt-0.5">
            {isSignUp ? "Create a Resident Account" : "One Front Door for Civic Hazard Reporting"}
          </h1>

          <p className="text-xs text-ink-muted leading-relaxed max-w-[30ch]">
            {isSignUp
              ? "Register to save your report history across devices."
              : "Report hazards, track city response, and receive official alerts for Legazpi City."}
          </p>
        </div>

        {/* Quick-Select Demo Account for Testing */}
        {!isSignUp && (
          <div className="mb-3.5 p-2.5 rounded-xs border border-brand-wash bg-brand-wash/40 space-y-1.5">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-ink-muted">
              Select Test Account Role:
            </span>
            <button
              type="button"
              onClick={() => {
                setAccountInput("resident@saro.legazpi.gov.ph");
                setPassword("demo123");
                setError("");
              }}
              className="w-full px-2.5 py-1.5 bg-white hover:bg-brand hover:text-white border border-line rounded-xs text-ink font-bold transition-colors flex items-center justify-between text-[10px] group shadow-2xs"
              title="Resident Demo Account"
            >
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-brand group-hover:text-white transition-colors" />
                Resident
              </span>
              <span className="font-mono text-[9px] text-ink-muted group-hover:text-white/90 transition-colors truncate max-w-[170px]">
                resident@saro.legazpi.gov.ph
              </span>
            </button>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="space-y-2.5">
          {isSignUp && (
            <div>
              <label className="block font-bold text-ink-muted uppercase tracking-wider mb-1 text-[9px]">
                Full Name
              </label>
              <div className="flex items-center gap-2 border border-line rounded-xs px-2.5 py-2 focus-within:border-brand bg-surface transition-colors">
                <User className="w-3.5 h-3.5 text-ink-muted shrink-0" aria-hidden="true" />
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  className="w-full text-xs font-medium text-ink outline-none bg-transparent"
                  placeholder="Juan dela Cruz"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block font-bold text-ink-muted uppercase tracking-wider mb-1 text-[9px]">
              Email or Mobile Number
            </label>
            <div className="flex items-center gap-2 border border-line rounded-xs px-2.5 py-2 focus-within:border-brand bg-surface transition-colors">
              <Mail className="w-3.5 h-3.5 text-ink-muted shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={accountInput}
                onChange={(e) => setAccountInput(e.target.value)}
                autoComplete="username"
                className="w-full text-xs font-medium text-ink outline-none bg-transparent"
                placeholder="resident@example.com or 09171234567"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-ink-muted uppercase tracking-wider mb-1 text-[9px]">
              Password
            </label>
            <div className="flex items-center gap-2 border border-line rounded-xs px-2.5 py-2 focus-within:border-brand bg-surface transition-colors">
              <Lock className="w-3.5 h-3.5 text-ink-muted shrink-0" aria-hidden="true" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                className="w-full text-xs font-medium text-ink outline-none bg-transparent"
                placeholder={isSignUp ? `At least ${MIN_PASSWORD_LENGTH} characters` : "demo123"}
              />
            </div>
            {!isSignUp && (
              <span className="block mt-1 text-[10px] text-ink-faint">
                Demo Password: <strong className="font-mono text-ink font-semibold">demo123</strong>
              </span>
            )}
          </div>

          {error && (
            <p className="text-xs font-bold text-alert bg-alert-wash border border-alert rounded-xs px-2.5 py-1.5">
              {error}
            </p>
          )}

          {/* Primary Action Button */}
          <button
            type="submit"
            disabled={busy}
            className="saro-btn saro-btn-primary w-full font-bold justify-center py-2 text-xs min-h-[38px]"
          >
            <span>{busy ? "Please Wait…" : isSignUp ? "Create Resident Account" : "Sign In as Resident"}</span>
            {!busy && <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
        </form>

        {/* Secondary Guest Action */}
        <div className="mt-2.5 pt-2.5 border-t border-line space-y-2">
          <button
            type="button"
            onClick={handleGuestAction}
            className="w-full py-2 px-3 rounded-xs bg-sunken hover:bg-line text-ink font-bold text-xs transition-colors border border-line flex items-center justify-center gap-1.5 min-h-[38px]"
          >
            <UserCheck className="w-3.5 h-3.5 text-brand" />
            <span>Continue as Guest</span>
          </button>

          {/* Mode Switcher */}
          <div className="text-center pt-0.5">
            <button
              type="button"
              onClick={() => {
                setMode(isSignUp ? "sign-in" : "sign-up");
                setError("");
              }}
              className="text-xs font-bold text-brand hover:underline"
            >
              {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>

        {/* Anonymous Guarantee Notice */}
        <div className="mt-3 pt-2.5 border-t border-line text-center">
          <p className="text-[10px] text-ink-faint leading-tight">
            An account is never required to report an emergency. Panic and urgent hazard reports work anonymously.
          </p>
        </div>
      </div>
    </div>
  );
}

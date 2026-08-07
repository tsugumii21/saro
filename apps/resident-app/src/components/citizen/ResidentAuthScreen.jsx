import { useState } from "react";
import { ShieldCheck, Mail, Lock, User, ArrowRight, ArrowLeft, MailCheck } from "lucide-react";
import { Wordmark } from "@saro/ui";
import { useAuth } from "@saro/shared";

// Resident account screen. Replaces the prototype's CitizenLoginScreen, which
// was a demo shim that logged everyone in as a hard-coded "Verified Resident".
//
// The important property of this screen is where it is NOT: it never appears on
// app open, never blocks Panic, and never blocks a Describe report the
// emergency check flagged as urgent. It is reachable from the account button,
// and it is shown inline at exactly one other moment — when a guest tries to
// submit a standard, non-urgent report.
//
// An account buys one thing, and the copy says so plainly rather than selling
// it: report history that survives losing your phone.

const MIN_PASSWORD_LENGTH = 8;

export default function ResidentAuthScreen({
  mode: initialMode = "sign-in",
  onCancel,
  onSignedIn,
  reason,
}) {
  const { signIn, signUp, resendConfirmation } = useAuth();

  const [mode, setMode] = useState(initialMode); // "sign-in" | "sign-up" | "check-email"
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!email.trim()) return setError("Enter your email address.");
    if (!password) return setError("Enter your password.");

    if (mode === "sign-up") {
      if (!fullName.trim()) return setError("Enter your name.");
      if (password.length < MIN_PASSWORD_LENGTH) {
        return setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      }
    }

    setBusy(true);

    if (mode === "sign-up") {
      const { error: signUpError, needsConfirmation } = await signUp(email, password, fullName);
      setBusy(false);
      if (signUpError) return setError(signUpError);
      if (needsConfirmation) return setMode("check-email");
      onSignedIn?.();
      return;
    }

    const { error: signInError } = await signIn(email, password);
    setBusy(false);
    if (signInError) return setError(signInError);
    onSignedIn?.();
  };

  const handleResend = async () => {
    setBusy(true);
    const { error: resendError } = await resendConfirmation(email);
    setBusy(false);
    setError(resendError || "");
    setNotice(resendError ? "" : "Confirmation email sent again.");
  };

  // ── Post-signup: waiting on email confirmation ────────────────────────────
  if (mode === "check-email") {
    return (
      <div className="flex flex-col h-full w-full bg-white px-6 py-8 overflow-y-auto">
        <div className="max-w-sm mx-auto w-full space-y-6">
          <Wordmark size="md" />

          <div className="p-3 bg-brand-wash border border-brand-edge rounded-xs w-fit text-brand">
            <MailCheck className="w-6 h-6" />
          </div>

          <div className="space-y-2">
            <h1 className="text-lg font-bold text-ink">Confirm your email</h1>
            <p className="text-sm text-ink-muted leading-relaxed">
              We sent a link to <span className="font-mono font-semibold text-ink">{email}</span>.
              Open it to finish setting up your account.
            </p>
            <p className="text-xs text-ink-muted leading-relaxed">
              You can keep using SARO without an account in the meantime. Reporting an
              emergency never requires signing in.
            </p>
          </div>

          {notice && (
            <p className="text-xs text-brand bg-brand-wash border border-brand-edge rounded-xs px-3 py-2">
              {notice}
            </p>
          )}
          {error && (
            <p className="text-xs text-alert bg-alert-wash border border-alert rounded-xs px-3 py-2">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={handleResend}
              disabled={busy}
              className="w-full py-2.5 bg-sunken hover:bg-line text-ink text-xs font-bold rounded-xs transition-colors disabled:opacity-50"
            >
              {busy ? "Sending…" : "Resend confirmation email"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-2.5 text-xs font-bold text-ink-muted hover:text-ink transition-colors"
            >
              Continue without an account
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isSignUp = mode === "sign-up";

  return (
    <div className="flex flex-col h-full w-full bg-white px-6 py-8 overflow-y-auto">
      <div className="max-w-sm mx-auto w-full space-y-6">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-ink transition-colors -ml-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        )}

        <Wordmark size="md" />

        {/* Shown when a guest hit the non-urgent submit wall, so the prompt
            explains itself instead of appearing out of nowhere. */}
        {reason && (
          <p className="text-xs text-ink bg-brand-wash border border-brand-edge rounded-xs px-3 py-2.5 leading-relaxed">
            {reason}
          </p>
        )}

        <div className="space-y-1.5">
          <h1 className="text-lg font-bold text-ink">
            {isSignUp ? "Create a resident account" : "Sign in"}
          </h1>
          <p className="text-sm text-ink-muted leading-relaxed">
            Keeps your report history if you change or lose your phone. Emergency
            reports never need an account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {isSignUp && (
            <label className="block">
              <span className="t-label font-bold text-ink-muted uppercase tracking-wider">
                Full name
              </span>
              <div className="mt-1 flex items-center gap-2 border border-line rounded-xs px-3 py-2.5 focus-within:border-brand transition-colors">
                <User className="w-4 h-4 text-ink-muted shrink-0" aria-hidden="true" />
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  className="w-full text-sm text-ink outline-none bg-transparent"
                  placeholder="Juan dela Cruz"
                />
              </div>
            </label>
          )}

          <label className="block">
            <span className="t-label font-bold text-ink-muted uppercase tracking-wider">
              Email
            </span>
            <div className="mt-1 flex items-center gap-2 border border-line rounded-xs px-3 py-2.5 focus-within:border-brand transition-colors">
              <Mail className="w-4 h-4 text-ink-muted shrink-0" aria-hidden="true" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full text-sm text-ink outline-none bg-transparent"
                placeholder="you@example.com"
              />
            </div>
          </label>

          <label className="block">
            <span className="t-label font-bold text-ink-muted uppercase tracking-wider">
              Password
            </span>
            <div className="mt-1 flex items-center gap-2 border border-line rounded-xs px-3 py-2.5 focus-within:border-brand transition-colors">
              <Lock className="w-4 h-4 text-ink-muted shrink-0" aria-hidden="true" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                className="w-full text-sm text-ink outline-none bg-transparent"
                placeholder={isSignUp ? `At least ${MIN_PASSWORD_LENGTH} characters` : ""}
              />
            </div>
          </label>

          {error && (
            <p className="text-xs text-alert bg-alert-wash border border-alert rounded-xs px-3 py-2">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="saro-btn-primary w-full">
            {busy ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
            {!busy && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(isSignUp ? "sign-in" : "sign-up");
            setError("");
          }}
          className="w-full text-xs font-semibold text-brand hover:underline"
        >
          {isSignUp ? "I already have an account" : "Create a resident account"}
        </button>

        <div className="pt-4 border-t border-line space-y-2">
          <div className="flex items-start gap-2 text-ink-muted">
            <ShieldCheck className="w-4 h-4 text-brand shrink-0 mt-0.5" aria-hidden="true" />
            <p className="t-label leading-relaxed">
              An account is never required to report an emergency. Panic and urgent
              reports stay anonymous and work signed out.
            </p>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-2 text-xs font-bold text-ink-muted hover:text-ink transition-colors"
            >
              Continue without an account
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

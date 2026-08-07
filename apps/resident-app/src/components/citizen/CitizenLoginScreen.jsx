import { useState } from "react";
import { ShieldCheck, Mail, Lock, ArrowRight } from "lucide-react";
import { Wordmark } from "@saro/ui";

export default function CitizenLoginScreen({ onSignInSuccess, onContinueGuest }) {
  const [email, setEmail] = useState("resident@legazpi.gov.ph");
  const [password, setPassword] = useState("••••••••");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onSignInSuccess();
    }, 250);
  };

  const handleGuest = () => {
    if (onContinueGuest) {
      onContinueGuest();
    } else {
      onSignInSuccess();
    }
  };

  return (
    <div className="min-h-full bg-slate-100/70 text-slate-900 font-sans flex flex-col justify-between p-4 max-w-md mx-auto py-6">
      
      {/* Top Header Bar */}
      <div className="flex items-center justify-between text-xs text-slate-500 font-medium px-1 mb-6">
        <span>— Public Portal</span>
        <span>SARO Legazpi</span>
      </div>

      {/* Centered Brand Logo */}
      <div className="flex justify-center mb-6">
        <Wordmark variant="teal" size="lg" />
      </div>

      {/* Main Elevated Resident Sign-In Card */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xl space-y-5 my-auto">
        
        {/* Pill Badge */}
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 bg-teal-50 border border-teal-200 text-teal-800 text-xs font-bold px-3 py-1 rounded-full shadow-2xs">
            <ShieldCheck className="w-4 h-4 text-teal-700" />
            Legazpi Resident Portal
          </span>
        </div>

        {/* Title & Subtitle */}
        <div className="text-center space-y-1.5">
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight leading-snug">
            One front door for civic hazard reporting.
          </h1>
          <p className="text-xs text-slate-500 leading-relaxed font-medium px-2">
            Sign in to manage your reports, receive SMS updates, and track dispatch status.
          </p>
        </div>

        {/* Sign In Form */}
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          
          {/* Email or Mobile Number */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1.5">
              Email or Mobile Number
            </label>
            <div className="relative">
              <input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="resident@legazpi.gov.ph"
                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs rounded-xl py-3 pl-10 pr-3.5 focus:bg-white focus:border-teal-700 focus:outline-none font-medium transition-colors"
              />
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>
          </div>

          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-800">
                Password
              </label>
              <button
                type="button"
                className="text-[11px] font-bold text-teal-700 hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs rounded-xl py-3 pl-10 pr-3.5 focus:bg-white focus:border-teal-700 focus:outline-none font-medium transition-colors"
              />
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>
          </div>

          {/* Primary CTA: Sign In as Resident */}
          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[48px] bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-bold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-2 active:scale-[0.98] mt-2"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{loading ? "Signing In..." : "Sign In as Resident"}</span>
          </button>

          {/* Secondary CTA: Continue as Guest */}
          <button
            type="button"
            onClick={handleGuest}
            className="w-full min-h-[48px] bg-white border border-slate-200 hover:border-slate-300 text-slate-800 font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-2xs active:bg-slate-50"
          >
            <span>Continue as Guest</span>
            <ArrowRight className="w-4 h-4 text-slate-600" />
          </button>
        </form>

        {/* Footer text */}
        <div className="text-center pt-2 text-xs text-slate-500 font-medium">
          Don't have an account?{" "}
          <button
            onClick={handleSubmit}
            className="font-bold text-teal-700 hover:underline"
          >
            Sign up
          </button>
        </div>

      </div>

      {/* Bottom Padding */}
      <div className="h-4" />

    </div>
  );
}

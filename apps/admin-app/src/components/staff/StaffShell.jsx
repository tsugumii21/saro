import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Shield, User, Lock, LogOut, LayoutDashboard, Users,
  Building2, ArrowRight, ShieldAlert, CheckCircle2, PlusCircle
} from "lucide-react";
import ResponderDashboard from "./ResponderDashboard.jsx";
import AdminDashboard from "./AdminDashboard.jsx";
import { Wordmark } from "@saro/ui";
import { useAuth } from "@saro/shared";
import { SEED_PROFILES, SEED_OFFICES } from "@saro/shared";

// The resident experience is a separate Vercel deployment.
const RESIDENT_APP_URL = import.meta.env.VITE_RESIDENT_APP_URL || "";

export default function StaffShell() {
  const { profile, login, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("dashboard"); // 'dashboard' | 'admin'

  // If user is authenticated as responder, check for coordinator status
  const isCoordinator = Boolean(profile?.is_coordinator);

  // If not logged in as responder, render Staff Login Portal
  if (!profile || profile.role !== "responder") {
    return <StaffLoginPortal onLogin={login} />;
  }

  const office = SEED_OFFICES.find((o) => o.id === profile.office_id);

  return (
    <div className="min-h-screen bg-saro-mist flex flex-col font-sans">
      
      {/* Top Officer Header Bar */}
      <header className="bg-slate-950 text-white border-b border-teal-900/40 sticky top-0 z-30 shadow-md">
        <div className="w-full px-4 sm:px-6 py-2.5 flex items-center justify-between">
          
          <div className="flex items-center gap-4">
            <Wordmark variant="white" size="md" />
            <div className="hidden sm:flex items-center gap-2 border-l border-slate-800 pl-4">
              <span className="text-xs font-bold text-teal-400 uppercase tracking-wider">
                {office?.short_name || "Command Center"}
              </span>
              <span className="text-[10px] bg-teal-500/20 text-teal-300 border border-teal-500/30 px-2 py-0.5 rounded font-mono">
                {isCoordinator ? "COORDINATOR" : "RESPONDER"}
              </span>
            </div>
          </div>

          {/* Center Tabs for Coordinators */}
          {isCoordinator && (
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveTab("dashboard")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === "dashboard"
                    ? "bg-teal-700 text-white shadow-2xs"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                Dispatch Queue
              </button>
              <button
                onClick={() => setActiveTab("admin")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === "admin"
                    ? "bg-teal-700 text-white shadow-2xs"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                Admin Routing & SLA
              </button>
            </div>
          )}

          {/* Right Officer Profile & Logout */}
          <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <div className="text-xs font-bold text-white leading-tight">
                {profile.full_name}
              </div>
              <div className="text-[10px] text-teal-200/70 font-mono">
                {profile.mobile_number || "Legazpi EOC"}
              </div>
            </div>

            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-xs text-red-200 hover:text-white bg-red-950/40 hover:bg-red-900/80 border border-red-800/60 px-3 py-1.5 rounded-xl transition-all font-bold shadow-2xs active:scale-95 shrink-0"
              title="Sign out of operations session"
            >
              <LogOut className="w-3.5 h-3.5 text-red-400" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Full-Width Content Canvas */}
      <main className="flex-1 p-4 w-full">
        {activeTab === "admin" && isCoordinator ? (
          <AdminDashboard />
        ) : (
          <ResponderDashboard />
        )}
      </main>
    </div>
  );
}

function StaffLoginPortal({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");

    if (!username.trim()) {
      setError("Please enter your Email, Username, or Badge ID.");
      return;
    }
    if (!password) {
      setError("Please enter your access code / password.");
      return;
    }

    setLoading(true);

    try {
      const uLower = username.trim().toLowerCase();
      let targetProfile = SEED_PROFILES.find((p) =>
        p.role === "responder" && (
          (p.full_name && p.full_name.toLowerCase().includes(uLower)) ||
          (p.id && p.id.toLowerCase().includes(uLower)) ||
          (p.office_id && p.office_id.toLowerCase().includes(uLower))
        )
      );

      if (!targetProfile) {
        if (uLower.includes("admin") || uLower.includes("coord") || uLower.includes("director") || uLower.includes("arnel")) {
          targetProfile = SEED_PROFILES.find((p) => p.is_coordinator) || SEED_PROFILES[0];
        } else {
          targetProfile = SEED_PROFILES.find((p) => p.role === "responder") || SEED_PROFILES[0];
        }
      }

      const safeProfile = {
        id: targetProfile.id,
        full_name: targetProfile.full_name,
        mobile_number: targetProfile.mobile_number,
        role: "responder",
        office_id: targetProfile.office_id || "off1_cdrrmo",
        is_coordinator: Boolean(targetProfile.is_coordinator)
      };

      onLogin(safeProfile);
    } catch (err) {
      console.error("Login error:", err);
      setError("Authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 bg-[radial-gradient(#1E293B_1px,transparent_1px)] [background-size:24px_24px] flex flex-col justify-between p-4 sm:p-6 md:p-10 font-sans">
      
      {/* Top Navigation Bar */}
      <div className="max-w-4xl mx-auto w-full flex items-center justify-between py-2 shrink-0">
        <button
          onClick={() => {
            // The public portal is a separate deployment now.
            // TODO: set VITE_RESIDENT_APP_URL once the resident app has a Vercel domain.
            if (RESIDENT_APP_URL) {
              window.location.href = RESIDENT_APP_URL;
              return;
            }
            console.warn("VITE_RESIDENT_APP_URL is not set — cannot route to the resident app.");
          }}
          className="text-xs text-slate-400 hover:text-white font-medium flex items-center gap-1.5 transition-colors"
        >
          ← Back to Public Portal
        </button>
        <span className="text-[11px] text-teal-400 font-mono font-semibold tracking-wider">
          LEGAZPI EOC GATEWAY
        </span>
      </div>

      {/* Container Card: Clean dual-panel layout, NO white outer stroke, soft elevation */}
      <div className="max-w-4xl mx-auto w-full bg-white rounded-xl shadow-xl overflow-hidden grid md:grid-cols-12 my-auto shrink-0">
        
        {/* Left Panel: Deep Dark Teal/Slate Brand Side (md:col-span-5) */}
        <div className="md:col-span-5 bg-slate-950 text-white p-8 flex flex-col justify-between relative border-r border-slate-900">
          
          <div className="space-y-6">
            <Wordmark variant="white" size="lg" />
            
            {/* Title & Description Block */}
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Operations Dispatch Portal
              </h1>
              <p className="text-xs text-slate-400 leading-relaxed">
                Real-time incident routing for CDRRMO, Legazpi 911, BFP, PNP, and City Engineering.
              </p>
            </div>

            {/* Flat Feature Cards: Vertically centered icon + text */}
            <div className="space-y-3">
              <div className="bg-slate-900/80 rounded-xl p-3.5 border border-slate-800 flex items-center gap-3.5">
                <div className="p-2 rounded-lg bg-teal-950 text-teal-400 border border-teal-900 shrink-0 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white leading-tight">Automated Department Routing</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Category & barangay dispatching</div>
                </div>
              </div>

              <div className="bg-slate-900/80 rounded-xl p-3.5 border border-slate-800 flex items-center gap-3.5">
                <div className="p-2 rounded-lg bg-teal-950 text-teal-400 border border-teal-900 shrink-0 flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white leading-tight">Multi-Agency Operations</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">8 emergency offices connected</div>
                </div>
              </div>
            </div>
          </div>

          {/* Active Responder Status Widget: Horizontally aligned pill badge & equal stat columns */}
          <div className="pt-6 border-t border-slate-900">
            <div className="bg-slate-900/80 rounded-xl p-4 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <Users className="w-4 h-4 text-teal-400 shrink-0" />
                  Responder Status
                </span>
                <span className="text-[10px] font-mono bg-teal-950 text-teal-300 border border-teal-800 px-2 py-0.5 rounded font-semibold tracking-wide">
                  CDRRMO READY
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-4 pt-1">
                <div>
                  <div className="font-mono text-white font-bold text-sm">&lt; 3 Mins</div>
                  <div className="text-[11px] text-slate-400">Avg Dispatch</div>
                </div>
                <div>
                  <div className="font-mono text-white font-bold text-sm">70 Barangays</div>
                  <div className="text-[11px] text-slate-400">Citywide Coverage</div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Right Panel: Clean High-Contrast Form Side (md:col-span-7) */}
        <div className="md:col-span-7 bg-white p-8 flex flex-col justify-between">
          <div>
            {/* Prominent Citizen Public Reporting Banner (No Sign-In Needed) */}
            <div className="bg-teal-50 border-2 border-teal-200 rounded-xl p-3.5 mb-6 flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-teal-700 text-white rounded-lg shrink-0">
                  <PlusCircle className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-teal-900 leading-tight">
                    Reporting a Hazard as a Citizen?
                  </div>
                  <div className="text-[11px] text-teal-700 font-medium mt-0.5">
                    No account or sign-in required.
                  </div>
                </div>
              </div>

              <Link
                to="/report"
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs px-3 py-2 rounded-lg transition-colors shrink-0 flex items-center gap-1 shadow-2xs whitespace-nowrap"
              >
                Report Now — No Sign-In Needed
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="flex flex-col mb-5">
              <div className="md:hidden mb-4">
                <Wordmark variant="teal" size="md" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Officer & Staff Login</h2>
              <p className="text-xs text-slate-500 mt-1">
                Enter your credentials to access dispatch queue & SLA controls.
              </p>
            </div>

            {error && (
              <div className="mb-5 text-xs bg-red-50 text-saro-red border border-red-200 p-3.5 rounded-xl font-medium flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {showForgot ? (
              <div className="space-y-4">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-left">
                  <h3 className="text-sm font-semibold text-slate-900 mb-1">Reset Access Code</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Contact your office coordinator or the CDRRMO admin desk to request an access code reset. For testing, all accounts use:
                  </p>
                  <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg font-mono text-xs text-teal-700 font-bold text-center">
                    saro2026
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowForgot(false)}
                  className="text-xs text-teal-700 font-semibold hover:underline"
                >
                  ← Back to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email / Username / Badge ID Field */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Email, Username, or Badge ID
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      placeholder="e.g. officer.santos@legazpi.gov.ph or CDRRMO-01"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs rounded-xl py-3 pl-10 pr-3.5 focus:bg-white focus:border-teal-700 focus:outline-none font-medium placeholder:text-slate-400 transition-colors"
                    />
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                  </div>
                </div>

                {/* Access Code / Password Field */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Access Code / Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowForgot(true)}
                      className="text-[11px] text-teal-700 font-semibold hover:underline"
                    >
                      Forgot code?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type="password"
                      required
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs rounded-xl py-3 pl-10 pr-3.5 focus:bg-white focus:border-teal-700 focus:outline-none font-medium placeholder:text-slate-400 transition-colors"
                    />
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                  </div>
                </div>

                {/* Solid Fill Button: Solid brand teal, no glow, no outline */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-4 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-bold text-xs rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
                >
                  <Shield className="w-4 h-4" />
                  {loading ? "Authenticating..." : "Sign In to Operations"}
                </button>
              </form>
            )}
          </div>

          <div className="pt-6 border-t border-slate-100 text-center">
            <p className="text-[11px] text-slate-400 font-medium">
              Authorized municipal responders & coordinators only.
            </p>
          </div>
        </div>

      </div>

      {/* Footer */}
      <div className="max-w-4xl mx-auto w-full text-center text-[11px] text-slate-500 py-2 shrink-0">
        Legazpi City Emergency Operations Center &bull; Heroes of Innovation 2026
      </div>

    </div>
  );
}

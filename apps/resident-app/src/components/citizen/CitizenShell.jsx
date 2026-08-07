import { useState } from "react";
import { Routes, Route, Navigate, NavLink } from "react-router-dom";
import { Map, PlusCircle, List, Bot, Home, User, LogOut, X, ChevronRight, ShieldCheck } from "lucide-react";
import ConnectionIndicator from "../common/ConnectionIndicator";
import { CLIENT_STORAGE_KEYS } from "@saro/shared";
import CitizenLandingScreen from "./CitizenLandingScreen";
import PublicMapScreen from "./PublicMapScreen";
import ReportFormScreen from "./ReportFormScreen";
import TrackScreen from "./TrackScreen";
import AssistantScreen from "./AssistantScreen";

// Residents do not sign in. The Supabase schema has three roles — admin,
// office, barangay_official — and none of them is "resident": a report is tied
// to a random device id held in this browser, never to a person. The
// prototype's auto-login as a fake "Verified Resident" is gone; the account
// sheet below now offers to forget this device instead, which is the only
// identity there is to clear.
export default function CitizenShell() {
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const handleForgetDevice = () => {
    // Drops the device id, so "My Reports" empties and future reports are
    // filed under a fresh id with no link to the old ones.
    localStorage.removeItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT);
    localStorage.removeItem(CLIENT_STORAGE_KEYS.OFFLINE_QUEUE);
    setShowAccountMenu(false);
  };

  return (
    <div className="relative flex flex-col h-screen sm:h-full w-full overflow-hidden bg-saro-surface text-saro-ink font-sans">
      {/* Connection Indicator */}
      <ConnectionIndicator />

      {/* Top Header Bar */}
      <header className="bg-white border-b border-saro-line px-4 py-2.5 shadow-2xs sticky top-0 z-30 shrink-0">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-700 animate-pulse" />
            <span className="font-extrabold text-sm tracking-tight text-slate-900 font-mono">SARO</span>
          </div>

          {/* Account Button */}
          <button
            onClick={() => setShowAccountMenu(true)}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded-full text-xs font-bold transition-colors border border-slate-200 active:scale-95"
            aria-label="Account Menu"
          >
            <User className="w-3.5 h-3.5 text-teal-700" />
            <span className="text-[11px]">Account</span>
          </button>
        </div>
      </header>

      {/* Citizen Shell Routes */}
      <main className="flex-1 min-h-0 max-w-md mx-auto w-full overflow-y-auto">
        <Routes>
          <Route path="/" element={<CitizenLandingScreen />} />
          <Route path="/map" element={<PublicMapScreen />} />
          <Route path="/report" element={<ReportFormScreen />} />
          <Route path="/track" element={<TrackScreen />} />
          <Route path="/assistant" element={<AssistantScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Device sheet. There is no account to manage — only this device. */}
      {showAccountMenu && (
        <div className="fixed inset-0 bg-slate-950/60 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 w-full max-w-sm shadow-2xl space-y-4 animate-slide-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-teal-50 border border-teal-200 rounded-xl text-teal-700">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">Anonymous Reporter</div>
                  <div className="text-[11px] text-slate-500 font-mono">No account required</div>
                </div>
              </div>
              <button
                onClick={() => setShowAccountMenu(false)}
                className="text-slate-400 hover:text-slate-800 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              {/* Clears the only identifier this app holds. */}
              <button
                onClick={handleForgetDevice}
                className="w-full p-3.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl text-left transition-colors flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <LogOut className="w-4 h-4 text-red-600 shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-red-900">
                      Forget This Device
                    </div>
                    <div className="text-[10px] text-red-700 font-medium mt-0.5">
                      Clears My Reports. Filed reports stay with the city.
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-red-600 shrink-0" />
              </button>
            </div>

            <button
              onClick={() => setShowAccountMenu(false)}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Fixed Bottom Navigation Bar */}
      <nav
        className="bg-white border-t border-saro-line px-2 py-1.5 sticky bottom-0 z-30 shrink-0 shadow-lg"
        aria-label="Citizen Navigation"
      >
        <div className="max-w-md mx-auto flex justify-around items-center">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex flex-col items-center py-1 px-2.5 rounded-xl transition-colors min-h-[44px] justify-center ${
                isActive
                  ? "text-saro-primary font-bold bg-saro-primary-light border border-saro-primary/20"
                  : "text-saro-secondary font-medium hover:text-saro-ink"
              }`
            }
            aria-label="Home"
          >
            <Home className="w-5 h-5 mb-0.5" aria-hidden="true" />
            <span className="text-[11px]">Home</span>
          </NavLink>

          <NavLink
            to="/map"
            className={({ isActive }) =>
              `flex flex-col items-center py-1 px-2.5 rounded-xl transition-colors min-h-[44px] justify-center ${
                isActive
                  ? "text-saro-primary font-bold bg-saro-primary-light border border-saro-primary/20"
                  : "text-saro-secondary font-medium hover:text-saro-ink"
              }`
            }
            aria-label="Live Map"
          >
            <Map className="w-5 h-5 mb-0.5" aria-hidden="true" />
            <span className="text-[11px]">Map</span>
          </NavLink>

          <NavLink
            to="/report"
            className={({ isActive }) =>
              `flex flex-col items-center py-1 px-2.5 rounded-xl transition-colors min-h-[44px] justify-center ${
                isActive
                  ? "text-saro-primary font-bold bg-saro-primary-light border border-saro-primary/20"
                  : "text-saro-secondary font-medium hover:text-saro-ink"
              }`
            }
            aria-label="Report Hazard"
          >
            <PlusCircle className="w-5 h-5 mb-0.5" aria-hidden="true" />
            <span className="text-[11px]">Report</span>
          </NavLink>

          <NavLink
            to="/track"
            className={({ isActive }) =>
              `flex flex-col items-center py-1 px-2.5 rounded-xl transition-colors min-h-[44px] justify-center ${
                isActive
                  ? "text-saro-primary font-bold bg-saro-primary-light border border-saro-primary/20"
                  : "text-saro-secondary font-medium hover:text-saro-ink"
              }`
            }
            aria-label="Track Reports"
          >
            <List className="w-5 h-5 mb-0.5" aria-hidden="true" />
            <span className="text-[11px]">Track</span>
          </NavLink>

          <NavLink
            to="/assistant"
            className={({ isActive }) =>
              `flex flex-col items-center py-1 px-2.5 rounded-xl transition-colors min-h-[44px] justify-center ${
                isActive
                  ? "text-saro-primary font-bold bg-saro-primary-light border border-saro-primary/20"
                  : "text-saro-secondary font-medium hover:text-saro-ink"
              }`
            }
            aria-label="AI Assistant"
          >
            <Bot className="w-5 h-5 mb-0.5" aria-hidden="true" />
            <span className="text-[11px]">Assistant</span>
          </NavLink>
        </div>
      </nav>
    </div>
  );
}

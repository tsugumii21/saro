import { useState } from "react";
import { NavLink, Routes, Route, Navigate } from "react-router-dom";
import {
  Home, Map, PlusCircle, List, Bot, User, LogOut, Settings,
  ChevronRight, ShieldCheck, X,
} from "lucide-react";
import { Wordmark } from "@saro/ui";
import ConnectionIndicator from "../common/ConnectionIndicator";
import { useAuth } from "@saro/shared";

// Screen imports — the desktop wrappers (created Part 2–6).
// These are imported lazily so Part 1 compiles without them.
import HomeDesktop from "./desktop/HomeDesktop";
import TrackDesktop from "./desktop/TrackDesktop";
import MapDesktop from "./desktop/MapDesktop";
import ReportDesktop from "./desktop/ReportDesktop";
import AssistantDesktop from "./desktop/AssistantDesktop";

/**
 * Desktop shell — lg: and above (≥ 1024px).
 *
 * Layout: fixed 200px sidebar (left) + flex-1 content area (right).
 * The sidebar carries the Wordmark, five nav items, and the account widget
 * at the bottom. The mobile bottom tab bar and top header do not render.
 *
 * Props mirror what CitizenShell passes down so state stays in one place.
 */

const NAV_ITEMS = [
  { to: "/",          end: true,  Icon: Home,       label: "Home"      },
  { to: "/map",       end: false, Icon: Map,        label: "Map"       },
  { to: "/track",     end: false, Icon: List,       label: "Track"     },
  { to: "/assistant", end: false, Icon: Bot,        label: "Ask"       },
];

export default function DesktopShell({
  onReturnToWelcome,
  onShowSettings,
  onShowAuth,
}) {
  const { profile, isResident, signOut } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);

  const handleSignOut = async () => {
    setAccountOpen(false);
    await signOut();
    onReturnToWelcome?.();
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas text-ink font-sans">
      <ConnectionIndicator />

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className="flex w-[200px] shrink-0 flex-col border-r border-line bg-surface"
        aria-label="Primary navigation"
      >
        {/* Wordmark */}
        <div className="border-b border-line px-5 py-4">
          <Wordmark size="sm" />
        </div>

        {/* Report CTA */}
        <div className="px-3 pt-4">
          <NavLink
            to="/report"
            className={({ isActive }) =>
              `flex w-full items-center justify-center gap-2 px-4 py-3 font-bold text-sm transition-colors ${
                isActive
                  ? "bg-brand-strong text-white"
                  : "bg-brand text-white hover:bg-brand-mid"
              }`
            }
            style={{ clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)" }}
          >
            <PlusCircle width={16} height={16} aria-hidden="true" />
            Report a Hazard
          </NavLink>
        </div>

        {/* Nav links */}
        <nav className="flex flex-col gap-px px-3 pt-4" aria-label="Sections">
          {NAV_ITEMS.map(({ to, end, Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-brand-wash text-brand border-l-2 border-brand"
                    : "text-ink-muted hover:bg-raised hover:text-ink border-l-2 border-transparent"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    width={17}
                    height={17}
                    strokeWidth={isActive ? 2.3 : 1.8}
                    aria-hidden="true"
                  />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Account widget */}
        <div className="border-t border-line px-3 py-3">
          <button
            onClick={() => setAccountOpen((v) => !v)}
            className="flex w-full items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-raised"
            aria-expanded={accountOpen}
            aria-haspopup="dialog"
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center bg-brand-wash text-brand border border-brand-edge"
              aria-hidden="true"
            >
              <User width={15} height={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold text-ink leading-tight">
                {isResident ? (profile?.full_name || "Resident") : "Anonymous Reporter"}
              </span>
              <span className="block text-[10px] text-ink-faint leading-tight">
                {isResident ? "Signed in" : "No account"}
              </span>
            </span>
            <ChevronRight
              width={14}
              height={14}
              className="shrink-0 text-ink-faint"
              aria-hidden="true"
            />
          </button>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/"          element={<HomeDesktop />} />
          <Route path="/map"       element={<MapDesktop />} />
          <Route path="/report"    element={<ReportDesktop />} />
          <Route path="/track"     element={<TrackDesktop />} />
          <Route path="/assistant" element={<AssistantDesktop />} />
          <Route path="*"          element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* ── Account popover (desktop) ─────────────────────────────────── */}
      {accountOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-start"
          onClick={() => setAccountOpen(false)}
          role="dialog"
          aria-label="Account menu"
          aria-modal="true"
        >
          {/* Panel anchors to bottom of sidebar */}
          <div
            className="mb-[60px] ml-3 w-[232px] border border-line bg-surface shadow-lift animate-fade-in"
            style={{ clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
              <span className="flex items-center gap-2.5">
                <ShieldCheck
                  width={18}
                  height={18}
                  className={isResident ? "text-status-resolved-ink" : "text-ink-faint"}
                  aria-hidden="true"
                />
                <span>
                  <span className="block text-sm font-bold text-ink">
                    {isResident ? profile?.full_name || "Resident" : "Anonymous Reporter"}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {isResident ? "Reports follow your account" : "Reports stay on this device"}
                  </span>
                </span>
              </span>
              <button
                onClick={() => setAccountOpen(false)}
                className="saro-btn saro-btn-ghost saro-btn-sm -mr-1 -mt-0.5"
                aria-label="Close"
              >
                <X width={14} height={14} />
              </button>
            </div>

            <div className="flex flex-col gap-1.5 p-3">
              {/* Sign in prompt for guests */}
              {!isResident && (
                <button
                  onClick={() => { setAccountOpen(false); onShowAuth?.(); }}
                  className="flex items-center justify-between gap-2 border border-brand-edge bg-brand-wash px-3 py-2.5 text-left transition-colors hover:bg-brand-wash/80"
                >
                  <span>
                    <span className="block text-sm font-bold text-brand-strong">Sign In or Create Account</span>
                    <span className="block text-xs text-ink-muted">Keeps your history synced</span>
                  </span>
                  <ChevronRight width={14} height={14} className="shrink-0 text-brand" aria-hidden="true" />
                </button>
              )}

              {/* Settings */}
              <button
                onClick={() => { setAccountOpen(false); onShowSettings?.(); }}
                className="flex items-center gap-2.5 border border-line px-3 py-2.5 text-left transition-colors hover:bg-raised"
              >
                <Settings width={16} height={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">Settings</span>
                  <span className="block text-xs text-ink-muted">Notifications, permissions, privacy</span>
                </span>
                <ChevronRight width={14} height={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
              </button>

              {/* Sign out / forget device */}
              <div className="border-t border-line pt-1.5">
                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 border border-alert/30 bg-alert-wash/50 px-3 py-2.5 text-left transition-colors hover:bg-alert-wash"
                >
                  <LogOut width={16} height={16} className="shrink-0 text-alert" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-alert">
                      {isResident ? "Sign Out" : "Forget This Device"}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {isResident
                        ? "Your reports stay saved on your account"
                        : "Clears local Track list. Filed reports stay with city."}
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

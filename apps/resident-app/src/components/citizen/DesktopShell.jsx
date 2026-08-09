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
import AccountPopover from "./desktop/AccountPopover";

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
  const [popoverPosition, setPopoverPosition] = useState("bottom-left");

  const handleSignOut = async () => {
    setAccountOpen(false);
    await signOut();
    onReturnToWelcome?.();
  };

  const toggleAccountMenu = (position = "bottom-left") => {
    setPopoverPosition(position);
    setAccountOpen((prev) => !prev);
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas text-ink font-sans relative">
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
            onClick={() => toggleAccountMenu("bottom-left")}
            className="flex w-full items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-raised rounded-lg"
            aria-expanded={accountOpen && popoverPosition === "bottom-left"}
            aria-haspopup="dialog"
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center bg-brand-wash text-brand border border-brand-edge rounded-full"
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
          <Route path="/"          element={<HomeDesktop onToggleAccount={() => toggleAccountMenu("top-right")} />} />
          <Route path="/map"       element={<MapDesktop onToggleAccount={() => toggleAccountMenu("top-right")} />} />
          <Route path="/report"    element={<ReportDesktop onToggleAccount={() => toggleAccountMenu("top-right")} />} />
          <Route path="/track"     element={<TrackDesktop onToggleAccount={() => toggleAccountMenu("top-right")} />} />
          <Route path="/assistant" element={<AssistantDesktop onToggleAccount={() => toggleAccountMenu("top-right")} />} />
          <Route path="*"          element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* ── Dynamic Account popover (desktop) ─────────────────────────── */}
      <AccountPopover
        isOpen={accountOpen}
        onClose={() => setAccountOpen(false)}
        position={popoverPosition}
        profile={profile}
        isResident={isResident}
        onShowSettings={onShowSettings}
        onShowAuth={onShowAuth}
        onSignOut={handleSignOut}
      />
    </div>
  );
}

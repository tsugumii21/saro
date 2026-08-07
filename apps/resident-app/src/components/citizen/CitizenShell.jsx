import { useState, useEffect } from "react";
import { Routes, Route, Navigate, NavLink } from "react-router-dom";
import {
  Map, PlusCircle, List, Bot, Home, User, LogOut, X, ChevronRight, ShieldCheck,
  Bell, BellOff, FileText,
} from "lucide-react";
import { Wordmark } from "@saro/ui";
import ConnectionIndicator from "../common/ConnectionIndicator";
import {
  CLIENT_STORAGE_KEYS, useAuth,
  startOutboxSync, pushSupported, pushPermission,
  subscribeToPush, unsubscribeFromPush, currentPushSubscription,
} from "@saro/shared";
import ConsentNotice from "./ConsentNotice";
import CitizenLandingScreen from "./CitizenLandingScreen";
import PublicMapScreen from "./PublicMapScreen";
import ReportFormScreen from "./ReportFormScreen";
import TrackScreen from "./TrackScreen";
import AssistantScreen from "./AssistantScreen";
import ResidentAuthScreen from "./ResidentAuthScreen";

/**
 * Resident shell.
 *
 * The old header was a pulsing teal dot, the word SARO in a monospace face,
 * and a pill-shaped "Account" button — three competing signals inside a 44px
 * strip. It is now the mark plus one account control that says who you are
 * rather than what it opens.
 *
 * The tab bar changed shape too. Report is a verb, not a place, so it gets the
 * one filled control in the bar instead of a fifth identical icon — which also
 * stops the old build's three competing routes into the report form.
 */

const TABS = [
  { to: "/", end: true, Icon: Home, label: "Home" },
  { to: "/map", Icon: Map, label: "Map" },
  { to: "/track", Icon: List, label: "Track" },
  { to: "/assistant", Icon: Bot, label: "Ask" },
];

export default function CitizenShell() {
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");
  const { profile, isResident, signOut } = useAuth();

  // The queue drains from here rather than from a screen, because a queued
  // report must keep trying no matter which tab the person is looking at — or
  // whether they ever return to the one they filed from.
  useEffect(() => startOutboxSync(), []);

  useEffect(() => {
    currentPushSubscription().then((subscription) => setPushOn(Boolean(subscription)));
  }, []);

  const togglePush = async () => {
    setPushBusy(true);
    setPushError("");
    if (pushOn) {
      await unsubscribeFromPush();
      setPushOn(false);
    } else {
      const { error } = await subscribeToPush();
      if (error) setPushError(error);
      else setPushOn(true);
    }
    setPushBusy(false);
  };

  const handleForgetDevice = () => {
    localStorage.removeItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT);
    localStorage.removeItem(CLIENT_STORAGE_KEYS.OFFLINE_QUEUE);
    setShowAccountMenu(false);
  };

  const handleSignOut = async () => {
    await signOut();
    setShowAccountMenu(false);
  };

  if (showAuth) {
    return (
      <div className="relative flex h-screen w-full flex-col overflow-hidden bg-surface sm:h-full">
        <ConnectionIndicator />
        <ResidentAuthScreen onCancel={() => setShowAuth(false)} onSignedIn={() => setShowAuth(false)} />
      </div>
    );
  }

  if (showPrivacy) {
    return (
      <div className="relative flex h-screen w-full flex-col overflow-hidden bg-canvas sm:h-full">
        <ConnectionIndicator />
        <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto p-4">
          <ConsentNotice dismissible onAcknowledge={() => setShowPrivacy(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-canvas text-ink sm:h-full">
      <ConnectionIndicator />

      <header className="sticky top-0 z-30 shrink-0 border-b border-line bg-surface px-4 py-2.5">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <Wordmark size="sm" />
          <button
            onClick={() => setShowAccountMenu(true)}
            className="saro-btn saro-btn-ghost saro-btn-sm"
            aria-label={isResident ? `Account: ${profile?.full_name}` : "Sign in"}
          >
            <User width={14} height={14} />
            {isResident ? (profile?.full_name?.split(" ")[0] ?? "Account") : "Sign in"}
          </button>
        </div>
      </header>

      <main className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<CitizenLandingScreen />} />
          <Route path="/map" element={<PublicMapScreen />} />
          <Route path="/report" element={<ReportFormScreen />} />
          <Route path="/track" element={<TrackScreen />} />
          <Route path="/assistant" element={<AssistantScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {showAccountMenu && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink-strong/50 sm:items-center sm:p-4"
          onClick={() => setShowAccountMenu(false)}
        >
          <div
            className="saro-rise w-full max-w-sm border-t border-line bg-surface p-5 sm:border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-rule pb-4">
              <span className="flex items-center gap-3">
                <ShieldCheck
                  width={22}
                  height={22}
                  className={isResident ? "text-status-resolved-ink" : "text-ink-faint"}
                  aria-hidden="true"
                />
                <span>
                  <span className="t-subhead block">
                    {isResident ? profile?.full_name || "Resident" : "Anonymous reporter"}
                  </span>
                  <span className="t-body-sm block text-ink-muted">
                    {isResident ? "Reports follow your account" : "Reports stay on this device"}
                  </span>
                </span>
              </span>
              <button
                onClick={() => setShowAccountMenu(false)}
                className="saro-btn saro-btn-ghost saro-btn-sm -mr-2 -mt-1"
                aria-label="Close"
              >
                <X width={16} height={16} />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {!isResident && (
                <button
                  onClick={() => { setShowAccountMenu(false); setShowAuth(true); }}
                  className="flex items-center justify-between gap-3 border border-brand-edge bg-brand-wash px-4 py-3 text-left"
                >
                  <span>
                    <span className="t-subhead block text-brand-strong">Sign in or create an account</span>
                    <span className="t-body-sm block text-ink-muted">Keeps your history if you lose this phone</span>
                  </span>
                  <ChevronRight width={16} height={16} className="shrink-0 text-brand" aria-hidden="true" />
                </button>
              )}

              {/* Opt-in, and only here. Never prompted on app open: a
                  permission dialog someone did not ask for is one tap from
                  "Block", and a blocked resident cannot be told their report
                  was resolved. */}
              {pushSupported() && (
                <button
                  onClick={togglePush}
                  disabled={pushBusy}
                  aria-pressed={pushOn}
                  className="flex items-center gap-3 border border-line px-4 py-3 text-left hover:bg-raised"
                >
                  {pushOn
                    ? <Bell width={16} height={16} className="shrink-0 text-brand" aria-hidden="true" />
                    : <BellOff width={16} height={16} className="shrink-0 text-ink-faint" aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    <span className="t-subhead block">
                      {pushOn ? "Notifications are on" : "Tell me when my report changes"}
                    </span>
                    <span className="t-body-sm block text-ink-muted">
                      {pushError
                        ? pushError
                        : pushPermission() === "denied"
                        ? "Blocked in your browser settings"
                        : "No phone number needed. Status changes only."}
                    </span>
                  </span>
                </button>
              )}

              <button
                onClick={() => { setShowAccountMenu(false); setShowPrivacy(true); }}
                className="flex items-center gap-3 border border-line px-4 py-3 text-left hover:bg-raised"
              >
                <FileText width={16} height={16} className="shrink-0 text-ink-faint" aria-hidden="true" />
                <span>
                  <span className="t-subhead block">Privacy notice</span>
                  <span className="t-body-sm block text-ink-muted">
                    What is collected, who sees it, how long it is kept
                  </span>
                </span>
              </button>

              <button
                onClick={isResident ? handleSignOut : handleForgetDevice}
                className="flex items-center gap-3 border border-line px-4 py-3 text-left hover:bg-raised"
              >
                <LogOut width={16} height={16} className="shrink-0 text-alert" aria-hidden="true" />
                <span>
                  <span className="t-subhead block">{isResident ? "Sign out" : "Forget this device"}</span>
                  <span className="t-body-sm block text-ink-muted">
                    {isResident
                      ? "Your reports stay on your account"
                      : "Clears Track. Filed reports stay with the city."}
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      <nav className="sticky bottom-0 z-30 shrink-0 border-t border-line bg-surface" aria-label="Main">
        <div className="mx-auto flex max-w-md items-stretch justify-around">
          {TABS.map(({ to, end, Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 px-2 py-1.5 ${
                  isActive ? "text-brand" : "text-ink-faint"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Active tab marked by a rule on the top edge — the index-tab
                      idea from the queue, at navigation scale. */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-3 top-0 h-0.5"
                    style={{ background: isActive ? "var(--color-brand)" : "transparent" }}
                  />
                  <Icon width={20} height={20} strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
                  <span className="t-micro">{label}</span>
                </>
              )}
            </NavLink>
          ))}

          <NavLink
            to="/report"
            className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 bg-brand px-2 py-1.5 text-white"
          >
            <PlusCircle width={20} height={20} strokeWidth={2.4} aria-hidden="true" />
            <span className="t-micro">Report</span>
          </NavLink>
        </div>
      </nav>
    </div>
  );
}

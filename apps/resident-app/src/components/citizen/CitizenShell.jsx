import { useState, useEffect } from "react";
import { Routes, Route, Navigate, NavLink } from "react-router-dom";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import DesktopShell from "./DesktopShell";
import {
  Map, PlusCircle, List, Bot, Home, User, LogOut, X, ChevronRight, ShieldCheck,
  Bell, BellOff, FileText, PhoneCall, Settings, MapPin, Mic, Trash2,
} from "lucide-react";
import { Wordmark } from "@saro/ui";
import ConnectionIndicator from "../common/ConnectionIndicator";
import {
  CLIENT_STORAGE_KEYS, useAuth,
  startOutboxSync, pushSupported, pushPermission,
  subscribeToPush, unsubscribeFromPush, currentPushSubscription,
  updateResidentProfile, deleteResidentAccount
} from "@saro/shared";
import { getPermissionsState, setPermissionState, requestBrowserPermission } from "../../lib/permissions";
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
  { to: "/report", Icon: PlusCircle, label: "Report", isPrimary: true },
  { to: "/track", Icon: List, label: "Track" },
  { to: "/assistant", Icon: Bot, label: "Ask" },
];

export default function CitizenShell({ onReturnToWelcome }) {
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [desktopTab, setDesktopTab] = useState("notifications");

  // Resident Self Account Management state
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showDeleteProfileModal, setShowDeleteProfileModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [resSaving, setResSaving] = useState(false);
  const [resMsg, setResMsg] = useState({ type: "", text: "" });
  const [deleteConfirmPassword, setDeleteConfirmPassword] = useState("");
  const [resDeleting, setResDeleting] = useState(false);

  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");
  const { profile, isResident, signOut } = useAuth();
  const [appPermissions, setAppPermissions] = useState(getPermissionsState());

  const togglePermission = async (key) => {
    const current = appPermissions[key];
    if (current === "granted") {
      const updated = setPermissionState(key, "denied");
      setAppPermissions(updated);
    } else {
      await requestBrowserPermission(key);
      setAppPermissions(getPermissionsState());
    }
  };

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
    sessionStorage.removeItem(CLIENT_STORAGE_KEYS.UNAUTH_VIEW);
    localStorage.removeItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT);
    localStorage.removeItem(CLIENT_STORAGE_KEYS.OFFLINE_QUEUE);
    setShowAccountMenu(false);
    onReturnToWelcome?.();
  };

  const handleSignOut = async () => {
    sessionStorage.removeItem(CLIENT_STORAGE_KEYS.UNAUTH_VIEW);
    await signOut();
    setShowAccountMenu(false);
    onReturnToWelcome?.();
  };

  const handleSaveResidentProfile = async () => {
    if (!profile?.id) return;
    setResSaving(true);
    setResMsg({ type: "", text: "" });

    const { error } = await updateResidentProfile({
      userId: profile.id,
      full_name: editName,
      email: editEmail,
      password: editPassword,
    });

    setResSaving(false);
    if (error) {
      setResMsg({ type: "error", text: error });
    } else {
      setResMsg({ type: "success", text: "Profile updated successfully!" });
      setTimeout(() => setShowEditProfileModal(false), 1200);
    }
  };

  const handleDeleteResidentAccount = async () => {
    if (!profile?.id) return;
    setResDeleting(true);
    setResMsg({ type: "", text: "" });

    const { error } = await deleteResidentAccount({
      userId: profile.id,
      reason: "Self-deletion by resident",
    });

    setResDeleting(false);
    if (error) {
      setResMsg({ type: "error", text: error });
    } else {
      setShowDeleteProfileModal(false);
      setShowSettings(false);
      await signOut();
      onReturnToWelcome?.();
    }
  };

  /* ── Dedicated Settings Modal (Mobile + Desktop variants) ───────────── */
  const renderSettingsModal = (isDesktopView = false) => {
    if (isDesktopView) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-6 backdrop-blur-xs font-sans animate-in fade-in duration-150">
          <div className="w-full max-w-2xl h-[520px] border border-line bg-surface shadow-2xl rounded-xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line px-6 py-4 bg-surface shrink-0">
              <div className="flex items-center gap-2.5">
                <Settings className="w-5 h-5 text-brand" />
                <div>
                  <h3 className="text-base font-bold text-ink leading-none">Settings &amp; Preferences</h3>
                  <p className="text-xs text-ink-muted mt-1 leading-none">Manage notifications, app permissions, and account settings</p>
                </div>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="saro-btn saro-btn-ghost saro-btn-sm"
                aria-label="Close settings"
              >
                <X width={16} height={16} />
              </button>
            </div>

            {/* Two Column Layout */}
            <div className="flex flex-1 min-h-0">
              {/* Left Sidebar Navigation */}
              <aside className="w-52 border-r border-line bg-sunken/40 p-3 flex flex-col gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setDesktopTab("notifications")}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs font-bold text-left transition-colors ${
                    desktopTab === "notifications"
                      ? "bg-brand text-white shadow-xs"
                      : "text-ink-muted hover:bg-raised hover:text-ink"
                  }`}
                >
                  <Bell className="w-4 h-4 shrink-0" />
                  Notifications
                </button>

                <button
                  type="button"
                  onClick={() => setDesktopTab("permissions")}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs font-bold text-left transition-colors ${
                    desktopTab === "permissions"
                      ? "bg-brand text-white shadow-xs"
                      : "text-ink-muted hover:bg-raised hover:text-ink"
                  }`}
                >
                  <MapPin className="w-4 h-4 shrink-0" />
                  Permissions
                </button>

                <button
                  type="button"
                  onClick={() => setDesktopTab("privacy")}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs font-bold text-left transition-colors ${
                    desktopTab === "privacy"
                      ? "bg-brand text-white shadow-xs"
                      : "text-ink-muted hover:bg-raised hover:text-ink"
                  }`}
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  Privacy &amp; Legal
                </button>

                {isResident && (
                  <button
                    type="button"
                    onClick={() => setDesktopTab("account")}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs font-bold text-left transition-colors ${
                      desktopTab === "account"
                        ? "bg-brand text-white shadow-xs"
                        : "text-ink-muted hover:bg-raised hover:text-ink"
                    }`}
                  >
                    <User className="w-4 h-4 shrink-0" />
                    Account
                  </button>
                )}

                <div className="flex-1" />

                {/* Footer System Info */}
                <div className="p-3 bg-white border border-line rounded-md text-[11px] text-ink-muted space-y-0.5">
                  <span className="font-bold text-ink block">SARO Citizen Portal</span>
                  <span>Legazpi City DRRM</span>
                </div>
              </aside>

              {/* Right Content Panel */}
              <main className="flex-1 p-6 overflow-y-auto space-y-4">
                {/* 1. Notifications Tab */}
                {desktopTab === "notifications" && (
                  <div className="space-y-4 animate-in fade-in duration-150">
                    <div>
                      <h4 className="text-sm font-bold text-ink">Notification Preferences</h4>
                      <p className="text-xs text-ink-muted mt-0.5">Control how SARO alerts you about reported hazards and status updates.</p>
                    </div>

                    <div className="border border-line rounded-lg p-4 bg-white space-y-3 shadow-2xs">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-full ${pushOn ? "bg-brand-wash text-brand" : "bg-sunken text-ink-faint"}`}>
                            {pushOn ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
                          </div>
                          <div>
                            <span className="text-sm font-bold text-ink block">Report Update Notifications</span>
                            <span className="text-xs text-ink-muted block">Receive browser alerts when assigned offices resolve your filed reports</span>
                          </div>
                        </div>

                        {pushSupported() && (
                          <button
                            type="button"
                            onClick={togglePush}
                            disabled={pushBusy}
                            role="switch"
                            aria-checked={pushOn}
                            aria-label="Toggle report update notifications"
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              pushOn ? "bg-brand" : "bg-line hover:bg-line/80"
                            } ${pushBusy ? "opacity-50 cursor-not-allowed" : ""}`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                pushOn ? "translate-x-5" : "translate-x-0"
                              }`}
                            />
                          </button>
                        )}
                      </div>

                      <div className="text-xs pt-2 border-t border-line flex items-center justify-between">
                        <span className="text-ink-muted">Status: <strong className={pushOn ? "text-brand font-bold" : "text-ink-faint"}>{pushOn ? "Active (Push Notifications Enabled)" : "Disabled"}</strong></span>
                        {pushError && <span className="text-alert font-bold">{pushError}</span>}
                        {pushPermission() === "denied" && <span className="text-alert font-bold">Blocked in browser</span>}
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Hardware Permissions Tab */}
                {desktopTab === "permissions" && (
                  <div className="space-y-4 animate-in fade-in duration-150">
                    <div>
                      <h4 className="text-sm font-bold text-ink">Hardware Permissions</h4>
                      <p className="text-xs text-ink-muted mt-0.5">Manage browser access for location, microphone, and emergency dialing.</p>
                    </div>

                    <div className="border border-line rounded-lg p-4 bg-white space-y-4 shadow-2xs">
                      {/* Location Toggle */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-md ${appPermissions.location === "granted" ? "bg-brand-wash text-brand" : "bg-sunken text-ink-faint"}`}>
                            <MapPin className="w-5 h-5" />
                          </div>
                          <div>
                            <span className="text-xs font-bold text-ink block">GPS Location Access</span>
                            <span className="text-[11px] text-ink-muted block">Detects your current position for emergency map pin placement</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => togglePermission("location")}
                          role="switch"
                          aria-checked={appPermissions.location === "granted"}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                            appPermissions.location === "granted" ? "bg-brand" : "bg-line hover:bg-line/80"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                              appPermissions.location === "granted" ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>

                      {/* Microphone Toggle */}
                      <div className="flex items-center justify-between gap-3 pt-3 border-t border-line">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-md ${appPermissions.microphone === "granted" ? "bg-brand-wash text-brand" : "bg-sunken text-ink-faint"}`}>
                            <Mic className="w-5 h-5" />
                          </div>
                          <div>
                            <span className="text-xs font-bold text-ink block">Microphone Voice Input</span>
                            <span className="text-[11px] text-ink-muted block">Enables Bikol/Tagalog voice dictation when filing hazard descriptions</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => togglePermission("microphone")}
                          role="switch"
                          aria-checked={appPermissions.microphone === "granted"}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                            appPermissions.microphone === "granted" ? "bg-brand" : "bg-line hover:bg-line/80"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                              appPermissions.microphone === "granted" ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>

                      {/* Phone Dialer Toggle */}
                      <div className="flex items-center justify-between gap-3 pt-3 border-t border-line">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-md ${appPermissions.phone === "granted" ? "bg-brand-wash text-brand" : "bg-sunken text-ink-faint"}`}>
                            <PhoneCall className="w-5 h-5" />
                          </div>
                          <div>
                            <span className="text-xs font-bold text-ink block">Phone Dialer Access</span>
                            <span className="text-[11px] text-ink-muted block">One-tap emergency call handoff to 911 hotline dialer</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => togglePermission("phone")}
                          role="switch"
                          aria-checked={appPermissions.phone === "granted"}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                            appPermissions.phone === "granted" ? "bg-brand" : "bg-line hover:bg-line/80"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                              appPermissions.phone === "granted" ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Privacy & Legal Tab */}
                {desktopTab === "privacy" && (
                  <div className="space-y-4 animate-in fade-in duration-150">
                    <div>
                      <h4 className="text-sm font-bold text-ink">Legal &amp; Privacy Governance</h4>
                      <p className="text-xs text-ink-muted mt-0.5">Read about data retention, anonymity rules, and civic safety compliance.</p>
                    </div>

                    <div className="border border-line rounded-lg p-4 bg-white space-y-3 shadow-2xs">
                      <div className="flex items-start gap-3">
                        <FileText className="w-6 h-6 text-brand shrink-0 mt-0.5" />
                        <div>
                          <span className="text-sm font-bold text-ink block">Data Governance &amp; Privacy Notice</span>
                          <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                            Emergency reports are handled anonymously. Standard hazard reports follow your resident account so city offices can follow up on resolution status.
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => { setShowSettings(false); setShowPrivacy(true); }}
                        className="saro-btn saro-btn-secondary saro-btn-sm w-full flex items-center justify-center gap-2 mt-2"
                      >
                        <FileText className="w-4 h-4 text-brand" />
                        Read Full Privacy Policy Notice
                      </button>
                    </div>
                  </div>
                )}

                {/* 4. Account Settings Tab */}
                {desktopTab === "account" && isResident && (
                  <div className="space-y-4 animate-in fade-in duration-150">
                    <div>
                      <h4 className="text-sm font-bold text-ink">Account Self-Management</h4>
                      <p className="text-xs text-ink-muted mt-0.5">Manage your personal details or delete your resident account profile.</p>
                    </div>

                    <div className="border border-line rounded-lg p-4 bg-white space-y-3 shadow-2xs">
                      <button
                        onClick={() => {
                          setEditName(profile?.full_name || "");
                          setEditEmail(profile?.email || "");
                          setEditPassword("");
                          setResMsg({ type: "", text: "" });
                          setShowEditProfileModal(true);
                        }}
                        className="w-full flex items-center justify-between p-3 rounded-md border border-line hover:bg-raised text-left transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <User className="w-5 h-5 text-brand shrink-0" />
                          <div>
                            <span className="text-xs font-bold text-ink block">Edit Resident Profile</span>
                            <span className="text-[11px] text-ink-muted block">Update name, email, or password</span>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-ink-faint" />
                      </button>

                      <div className="border-t border-line pt-2">
                        <button
                          onClick={() => {
                            setDeleteConfirmPassword("");
                            setResMsg({ type: "", text: "" });
                            setShowDeleteProfileModal(true);
                          }}
                          className="w-full flex items-center justify-between p-3 rounded-md border border-alert/30 bg-alert-wash/30 hover:bg-alert-wash text-left transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <Trash2 className="w-5 h-5 text-alert shrink-0" />
                            <div>
                              <span className="text-xs font-bold text-alert block">Delete Account</span>
                              <span className="text-[11px] text-ink-muted block">Permanently remove profile; filed reports stay with city</span>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-alert/70" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </main>
            </div>
          </div>
        </div>
      );
    }

    /* Mobile Sheet Variant (< 1024px) */
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-xs font-sans">
        <div className="w-full max-w-md border border-line bg-surface p-5 shadow-sheet animate-fade-in rounded-lg space-y-4 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-brand" />
              <h3 className="text-base font-bold text-ink">Settings &amp; Preferences</h3>
            </div>
            <button
              onClick={() => setShowSettings(false)}
              className="saro-btn saro-btn-ghost saro-btn-sm"
              aria-label="Close settings"
            >
              <X width={16} height={16} />
            </button>
          </div>

          <div className="space-y-3">
            {/* Notification Toggle Switch */}
            <div className="border border-line rounded-md p-3.5 bg-white space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {pushOn
                    ? <Bell className="w-5 h-5 text-brand shrink-0" />
                    : <BellOff className="w-5 h-5 text-ink-faint shrink-0" />}
                  <div>
                    <span className="t-subhead block font-bold text-ink text-sm">
                      Report Update Notifications
                    </span>
                    <span className="t-body-sm block text-ink-muted text-xs">
                      Get notified when your report changes status
                    </span>
                  </div>
                </div>

                {/* Clean On/Off Toggle Button */}
                {pushSupported() && (
                  <button
                    type="button"
                    onClick={togglePush}
                    disabled={pushBusy}
                    role="switch"
                    aria-checked={pushOn}
                    aria-label="Toggle report update notifications"
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      pushOn ? "bg-brand" : "bg-line hover:bg-line/80"
                    } ${pushBusy ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                        pushOn ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                )}
              </div>

              <div className="text-[11px] text-ink-muted pt-1 border-t border-line/60 flex items-center justify-between">
                <span>Status: <strong className={pushOn ? "text-brand font-bold" : "text-ink-faint"}>{pushOn ? "ON (Push Enabled)" : "OFF (Push Disabled)"}</strong></span>
                {pushError && <span className="text-alert font-bold">{pushError}</span>}
                {pushPermission() === "denied" && <span className="text-alert font-bold">Blocked in browser</span>}
              </div>
            </div>

            {/* Hardware Permissions Section */}
            <div className="border border-line rounded-md p-3.5 bg-white space-y-3">
              <span className="text-xs font-bold text-ink uppercase tracking-wider block">
                App Hardware Permissions
              </span>

              {/* Location Toggle */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2.5">
                  <MapPin className={`w-4.5 h-4.5 ${appPermissions.location === "granted" ? "text-brand" : "text-ink-faint"}`} />
                  <div>
                    <span className="text-xs font-bold text-ink block">Location Access</span>
                    <span className="text-[11px] text-ink-muted block leading-tight">GPS position for Panic and reports</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => togglePermission("location")}
                  role="switch"
                  aria-checked={appPermissions.location === "granted"}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                    appPermissions.location === "granted" ? "bg-brand" : "bg-line hover:bg-line/80"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                      appPermissions.location === "granted" ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Microphone Toggle */}
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-line/50">
                <div className="flex items-center gap-2.5">
                  <Mic className={`w-4.5 h-4.5 ${appPermissions.microphone === "granted" ? "text-brand" : "text-ink-faint"}`} />
                  <div>
                    <span className="text-xs font-bold text-ink block">Microphone Access</span>
                    <span className="text-[11px] text-ink-muted block leading-tight">Voice input for describing hazards</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => togglePermission("microphone")}
                  role="switch"
                  aria-checked={appPermissions.microphone === "granted"}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                    appPermissions.microphone === "granted" ? "bg-brand" : "bg-line hover:bg-line/80"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                      appPermissions.microphone === "granted" ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Phone Call Toggle */}
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-line/50">
                <div className="flex items-center gap-2.5">
                  <PhoneCall className={`w-4.5 h-4.5 ${appPermissions.phone === "granted" ? "text-brand" : "text-ink-faint"}`} />
                  <div>
                    <span className="text-xs font-bold text-ink block">Phone Dialer Access</span>
                    <span className="text-[11px] text-ink-muted block leading-tight">Emergency 911 phone dialer handoff</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => togglePermission("phone")}
                  role="switch"
                  aria-checked={appPermissions.phone === "granted"}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                    appPermissions.phone === "granted" ? "bg-brand" : "bg-line hover:bg-line/80"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                      appPermissions.phone === "granted" ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Privacy Notice Item */}
            <div className="border border-line rounded-md p-3.5 bg-white space-y-2">
              <span className="text-xs font-bold text-ink uppercase tracking-wider block">
                Legal &amp; Privacy Governance
              </span>
              <button
                onClick={() => { setShowSettings(false); setShowPrivacy(true); }}
                className="w-full flex items-center gap-3 border border-line p-3 rounded-md text-left hover:bg-raised transition-colors"
              >
                <FileText width={18} height={18} className="shrink-0 text-brand" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="t-subhead block font-bold text-ink">Privacy Notice</span>
                  <span className="t-body-sm block text-ink-muted text-xs">
                    What data is collected, who sees it, and security retention rules
                  </span>
                </span>
                <ChevronRight width={16} height={16} className="shrink-0 text-ink-faint" aria-hidden="true" />
              </button>
            </div>

            {/* Resident Account Self-Management Section (Signed-in residents only) */}
            {isResident && profile && (
              <div className="border border-line rounded-md p-3.5 bg-white space-y-3">
                <span className="text-xs font-bold text-ink uppercase tracking-wider block">
                  Account Self-Management
                </span>

                <button
                  onClick={() => {
                    setEditName(profile.full_name || "");
                    setEditEmail(profile.email || "");
                    setEditPassword("");
                    setResMsg({ type: "", text: "" });
                    setShowEditProfileModal(true);
                  }}
                  className="w-full flex items-center justify-between p-2.5 rounded border border-line hover:bg-raised text-left transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <User className="w-4 h-4 text-brand shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-ink block">Edit Profile</span>
                      <span className="text-[11px] text-ink-muted block leading-tight">Update name, email, or password</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-ink-faint" />
                </button>

                {/* Visually Separated Delete Account Entry */}
                <div className="border-t border-line/60 pt-2">
                  <button
                    onClick={() => {
                      setDeleteConfirmPassword("");
                      setResMsg({ type: "", text: "" });
                      setShowDeleteProfileModal(true);
                    }}
                    className="w-full flex items-center justify-between p-2.5 rounded border border-alert/30 bg-alert-wash/30 hover:bg-alert-wash text-left transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <Trash2 className="w-4 h-4 text-alert shrink-0" />
                      <div>
                        <span className="text-xs font-bold text-alert block">Delete Account</span>
                        <span className="text-[11px] text-ink-muted block leading-tight">Permanently delete account; reports stay trackable</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-alert/70" />
                  </button>
                </div>
              </div>
            )}

            {/* System Metadata */}
            <div className="bg-raised p-3 rounded-md border border-line text-xs text-ink-muted flex items-center justify-between">
              <div>
                <span className="font-bold text-ink block">SARO Resident Portal</span>
                <span>Legazpi City DRRM System</span>
              </div>
              {isResident && (
                <span className="t-micro font-bold px-2 py-1 bg-brand/10 text-brand rounded border border-brand/20">
                  Verified Resident
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  /* ── Edit Resident Profile Modal ────────────────────────────────────── */
  const renderEditProfileModal = () => {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/60 p-4 backdrop-blur-xs font-sans animate-in fade-in duration-150">
        <div className="w-full max-w-md border border-line bg-surface p-6 shadow-2xl rounded-xl space-y-4 animate-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2.5">
              <User className="w-5 h-5 text-brand" />
              <div>
                <h3 className="text-base font-bold text-ink leading-none">Edit Resident Profile</h3>
                <p className="text-xs text-ink-muted mt-1 leading-none">Update your personal account information</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowEditProfileModal(false)}
              className="saro-btn saro-btn-ghost saro-btn-sm"
              aria-label="Close edit profile modal"
            >
              <X width={16} height={16} />
            </button>
          </div>

          {resMsg.text && (
            <div
              className={`p-3 rounded-md border text-xs font-medium ${
                resMsg.type === "error"
                  ? "bg-alert-wash border-alert/30 text-alert"
                  : "bg-emerald-50 border-emerald-200 text-emerald-800"
              }`}
            >
              {resMsg.text}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveResidentProfile();
            }}
            className="space-y-4"
          >
            <div className="space-y-1">
              <label className="block text-xs font-bold text-ink">Full Name</label>
              <input
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Juan dela Cruz"
                className="w-full px-3 py-2 text-xs border border-line rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 text-ink"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-ink">Email Address</label>
              <input
                type="email"
                required
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="resident@example.com"
                className="w-full px-3 py-2 text-xs border border-line rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 text-ink"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-ink">New Password (optional)</label>
              <input
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="Leave blank to keep current password"
                className="w-full px-3 py-2 text-xs border border-line rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 text-ink"
              />
              <span className="text-[10px] text-ink-faint block">Minimum 6 characters if changing</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setShowEditProfileModal(false)}
                className="saro-btn saro-btn-ghost saro-btn-sm"
                disabled={resSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resSaving}
                className="saro-btn saro-btn-primary saro-btn-sm font-bold flex items-center gap-1.5"
              >
                {resSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  /* ── Delete Resident Profile Modal ──────────────────────────────────── */
  const renderDeleteProfileModal = () => {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/60 p-4 backdrop-blur-xs font-sans animate-in fade-in duration-150">
        <div className="w-full max-w-md border border-alert/30 bg-surface p-6 shadow-2xl rounded-xl space-y-4 animate-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2.5">
              <Trash2 className="w-5 h-5 text-alert shrink-0" />
              <div>
                <h3 className="text-base font-bold text-alert leading-none">Delete Resident Account</h3>
                <p className="text-xs text-ink-muted mt-1 leading-none">Permanent account self-deletion</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowDeleteProfileModal(false)}
              className="saro-btn saro-btn-ghost saro-btn-sm"
              aria-label="Close delete account modal"
            >
              <X width={16} height={16} />
            </button>
          </div>

          <div className="p-3 bg-alert-wash/50 border border-alert/20 rounded-md space-y-1.5 text-xs text-alert-strong">
            <span className="font-bold block">Are you sure you want to delete your account?</span>
            <p className="text-[11px] leading-relaxed text-ink-muted">
              Your account and synced "My Reports" profile access will be deleted. Any hazard reports you previously filed will remain safely recorded with Legazpi City and checkable by tracking code.
            </p>
          </div>

          {resMsg.text && (
            <div
              className={`p-3 rounded-md border text-xs font-medium ${
                resMsg.type === "error"
                  ? "bg-alert-wash border-alert/30 text-alert"
                  : "bg-emerald-50 border-emerald-200 text-emerald-800"
              }`}
            >
              {resMsg.text}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleDeleteResidentAccount();
            }}
            className="space-y-4"
          >
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setShowDeleteProfileModal(false)}
                className="saro-btn saro-btn-ghost saro-btn-sm"
                disabled={resDeleting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resDeleting}
                className="saro-btn bg-alert text-white hover:bg-alert/90 saro-btn-sm font-bold flex items-center gap-1.5 shadow-xs"
              >
                {resDeleting ? "Deleting Account..." : "Confirm Delete Account"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // ── Desktop branch (≥ 1024px) ───────────────────────────────────────────
  // All state (modals, auth, settings) is managed here and passed down so
  // neither branch duplicates logic. The mobile JSX below is untouched.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const isDesktop = useDesktopBreakpoint();

  if (isDesktop) {
    // Auth and privacy overlays render over the desktop shell too.
    if (showAuth) {
      return (
        <div className="fixed inset-0 z-50 flex h-full w-full flex-col overflow-hidden bg-surface">
          <ConnectionIndicator />
          <ResidentAuthScreen onCancel={() => setShowAuth(false)} onSignedIn={() => setShowAuth(false)} />
        </div>
      );
    }
    if (showPrivacy) {
      return (
        <div className="fixed inset-0 z-50 flex h-full w-full flex-col overflow-hidden bg-canvas">
          <ConnectionIndicator />
          <div className="mx-auto w-full max-w-[1536px] flex-1 overflow-y-auto p-6 md:p-8 lg:p-10">
            <ConsentNotice dismissible onAcknowledge={() => setShowPrivacy(false)} />
          </div>
        </div>
      );
    }
    return (
      <div className="relative h-full w-full overflow-hidden">
        <DesktopShell
          onReturnToWelcome={onReturnToWelcome}
          onShowSettings={() => setShowSettings(true)}
          onShowAuth={() => setShowAuth(true)}
        />
        {showSettings && renderSettingsModal(true)}
        {showEditProfileModal && renderEditProfileModal()}
        {showDeleteProfileModal && renderDeleteProfileModal()}
      </div>
    );
  }
  // ── End desktop branch ───────────────────────────────────────────────────

  if (showAuth) {
    return (
      <div className="absolute inset-0 z-50 flex h-full w-full flex-col overflow-hidden bg-surface">
        <ConnectionIndicator />
        <ResidentAuthScreen onCancel={() => setShowAuth(false)} onSignedIn={() => setShowAuth(false)} />
      </div>
    );
  }

  if (showPrivacy) {
    return (
      <div className="absolute inset-0 z-50 flex h-full w-full flex-col overflow-hidden bg-canvas">
        <ConnectionIndicator />
        <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto p-4">
          <ConsentNotice dismissible onAcknowledge={() => setShowPrivacy(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-canvas text-ink">
      {showSettings && renderSettingsModal(false)}
      <ConnectionIndicator />

      <header className="sticky top-0 z-30 shrink-0 border-b border-line bg-surface px-4 py-2.5">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <Wordmark size="sm" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAccountMenu(true)}
              className="relative flex items-center gap-2 p-1 rounded-full text-left transition-transform active:scale-95 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-brand/40"
              aria-label={isResident ? `Account settings for ${profile?.full_name || "Resident"}` : "Account settings and sign in"}
            >
              {isResident ? (
                <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-brand-wash text-brand font-bold text-xs border border-brand/30 shadow-2xs">
                  <User className="w-4 h-4 text-brand" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-emerald-500" aria-hidden="true" />
                </div>
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sunken text-ink-muted border border-line hover:border-brand-edge shadow-2xs">
                  <User className="w-4 h-4 text-ink-muted" />
                </div>
              )}
            </button>
          </div>
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
          className="fixed inset-0 z-50 bg-black/5 animate-in fade-in duration-150"
          onClick={() => setShowAccountMenu(false)}
        >
          <div
            className="absolute top-[52px] right-3 w-[260px] border border-line bg-surface p-3.5 shadow-2xl rounded-xl space-y-3 font-sans text-ink animate-in slide-in-from-top-2 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {isResident ? (
                  <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand font-bold text-xs border border-brand/30">
                    <User className="w-4 h-4 text-brand" />
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-emerald-500" aria-hidden="true" />
                  </div>
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-muted border border-line">
                    <User className="w-4 h-4 text-ink-muted" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-xs font-bold text-ink truncate leading-tight">
                      {isResident ? profile?.full_name || "Resident" : "Anonymous Reporter"}
                    </span>
                    {isResident && (
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                    )}
                  </div>
                  <span className="text-[10px] text-ink-muted block truncate mt-0.5 leading-none">
                    {isResident ? profile?.email || "Reports follow your account" : "Reports stay on this device"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowAccountMenu(false)}
                className="saro-btn saro-btn-ghost saro-btn-sm shrink-0 -mr-1 -mt-1 text-ink-muted hover:text-ink"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-1.5 text-xs">
              {!isResident && (
                <button
                  onClick={() => { setShowAccountMenu(false); setShowAuth(true); }}
                  className="flex items-center justify-between gap-2 border border-brand-edge bg-brand-wash p-2.5 rounded-lg text-left transition-colors hover:bg-brand-wash/80"
                >
                  <span className="min-w-0">
                    <span className="block font-bold text-brand-strong text-xs">Sign In or Create Account</span>
                    <span className="block text-[10px] text-ink-muted mt-0.5">Sync history across devices</span>
                  </span>
                  <ChevronRight width={14} height={14} className="shrink-0 text-brand" aria-hidden="true" />
                </button>
              )}

              {/* 1. Settings Entry */}
              <button
                onClick={() => { setShowAccountMenu(false); setShowSettings(true); }}
                className="flex items-center gap-2.5 border border-line p-2.5 rounded-lg text-left transition-colors hover:bg-sunken"
              >
                <Settings width={16} height={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-ink text-xs">Settings</span>
                  <span className="block text-[10px] text-ink-muted mt-0.5">Notifications &amp; privacy notice</span>
                </span>
                <ChevronRight width={14} height={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
              </button>

              {/* 2. Sign Out / Forget Device */}
              <div className="border-t border-line pt-1.5 mt-1">
                <button
                  onClick={isResident ? handleSignOut : handleForgetDevice}
                  className="w-full flex items-center gap-2.5 border border-amber-200/60 bg-amber-50/50 p-2.5 rounded-lg text-left transition-colors hover:bg-amber-100/50"
                >
                  <LogOut width={16} height={16} className="shrink-0 text-amber-700" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-amber-800 text-xs">
                      {isResident ? "Sign Out" : "Forget This Device"}
                    </span>
                    <span className="block text-[10px] text-amber-700/80 mt-0.5">
                      {isResident
                        ? "Reports stay saved on account"
                        : "Clears local Track list"}
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditProfileModal && renderEditProfileModal()}
      {showDeleteProfileModal && renderDeleteProfileModal()}

      <nav className="sticky bottom-0 z-30 shrink-0 border-t border-line bg-surface font-sans" aria-label="Main">
        <div className="mx-auto flex max-w-md items-end justify-around relative px-1 h-[56px]">
          {TABS.map(({ to, end, Icon, label, isPrimary }) => {
            if (isPrimary) {
              return (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className="relative flex-1 flex flex-col items-center z-40 focus:outline-none"
                  style={{ marginBottom: '4px' }}
                >
                  {({ isActive }) => (
                    <div className="flex flex-col items-center -mt-10">
                      {/* FAB circle */}
                      <div
                        className={`w-14 h-14 rounded-full flex items-center justify-center transition-shadow duration-150 ${
                          isActive
                            ? "bg-brand text-white shadow-[0_4px_16px_rgba(27,46,107,0.45)]"
                            : "bg-brand text-white shadow-[0_2px_10px_rgba(27,46,107,0.3)] hover:shadow-[0_4px_14px_rgba(27,46,107,0.4)] active:shadow-[0_2px_6px_rgba(27,46,107,0.35)]"
                        }`}
                      >
                        <Icon className="w-[22px] h-[22px] stroke-[2.2]" aria-hidden="true" />
                      </div>
                      {/* Label below circle */}
                      <span className={`text-[10px] font-bold uppercase tracking-wide leading-none mt-1 ${
                        isActive ? "text-brand" : "text-ink-faint"
                      }`}>
                        {label}
                      </span>
                    </div>
                  )}
                </NavLink>
              );
            }

            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `relative flex h-full flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-inset rounded-xs ${
                    isActive ? "text-brand" : "text-ink-faint hover:text-ink"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-3 top-0 h-0.5 transition-all"
                      style={{ background: isActive ? "var(--color-brand)" : "transparent" }}
                    />
                    <Icon width={20} height={20} strokeWidth={isActive ? 2.4 : 1.8} aria-hidden="true" />
                    <span className="t-micro text-[10px]">{label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

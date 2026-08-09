import { ShieldCheck, Settings, LogOut, ChevronRight, X } from "lucide-react";

/**
 * Reusable Desktop Account Popover.
 * Supports anchor positions: 'bottom-left' (sidebar) and 'top-right' (header/Home).
 *
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {"bottom-left" | "top-right"} [props.position="bottom-left"]
 * @param {object} [props.profile]
 * @param {boolean} props.isResident
 * @param {() => void} [props.onShowSettings]
 * @param {() => void} [props.onShowAuth]
 * @param {() => void} [props.onSignOut]
 */
export default function AccountPopover({
  isOpen,
  onClose,
  position = "bottom-left",
  profile,
  isResident,
  onShowSettings,
  onShowAuth,
  onSignOut,
}) {
  if (!isOpen) return null;

  const positionClasses =
    position === "top-right"
      ? "top-[58px] right-6 animate-in slide-in-from-top-2 duration-150"
      : "bottom-[64px] left-3 animate-in slide-in-from-bottom-2 duration-150";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-start bg-black/5"
      onClick={onClose}
      role="dialog"
      aria-label="Account menu"
      aria-modal="true"
    >
      <div
        className={`absolute w-[250px] border border-line bg-surface p-4 shadow-2xl rounded-xl space-y-3 font-sans text-ink ${positionClasses}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <ShieldCheck
              width={18}
              height={18}
              className={isResident ? "text-emerald-600 shrink-0" : "text-ink-faint shrink-0"}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <span className="block truncate text-xs font-bold text-ink leading-snug">
                {isResident ? profile?.full_name || "Resident" : "Anonymous Reporter"}
              </span>
              <span className="block truncate text-[10px] text-ink-muted leading-none mt-0.5">
                {isResident ? "Reports follow your account" : "Reports stay on this device"}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="saro-btn saro-btn-ghost saro-btn-sm shrink-0 -mr-1 -mt-1 text-ink-muted hover:text-ink"
            aria-label="Close menu"
          >
            <X width={15} height={15} />
          </button>
        </div>

        {/* Menu Options */}
        <div className="flex flex-col gap-1.5 text-xs">
          {/* Guest Sign In */}
          {!isResident && (
            <button
              onClick={() => {
                onClose();
                onShowAuth?.();
              }}
              className="flex items-center justify-between gap-2 border border-brand-edge bg-brand-wash p-2.5 rounded-lg text-left transition-colors hover:bg-brand-wash/80"
            >
              <div>
                <span className="block font-bold text-brand-strong text-xs">Sign In or Create Account</span>
                <span className="block text-[10px] text-ink-muted mt-0.5">Sync history across devices</span>
              </div>
              <ChevronRight width={14} height={14} className="shrink-0 text-brand" />
            </button>
          )}

          {/* Settings */}
          <button
            onClick={() => {
              onClose();
              onShowSettings?.();
            }}
            className="flex items-center gap-2.5 border border-line p-2.5 rounded-lg text-left transition-colors hover:bg-sunken"
          >
            <Settings width={16} height={16} className="shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink text-xs">Settings</span>
              <span className="block text-[10px] text-ink-muted mt-0.5">Notifications &amp; privacy notice</span>
            </span>
            <ChevronRight width={14} height={14} className="shrink-0 text-ink-faint" />
          </button>

          {/* Sign Out */}
          <div className="border-t border-line pt-1.5 mt-1">
            <button
              onClick={() => {
                onClose();
                onSignOut?.();
              }}
              className="w-full flex items-center gap-2.5 border border-amber-200/60 bg-amber-50/50 p-2.5 rounded-lg text-left transition-colors hover:bg-amber-100/50"
            >
              <LogOut width={16} height={16} className="shrink-0 text-amber-700" />
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-amber-800 text-xs">
                  {isResident ? "Sign Out" : "Forget This Device"}
                </span>
                <span className="block text-[10px] text-ink-muted mt-0.5">
                  {isResident ? "Reports stay saved on account" : "Clears local Track list"}
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

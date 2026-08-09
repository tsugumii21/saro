import { useState, useEffect, useCallback } from "react";
import { Mountain, ExternalLink, Save, ShieldAlert, RefreshCw, Layers } from "lucide-react";
import { AlertLevelBadge, ALERT_LEVELS } from "@saro/ui";
import {
  getVolcanicAlert,
  setVolcanicAlert,
  useAuth,
  MOCK_LIVE_VOLCANIC_ALERT,
  toggleMockVolcanoFeed,
  isMockVolcanoFeedActive,
} from "@saro/shared";

/**
 * DEMO PRESENTATION MOCK: Simulated real-time PHIVOLCS telemetry feed for prototype presentation.
 * Note: This is a presentation stand-in for pitch demos, not a production API integration.
 *
 * In production, Mayon alert level is verified manually by an authorized official reading PHIVOLCS bulletins.
 * For presentation purposes, this component provides a live-simulated feed (Level 3 High Unrest)
 * with continuous auto-refreshing timestamps ("verified just now"), while retaining the ability
 * to toggle back to manual verification mode without code changes or rebuilds.
 */
export default function AlertLevelEditor() {
  const { isAdmin } = useAuth();
  const [alert, setAlert] = useState(null);
  const [isMockMode, setIsMockMode] = useState(isMockVolcanoFeedActive());
  const [, setLastRefreshed] = useState(new Date());

  // Manual mode state
  const [level, setLevel] = useState(3);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const { data } = await getVolcanicAlert();
    if (!data) return;
    setAlert(data);
    setLevel(data.alert_level);
    setSummary(data.summary ?? "");
    setLastRefreshed(new Date());
  }, []);

  // Initial load + interval auto-refresh simulation (10 seconds)
  useEffect(() => {
    load();
    const interval = setInterval(() => {
      setLastRefreshed(new Date());
    }, 10000);
    return () => clearInterval(interval);
  }, [load]);

  if (!isAdmin) return null;

  const handleToggleMode = () => {
    const nextMockState = toggleMockVolcanoFeed();
    setIsMockMode(nextMockState);
    load();
  };

  const saveManual = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    const { error: saveError } = await setVolcanicAlert({
      alertLevel: level,
      summary,
      bulletinUrl: alert?.bulletin_url,
    });
    setBusy(false);
    if (saveError) return setError(saveError);
    setSaved(true);
    await load();
    setTimeout(() => setSaved(false), 4000);
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h2 className="t-heading flex items-center gap-2">
            <Mountain width={20} height={20} className="text-brand" aria-hidden="true" />
            Mayon Alert Level
          </h2>
          <p className="t-body-sm mt-1 text-ink-muted">
            {isMockMode
              ? "Live real-time telemetry feed simulation active (Level 3 High Unrest for presentation demo)."
              : "Set by hand from the official PHIVOLCS bulletin — never scraped."}
          </p>
        </div>

        {/* Toggle Mode Button */}
        <button
          type="button"
          onClick={handleToggleMode}
          className="saro-btn saro-btn-secondary text-xs flex items-center gap-2 shrink-0 border-brand-edge"
        >
          <Layers className="w-3.5 h-3.5 text-brand" />
          <span>{isMockMode ? "Switch to Manual Mode" : "Switch to Mock Live Feed (Demo)"}</span>
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Left Side: Feed Display or Manual Editor */}
        {isMockMode ? (
          /* ── MOCK LIVE REAL-TIME FEED SIMULATION ───────────────────── */
          <div className="saro-clip saro-card p-5 flex flex-col gap-4 border-amber-300 bg-amber-50/20">
            {/* Live Feed Status Header */}
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-200">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-600"></span>
                </span>
                <span className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                  Live Telemetry Feed (Presentation Mock)
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] font-mono font-semibold text-amber-700">
                <RefreshCw className="w-3 h-3 animate-spin text-amber-600" />
                <span>verified just now</span>
              </div>
            </div>

            {/* Current Level & Description */}
            <div className="flex flex-col gap-2 p-4 rounded-lg bg-surface border border-line">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-600" />
                  <span className="text-sm font-bold text-ink">
                    Alert Level {MOCK_LIVE_VOLCANIC_ALERT.alert_level} — {MOCK_LIVE_VOLCANIC_ALERT.status_title}
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                  {MOCK_LIVE_VOLCANIC_ALERT.source_label}
                </span>
              </div>

              <p className="text-xs text-ink mt-1 leading-relaxed">
                {MOCK_LIVE_VOLCANIC_ALERT.summary}
              </p>

              {/* Recommended Action Callout */}
              <div className="mt-2 p-3 rounded-md bg-red-50 border border-red-200 flex flex-col gap-1">
                <span className="text-[11px] font-bold text-red-900 uppercase tracking-wide flex items-center gap-1.5">
                  <span>⚠️</span> Recommended Action:
                </span>
                <span className="text-xs font-bold text-red-800">
                  {MOCK_LIVE_VOLCANIC_ALERT.recommended_action}
                </span>
              </div>

              {/* Additional Advisory */}
              <div className="p-3 rounded-md bg-amber-50/80 border border-amber-200/80 flex flex-col gap-1">
                <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wide">
                  ℹ️ Additional Advisory:
                </span>
                <span className="text-xs text-amber-900 leading-normal">
                  {MOCK_LIVE_VOLCANIC_ALERT.advisory}
                </span>
              </div>
            </div>

            {/* Official Bulletin Link */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-ink-faint">
                Source: {MOCK_LIVE_VOLCANIC_ALERT.verified_by}
              </span>
              <a
                href={MOCK_LIVE_VOLCANIC_ALERT.bulletin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="t-body-sm inline-flex items-center gap-1 text-brand-bright underline font-semibold"
              >
                Open PHIVOLCS Bulletin
                <ExternalLink width={13} height={13} />
              </a>
            </div>
          </div>
        ) : (
          /* ── MANUAL VERIFICATION FORM ─────────────────────────────── */
          <div className="saro-clip saro-card p-5">
            <a
              href={alert?.bulletin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="saro-btn saro-btn-secondary saro-btn-block"
            >
              Open the PHIVOLCS Bulletin
              <ExternalLink width={14} height={14} />
            </a>
            <p className="t-body-sm mt-2 text-ink-faint">
              Check the bulletin before saving. Saving stamps your name and current time as verification.
            </p>

            <fieldset className="mt-5">
              <legend className="t-label text-ink-faint">Current Level</legend>
              <div className="mt-2 flex flex-col gap-1.5">
                {Object.entries(ALERT_LEVELS).map(([value, meta]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-start gap-3 border border-line p-2.5 hover:bg-raised"
                    style={
                      Number(value) === level
                        ? { borderColor: "var(--color-brand)", background: "var(--color-brand-wash)" }
                        : undefined
                    }
                  >
                    <input
                      type="radio"
                      name="alert-level"
                      value={value}
                      checked={Number(value) === level}
                      onChange={() => setLevel(Number(value))}
                      className="mt-1 h-4 w-4 accent-brand"
                    />
                    <span className="min-w-0">
                      <span className="t-body-sm block font-bold">
                        Level {value} — {meta.name}
                      </span>
                      <span className="t-body-sm block text-ink-muted">{meta.meaning}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="mt-4 block">
              <span className="t-label text-ink-faint">Note for Residents (Optional)</span>
              <textarea
                rows={3}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Leave blank to show standard description."
                className="saro-field mt-1.5 w-full resize-none"
              />
            </label>

            {error && (
              <p role="alert" className="t-body-sm mt-3 border border-alert bg-alert-wash p-2.5 text-alert">
                {error}
              </p>
            )}
            {saved && (
              <p role="status" className="t-body-sm mt-3 text-ink-muted">
                Saved and verified just now. Both apps show it immediately.
              </p>
            )}

            <button onClick={saveManual} disabled={busy} className="saro-btn saro-btn-primary saro-btn-block mt-4">
              <Save width={15} height={15} />
              {busy ? "Saving…" : "Save and Mark Verified Now"}
            </button>
          </div>
        )}

        {/* Right Side: What Residents See Preview */}
        <div>
          <span className="t-label text-ink-faint block mb-2 font-bold">What Residents See</span>
          <AlertLevelBadge alert={alert} />
        </div>
      </div>
    </section>
  );
}

import { useState, useEffect, useCallback } from "react";
import { Mountain, ExternalLink, Save } from "lucide-react";
import { AlertLevelBadge, ALERT_LEVELS } from "@saro/ui";
import { getVolcanicAlert, setVolcanicAlert, useAuth } from "@saro/shared";

/**
 * Mayon alert level — set by hand, on purpose.
 *
 * This is the one number in SARO that is deliberately not automated, and the
 * reasoning is worth keeping next to the code.
 *
 * PHIVOLCS publishes bulletins as prose on a web page. A scraper for it would
 * work until the page was redesigned, and then it would fail in the worst
 * available way: silently, still returning the last value it managed to parse.
 * SARO would go on displaying "Alert Level 1" with total confidence while the
 * volcano sat at 4. People evacuate on this number.
 *
 * So a named official reads the bulletin and types the level, and the display
 * carries how long ago that happened. Past 24 hours the age turns red on both
 * apps. A stale value that admits it is stale is safe; a fresh-looking wrong
 * one is not.
 *
 * `last_verified_at` is stamped server-side from the write, not accepted from
 * this form — otherwise "verified" would mean "somebody opened the page".
 */
export default function AlertLevelEditor() {
  const { isAdmin } = useAuth();
  const [alert, setAlert] = useState(null);
  const [level, setLevel] = useState(0);
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
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!isAdmin) return null;

  const save = async () => {
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
      <div>
        <h2 className="t-heading flex items-center gap-2">
          <Mountain width={18} height={18} className="text-brand" aria-hidden="true" />
          Mayon alert level
        </h2>
        <p className="t-body-sm mt-1 text-ink-muted">
          Set by hand from the official PHIVOLCS bulletin — never scraped. Shown on both apps
          with the time since it was last checked.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="saro-clip saro-card p-5">
          <a
            href={alert?.bulletin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="saro-btn saro-btn-secondary saro-btn-block"
          >
            Open the PHIVOLCS bulletin
            <ExternalLink width={14} height={14} />
          </a>
          <p className="t-body-sm mt-2 text-ink-faint">
            Check the bulletin before saving. Saving stamps your name and the current time as
            the verification.
          </p>

          <fieldset className="mt-5">
            <legend className="t-label text-ink-faint">Current level</legend>
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
            <span className="t-label text-ink-faint">Note for residents (optional)</span>
            <textarea
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Leave blank to show the standard description of this level."
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

          <button onClick={save} disabled={busy} className="saro-btn saro-btn-primary saro-btn-block mt-4">
            <Save width={15} height={15} />
            {busy ? "Saving…" : "Save and mark verified now"}
          </button>
        </div>

        <div>
          <span className="t-label text-ink-faint">What residents see</span>
          <div className="mt-2">
            <AlertLevelBadge alert={alert} />
          </div>
        </div>
      </div>
    </section>
  );
}

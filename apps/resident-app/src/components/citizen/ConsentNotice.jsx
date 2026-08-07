import { ShieldCheck, X } from "lucide-react";
import { CLIENT_STORAGE_KEYS, CONSENT_VERSION } from "@saro/shared";

/**
 * RA 10173 (Data Privacy Act of 2012) notice.
 *
 * Two rules govern when this appears, and both are about not getting in the way
 * of the thing SARO exists to do:
 *
 *   1. It NEVER blocks or delays a Panic press. Not by a modal, not by a
 *      spinner, not by a tap. It is shown on the receipt screen, after the call
 *      has been placed and the alert is already routing.
 *
 *   2. It is not shown on app open. A privacy notice as a front door is how you
 *      teach people to dismiss privacy notices unread, and it puts a dialog
 *      between a frightened person and the red button.
 *
 * Plain language is a legal requirement here, not a style preference — the Act
 * requires the data subject to be informed in a form they can actually
 * understand. So: no "processing", no "data subject", no "personal information
 * controller". Short sentences, second person, concrete agency names.
 *
 * Acknowledgement is stored per device against CONSENT_VERSION, so a change to
 * what is collected or who receives it re-prompts everyone.
 */

export function consentAcknowledged() {
  try {
    return Number(localStorage.getItem(CLIENT_STORAGE_KEYS.CONSENT_ACK)) >= CONSENT_VERSION;
  } catch {
    // Storage blocked. Treat as not acknowledged: showing the notice again is a
    // small annoyance, never showing it is a legal failure.
    return false;
  }
}

export function acknowledgeConsent() {
  try {
    localStorage.setItem(CLIENT_STORAGE_KEYS.CONSENT_ACK, String(CONSENT_VERSION));
  } catch { /* nothing to do; it will ask again next time */ }
}

const COLLECTED = [
  ["Where you are", "Your location at the moment you report, so responders can find it."],
  ["When you reported", "The date and time of the report."],
  ["What you wrote", "Your description, and any photo you attach."],
  ["A device label", "A random code for this browser. Not your name, number, or IMEI."],
];

const SHARED_WITH = [
  "911 Emergency Action Center",
  "Legazpi CDRRMO",
  "Philippine National Police",
  "Bureau of Fire Protection",
  "Your barangay hall",
  "The city office handling your report",
];

/**
 * @param {object}   props
 * @param {() => void} props.onAcknowledge
 * @param {boolean}  [props.dismissible] Receipt-screen usage allows dismissal;
 *                                       the acknowledgement still records.
 */
export default function ConsentNotice({ onAcknowledge, dismissible = false }) {
  const accept = () => {
    acknowledgeConsent();
    onAcknowledge?.();
  };

  return (
    <section
      role="region"
      aria-labelledby="consent-heading"
      className="saro-clip saro-card overflow-hidden"
    >
      <header className="flex items-start gap-3 border-b border-rule p-5">
        <ShieldCheck width={20} height={20} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="consent-heading" className="t-heading">How SARO handles what you send</h2>
          <p className="t-body-sm mt-1 text-ink-muted">
            Required by the Data Privacy Act of 2012 (RA 10173). Worth thirty seconds.
          </p>
        </div>
        {dismissible && (
          <button
            type="button"
            onClick={accept}
            aria-label="Close and acknowledge"
            className="saro-btn saro-btn-ghost saro-btn-sm shrink-0"
          >
            <X width={16} height={16} />
          </button>
        )}
      </header>

      <div className="flex flex-col gap-5 p-5">
        <div>
          <h3 className="t-label text-ink-faint">What we collect</h3>
          <dl className="mt-2 flex flex-col gap-2">
            {COLLECTED.map(([term, detail]) => (
              <div key={term}>
                <dt className="t-body-sm font-bold">{term}</dt>
                <dd className="t-body-sm text-ink-muted">{detail}</dd>
              </div>
            ))}
          </dl>
          <p className="t-body-sm mt-3 text-ink-muted">
            You are not asked for your name or phone number. A number is optional, and
            only so someone can call you back.
          </p>
        </div>

        <div>
          <h3 className="t-label text-ink-faint">Why</h3>
          <p className="t-body-sm mt-2 text-ink-muted">
            To send help to the right place, and to route your report to the office that
            can act on it. Nothing here is used for advertising, and SARO does not sell
            or share it with anyone outside the list below.
          </p>
        </div>

        <div>
          <h3 className="t-label text-ink-faint">Who can see it</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {SHARED_WITH.map((agency) => (
              <li key={agency} className="t-body-sm flex items-start gap-2 text-ink-muted">
                <span
                  className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint"
                  aria-hidden="true"
                />
                {agency}
              </li>
            ))}
          </ul>
          <p className="t-body-sm mt-2 text-ink-muted">
            Each office sees only the reports assigned to it. Your barangay sees reports
            in your barangay.
          </p>
        </div>

        <div>
          <h3 className="t-label text-ink-faint">How long it is kept</h3>
          <p className="t-body-sm mt-2 text-ink-muted">
            Three years from the day the report closes, then it is deleted. Incident
            records are kept this long so the city can answer questions about how a
            disaster was handled.
          </p>
        </div>

        <div>
          <h3 className="t-label text-ink-faint">Your rights</h3>
          <p className="t-body-sm mt-2 text-ink-muted">
            Under RA 10173 you may ask what SARO holds about you, have it corrected, or
            object to how it is used. Ask at the Legazpi City Hall records office and
            bring your tracking code.
          </p>
        </div>

        <button type="button" onClick={accept} className="saro-btn saro-btn-primary saro-btn-lg saro-btn-block">
          I understand
        </button>

        <p className="t-body-sm text-ink-faint">
          This does not affect emergencies. Panic and emergency reports work whether or
          not you have read this.
        </p>
      </div>
    </section>
  );
}

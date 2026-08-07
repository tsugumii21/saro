import { useState, useEffect, useCallback } from "react";
import { Siren, ChevronRight, Info } from "lucide-react";
import { StatusTag, TrackingCode } from "@saro/ui";
import { getPanicFlags, getReportsForDevice, PANIC_REPEAT_WINDOW_MS } from "@saro/shared";

/**
 * Panic abuse review.
 *
 * Read-only, and that is the entire design.
 *
 * Nothing on this screen blocks, throttles, warns, or rate-limits anybody. The
 * database column that used to do that is pinned to false forever. A panic
 * control that can refuse is not a panic control, and the failure modes are not
 * symmetrical: wrongly ignoring a prank costs a wasted trip, wrongly blocking a
 * real emergency costs a life. So SARO never makes that call automatically — a
 * person looks at the reports and decides.
 *
 * Which is why the first thing this screen offers is not a block button but the
 * device's actual reports. A high count is a reason to read, not a verdict:
 * the most common cause of five presses in ten minutes is somebody whose first
 * alert brought nobody.
 */

function timeAgo(iso) {
  if (!iso) return "—";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function PanicReview() {
  const [flags, setFlags] = useState([]);
  const [selected, setSelected] = useState(null);
  const [deviceReports, setDeviceReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await getPanicFlags();
    setFlags(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const inspect = async (flag) => {
    setSelected(flag);
    setDeviceReports([]);
    const { data } = await getReportsForDevice(flag.device_token);
    setDeviceReports(data ?? []);
  };

  const windowMinutes = PANIC_REPEAT_WINDOW_MS / 60_000;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="t-heading">Panic press review</h1>
        <p className="t-body-sm mt-1 text-ink-muted">
          Devices that have pressed Panic repeatedly. For a person to look at — SARO never
          blocks a panic press, and nothing here does either.
        </p>
      </div>

      <p className="t-body-sm flex items-start gap-2 border border-line bg-raised p-3 text-ink-muted">
        <Info width={15} height={15} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
        <span>
          A “rapid repeat” is a second press within {windowMinutes} minutes of the last one. It
          usually means the first alert brought nobody, not that somebody is playing. Read the
          reports before deciding anything.
        </span>
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="saro-card overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-raised">
                {["Device", "Presses", "Rapid repeats", "Last press", ""].map((h) => (
                  <th key={h} className="t-label px-3 py-2.5 text-left text-ink-faint">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flags.map((flag) => (
                <tr
                  key={flag.device_token}
                  onClick={() => inspect(flag)}
                  aria-selected={selected?.device_token === flag.device_token}
                  className="cursor-pointer border-t border-line aria-selected:bg-brand-wash hover:bg-raised"
                >
                  <td className="t-data-sm px-3 py-2.5">{flag.device_token.slice(0, 22)}…</td>
                  <td className="px-3 py-2.5">
                    <span className="t-data font-bold">{flag.flag_count}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className="t-data"
                      style={{
                        color: flag.rapid_repeat_count > 2
                          ? "var(--color-status-assigned-ink)"
                          : "var(--color-ink-muted)",
                      }}
                    >
                      {flag.rapid_repeat_count ?? 0}
                    </span>
                  </td>
                  <td className="t-data-sm px-3 py-2.5 text-ink-muted">{timeAgo(flag.last_flagged_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <ChevronRight width={15} height={15} className="text-ink-faint" aria-hidden="true" />
                  </td>
                </tr>
              ))}
              {!loading && flags.length === 0 && (
                <tr>
                  <td colSpan={5} className="t-body-sm px-3 py-10 text-center text-ink-muted">
                    No device has pressed Panic more than once.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <aside className="saro-clip saro-card self-start overflow-hidden">
            <header className="border-b border-rule p-4">
              <span className="t-label flex items-center gap-1.5 text-ink-faint">
                <Siren width={13} height={13} aria-hidden="true" />
                What this device reported
              </span>
              <p className="t-data-sm mt-1.5 break-all text-ink-muted">{selected.device_token}</p>
            </header>

            <ul className="flex flex-col">
              {deviceReports.map((report) => (
                <li key={report.id} className="border-b border-line p-3 last:border-0">
                  <div className="flex items-center gap-2">
                    <TrackingCode code={report.tracking_code} />
                    <StatusTag status={report.status} size="sm" />
                  </div>
                  <p className="t-body-sm mt-1.5 text-ink-muted">{report.description}</p>
                  <p className="t-data-sm mt-1 text-ink-faint">
                    {new Date(report.created_at).toLocaleString("en-PH", {
                      dateStyle: "medium", timeStyle: "short",
                    })}
                  </p>
                </li>
              ))}
              {deviceReports.length === 0 && (
                <li className="t-body-sm p-4 text-ink-muted">
                  Presses recorded, but no report from this device is in your scope — the alerts
                  may have gone to another office.
                </li>
              )}
            </ul>

            <p className="t-body-sm border-t border-rule bg-raised p-3 text-ink-faint">
              There is no block action here, by design. If a device is genuinely abusing the
              system, that is a conversation for the barangay, not a switch in this screen.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

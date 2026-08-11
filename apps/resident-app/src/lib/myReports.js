import {
  getMyReports,
  getReportsByDevice,
  getOriginalMapDemoReports,
  listRememberedReports,
  CLIENT_STORAGE_KEYS,
} from "@saro/shared";

/**
 * Which map pins belong to the person reading the map.
 *
 * The public map projection carries a report id and never a tracking code — the
 * code is the credential its filer closes the report with, so publishing it on
 * a map anyone can open would hand strangers that power. Ownership is therefore
 * decided on the client: the reader already holds the codes for their own
 * reports, so the app compares the map's ids against the ids it knows are the
 * reader's, and only then pairs a pin with the code it already had.
 *
 * The sources are the same three Track merges, for the same reason — no single
 * one of them is complete:
 *
 *   the account      every report a signed-in resident filed, from any device
 *   the device RPC   reports filed anonymously from this browser
 *   IndexedDB        codes this browser has seen, including undelivered ones
 *
 * IndexedDB knows codes but no ids, so it can only recognise a pin that already
 * carries a code (the built-in demo rows). That is a bookmark, not the record.
 */
export async function loadMyReportKeys({ isResident } = {}) {
  const codeById = new Map();
  const codes = new Set();

  const remember = (row) => {
    const code = row?.tracking_code || row?.trackingCode || "";
    const id = row?.id ?? row?.report_id;
    if (id != null && String(id) !== "") codeById.set(String(id), code || "");
    if (code) codes.add(String(code).toUpperCase());
  };

  if (isResident) {
    /* Demo rows come from the exact source the public Map draws, so a signed-in
       resident sees the same reports here that Track lists as theirs. */
    for (const row of getOriginalMapDemoReports()) remember(row);

    const { data } = await getMyReports();
    for (const row of data ?? []) remember(row);
  } else {
    const deviceId = localStorage.getItem(CLIENT_STORAGE_KEYS.DEVICE_FINGERPRINT);
    if (deviceId) {
      const { data } = await getReportsByDevice(deviceId);
      for (const row of data ?? []) remember(row);
    }
  }

  for (const row of await listRememberedReports()) remember(row);

  return { codeById, codes };
}

/** An ownership index that matches nothing — what a screen starts with. */
export const EMPTY_REPORT_KEYS = { codeById: new Map(), codes: new Set() };

/**
 * Is this report the reader's, and if so what code opens it in Track?
 *
 * @returns {{ isMine: boolean, trackingCode: string }}
 */
export function matchOwnership(keys, report) {
  if (!keys || !report) return { isMine: false, trackingCode: "" };

  const id = report.report_id ?? report.id;
  if (id != null && keys.codeById.has(String(id))) {
    return { isMine: true, trackingCode: keys.codeById.get(String(id)) || "" };
  }

  const code = report.tracking_code || report.trackingCode || report.code;
  if (code && keys.codes.has(String(code).toUpperCase())) {
    return { isMine: true, trackingCode: String(code) };
  }

  return { isMine: false, trackingCode: "" };
}

/**
 * Stamp a pin's lead report and every hazard grouped under it with ownership.
 *
 * A location pin stands for everything filed on one rounded coordinate, so it
 * is "yours" when any single report under it is — the marker is the only thing
 * the reader can see before opening it.
 */
export function decorateGroupsWithOwnership(keys, groups) {
  let anyMine = false;

  const decorated = (groups ?? []).map((group) => {
    const { isMine, trackingCode } = matchOwnership(keys, group.report);
    if (isMine) anyMine = true;
    return {
      ...group,
      report: { ...group.report, is_mine: isMine, my_tracking_code: trackingCode },
    };
  });

  return { groups: decorated, anyMine };
}

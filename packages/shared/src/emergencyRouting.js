/**
 * Which agency answers which emergency.
 *
 * There is no hotline list in this file, and that is the point. The city already
 * decides routing in two places SARO reads at runtime:
 *
 *   routing_table.responsible_office_id   category  -> office
 *   offices.hotline                       office    -> number
 *
 * Those are the same rows the dispatcher queue routes reports with, so a
 * resident pressing S.O.S for a fire reaches whoever the routing table says
 * handles fire. Correcting a number, or moving a category to a different
 * agency, is an UPDATE — no code change and no redeploy.
 *
 * Everything here is a pure function over rows already fetched by getCategories()
 * and getOffices(). No network, no side effects.
 */

import { EMERGENCY_NUMBER, PANIC_CATEGORY } from "./constants.js";

/**
 * Order the picker presents emergencies in, most time-critical first.
 *
 * Categories not named here still appear — they sort to the end alphabetically —
 * so adding an emergency category to routing_table surfaces it in the S.O.S
 * picker without touching this file. This only decides what a frightened person
 * sees first.
 */
const PICKER_PRIORITY = [
  "medical",
  "fire",
  "accident",
  "crime",
  "flood",
  "gas_leak",
  "landslide",
  "coastal_hazard",
];

/**
 * Strip a printed hotline down to something `tel:` will dial.
 *
 * "(052) 480-6222" -> "0524806222". A leading + is kept for international form.
 */
export function toDialableNumber(hotline) {
  if (!hotline) return "";
  const raw = String(hotline).trim();
  const plus = raw.startsWith("+") ? "+" : "";
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? plus + digits : "";
}

function officeIdOf(category) {
  if (!category) return null;
  return category.office_id ?? category.responsible_office_id ?? null;
}

function categoryIdOf(category) {
  if (!category) return null;
  return category.id ?? category.category ?? null;
}

/**
 * The emergency types the S.O.S picker offers.
 *
 * Drawn straight from routing_table's `is_emergency` flag rather than a list
 * invented here, so the picker and the dispatcher queue can never disagree about
 * what counts as an emergency.
 *
 * The generic panic category is excluded from the main set — it is not a kind of
 * emergency a person would choose, it is what they get when they cannot choose.
 * Callers offer it separately as "Not sure".
 *
 * @param {Array} categories  Rows from getCategories()
 * @returns {Array} category rows, ordered for presentation
 */
export function listEmergencyCategories(categories) {
  const emergencies = (categories ?? []).filter(
    (c) => c?.is_emergency && categoryIdOf(c) !== PANIC_CATEGORY
  );

  return emergencies.sort((a, b) => {
    const ai = PICKER_PRIORITY.indexOf(categoryIdOf(a));
    const bi = PICKER_PRIORITY.indexOf(categoryIdOf(b));
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return String(a.name ?? a.label ?? "").localeCompare(String(b.name ?? b.label ?? ""));
  });
}

/**
 * Resolve a chosen emergency to the agency that answers it and the number to
 * dial.
 *
 * Falls back to the national emergency number at every step where the city's own
 * data is missing — an unrouted category, a deleted office, an office with no
 * hotline recorded. A resident in trouble must always end up connected to
 * somebody, so the failure direction is always "911", never "no number".
 *
 * @param {string} categoryId
 * @param {object} sources
 * @param {Array}  sources.categories  Rows from getCategories()
 * @param {Array}  sources.offices     Rows from getOffices()
 * @returns {{
 *   categoryId: string,
 *   categoryLabel: string,
 *   office: object|null,
 *   agencyName: string,
 *   hotline: string,
 *   dial: string,
 *   isFallback: boolean
 * }}
 */
export function resolveEmergencyRouting(categoryId, { categories = [], offices = [] } = {}) {
  const category = categories.find((c) => categoryIdOf(c) === categoryId) ?? null;
  const officeId = officeIdOf(category);
  const office = officeId ? offices.find((o) => o.id === officeId) ?? null : null;

  const hotline = office?.hotline ?? "";
  const dial = toDialableNumber(hotline);

  /* No route, no office, or no recorded number: hand them the national line
     rather than a dead button. */
  if (!dial) {
    return {
      categoryId,
      categoryLabel: category?.name ?? category?.label ?? "Emergency",
      office,
      agencyName: office?.short_name ?? "Legazpi 911",
      hotline: EMERGENCY_NUMBER,
      dial: EMERGENCY_NUMBER,
      isFallback: true,
    };
  }

  return {
    categoryId,
    categoryLabel: category?.name ?? category?.label ?? "Emergency",
    office,
    agencyName: office.short_name ?? office.full_name ?? "Legazpi 911",
    hotline,
    dial,
    isFallback: false,
  };
}

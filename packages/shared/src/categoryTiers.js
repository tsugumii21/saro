/**
 * Hazard tiers — how fast a category has to be answered.
 *
 * A leaf module on purpose. These lists are read by the data layer, by the maps
 * that size and colour pins, and by the jurisdiction rules in `scope.js`; if
 * they lived in the API module those consumers would have to import the whole
 * Supabase client to ask whether a pothole is an emergency, and `scope.js`
 * would form an import cycle with the module that calls it.
 *
 * Re-exported from `./api/index.js` so existing imports keep working.
 */

export const CRITICAL_CATEGORIES = [
  "fire",
  "gas_leak",
  "medical",
  "accident",
  "vehicular_crash",
  "coastal_hazard",
  "landslide",
  "crime",
];

export const URGENT_CATEGORIES = [
  "bridge_damage",
  "soil_erosion",
];

export function getCategoryTier(categoryOrRow) {
  const catKey = typeof categoryOrRow === "string"
    ? categoryOrRow
    : (categoryOrRow?.category || categoryOrRow?.id);

  if (!catKey) return "routine";
  if (CRITICAL_CATEGORIES.includes(catKey)) return "critical";
  if (URGENT_CATEGORIES.includes(catKey)) return "urgent";
  return "routine";
}

export function isEmergencyCategory(categoryOrRow) {
  const tier = getCategoryTier(categoryOrRow);
  return tier === "critical" || tier === "urgent";
}

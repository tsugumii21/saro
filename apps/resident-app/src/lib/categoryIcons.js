/**
 * One icon per report category.
 *
 * Lifted out of ReportFormScreen so the S.O.S emergency picker shows a category
 * with the same face the report form gives it. Two screens drawing the same
 * category with different icons is the kind of small inconsistency that makes an
 * interface feel untrustworthy in the moment it most needs to be trusted.
 *
 * Matching is by substring on the category id, so a new routing_table category
 * lands on a sensible icon without an edit here, and on AlertTriangle if nothing
 * matches.
 */

import {
  Waves, Mountain, Wind, Ambulance, Car, Flame, Wrench,
  ShieldAlert, Droplets, Anchor, AlertTriangle,
} from "lucide-react";

export function getCategoryIcon(categoryOrId) {
  const id = String(
    typeof categoryOrId === "string"
      ? categoryOrId
      : categoryOrId?.id ?? categoryOrId?.category ?? ""
  );

  if (id.includes("flood")) return Waves;
  if (id.includes("landslide")) return Mountain;
  if (id.includes("debris")) return Wind;
  if (id.includes("medical")) return Ambulance;
  if (id.includes("accident")) return Car;
  if (id.includes("fire") || id.includes("gas")) return Flame;
  if (id.includes("pothole") || id.includes("drain") || id.includes("bridge")) return Wrench;
  if (id.includes("crime") || id.includes("traffic")) return ShieldAlert;
  if (id.includes("water")) return Droplets;
  if (id.includes("coastal")) return Anchor;
  return AlertTriangle;
}

export default getCategoryIcon;

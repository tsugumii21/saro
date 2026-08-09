// @saro/ui — the shared component vocabulary.
//
// Admission rule: a component belongs here when both apps render it for the
// same purpose. What changed with the run-card system is that this is now
// most of the interface's atoms rather than just the logo — the status tab,
// the tracking code and the mark are the three things a resident and a
// dispatcher must recognise as the same object, which is exactly what stops
// the two apps reading as two products.
//
// Components that will diverge — landing pages, shells, queues, forms — still
// stay inside their owning app.

export { default as Logo, CARD_PATH, DOOR_PATH } from "./Logo.jsx";
export { default as Wordmark } from "./Wordmark.jsx";
export { default as StatusTag, STATUS_META, statusTab } from "./StatusTag.jsx";
export { default as TrackingCode } from "./TrackingCode.jsx";
export { default as HazardMap, HAZARD_LAYERS } from "./HazardMap.jsx";
export { default as AlertLevelBadge, ALERT_LEVELS } from "./AlertLevelBadge.jsx";
export { default as IncidentPinCard } from "./IncidentPinCard.jsx";

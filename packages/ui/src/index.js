// @saro/ui — visual components genuinely shared by resident-app and admin-app.
//
// Admission rule: a component only belongs here if both apps render it for the
// same purpose. Components that will diverge (landing pages, shells, queues,
// forms) stay inside their owning app.

export { default as Logo } from "./Logo.jsx";
export { default as Wordmark } from "./Wordmark.jsx";

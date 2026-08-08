/**
 * Turn backend failures into sentences a person can act on.
 *
 * Every error in this project travels as a string in the `{ data, error }`
 * envelope, and until now that string was whatever Postgres, PostgREST, GoTrue
 * or `fetch` happened to say. Which meant a resident whose report was rejected
 * saw:
 *
 *     new row violates row-level security policy for table "reports"
 *
 * That sentence is true, useless, and frightening. It names an internal table,
 * implies the person did something wrong, and offers no next step.
 *
 * WCAG 2.2 puts this under 3.3.1 Error Identification and 3.3.3 Error
 * Suggestion, but the plainer reason is that an error message is the only part
 * of a product a person reads when they are already having a bad time. It
 * should say what happened and what to do, in that order, and nothing else.
 *
 * Rules this file follows:
 *   - Never show a table name, a constraint name, an error code, or a stack.
 *   - Say what the person can do next, even when the answer is "wait".
 *   - Do not blame the user for something the system did.
 *   - Fall through to a calm generic rather than leaking an unmatched string.
 */

/**
 * Ordered because the first match wins, and some raw strings satisfy more than
 * one pattern. Network failures are checked before anything else: during a
 * typhoon that is what most of these will be, and a connection problem must
 * never be reported as a permission problem.
 */
const PATTERNS = [
  // ── Network ─────────────────────────────────────────────────────────────
  {
    match: /failed to fetch|networkerror|load failed|fetch failed|err_internet|net::/i,
    message:
      "No connection right now. Your work is saved on this device and will send by itself when signal returns.",
  },
  {
    match: /timeout|timed out|aborted|canceling statement/i,
    message: "That took too long to respond. Please try again in a moment.",
  },

  // ── Authorization ───────────────────────────────────────────────────────
  //
  // RLS denial is deliberately NOT phrased as "you don't have permission" for
  // residents, because the most common cause is a signed-out session rather
  // than a real authorization failure, and telling somebody they are forbidden
  // when they merely need to sign in sends them to the wrong fix.
  {
    match: /row-level security|violates row-level security policy/i,
    message:
      "This account can't make that change. If you should be able to, ask the city administrator to check your role.",
  },
  {
    match: /permission denied|insufficient privilege|42501/i,
    message: "This account can't do that. Ask the city administrator if you need access.",
  },
  {
    match: /jwt expired|token is expired|invalid token|refresh_token_not_found/i,
    message: "Your session has expired. Please sign in again — nothing you typed is lost.",
  },
  {
    match: /invalid login credentials/i,
    message: "Email or password is incorrect.",
  },
  {
    match: /email not confirmed/i,
    message:
      "This email hasn't been confirmed yet. Check your inbox for the confirmation link, including spam.",
  },
  {
    match: /user already registered|already been registered/i,
    message: "There is already an account with this email. Try signing in instead.",
  },

  // ── Data ────────────────────────────────────────────────────────────────
  {
    match: /duplicate key value|already exists|unique constraint/i,
    message: "That already exists. Check the list before adding it again.",
  },
  {
    match: /violates foreign key|is not present in table/i,
    message: "Something this depends on is missing. Refresh the page and try again.",
  },
  {
    match: /violates check constraint|invalid input (value )?for enum/i,
    message: "Some of those values aren't allowed together. Check the form and try again.",
  },
  {
    match: /PGRST116|no rows returned|multiple \(or no\) rows/i,
    message: "That record isn't available to you, or no longer exists.",
  },
  {
    match: /payload too large|exceeded the maximum allowed size|413/i,
    message: "That file is too large. Photos must be under 10 MB.",
  },

  // ── Rate limits and upstream ────────────────────────────────────────────
  {
    match: /too many requests|rate limit|429/i,
    message: "Too many attempts just now. Wait a minute and try again.",
  },
  {
    match: /temporarily unavailable|502|503|edge function|non-2xx/i,
    message: "That service is temporarily unavailable. Your report and your account are fine.",
  },
];

/**
 * @param {string|Error|null|undefined} error
 * @param {string} [fallback] Shown when nothing matches. Keep it specific to
 *                            the calling screen where you can.
 * @returns {string}
 */
export function humanizeError(error, fallback = "Something went wrong. Please try again.") {
  if (!error) return fallback;

  const raw = typeof error === "string" ? error : error.message ?? String(error);
  if (!raw.trim()) return fallback;

  for (const { match, message } of PATTERNS) {
    if (match.test(raw)) return message;
  }

  // An unmatched string is very likely one of ours — the API layer writes
  // sentences like "A resolution photo is required before this report can be
  // resolved." Those are already the right thing to show. But anything that
  // still smells like machine output is swallowed rather than displayed:
  // better a vague apology than a constraint name.
  const looksTechnical =
    /^[A-Z]{2,}\d|_[a-z]+_|::|\bpg_|\brelation\b|\bcolumn\b|\bschema\b|^\{|\[object/i.test(raw);

  return looksTechnical ? fallback : raw;
}

/**
 * Same idea for a thrown exception, so a `catch` block has one obvious thing
 * to call and nobody is tempted to render `err.message` directly.
 */
export function humanizeThrown(err, fallback) {
  return humanizeError(err instanceof Error ? err.message : err, fallback);
}

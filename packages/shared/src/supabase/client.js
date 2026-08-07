// The single Supabase browser client for both apps.
//
// Configured from Vite env vars that are safe to ship to the browser:
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_PUBLISHABLE_KEY
//
// The publishable key is public by design — it identifies the project and
// nothing else. Every actual permission decision is made by Row Level Security
// in Postgres. The secret key must NEVER appear here or in any VITE_ variable;
// it bypasses RLS entirely and anything prefixed VITE_ is compiled into the
// JavaScript bundle that browsers download.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  // Loud on purpose. A missing key produces confusing 401s deep inside
  // unrelated queries otherwise.
  console.error(
    "[SARO] VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set. " +
      "Copy .env.example to .env.local and fill them in."
  );
}

// Guard against a secret key being pasted into the publishable slot.
if (SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_secret_")) {
  throw new Error(
    "[SARO] A Supabase SECRET key was placed in VITE_SUPABASE_PUBLISHABLE_KEY. " +
      "That key bypasses all Row Level Security and would be shipped to every " +
      "browser. Refusing to start. Rotate it in the Supabase dashboard now."
  );
}

export const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_PUBLISHABLE_KEY ?? "", {
  auth: {
    // Residents are never signed in; staff sessions persist across reloads.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 5 },
  },
});

/** Storage bucket holding report photos. Private — reads need a signed URL. */
export const REPORT_PHOTO_BUCKET = "report-photos";

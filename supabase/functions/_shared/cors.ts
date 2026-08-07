// Shared CORS handling for SARO Edge Functions.
//
// Both apps are browser clients on their own Vercel domains, so every function
// needs a preflight answer and an echoed origin.
//
// ALLOWED_ORIGINS is a Supabase secret holding a comma-separated list, e.g.
//   supabase secrets set ALLOWED_ORIGINS="https://saro.vercel.app,https://saro-ops.vercel.app"
// Unset means "development": localhost only.

const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
];

function allowedOrigins(): string[] {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  if (!configured) return DEV_ORIGINS;
  return configured.split(",").map((o) => o.trim()).filter(Boolean).concat(DEV_ORIGINS);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = allowedOrigins();
  const permitted = allowed.includes(origin);

  return {
    // Echo the origin rather than using "*": the resident app sends an apikey
    // header, and a wildcard cannot be combined with credentialed requests.
    "Access-Control-Allow-Origin": permitted ? origin : allowed[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function handlePreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

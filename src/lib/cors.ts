/**
 * CORS helpers for the public API surface.
 *
 * The waitlist/lead endpoints are called from the separate Aplyer frontend
 * project, so we echo back only known-good origins instead of a blanket "*".
 * Requests without an Origin header (server-to-server, curl) are unaffected.
 */

const ALLOWED_ORIGINS = new Set([
  "https://aplyer.ai",
  "https://www.aplyer.ai",
  "https://aplyer.lovable.app",
  "https://aplyer.devssh.xyz",
  "https://aplyer.assuredtechno.com",
  "http://localhost:8080",
  "http://localhost:5173",
]);

/** Lovable preview/sandbox hosts used for QA. */
const ALLOWED_ORIGIN_PATTERNS = [/^https:\/\/[a-z0-9-]+\.lovable\.app$/i, /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/i];

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

export function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get("origin") ?? null;
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin! : "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Legacy static headers (no credentials, wildcard origin). */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

export function jsonWithCors(body: unknown, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

export function preflight(request?: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

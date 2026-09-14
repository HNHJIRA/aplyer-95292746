/**
 * Waitlist queue runner — called on a schedule (pg_cron) so queued follow-up
 * work (Brevo contact sync, welcome email) is always processed, even when the
 * serverless runtime tears down before post-response work can finish.
 *
 * Caller is verified with a shared secret header; no PII is returned.
 */
import { createFileRoute } from "@tanstack/react-router";
import { drainWaitlistJobs } from "@/lib/waitlist/jobs.server";

function authorized(request: Request): boolean {
  const expected = process.env.WAITLIST_DRAIN_KEY ?? process.env.WAITLIST_DRAIN_SECRET;
  if (!expected) return false;
  const url = new URL(request.url);
  const provided =
    request.headers.get("x-drain-secret") ?? url.searchParams.get("secret") ?? "";
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function handle(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await drainWaitlistJobs(25);
  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/waitlist-drain")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

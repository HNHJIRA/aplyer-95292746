/**
 * Waitlist queue runner — called on a schedule (pg_cron) so queued follow-up
 * work (Brevo contact sync, welcome email) is always processed, even when the
 * serverless runtime tears down before post-response work can finish.
 *
 * Caller is verified with a shared secret header; no PII is returned.
 */
import { createFileRoute } from "@tanstack/react-router";
import { drainWaitlistJobs } from "@/lib/waitlist/jobs.server";
import { drainDemoQueue } from "@/lib/demo/queue.server";
import { generateChatgptDemoAnswer } from "@/lib/demo/openai.server";
import { dbDemoStore } from "@/lib/demo/store.server";
import { generateAplyerDemoAnswer } from "@/lib/demo/generate.server";
import { sendDemoResultEmail } from "@/lib/demo/result-email.server";

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
  // Same schedule also drains held demo requests (cap/limit/unconfigured).
  const demo = await drainDemoQueue({
    store: dbDemoStore,
    generate: generateAplyerDemoAnswer,
    generateChatgpt: generateChatgptDemoAnswer,
    sendResult: sendDemoResultEmail,
  });
  return new Response(JSON.stringify({ ok: true, ...result, demo }), {
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

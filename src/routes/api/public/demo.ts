// Public demo answer endpoint, wrapped in server-side cost controls
// (email gate, per-email/session/IP limits, hard daily cap, idempotency,
// durable queue). The generation itself is unchanged in Step 1.
import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/lib/cors";
import { handleDemoRequest } from "@/lib/demo/handler.server";
import { generateLegacyDemoAnswer } from "@/lib/demo/generate.server";
import { dbDemoStore } from "@/lib/demo/store.server";

export { wantsStream } from "@/lib/demo/handler.server";

async function zeroBounceAllows(email: string): Promise<boolean> {
  const key = process.env.ZEROBOUNCE_API_KEY;
  if (!key) return true;
  try {
    const res = await fetch(
      `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return true;
    const zb = (await res.json()) as { status?: string };
    return !(zb.status === "invalid" || zb.status === "spamtrap" || zb.status === "abuse");
  } catch {
    return true; // best-effort, same rule as waitlist signup
  }
}

export const Route = createFileRoute("/api/public/demo")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) =>
        handleDemoRequest(request, {
          store: dbDemoStore,
          generate: generateLegacyDemoAnswer,
          salt: process.env.DEMO_HASH_SALT,
          checkEmail: zeroBounceAllows,
        }),
    },
  },
});

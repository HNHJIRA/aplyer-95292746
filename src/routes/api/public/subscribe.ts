import { createFileRoute } from "@tanstack/react-router";
import { jsonWithCors, preflight } from "@/lib/cors";
import { waitUntil } from "@/lib/runtime/wait-until.server";
import { drainWaitlistJobs, enqueueWaitlistJobs } from "@/lib/waitlist/jobs.server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function readSubscribeBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    const json = await request.json().catch(() => ({}));
    return json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("text/plain")
  ) {
    const text = await request.text().catch(() => "");
    if (!text.trim()) return {};
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON — parse as URL-encoded below.
    }
    return Object.fromEntries(new URLSearchParams(text));
  }

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    return form ? Object.fromEntries(form.entries()) : {};
  }

  const fallbackText = await request.text().catch(() => "");
  if (!fallbackText.trim()) return {};
  try {
    const parsed = JSON.parse(fallbackText) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(fallbackText));
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Critical path = validate + persist the waitlist row. Everything else
 * (Brevo contact sync, welcome email) is durable background work, so the user
 * gets their confirmation as soon as the signup is actually stored.
 */
export async function handleSubscribe(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const t0 = Date.now();
  const mark = (stage: string, from: number) =>
    console.log(`[subscribe] rid=${requestId} stage=${stage} ms=${Date.now() - from}`);

  try {
    const body = await readSubscribeBody(request);
    const email = firstString(
      body.email,
      body.emailAddress,
      body.email_address,
      body.userEmail,
      body["fields[email]"],
    ).toLowerCase();
    const source = firstString(body.source, body.page, body.origin).slice(0, 64) || null;
    const firstName =
      firstString(body.firstName, body.first_name, body.fname, body.name, body.fullName).slice(
        0,
        60,
      ) || null;

    if (!EMAIL_RE.test(email) || email.length > 254) {
      mark("validate_rejected", t0);
      return jsonWithCors({ error: "Please enter a valid email address." }, 400, request);
    }

    // ZeroBounce validation (best-effort; only reject on definitive "invalid").
    const tValidate = Date.now();
    const zbKey = process.env.ZEROBOUNCE_API_KEY;
    if (zbKey) {
      try {
        const zbUrl = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(
          zbKey,
        )}&email=${encodeURIComponent(email)}`;
        const zbRes = await fetch(zbUrl, { signal: AbortSignal.timeout(3000) });
        if (zbRes.ok) {
          const zb = (await zbRes.json()) as { status?: string; sub_status?: string };
          if (zb.status === "invalid" || zb.status === "spamtrap" || zb.status === "abuse") {
            mark("validate_rejected", t0);
            return jsonWithCors({ error: "This email address appears to be invalid." }, 400, request);
          }
        } else {
          console.warn(`[subscribe] rid=${requestId} zerobounce non-ok http=${zbRes.status}`);
        }
      } catch {
        console.warn(`[subscribe] rid=${requestId} zerobounce unavailable (allowing through)`);
      }
    }
    mark("validate", tValidate);

    // Required operation — the only thing a success response depends on.
    // Stores the signup AND queues its follow-up work in one transaction.
    const tDb = Date.now();
    try {
      await recordWaitlistSignup({ email, firstName, source });
    } catch (e) {
      console.error(
        `[subscribe] rid=${requestId} db_write_failed code=${e instanceof Error ? e.message : "unknown"}`,
      );
      return jsonWithCors({ error: "Something went wrong. Please try again." }, 500, request);
    }
    mark("db_write", tDb);

    // Secondary operations run after the response is flushed; anything that
    // fails stays queued and is retried on a later request.
    waitUntil(() => drainWaitlistJobs(10), "waitlist-jobs-drain");

    console.log(`[subscribe] rid=${requestId} stage=total ms=${Date.now() - t0} ok=1`);
    return jsonWithCors({ ok: true }, 200, request);
  } catch (err) {
    console.error(`[subscribe] rid=${requestId} error`, err);
    return jsonWithCors({ error: "Something went wrong. Please try again." }, 500, request);
  }
}

export const Route = createFileRoute("/api/public/subscribe")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => handleSubscribe(request),
    },
  },
});

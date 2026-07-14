import { createFileRoute } from "@tanstack/react-router";
import { jsonWithCors, preflight } from "@/lib/cors";

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

export const Route = createFileRoute("/api/public/subscribe")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
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

          if (!EMAIL_RE.test(email) || email.length > 254) {
            return jsonWithCors({ error: "Please enter a valid email address." }, 400);
          }

          // ZeroBounce validation (best-effort; only reject on definitive "invalid")
          const zbKey = process.env.ZEROBOUNCE_API_KEY;
          if (zbKey) {
            try {
              const zbUrl = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(
                zbKey,
              )}&email=${encodeURIComponent(email)}`;
              const zbRes = await fetch(zbUrl, { signal: AbortSignal.timeout(5000) });
              if (zbRes.ok) {
                const zb = (await zbRes.json()) as { status?: string; sub_status?: string };
                if (zb.status === "invalid" || zb.status === "spamtrap" || zb.status === "abuse") {
                  return jsonWithCors(
                    { error: "This email address appears to be invalid." },
                    400,
                  );
                }
              } else {
                console.warn("[subscribe] zerobounce non-ok", zbRes.status);
              }
            } catch (e) {
              console.warn("[subscribe] zerobounce error (allowing through)", e);
            }
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin
            .from("waitlist_subscribers")
            .upsert({ email, source }, { onConflict: "email,source", ignoreDuplicates: true });

          if (error) {
            console.error("[subscribe]", error);
            return jsonWithCors({ error: "Something went wrong. Please try again." }, 500);
          }

          return jsonWithCors({ ok: true });
        } catch (err) {
          console.error("[subscribe]", err);
          return jsonWithCors({ error: "Something went wrong. Please try again." }, 500);
        }
      },
    },
  },
});

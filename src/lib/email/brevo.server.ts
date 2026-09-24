/**
 * Welcome-email dispatch — SERVER ONLY. (File name kept for import stability;
 * delivery now uses Postmark. Brevo is still used for the waitlist contact list.)
 *
 * The API key is read from process.env inside the function body so it can
 * never be inlined into a client bundle. Nothing here is exported to the
 * browser or the Chrome extension.
 */
import {
  WELCOME_SENDER,
  WELCOME_SUBJECT,
  buildWelcomeEmailHtml,
  buildWelcomeEmailText,
} from "./welcome-email";

import { fromHeader, postmarkConfigured, sendPostmarkEmail } from "./postmark.server";

export interface SendResult {
  ok: boolean;
  /** 'sent' | 'skipped' (already sent / no key) | 'failed' */
  status: "sent" | "skipped" | "failed";
  messageId?: string;
  errorCode?: string;
  httpStatus?: number;
  provider?: "postmark" | "brevo";
}

/**
 * Low-level send. Never throws; always resolves with a safe result object.
 * Delivery goes through Postmark (client Addendum 8). Content, subject and
 * sender are unchanged. With no POSTMARK_SERVER_TOKEN this is `skipped`.
 */
export async function sendWelcomeEmail(input: {
  email: string;
  firstName?: string | null;
  correlationId?: string;
}): Promise<SendResult> {
  // Transitional: until POSTMARK_SERVER_TOKEN is configured, keep the
  // existing Brevo delivery so live welcome emails are not silently lost.
  if (!postmarkConfigured()) {
    const b = await sendViaBrevo(input);
    console.log(`[welcome-email] provider=brevo status=${b.status}${b.errorCode ? ` code=${b.errorCode}` : ""} cid=${input.correlationId ?? "-"}`);
    return { ...b, provider: "brevo" };
  }
  const r = await sendPostmarkEmail({
    from: fromHeader(WELCOME_SENDER),
    to: input.email,
    replyTo: WELCOME_SENDER.email,
    subject: WELCOME_SUBJECT,
    html: buildWelcomeEmailHtml(input.firstName),
    text: buildWelcomeEmailText(input.firstName),
    tag: "waitlist-welcome",
  });
  console.log(
    `[welcome-email] provider=postmark status=${r.status}${r.errorCode ? ` code=${r.errorCode}` : ""} cid=${input.correlationId ?? "-"}`,
  );
  return { ...r, provider: "postmark" };
}

/** The previous Brevo transactional send, unchanged; fallback only. */
async function sendViaBrevo(input: { email: string; firstName?: string | null }): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, status: "skipped", errorCode: "missing_api_key" };
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        sender: WELCOME_SENDER,
        to: [{ email: input.email }],
        subject: WELCOME_SUBJECT,
        htmlContent: buildWelcomeEmailHtml(input.firstName),
        textContent: buildWelcomeEmailText(input.firstName),
        tags: ["waitlist-welcome"],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, status: "failed", errorCode: `http_${res.status}`, httpStatus: res.status };
    const json = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { ok: true, status: "sent", messageId: json.messageId, httpStatus: res.status };
  } catch (e) {
    return { ok: false, status: "failed", errorCode: e instanceof Error ? e.name : "unknown_error" };
  }
}

/**
 * Idempotent welcome-email dispatch.
 *
 * Uses `public.welcome_email_events` (unique on email) as the send ledger:
 * a row with status='sent' means the founding-member email already went out
 * and must not be sent again, no matter which lead magnet the user submits
 * next. Always fail-soft: signup must never depend on this.
 */
export async function sendWelcomeEmailOnce(input: {
  email: string;
  firstName?: string | null;
  source?: string | null;
  force?: boolean;
}): Promise<SendResult> {
  const correlationId = crypto.randomUUID();
  const email = input.email.toLowerCase();

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!input.force) {
      const { data: existing } = await supabaseAdmin
        .from("welcome_email_events")
        .select("id, status, attempts")
        .eq("email", email)
        .maybeSingle();

      if (existing?.status === "sent") {
        return { ok: true, status: "skipped", errorCode: "already_sent" };
      }
    }

    // Claim the attempt before sending so concurrent double-submits collapse.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("welcome_email_events")
      .upsert(
        {
          email,
          first_name: input.firstName ?? null,
          source: input.source ?? null,
          status: "attempted",
          attempted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "email", ignoreDuplicates: false },
      )
      .select("id, attempts, status")
      .maybeSingle();

    if (claimError) {
      console.warn(`[welcome-email] ledger claim failed code=${claimError.code ?? "unknown"}`);
    }

    const result = await sendWelcomeEmail({ email, firstName: input.firstName, correlationId });

    await supabaseAdmin
      .from("welcome_email_events")
      .update({
        status: result.status,
        provider: result.provider ?? "postmark",
        provider_message_id: result.messageId ?? null,
        error_code: result.errorCode ?? null,
        attempts: (claimed?.attempts ?? 0) + 1,
        sent_at: result.ok ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("email", email);

    return result;
  } catch (e) {
    console.warn(
      `[welcome-email] dispatch error code=${e instanceof Error ? e.name : "unknown"} cid=${correlationId}`,
    );
    return { ok: false, status: "failed", errorCode: "dispatch_error" };
  }
}

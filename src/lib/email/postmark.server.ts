/**
 * Postmark transactional transport — SERVER ONLY (client Addendum 8).
 *
 * Endpoint and header are Postmark's documented Send Email API, as given in
 * the addendum. The token is read from process.env inside the call so it can
 * never reach a client bundle. With no token the transport is disabled and
 * reports `skipped` — it never pretends an email was delivered.
 * Tracking is not requested (open/link tracking stay off per the addendum).
 */

export const POSTMARK_ENDPOINT = "https://api.postmarkapp.com/email";
export const POSTMARK_TOKEN_ENV = "POSTMARK_SERVER_TOKEN";

export interface PostmarkMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  tag?: string;
}

export interface PostmarkResult {
  ok: boolean;
  status: "sent" | "skipped" | "failed";
  messageId?: string;
  errorCode?: string;
  httpStatus?: number;
}

export function postmarkConfigured(): boolean {
  return Boolean(process.env[POSTMARK_TOKEN_ENV]);
}

/** Never throws. Never logs recipients, bodies or the token. */
export async function sendPostmarkEmail(
  msg: PostmarkMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<PostmarkResult> {
  const token = process.env[POSTMARK_TOKEN_ENV];
  if (!token) return { ok: false, status: "skipped", errorCode: "missing_postmark_token" };
  try {
    const res = await fetchImpl(POSTMARK_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify({
        From: msg.from,
        To: msg.to,
        ...(msg.replyTo ? { ReplyTo: msg.replyTo } : {}),
        Subject: msg.subject,
        HtmlBody: msg.html,
        TextBody: msg.text,
        ...(msg.tag ? { Tag: msg.tag } : {}),
        MessageStream: "outbound",
      }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json().catch(() => ({}))) as { MessageID?: string; ErrorCode?: number };
    if (!res.ok || (typeof json.ErrorCode === "number" && json.ErrorCode !== 0)) {
      const code = typeof json.ErrorCode === "number" ? `postmark_${json.ErrorCode}` : `http_${res.status}`;
      return { ok: false, status: "failed", errorCode: code, httpStatus: res.status };
    }
    return { ok: true, status: "sent", messageId: json.MessageID, httpStatus: res.status };
  } catch (e) {
    return { ok: false, status: "failed", errorCode: e instanceof Error ? e.name : "unknown_error" };
  }
}

/** "Name <email>" From header from the existing sender object. */
export function fromHeader(sender: { name: string; email: string }): string {
  return `${sender.name} <${sender.email}>`;
}

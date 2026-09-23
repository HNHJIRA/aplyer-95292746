/**
 * Delivers a queued demo result by email (Brevo transport) — SERVER ONLY.
 * Plain wording; final copy is a client decision.
 */
import { WELCOME_SENDER } from "@/lib/email/welcome-email";
import type { DemoInput } from "./generate.server";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function sendDemoResultEmail(
  to: string,
  input: DemoInput,
  answer: string,
): Promise<{ ok: boolean; errorCode?: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, errorCode: "missing_api_key" };
  const subject = "Your Aplyer demo answer";
  const text = `Here is the answer you requested in the Aplyer demo.\n\nQuestion:\n${input.question}\n\nAnswer:\n${answer}\n`;
  const html = `<p>Here is the answer you requested in the Aplyer demo.</p><p><strong>Question</strong><br>${esc(input.question)}</p>${answer
    .split(/\n\n+/)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join("")}`;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        sender: WELCOME_SENDER,
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        tags: ["demo-result"],
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? { ok: true } : { ok: false, errorCode: `http_${res.status}` };
  } catch (e) {
    return { ok: false, errorCode: e instanceof Error ? e.name : "unknown" };
  }
}

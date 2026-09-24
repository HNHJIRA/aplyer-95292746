/**
 * Delivers a queued demo result by email (Postmark transport) — SERVER ONLY.
 * Plain wording; final copy is a client decision.
 */
import { WELCOME_SENDER } from "@/lib/email/welcome-email";
import { fromHeader, sendPostmarkEmail } from "@/lib/email/postmark.server";
import type { DemoInput } from "./generate.server";
import type { ChatgptView } from "./handler.server";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function sendDemoResultEmail(
  to: string,
  input: DemoInput,
  answer: string,
  chatgpt?: ChatgptView | null,
): Promise<{ ok: boolean; errorCode?: string }> {
  const subject = "Your Aplyer demo answer";
  // Two-sided result: the ChatGPT answer is appended only when it completed.
  const gpt = chatgpt?.status === "completed" && chatgpt.answer ? chatgpt.answer : null;
  const text =
    `Here is the answer you requested in the Aplyer demo.\n\nQuestion:\n${input.question}\n\nAnswer:\n${answer}\n` +
    (gpt ? `\nChatGPT:\n${gpt}\n` : "");
  const html = `<p>Here is the answer you requested in the Aplyer demo.</p><p><strong>Question</strong><br>${esc(input.question)}</p>${answer
    .split(/\n\n+/)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join("")}${
    gpt
      ? `<p><strong>ChatGPT</strong></p>${gpt
          .split(/\n\n+/)
          .map((p) => `<p>${esc(p.trim())}</p>`)
          .join("")}`
      : ""
  }`;
  // Missing token => not delivered (never faked); the queue keeps its
  // existing retry path and delivers once POSTMARK_SERVER_TOKEN exists.
  const r = await sendPostmarkEmail({
    from: fromHeader(WELCOME_SENDER),
    to,
    replyTo: WELCOME_SENDER.email,
    subject,
    html,
    text,
    tag: "demo-result",
  });
  return r.ok ? { ok: true } : { ok: false, errorCode: r.errorCode };
}

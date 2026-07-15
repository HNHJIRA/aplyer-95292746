import { createFileRoute } from "@tanstack/react-router";
import { jsonWithCors, preflight } from "@/lib/cors";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-5";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const Route = createFileRoute("/api/public/demo")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const resume = str(body.resume);
          const jobDescription = str(body.jobDescription);
          const question = str(body.question);

          if (!resume || !jobDescription || !question) {
            return jsonWithCors(
              { error: "resume, jobDescription, and question are all required." },
              400,
            );
          }

          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            console.error("[demo] Missing ANTHROPIC_API_KEY");
            return jsonWithCors({ error: "Server misconfigured." }, 500);
          }

          const capResume = resume.slice(0, 20000);
          const capJd = jobDescription.slice(0, 20000);
          const capQ = question.slice(0, 2000);

          const system =
            "You are an expert job-application writer. Write answers in the candidate's natural voice using real experience from their resume, weaving in relevant keywords from the job description. Keep it human, specific, and low AI-signature. Return only the answer text — no preamble, no markdown, no headings.";

          const user = `Resume:\n"""\n${capResume}\n"""\n\nJob Description:\n"""\n${capJd}\n"""\n\nQuestion:\n${capQ}\n\nWrite a 2–4 paragraph answer to the question. Separate paragraphs with a blank line. Return only the answer text.`;

          const res = await fetch(ANTHROPIC_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: CLAUDE_MODEL,
              max_tokens: 1500,
              system,
              messages: [{ role: "user", content: user }],
            }),
          });

          if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.error("[demo] anthropic error", res.status, text.slice(0, 500));
            if (res.status === 429 || res.status === 529) {
              return jsonWithCors(
                { error: "The demo is busy. Please try again in a moment." },
                503,
              );
            }
            return jsonWithCors({ error: "Something went wrong. Please try again." }, 500);
          }

          const data = (await res.json()) as {
            content?: Array<{ type: string; text?: string }>;
          };
          const answer = data.content?.find((c) => c.type === "text")?.text?.trim();
          if (!answer) {
            return jsonWithCors({ error: "Empty response from model." }, 500);
          }

          return jsonWithCors({ answer });
        } catch (err) {
          console.error("[demo]", err);
          return jsonWithCors({ error: "Something went wrong. Please try again." }, 500);
        }
      },
    },
  },
});

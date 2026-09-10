// Public demo answer endpoint.
//
// The provider request is always made in streaming mode. Delivery is chosen by
// the caller: `?stream=1` / `Accept: text/event-stream` gets SSE text chunks,
// anything else gets the original `{ answer }` JSON shape (backward compatible).
import { createFileRoute } from "@tanstack/react-router";
import { corsHeaders, jsonWithCors, preflight } from "@/lib/cors";
import { consumeAnthropicStream, sseFrame, sseHeaders } from "@/lib/ai/anthropic-stream.server";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-5";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Streaming is opt-in; the default response stays the original JSON shape. */
export function wantsStream(request: Request): boolean {
  try {
    if (new URL(request.url).searchParams.get("stream") === "1") return true;
  } catch {
    /* relative URLs in tests */
  }
  return (request.headers.get("accept") ?? "").includes("text/event-stream");
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
              stream: true,
            }),
          });

          if (!res.ok || !res.body) {
            const text = await res.text().catch(() => "");
            console.error("[demo] anthropic error", res.status, text.slice(0, 500));
            if (res.status === 429 || res.status === 529) {
              return jsonWithCors(
                { error: "The demo is busy. Please try again in a moment." },
                503,
                request,
              );
            }
            return jsonWithCors({ error: "Something went wrong. Please try again." }, 500, request);
          }

          const providerBody = res.body;

          if (wantsStream(request)) {
            const encoder = new TextEncoder();
            const out = new ReadableStream<Uint8Array>({
              start(controller) {
                let closed = false;
                const send = (event: string, data: unknown) => {
                  if (closed) return;
                  try {
                    controller.enqueue(encoder.encode(sseFrame(event, data)));
                  } catch {
                    closed = true;
                  }
                };
                void (async () => {
                  try {
                    const result = await consumeAnthropicStream(providerBody, (text) =>
                      send("delta", { text }),
                    );
                    if (result.sawError || !result.text.trim()) {
                      send("error", { error: "Something went wrong. Please try again." });
                    }
                  } catch (streamErr) {
                    console.error("[demo] stream interrupted", streamErr);
                    send("error", { error: "The answer stopped early. Please try again." });
                  } finally {
                    send("done", { ok: true });
                    closed = true;
                    try {
                      controller.close();
                    } catch {
                      /* client already disconnected */
                    }
                  }
                })();
              },
            });
            return new Response(out, { status: 200, headers: sseHeaders(corsHeaders(request)) });
          }

          const collected = await consumeAnthropicStream(providerBody);
          const answer = collected.text.trim();
          if (!answer || collected.sawError) {
            return jsonWithCors({ error: "Empty response from model." }, 500, request);
          }

          return jsonWithCors({ answer }, 200, request);
        } catch (err) {
          console.error("[demo]", err);
          return jsonWithCors({ error: "Something went wrong. Please try again." }, 500);
        }
      },
    },
  },
});

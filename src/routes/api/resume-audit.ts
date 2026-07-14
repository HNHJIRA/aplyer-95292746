import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, jsonWithCors, preflight } from "@/lib/cors";
import { aiJson } from "@/lib/ai.server";

interface RedFlag {
  issue: string;
  why: string;
  fix: string;
}
interface Audit {
  verdict: string;
  redFlags: RedFlag[];
  strengths: string[];
  closing: string;
}

const SYSTEM = `You are a senior technical recruiter doing a 7-second red-flag scan of a resume.
Return STRICT JSON matching this TypeScript type, no prose, no markdown:
{
  "verdict": string,             // one-sentence overall verdict
  "redFlags": Array<{ "issue": string, "why": string, "fix": string }>, // 3-6 items, specific and actionable
  "strengths": string[],         // 3-5 short bullets
  "closing": string              // one encouraging paragraph
}
Be specific. Reference concrete phrases or patterns from the resume. Never invent employers or dates.`;

export const Route = createFileRoute("/api/resume-audit")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as { resume?: unknown };
          const resume = typeof body.resume === "string" ? body.resume.trim() : "";
          if (resume.length < 100) {
            return jsonWithCors({ error: "Resume text is too short." }, 400);
          }
          const capped = resume.length > 20000 ? resume.slice(0, 20000) : resume;

          const audit = await aiJson<Audit>({
            system: SYSTEM,
            user: `Resume:\n\n${capped}`,
          });

          return new Response(JSON.stringify(audit), {
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        } catch (err) {
          console.error("[resume-audit]", err);
          const msg = err instanceof Error ? err.message : "Unknown error";
          const status = /429|rate/i.test(msg) ? 429 : /402|payment/i.test(msg) ? 402 : 500;
          return jsonWithCors({ error: "Something went wrong. Please try again." }, status);
        }
      },
    },
  },
});

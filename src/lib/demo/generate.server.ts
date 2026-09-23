/**
 * Current demo generation (unchanged behaviour, one Claude call) — SERVER ONLY.
 * Extracted from the route so cost controls can wrap it. Step 1 does not
 * change the prompt, model or output.
 */
import { consumeAnthropicStream } from "@/lib/ai/anthropic-stream.server";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const DEMO_LEGACY_PROVIDER = "anthropic";
export const DEMO_LEGACY_MODEL = "claude-sonnet-4-5";
export const DEMO_LEGACY_OPERATION = "demo_answer_legacy";

export interface DemoInput {
  resume: string;
  jobDescription: string;
  question: string;
}

export interface DemoGenerationResult {
  text: string;
  side: "openai" | "aplyer";
  provider: string;
  model: string;
  operation: string;
  usage: { inputTokens?: number; outputTokens?: number };
}

export class DemoGenerationError extends Error {
  constructor(
    public code: string,
    public busy = false,
  ) {
    super(code);
  }
}

export type DemoGenerator = (
  input: DemoInput,
  onDelta?: (text: string) => void,
) => Promise<DemoGenerationResult>;

export const generateLegacyDemoAnswer: DemoGenerator = async (input, onDelta) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new DemoGenerationError("missing_key");

  const capResume = input.resume.slice(0, 20000);
  const capJd = input.jobDescription.slice(0, 20000);
  const capQ = input.question.slice(0, 2000);

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
      model: DEMO_LEGACY_MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    console.error("[demo] provider error", res.status, text.slice(0, 300));
    throw new DemoGenerationError(`http_${res.status}`, res.status === 429 || res.status === 529);
  }

  const result = await consumeAnthropicStream(res.body, onDelta);
  const text = result.text.trim();
  if (!text || result.sawError) throw new DemoGenerationError("empty_or_error");
  return {
    text,
    side: "aplyer",
    provider: DEMO_LEGACY_PROVIDER,
    model: DEMO_LEGACY_MODEL,
    operation: DEMO_LEGACY_OPERATION,
    usage: result.usage,
  };
};

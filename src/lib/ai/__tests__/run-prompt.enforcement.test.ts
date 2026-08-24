import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptError, runPromptValidated } from "@/lib/ai/run-prompt.server";
import { PROMPT_I_CLASSIFICATION, validateClassification } from "@/lib/ai/prompts";
import { CLASSIFICATION_RETRY_INSTRUCTION } from "@/lib/ai/prompts/prompt-i-classification";

const okBody = (obj: unknown) =>
  new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(obj) }] }), { status: 200 });

const bodies: Response[] = [];
let calls: Array<{ model: string; user: string }> = [];

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  calls = [];
  bodies.length = 0;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const parsed = JSON.parse(String(init.body)) as {
      model: string;
      messages: Array<{ content: string }>;
    };
    calls.push({ model: parsed.model, user: parsed.messages[0].content });
    const next = bodies.shift();
    if (!next) throw new Error("no queued response");
    return next;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("model enforcement", () => {
  it("always calls the model pinned on the spec", async () => {
    bodies.push(okBody({ framework: "STAR", reason: "past experience" }));
    const { value } = await runPromptValidated(
      PROMPT_I_CLASSIFICATION,
      "Tell me about a time you led a project.",
      validateClassification,
      CLASSIFICATION_RETRY_INSTRUCTION,
    );
    expect(value.framework).toBe("STAR");
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(PROMPT_I_CLASSIFICATION.model);
  });

  it("raises a controlled model_unavailable error with no fallback model", async () => {
    bodies.push(new Response(JSON.stringify({ error: { type: "not_found_error" } }), { status: 404 }));
    const err = await runPromptValidated(
      PROMPT_I_CLASSIFICATION,
      "q",
      validateClassification,
      CLASSIFICATION_RETRY_INSTRUCTION,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(PromptError);
    expect((err as PromptError).code).toBe("model_unavailable");
    expect(calls).toHaveLength(1);
  });

  it("returns not_configured when the provider key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const err = await runPromptValidated(
      PROMPT_I_CLASSIFICATION,
      "q",
      validateClassification,
      CLASSIFICATION_RETRY_INSTRUCTION,
    ).catch((e) => e);
    expect((err as PromptError).code).toBe("not_configured");
  });
});

describe("prompt I failure behaviour", () => {
  it("retries exactly once with the strict correction instruction", async () => {
    bodies.push(okBody({ framework: "BEHAVIOURAL" }));
    bodies.push(okBody({ framework: "CULTURAL", reason: "values" }));
    const { value, attempts } = await runPromptValidated(
      PROMPT_I_CLASSIFICATION,
      "How do you like to work with a team?",
      validateClassification,
      CLASSIFICATION_RETRY_INSTRUCTION,
    );
    expect(attempts).toBe(2);
    expect(value.framework).toBe("CULTURAL");
    expect(calls[1].user).toContain(CLASSIFICATION_RETRY_INSTRUCTION);
  });

  it("fails closed after a second invalid response — no heuristic result", async () => {
    bodies.push(okBody({ framework: "BEHAVIOURAL" }));
    bodies.push(okBody({ framework: "ALSO_WRONG" }));
    const err = await runPromptValidated(
      PROMPT_I_CLASSIFICATION,
      "Tell me about a time you failed.",
      validateClassification,
      CLASSIFICATION_RETRY_INSTRUCTION,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(PromptError);
    expect((err as PromptError).code).toBe("invalid_output");
    expect(calls).toHaveLength(2);
  });
});

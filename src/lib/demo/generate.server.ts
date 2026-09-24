/**
 * Demo generation — SERVER ONLY.
 *
 * Step 3: the Aplyer side of the Demo runs the REAL Aplyer answer pipeline
 * (Prompt I -> P0 -> Prompt A -> deterministic guards -> Prompt J -> repair ->
 * final post-guard) via `generateStatelessValidatedAnswer`. There is no
 * Demo-specific prompt and no direct provider call in this module. Every
 * provider call made by the pipeline is reported for cost accounting.
 */
import type { PromptUsageEvent } from "@/lib/ai/run-prompt.server";

export const DEMO_APLYER_SIDE = "aplyer" as const;

export interface DemoInput {
  resume: string;
  jobDescription: string;
  question: string;
  /** Optional writing sample, exact text as submitted, or null. Both future
   * comparison sides receive this same value. The current pipeline has no
   * stage that consumes a raw sample, so it is not sent to any AI yet. */
  writingSample: string | null;
  /** Deterministic word count of writingSample (0 when null). */
  writingSampleWordCount: number;
}

/** One billable AI operation. Server-side accounting only. */
export interface DemoAiCall {
  provider: string;
  model: string;
  operation: string;
  usage: { inputTokens?: number; outputTokens?: number };
}

export interface DemoGenerationResult {
  text: string;
  side: "openai" | "aplyer";
  calls: DemoAiCall[];
}

export class DemoGenerationError extends Error {
  constructor(
    public code: string,
    public busy = false,
    /** Calls that were billed before the failure, so they are still recorded. */
    public calls: DemoAiCall[] = [],
  ) {
    super(code);
  }
}

/** Safe, generic progress stages (no internal detail). */
export type DemoProgressStage = "reading_resume" | "writing";

export interface DemoGenerateHooks {
  onDelta?: (text: string) => void;
  onProgress?: (stage: DemoProgressStage) => void;
}

export type DemoGenerator = (input: DemoInput, hooks?: DemoGenerateHooks) => Promise<DemoGenerationResult>;

const OPERATION: Record<string, string> = {
  I_QUESTION_CLASSIFICATION: "prompt_i_classification",
  P0_FACT_INVENTORY: "p0_fact_inventory",
  A_ANSWER_GENERATION: "prompt_a_answer",
  J_QUALITY_SCAN: "prompt_j_quality_scan",
};

/** Maps pipeline usage events to per-call cost records (numbered per prompt). */
export function usageToCalls(events: PromptUsageEvent[]): DemoAiCall[] {
  const seen: Record<string, number> = {};
  return events.map((e) => {
    const base = OPERATION[e.promptId] ?? e.promptId.toLowerCase();
    seen[base] = (seen[base] ?? 0) + 1;
    // 1st call = the stage itself; later calls are retries / J repair scans.
    const operation = seen[base] === 1 ? base : `${base}_${seen[base]}`;
    return {
      provider: e.provider,
      model: e.model,
      operation,
      usage: { inputTokens: e.inputTokens, outputTokens: e.outputTokens },
    };
  });
}

export const generateAplyerDemoAnswer: DemoGenerator = async (input, hooks = {}) => {
  const [{ withPromptUsage, PromptError }, { generateStatelessValidatedAnswer, AnswerPipelineError }, { supabaseAdmin }] =
    await Promise.all([
      import("@/lib/ai/run-prompt.server"),
      import("@/lib/ai/answer-pipeline.server"),
      import("@/integrations/supabase/client.server"),
    ]);
  const events: PromptUsageEvent[] = [];
  try {
    const r = await withPromptUsage(
      (e) => events.push(e),
      () =>
        generateStatelessValidatedAnswer({
          resumeText: input.resume,
          jobDescription: input.jobDescription,
          question: input.question,
          db: supabaseAdmin,
          onDraftDelta: hooks.onDelta ?? null,
          onStage: hooks.onProgress ?? null,
        }),
    );
    return { text: r.answer, side: DEMO_APLYER_SIDE, calls: usageToCalls(events) };
  } catch (e) {
    const calls = usageToCalls(events);
    if (e instanceof AnswerPipelineError) {
      const busy = e.code === "provider_error" || e.code === "timeout";
      throw new DemoGenerationError(e.code, busy, calls);
    }
    if (e instanceof PromptError) throw new DemoGenerationError(e.code, e.status === 429 || e.status === 529, calls);
    throw new DemoGenerationError("pipeline_failed", false, calls);
  }
};

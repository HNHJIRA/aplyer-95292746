// Server functions for the validated A -> J answer pipeline.
// user_id always comes from the authenticated server context, never the client.
// The client may supply only a question and untrusted job context.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const generateAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      question: string;
      job?: { title?: string; company?: string; description?: string } | null;
      force?: boolean;
    }) => ({
      question: String(input?.question ?? "").slice(0, 2000),
      job: input?.job
        ? {
            title: input.job.title ? String(input.job.title).slice(0, 300) : undefined,
            company: input.job.company ? String(input.job.company).slice(0, 300) : undefined,
            description: input.job.description ? String(input.job.description).slice(0, 8000) : undefined,
          }
        : null,
      force: Boolean(input?.force),
    }),
  )
  .handler(async ({ data, context }) => {
    const { generateValidatedAnswer, AnswerPipelineError } = await import(
      "@/lib/ai/answer-pipeline.server"
    );
    try {
      const r = await generateValidatedAnswer(context.supabase, context.userId, {
        question: data.question,
        jobContext: data.job,
        force: data.force,
      });
      return {
        ok: true as const,
        answerId: r.answerId,
        answer: r.answer,
        wordCount: r.wordCount,
        options: r.variants
          ? r.variants.map((v) => ({ id: v.id, answer: v.answer, wordCount: v.wordCount }))
          : null,
        needsChoice: r.needsVariantChoice,
        cached: r.cached,
      };
    } catch (e) {
      if (e instanceof AnswerPipelineError) {
        return { ok: false as const, code: e.code, message: e.message };
      }
      throw e;
    }
  });

export const chooseAnswerVariant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { answerId: string; variantId: "A" | "B" }) => ({
    answerId: String(input?.answerId ?? ""),
    variantId: input?.variantId === "B" ? ("B" as const) : ("A" as const),
  }))
  .handler(async ({ data, context }) => {
    const { recordVariantPreference, AnswerPipelineError } = await import(
      "@/lib/ai/answer-pipeline.server"
    );
    try {
      return await recordVariantPreference(
        context.supabase,
        context.userId,
        data.answerId,
        data.variantId,
      );
    } catch (e) {
      if (e instanceof AnswerPipelineError) {
        return { ok: false as const, code: e.code, message: e.message };
      }
      throw e;
    }
  });

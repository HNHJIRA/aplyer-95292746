import { generateValidatedAnswer, AnswerPipelineError } from "../../src/lib/ai/answer-pipeline.server";
import { supabaseAdmin } from "../../src/integrations/supabase/client.server";
const userId = "f101e930-d2d2-4abc-85d1-5540c35444d1";
const question = "Walk us through a recent piece of code or integration you've built and deployed.";
for (let i = 1; i <= 5; i++) {
  const t = Date.now();
  try {
    const r = await generateValidatedAnswer(supabaseAdmin, userId, { question, force: true }, { writeDb: supabaseAdmin });
    console.log(`run ${i}: OK mode=${r.mode} variants=${r.variants?.map(v=>v.wordCount).join("/")} words=${r.wordCount} ms=${Date.now()-t}`);
    if (r.variants) console.log("   A:", r.variants[0]!.answer.slice(0,140));
  } catch (e) {
    const err = e as AnswerPipelineError;
    console.log(`run ${i}: FAIL code=${err.code} reasons=${JSON.stringify((err as any).reasonCodes)} ms=${Date.now()-t}`);
  }
}

import { supabaseAdmin } from "../src/integrations/supabase/client.server";
import { generateValidatedAnswer } from "../src/lib/ai/answer-pipeline.server";

const userId = "253a2743-7307-49ea-8883-ae3b4e4b3e20";
const q = "Walk us through a recent piece of code or integration you've built and deployed.";
try {
  const r = await generateValidatedAnswer(supabaseAdmin, userId, { question: q, force: true }, { writeDb: supabaseAdmin });
  console.log(JSON.stringify({ ok: true, mode: r.mode, needsChoice: r.needsVariantChoice, wordCount: r.wordCount, answer: r.answer, variants: r.variants?.map(v => ({ id: v.id, wc: v.wordCount, a: v.answer })) }, null, 2));
} catch (e: any) {
  console.log(JSON.stringify({ ok: false, code: e.code, reasonCodes: e.reasonCodes, msg: e.message }));
}

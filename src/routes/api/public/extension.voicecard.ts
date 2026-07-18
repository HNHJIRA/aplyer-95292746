import { createFileRoute } from "@tanstack/react-router";
import { jsonWithCors, preflight } from "@/lib/cors";

const PROMPT_VERSION = "v1";
const MODEL = "claude-haiku-4-5";
const STALE_LOCK_MS = 2 * 60 * 1000;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const AB_DEMO_QUESTION =
  "In 2–3 sentences, tell me why you're interested in this role and what you'd bring to the team.";

const AB_DEMO_GENERIC =
  "I am very interested in this role because it aligns with my skills and experience. I am a hard worker, a team player, and passionate about learning. I would bring dedication, strong communication, and a proven track record of delivering results to your team.";

interface VoiceCardData {
  headline: string;
  tone: string;
  cadence: string;
  formality: string;
  vocabulary_bias: string;
  distinctive_traits: string[];
  hooks_and_transitions: string[];
  values_signals: string[];
  do_and_avoid: { do: string[]; avoid: string[] };
}

interface SourceSnapshot {
  resumeId: string | null;
  resumeText: string | null;
  qualifyingSamples: Array<{ id: string; content: string; content_hash: string; type: string; title: string }>;
  sourceHash: string;
}

export const Route = createFileRoute("/api/public/extension/voicecard")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization") ?? "";
          const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
          if (!token) return jsonWithCors({ error: "Unauthorized" }, 401);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
          if (authError || !authData.user) return jsonWithCors({ error: "Unauthorized" }, 401);

          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const action = typeof body.action === "string" ? body.action : "";
          const userId = authData.user.id;

          if (action === "state") {
            return jsonWithCors(await getVoiceCardState(supabaseAdmin, userId));
          }

          if (action === "retry") {
            await supabaseAdmin
              .from("profiles")
              .update({
                voice_card_status: "eligible",
                voice_card_error: null,
                voice_card_generation_id: null,
                voice_card_generation_started_at: null,
              })
              .eq("id", userId)
              .in("voice_card_status", ["failed", "stale"]);
            return jsonWithCors({ ok: true });
          }

          if (action === "set_resume_only") {
            await supabaseAdmin
              .from("profiles")
              .update({ resume_only: !!body.resumeOnly })
              .eq("id", userId);
            return jsonWithCors({ ok: true });
          }

          if (action === "start") {
            return jsonWithCors(await startVoiceCardGeneration(supabaseAdmin, userId));
          }

          if (action === "generate_ab_demo") {
            return jsonWithCors(await generateAbDemo(supabaseAdmin, userId));
          }

          if (action === "complete_ab_demo") {
            await supabaseAdmin
              .from("profiles")
              .update({ ab_demo_completed: true, ab_demo_completed_at: new Date().toISOString() })
              .eq("id", userId);
            return jsonWithCors({ ok: true });
          }

          return jsonWithCors({ error: "Unknown action" }, 400);
        } catch (e) {
          console.error("[extension.voicecard]", e);
          return jsonWithCors({ error: e instanceof Error ? e.message : "Something went wrong" }, 500);
        }
      },
    },
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getVoiceCardState(supabase: any, userId: string) {
  const { data: p, error } = await supabase
    .from("profiles")
    .select("voice_card_status, voice_card_data, voice_card_error, voice_card_generation_started_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;

  if (p?.voice_card_status === "generating" && p.voice_card_generation_started_at) {
    const startedAt = new Date(p.voice_card_generation_started_at).getTime();
    if (Date.now() - startedAt > STALE_LOCK_MS) {
      await supabase
        .from("profiles")
        .update({
          voice_card_status: "failed",
          voice_card_error: "Generation timed out",
          voice_card_generation_id: null,
          voice_card_generation_started_at: null,
        })
        .eq("id", userId);
      return { ...p, voice_card_status: "failed", voice_card_error: "Generation timed out" };
    }
  }
  return p;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function startVoiceCardGeneration(supabase: any, userId: string) {
  await supabase.rpc("recalc_writedna", { _user_id: userId });

  const { data: prof } = await supabase
    .from("profiles")
    .select("voice_card_status, voice_card_generation_id, voice_card_generation_started_at, voice_card_source_hash, voice_card_data")
    .eq("id", userId)
    .maybeSingle();
  if (!prof) throw new Error("Profile not found");

  const snap = await fetchSourceSnapshot(supabase, userId);
  if (prof.voice_card_status === "generated" && prof.voice_card_source_hash === snap.sourceHash && prof.voice_card_data) {
    return { status: "generated" as const, voice_card: prof.voice_card_data };
  }

  if (!snap.resumeId) throw new Error("Resume required");
  if (snap.qualifyingSamples.length < 2) throw new Error("At least 2 qualifying writing samples required");

  const genId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiredCutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString();

  const { data: locked, error: lockErr } = await supabase
    .from("profiles")
    .update({
      voice_card_status: "generating",
      voice_card_generation_id: genId,
      voice_card_generation_started_at: now,
      voice_card_error: null,
    })
    .eq("id", userId)
    .or(
      `voice_card_status.in.(eligible,failed,stale),and(voice_card_status.eq.generating,voice_card_generation_started_at.lt.${expiredCutoff})`,
    )
    .select("voice_card_generation_id")
    .maybeSingle();

  if (lockErr) throw new Error(`Lock failed: ${lockErr.message}`);
  if (!locked || locked.voice_card_generation_id !== genId) return { status: "in_progress" as const };

  const resumeExcerpt = (snap.resumeText ?? "").slice(0, 8000);
  const samplesText = snap.qualifyingSamples
    .map((s, i) => `# Sample ${i + 1} — ${s.type} — ${s.title}\n${s.content.slice(0, 4000)}`)
    .join("\n\n---\n\n");

  const userPrompt = `Resume:\n${resumeExcerpt}\n\nWriting samples:\n${samplesText}`;
  let voiceCard: VoiceCardData | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      voiceCard = validateVoiceCard(await callClaudeJson(VC_SYSTEM, userPrompt));
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!voiceCard) {
    await supabase
      .from("profiles")
      .update({
        voice_card_status: "failed",
        voice_card_error: (lastErr instanceof Error ? lastErr.message : "Generation failed").slice(0, 500),
        voice_card_generation_id: null,
        voice_card_generation_started_at: null,
      })
      .eq("id", userId)
      .eq("voice_card_generation_id", genId);
    return { status: "failed" as const, error: "Generation failed" };
  }

  const { data: committed } = await supabase
    .from("profiles")
    .update({
      voice_card_status: "generated",
      voice_card_data: voiceCard,
      voice_card_generated_at: new Date().toISOString(),
      voice_card_model: MODEL,
      voice_card_source_hash: snap.sourceHash,
      voice_card_source_resume_id: snap.resumeId,
      voice_card_source_sample_ids: snap.qualifyingSamples.map((s) => s.id),
      voice_card_prompt_version: PROMPT_VERSION,
      voice_card_error: null,
      voice_card_generation_id: null,
      voice_card_generation_started_at: null,
      voice_confidence: 100,
    })
    .eq("id", userId)
    .eq("voice_card_generation_id", genId)
    .select("voice_card_data")
    .maybeSingle();

  if (!committed) return { status: "in_progress" as const };
  return { status: "generated" as const, voice_card: voiceCard };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateAbDemo(supabase: any, userId: string) {
  const { data: rowRaw } = await supabase
    .from("profiles")
    .select("ab_demo_answer, voice_card_data, voice_card_status, resume_only")
    .eq("id", userId)
    .maybeSingle();
  if (!rowRaw) throw new Error("Profile not found");
  if (rowRaw.ab_demo_answer) {
    return { question: AB_DEMO_QUESTION, generic: AB_DEMO_GENERIC, withVoice: rowRaw.ab_demo_answer };
  }
  if (rowRaw.resume_only) throw new Error("Resume-only users skip the A/B demo");
  if (rowRaw.voice_card_status !== "generated" || !rowRaw.voice_card_data) throw new Error("Voice Card not ready");

  const system =
    "You write short, authentic application answers in the candidate's exact voice. Match tone, cadence, and vocabulary. Never invent facts. 2-3 sentences. No preamble, no signoff. Plain text only.";
  const prompt = `Voice Card:\n${JSON.stringify(rowRaw.voice_card_data, null, 2)}\n\nQuestion:\n${AB_DEMO_QUESTION}\n\nWrite the answer.`;
  const answer = await callClaudeText(system, prompt, 400);
  if (!answer) throw new Error("Empty demo answer");

  await supabase
    .from("profiles")
    .update({
      ab_demo_answer: answer,
      ab_demo_generation_id: crypto.randomUUID(),
      ab_demo_model: MODEL,
      ab_demo_created_at: new Date().toISOString(),
    })
    .eq("id", userId);

  return { question: AB_DEMO_QUESTION, generic: AB_DEMO_GENERIC, withVoice: answer };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchSourceSnapshot(supabase: any, userId: string): Promise<SourceSnapshot> {
  const [resumeRes, samplesRes] = await Promise.all([
    supabase
      .from("resumes")
      .select("id, resume_text")
      .eq("user_id", userId)
      .eq("is_current", true)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("writing_samples")
      .select("id, content, content_hash, type, title, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
  ]);

  const resume = resumeRes.data ?? null;
  const rawSamples = (samplesRes.data ?? []) as Array<{
    id: string;
    content: string;
    content_hash: string;
    type: string;
    title: string;
  }>;
  const qualifyingSamples = rawSamples.filter((s) => isQualifyingProse(s.content, s.type));
  const sourceHash = await sha256Hex([resume?.id ?? "", "|", qualifyingSamples.map((s) => s.content_hash).join(","), "|", PROMPT_VERSION].join(""));
  return { resumeId: resume?.id ?? null, resumeText: resume?.resume_text ?? null, qualifyingSamples, sourceHash };
}

function isQualifyingProse(content: string, type: string): boolean {
  const trimmed = (content || "").trim();
  if (trimmed.length < 100) return false;
  const allowed = ["cover_letter", "linkedin_post", "professional_email", "blog", "essay", "free_text", "career_summary", "other"];
  if (!allowed.includes(type)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 30) return false;
  const lines = trimmed.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length >= 3) {
    const bullets = lines.filter((l) => /^(-|\*|•|\d+\.)\s/.test(l)).length;
    if (bullets / lines.length > 0.6) return false;
  }
  return true;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const VC_SYSTEM = `You are a writing-voice profiler. Given a resume and 2+ short pieces of prose written by the candidate, distill their writing DNA.

Return STRICT JSON only (no markdown, no prose) matching:
{
  "headline": string,
  "tone": string,
  "cadence": string,
  "formality": string,
  "vocabulary_bias": string,
  "distinctive_traits": string[],
  "hooks_and_transitions": string[],
  "values_signals": string[],
  "do_and_avoid": { "do": string[], "avoid": string[] }
}

Be specific and evidence-based. Reference concrete phrasing patterns. Never invent facts about the person.`;

async function callClaudeJson(system: string, user: string): Promise<unknown> {
  const text = await callClaudeText(`${system}\n\nRespond with ONLY a valid JSON object. No prose, no markdown fences.`, user, 1500);
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Non-JSON Claude response");
  }
}

async function callClaudeText(system: string, user: string, maxTokens: number): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
}

function validateVoiceCard(d: unknown): VoiceCardData {
  const o = d as VoiceCardData;
  const req = ["headline", "tone", "cadence", "formality", "vocabulary_bias"] as const;
  for (const k of req) if (typeof o?.[k] !== "string" || !o[k]) throw new Error(`Missing field ${k}`);
  const arr = ["distinctive_traits", "hooks_and_transitions", "values_signals"] as const;
  for (const k of arr) if (!Array.isArray(o?.[k]) || o[k].length === 0) throw new Error(`Missing ${k}`);
  if (!o.do_and_avoid || !Array.isArray(o.do_and_avoid.do) || !Array.isArray(o.do_and_avoid.avoid)) throw new Error("Missing do_and_avoid");
  return o;
}
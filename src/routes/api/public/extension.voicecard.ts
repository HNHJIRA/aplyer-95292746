import { createFileRoute } from "@tanstack/react-router";
import { jsonWithCors, preflight } from "@/lib/cors";
import {
  PROMPT_B_VOICE_CARD,
  VOICE_CARD_REVEAL,
  buildVoiceCardUser,
  validateVoiceCard,
  type VoiceCardData,
} from "@/lib/ai/prompts/prompt-b-voice-card";

const PROMPT_VERSION = PROMPT_B_VOICE_CARD.version;
const MODEL = PROMPT_B_VOICE_CARD.model;
const STALE_LOCK_MS = 45 * 1000;
const AI_TIMEOUT_MS = 12 * 1000;
const RESUME_EXCERPT_CHARS = 3000;
const SAMPLE_EXCERPT_CHARS = 1600;
const MAX_VOICECARD_TOKENS = 900;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const AB_DEMO_QUESTION =
  "In 2–3 sentences, tell me why you're interested in this role and what you'd bring to the team.";

const AB_DEMO_GENERIC =
  "I am very interested in this role because it aligns with my skills and experience. I am a hard worker, a team player, and passionate about learning. I would bring dedication, strong communication, and a proven track record of delivering results to your team.";

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

  const resumeExcerpt = (snap.resumeText ?? "").slice(0, RESUME_EXCERPT_CHARS);
  const samplesText = snap.qualifyingSamples
    .slice(0, 2)
    .map((s, i) => `# Sample ${i + 1} — ${s.type} — ${s.title}\n${s.content.slice(0, SAMPLE_EXCERPT_CHARS)}`)
    .join("\n\n---\n\n");

  const userPrompt = buildVoiceCardUser(resumeExcerpt, samplesText);
  let voiceCard: VoiceCardData;
  let usedFallback = false;
  try {
    voiceCard = validateVoiceCard(await callClaudeJson(PROMPT_B_VOICE_CARD.system, userPrompt));
  } catch (e) {
    console.warn("[extension.voicecard] Claude unavailable, using fast fallback", e);
    usedFallback = true;
    voiceCard = buildFastVoiceCard(snap);
  }

  const { data: committed } = await supabase
    .from("profiles")
    .update({
      voice_card_status: "generated",
      voice_card_data: voiceCard,
      voice_card_generated_at: new Date().toISOString(),
      voice_card_model: usedFallback ? `${MODEL}:fast-fallback` : MODEL,
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

function buildFastVoiceCard(snap: SourceSnapshot): VoiceCardData {
  const text = snap.qualifyingSamples.map((s) => s.content).join("\n\n");
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const words = text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  const avgSentenceWords = sentences.length
    ? Math.round(words.length / sentences.length)
    : 14;
  const traits = topTerms(words, 8);
  const transitions = findTransitions(text);
  const valueSignals = findValueSignals(words);
  const cadence = avgSentenceWords <= 12
    ? "Short, direct sentences with a practical rhythm."
    : avgSentenceWords >= 22
      ? "Longer explanatory sentences with reflective pacing."
      : "Balanced sentence length with clear setup and follow-through.";
  const formality = /\b(i'm|can't|don't|that's|you're)\b/i.test(text)
    ? "Conversational-professional"
    : "Polished-professional";
  const vocabulary = traits.length
    ? `Leans on concrete terms like ${traits.slice(0, 5).join(", ")}.`
    : "Leans on concrete, role-focused language.";

  const archetype =
    avgSentenceWords <= 12 ? "One-Liner" : avgSentenceWords >= 24 ? "Overthinker" : formality === "Conversational-professional" ? "Natural" : "Straight Shooter";

  return {
    archetype,
    archetype_description:
      "Your writing lands as " +
      archetype +
      ": " +
      cadence.toLowerCase(),
    reveal: VOICE_CARD_REVEAL,
    headline: "A clear, practical voice focused on evidence and contribution.",
    tone: "Direct, thoughtful, and professionally grounded.",
    cadence,
    formality,
    vocabulary_bias: vocabulary,
    distinctive_traits: [
      "Uses specific context before making a point.",
      "Connects experience to practical outcomes.",
      "Keeps the voice professional without sounding overly formal.",
    ],
    hooks_and_transitions: transitions.length
      ? transitions.slice(0, 4)
      : ["Start with the situation, then name the contribution.", "Use concise transitions between experience and impact.", "Close with a grounded next-step or value statement."],
    values_signals: valueSignals,
    do_and_avoid: {
      do: [
        "Keep answers specific and evidence-led.",
        "Use the candidate's practical, outcome-focused phrasing.",
        "Preserve a confident but measured tone.",
      ],
      avoid: [
        "Do not add unsupported achievements or metrics.",
        "Avoid generic enthusiasm without evidence.",
        "Avoid overly polished corporate phrasing that removes personality.",
      ],
    },
  };
}

function topTerms(words: string[], limit: number): string[] {
  const stop = new Set([
    "the", "and", "for", "with", "that", "this", "from", "have", "has", "was", "were", "are", "you", "your", "our", "their", "but", "not", "can", "will", "about", "into", "through", "they", "them", "then", "than", "also", "when", "where", "what", "how", "why", "who", "been", "being", "work", "role", "team",
  ]);
  const counts = new Map<string, number>();
  for (const word of words) {
    if (stop.has(word) || word.length < 4) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word]) => word);
}

function findTransitions(text: string): string[] {
  const candidates = [
    "I learned", "I believe", "In my experience", "For example", "As a result", "This helped", "My approach", "I focus", "I bring",
  ];
  return candidates
    .filter((phrase) => text.toLowerCase().includes(phrase.toLowerCase()))
    .map((phrase) => `Uses “${phrase}…” to move from context to impact.`);
}

function findValueSignals(words: string[]): string[] {
  const values = [
    { label: "ownership", keys: ["own", "owned", "ownership", "responsible", "accountable"] },
    { label: "collaboration", keys: ["collaborate", "collaboration", "partner", "team", "together"] },
    { label: "learning", keys: ["learn", "learning", "improve", "growth", "curious"] },
    { label: "clarity", keys: ["clear", "clarity", "explain", "communicate", "align"] },
    { label: "impact", keys: ["impact", "result", "outcome", "deliver", "improve"] },
  ];
  const set = new Set(words);
  const matched = values.filter((v) => v.keys.some((k) => set.has(k))).map((v) => v.label);
  const base = matched.length ? matched : ["clarity", "ownership", "impact"];
  return base.slice(0, 4).map((v) => `${v[0].toUpperCase()}${v.slice(1)} shows up as a recurring writing signal.`);
}

async function callClaudeJson(system: string, user: string): Promise<unknown> {
  const text = await callClaudeText(`${system}\n\nRespond with ONLY a valid JSON object. No prose, no markdown fences.`, user, MAX_VOICECARD_TOKENS);
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

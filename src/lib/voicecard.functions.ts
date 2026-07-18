// Server functions for Voice Card generation, A/B demo, retry, regenerate.
// All Claude Haiku 4.5 calls stay server-side. ANTHROPIC_API_KEY never leaks.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PROMPT_VERSION = "v1";
const MODEL = "claude-haiku-4-5";
const STALE_LOCK_MS = 2 * 60 * 1000; // 2 minutes

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

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

const VC_SYSTEM = `You are a writing-voice profiler. Given a resume and 2+ short pieces of prose written by the candidate, distill their writing DNA.

Return STRICT JSON only (no markdown, no prose) matching:
{
  "headline": string,              // 1 punchy sentence naming their voice
  "tone": string,                  // e.g. "warm-analytical", "direct-optimistic"
  "cadence": string,               // rhythm, sentence-length pattern
  "formality": string,             // e.g. "casual-professional"
  "vocabulary_bias": string,       // words/phrases they favor
  "distinctive_traits": string[],  // 3-5 specific idiosyncrasies
  "hooks_and_transitions": string[], // 3-5 opener/transition patterns they use
  "values_signals": string[],      // 3-5 values or themes their writing surfaces
  "do_and_avoid": {
    "do": string[],                // 3-5 rules to preserve their voice
    "avoid": string[]              // 3-5 anti-patterns for their voice
  }
}

Be specific and evidence-based. Reference concrete phrasing patterns. Never invent facts about the person.`;

async function callClaudeJson<T>(system: string, user: string, maxTokens = 1500): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: `${system}\n\nRespond with ONLY a valid JSON object. No prose, no markdown fences.`,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const raw = data.content?.find((c) => c.type === "text")?.text ?? "";
  return parseJson<T>(raw);
}

function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error("Non-JSON Claude response");
  }
}

function validateVoiceCard(d: unknown): VoiceCardData {
  const o = d as VoiceCardData;
  const req = ["headline", "tone", "cadence", "formality", "vocabulary_bias"] as const;
  for (const k of req) if (typeof o?.[k] !== "string" || !o[k]) throw new Error(`Missing field ${k}`);
  const arr = ["distinctive_traits", "hooks_and_transitions", "values_signals"] as const;
  for (const k of arr) if (!Array.isArray(o?.[k]) || o[k].length === 0) throw new Error(`Missing ${k}`);
  if (!o.do_and_avoid || !Array.isArray(o.do_and_avoid.do) || !Array.isArray(o.do_and_avoid.avoid)) {
    throw new Error("Missing do_and_avoid");
  }
  return o;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface SourceSnapshot {
  resumeId: string | null;
  resumeText: string | null;
  qualifyingSamples: Array<{ id: string; content: string; content_hash: string; type: string; title: string }>;
  sourceHash: string;
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
    created_at: string;
  }>;

  // Mirror is_qualifying_prose in TS (bulk filter — server-side check).
  const qualifying = rawSamples.filter((s) => isQualifyingProse(s.content, s.type));

  const parts = [
    resume?.id ?? "",
    "|",
    qualifying.map((s) => s.content_hash).join(","),
    "|",
    PROMPT_VERSION,
  ].join("");
  const sourceHash = await sha256Hex(parts);

  return {
    resumeId: resume?.id ?? null,
    resumeText: resume?.resume_text ?? null,
    qualifyingSamples: qualifying,
    sourceHash,
  };
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
    const bulletRe = /^(-|\*|•|\d+\.)\s/;
    const bullets = lines.filter((l) => bulletRe.test(l)).length;
    if (bullets / lines.length > 0.6) return false;
  }
  return true;
}

// -------- Server functions --------

export const getVoiceCardState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: p } = await supabase
      .from("profiles")
      .select(
        "voice_card_status, voice_card_data, voice_card_generated_at, voice_card_source_hash, voice_card_generation_id, voice_card_generation_started_at, voice_card_error, voice_confidence, writedna_stage, resume_uploaded, writing_sample_count, qualifying_prose_count, resume_only, ab_demo_completed, ab_demo_answer",
      )
      .eq("id", userId)
      .maybeSingle();

    // Stale-lock recovery: if generating too long, mark failed.
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
        p.voice_card_status = "failed";
        p.voice_card_error = "Generation timed out";
      }
    }
    return p;
  });

export const startVoiceCardGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // 1. Recompute canonical state (trigger on resume table doesn't exist, force it).
    await supabase.rpc("recalc_writedna", { _user_id: userId });

    // 2. Refetch canonical profile row.
    const { data: prof } = await supabase
      .from("profiles")
      .select("voice_card_status, voice_card_generation_id, voice_card_generation_started_at, voice_card_source_hash, voice_card_data")
      .eq("id", userId)
      .maybeSingle();
    if (!prof) throw new Error("Profile not found");

    // 3. Idempotent short-circuit: already generated with same source hash.
    const snap = await fetchSourceSnapshot(supabase, userId);
    if (prof.voice_card_status === "generated" && prof.voice_card_source_hash === snap.sourceHash && prof.voice_card_data) {
      return { status: "generated" as const, voice_card: prof.voice_card_data };
    }

    // 4. Server-side eligibility recheck.
    if (!snap.resumeId) throw new Error("Resume required");
    if (snap.qualifyingSamples.length < 2) throw new Error("At least 2 qualifying writing samples required");

    // 5. Atomic lock acquisition — only transition from eligible/failed/stale (or expired generating).
    const genId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expiredCutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString();

    // We split the atomic update into two allowed shapes:
    //   a) status in (eligible, failed, stale)
    //   b) status = generating BUT started_at < expiredCutoff (stale lock recovery)
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
    if (!locked || locked.voice_card_generation_id !== genId) {
      // Someone else won the lock or state is not eligible.
      return { status: "in_progress" as const };
    }

    // 6. Build prompt + call Claude with one corrective retry.
    const resumeExcerpt = (snap.resumeText ?? "").slice(0, 8000);
    const samplesText = snap.qualifyingSamples
      .map((s, i) => `# Sample ${i + 1} — ${s.type} — ${s.title}\n${s.content.slice(0, 4000)}`)
      .join("\n\n---\n\n");
    const userPrompt = `Resume:\n${resumeExcerpt}\n\nWriting samples:\n${samplesText}`;

    let voiceCard: VoiceCardData | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await callClaudeJson<VoiceCardData>(VC_SYSTEM, userPrompt);
        voiceCard = validateVoiceCard(raw);
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!voiceCard) {
      // Only clear if we still own the lock.
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

    // 7. Commit only if we still own the lock.
    const commitPayload: Record<string, unknown> = {
      voice_card_status: "generated",
      voice_card_data: voiceCard as unknown as Record<string, unknown>,
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
    };
    const { data: committed } = await supabase
      .from("profiles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(commitPayload as any)
      .eq("id", userId)
      .eq("voice_card_generation_id", genId)
      .select("voice_card_data")
      .maybeSingle();

    if (!committed) return { status: "in_progress" as const };
    return { status: "generated" as const, voice_card: voiceCard };
  });

export const retryVoiceCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await supabase
      .from("profiles")
      .update({ voice_card_status: "eligible", voice_card_error: null, voice_card_generation_id: null, voice_card_generation_started_at: null })
      .eq("id", userId)
      .in("voice_card_status", ["failed", "stale"]);
    return { ok: true };
  });

// ------- A/B demo -------

export const AB_DEMO_QUESTION =
  "In 2–3 sentences, tell me why you're interested in this role and what you'd bring to the team.";

export const AB_DEMO_GENERIC =
  "I am very interested in this role because it aligns with my skills and experience. I am a hard worker, a team player, and passionate about learning. I would bring dedication, strong communication, and a proven track record of delivering results to your team.";

interface AbDemoRow {
  ab_demo_completed: boolean;
  ab_demo_answer: string | null;
  ab_demo_generation_id: string | null;
  voice_card_data: unknown;
  voice_card_status: string;
  resume_only: boolean;
}

export const generateAbDemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: rowRaw } = await supabase
      .from("profiles")
      .select("ab_demo_completed, ab_demo_answer, ab_demo_generation_id, voice_card_data, voice_card_status, resume_only")
      .eq("id", userId)
      .maybeSingle();
    const row = rowRaw as AbDemoRow | null;
    if (!row) throw new Error("Profile not found");

    // Idempotent: if we already have a persisted answer, return it.
    if (row.ab_demo_answer) {
      return {
        question: AB_DEMO_QUESTION,
        generic: AB_DEMO_GENERIC,
        withVoice: row.ab_demo_answer,
      };
    }

    if (row.resume_only) throw new Error("Resume-only users skip the A/B demo");
    if (row.voice_card_status !== "generated" || !row.voice_card_data) {
      throw new Error("Voice Card not ready");
    }

    const voiceCard = row.voice_card_data as VoiceCardData;
    const system = `You write short, authentic application answers in the candidate's exact voice. Match tone, cadence, and vocabulary. Never invent facts. 2-3 sentences. No preamble, no signoff. Plain text only.`;
    const prompt = `Voice Card:\n${JSON.stringify(voiceCard, null, 2)}\n\nQuestion:\n${AB_DEMO_QUESTION}\n\nWrite the answer.`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Claude ${res.status}`);
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const answer = (data.content?.find((c) => c.type === "text")?.text ?? "").trim();
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
  });

export const completeAbDemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await supabase
      .from("profiles")
      .update({ ab_demo_completed: true, ab_demo_completed_at: new Date().toISOString() })
      .eq("id", userId);
    return { ok: true };
  });

export const setResumeOnly = createServerFn({ method: "POST" })
  .inputValidator((data: { resumeOnly: boolean }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.from("profiles").update({ resume_only: !!data.resumeOnly }).eq("id", userId);
    return { ok: true };
  });

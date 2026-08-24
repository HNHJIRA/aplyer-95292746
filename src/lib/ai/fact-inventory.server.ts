// Server-only orchestration for P0 canonical resume fact inventory.
//
// Pipeline: canonical resume text -> Prompt P0 (pinned model, 1 retry)
//           -> structural validation -> deterministic grounding guardrails
//           -> Supabase (resume_fact_inventories).
//
// Inputs are the resume ONLY. Writing samples, Voice Card, job descriptions,
// question text and any client-supplied facts are never read here.
import {
  FACT_INVENTORY_RETRY_INSTRUCTION,
  FACT_INVENTORY_SCHEMA_VERSION,
  PROMPT_P0_FACT_INVENTORY,
  buildFactInventoryUser,
  validateFactInventoryShape,
  type ResumeFactInventory,
} from "./prompts/prompt-p0-fact-inventory";
import { PromptError, runPromptValidated } from "./run-prompt.server";
import { GroundingError, applyGrounding, countFacts } from "./fact-inventory-grounding";

export const FACT_INVENTORY_TABLE = "resume_fact_inventories";
const STALE_LOCK_MS = 90 * 1000;
const AI_TIMEOUT_MS = 120 * 1000;
const MAX_RESUME_CHARS = 24000;
const MIN_RESUME_CHARS = 100;

export type InventoryStatus = "pending" | "extracting" | "ready" | "failed" | "stale";

export class FactInventoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FactInventoryError";
    this.code = code;
  }
}

export interface InventoryState {
  status: InventoryStatus | "missing";
  resumeId: string | null;
  schemaVersion: string;
  promptVersion: string;
  model: string | null;
  sourceHashPrefix: string | null;
  factCount: number;
  generatedAt: string | null;
  error: string | null;
  inventory?: ResumeFactInventory | null;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Source identity = resume identity + resume content + prompt version + schema version. */
export async function computeSourceHash(resumeId: string, resumeText: string): Promise<string> {
  return sha256Hex(
    [
      resumeId,
      await sha256Hex(resumeText.replace(/\s+/g, " ").trim().toLowerCase()),
      PROMPT_P0_FACT_INVENTORY.version,
      FACT_INVENTORY_SCHEMA_VERSION,
    ].join("|"),
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

interface CurrentResume {
  id: string;
  resumeText: string;
}

export async function resolveCurrentResume(supabase: Db, userId: string): Promise<CurrentResume> {
  const { data } = await supabase
    .from("resumes")
    .select("id, resume_text")
    .eq("user_id", userId)
    .eq("is_current", true)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.id) throw new FactInventoryError("no_resume", "No current resume found for this user.");
  const text = typeof data.resume_text === "string" ? data.resume_text.trim() : "";
  if (text.length < MIN_RESUME_CHARS) {
    throw new FactInventoryError("empty_resume", "The stored resume has no usable text.");
  }
  return { id: data.id, resumeText: text };
}

function rowToState(row: Record<string, any> | null, resumeId: string | null): InventoryState {
  if (!row) {
    return {
      status: "missing",
      resumeId,
      schemaVersion: FACT_INVENTORY_SCHEMA_VERSION,
      promptVersion: PROMPT_P0_FACT_INVENTORY.version,
      model: null,
      sourceHashPrefix: null,
      factCount: 0,
      generatedAt: null,
      error: null,
    };
  }
  const inv = (row.inventory_json ?? null) as ResumeFactInventory | null;
  return {
    status: row.status as InventoryStatus,
    resumeId: row.resume_id ?? resumeId,
    schemaVersion: row.schema_version,
    promptVersion: row.prompt_version,
    model: row.model ?? null,
    sourceHashPrefix: typeof row.source_hash === "string" ? row.source_hash.slice(0, 12) : null,
    factCount: inv ? countFacts(inv) : 0,
    generatedAt: row.generated_at ?? null,
    error: row.error ?? null,
  };
}

async function loadRow(supabase: Db, userId: string, resumeId: string) {
  const { data } = await supabase
    .from(FACT_INVENTORY_TABLE)
    .select("*")
    .eq("user_id", userId)
    .eq("resume_id", resumeId)
    .eq("schema_version", FACT_INVENTORY_SCHEMA_VERSION)
    .eq("prompt_version", PROMPT_P0_FACT_INVENTORY.version)
    .maybeSingle();
  return data ?? null;
}

/** Read-only status for the current resume. Never triggers extraction. */
export async function getFactInventoryState(
  supabase: Db,
  userId: string,
  opts: { includeInventory?: boolean } = {},
): Promise<InventoryState> {
  let resume: CurrentResume;
  try {
    resume = await resolveCurrentResume(supabase, userId);
  } catch {
    return rowToState(null, null);
  }
  const row = await loadRow(supabase, userId, resume.id);
  const state = rowToState(row, resume.id);

  if (row) {
    const expected = await computeSourceHash(resume.id, resume.resumeText);
    if (row.status === "ready" && row.source_hash !== expected) state.status = "stale";
    if (
      row.status === "extracting" &&
      row.generation_started_at &&
      Date.now() - new Date(row.generation_started_at).getTime() > STALE_LOCK_MS
    ) {
      state.status = "failed";
      state.error = "Extraction timed out";
    }
    if (opts.includeInventory && state.status === "ready") {
      state.inventory = (row.inventory_json ?? null) as ResumeFactInventory | null;
    }
  }
  return state;
}

/**
 * Idempotent, concurrency-safe extraction.
 * Zero AI calls when a ready inventory already matches the source hash.
 */
export async function ensureFactInventory(
  supabase: Db,
  userId: string,
  opts: { force?: boolean; includeInventory?: boolean } = {},
): Promise<InventoryState> {
  const resume = await resolveCurrentResume(supabase, userId);
  const sourceHash = await computeSourceHash(resume.id, resume.resumeText);
  const existing = await loadRow(supabase, userId, resume.id);

  // 1. Idempotent short-circuit — same resume + hash + versions already ready.
  if (
    !opts.force &&
    existing?.status === "ready" &&
    existing.source_hash === sourceHash &&
    existing.inventory_json
  ) {
    return { ...rowToState(existing, resume.id), ...(opts.includeInventory ? { inventory: existing.inventory_json } : {}) };
  }

  // 2. Another extraction already in flight (and not stale) — do not duplicate.
  if (
    existing?.status === "extracting" &&
    existing.generation_started_at &&
    Date.now() - new Date(existing.generation_started_at).getTime() < STALE_LOCK_MS
  ) {
    return rowToState(existing, resume.id);
  }

  // 3. Acquire the generation lock.
  const generationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const lockPayload = {
    user_id: userId,
    resume_id: resume.id,
    schema_version: FACT_INVENTORY_SCHEMA_VERSION,
    prompt_version: PROMPT_P0_FACT_INVENTORY.version,
    status: "extracting" as const,
    source_hash: sourceHash,
    generation_id: generationId,
    generation_started_at: now,
    error: null,
  };

  const { data: locked, error: lockErr } = await supabase
    .from(FACT_INVENTORY_TABLE)
    .upsert(lockPayload, { onConflict: "user_id,resume_id,schema_version,prompt_version" })
    .select("id, generation_id")
    .maybeSingle();

  if (lockErr) throw new FactInventoryError("lock_failed", "Could not start extraction.");
  if (!locked || locked.generation_id !== generationId) {
    return rowToState(await loadRow(supabase, userId, resume.id), resume.id);
  }

  // 4. Run the pinned P0 prompt (one strict corrective retry inside).
  try {
    const { value: draft } = await runPromptValidated(
      PROMPT_P0_FACT_INVENTORY,
      buildFactInventoryUser(resume.resumeText.slice(0, MAX_RESUME_CHARS)),
      validateFactInventoryShape,
      FACT_INVENTORY_RETRY_INSTRUCTION,
      { timeoutMs: AI_TIMEOUT_MS },
    );

    // 5. Deterministic grounding guardrails.
    const { inventory, rejections } = applyGrounding(
      draft,
      resume.resumeText.slice(0, MAX_RESUME_CHARS),
      resume.id,
    );

    if (rejections.length) {
      console.warn(
        JSON.stringify({
          evt: "p0_facts_rejected",
          prompt: PROMPT_P0_FACT_INVENTORY.id,
          count: rejections.length,
          reasons: [...new Set(rejections.map((r) => r.reason))],
        }),
      );
    }

    // 6. Commit only while we still own the lock.
    const { data: committed } = await supabase
      .from(FACT_INVENTORY_TABLE)
      .update({
        status: "ready",
        inventory_json: inventory,
        model: PROMPT_P0_FACT_INVENTORY.model,
        generated_at: new Date().toISOString(),
        generation_id: null,
        generation_started_at: null,
        error: null,
      })
      .eq("user_id", userId)
      .eq("resume_id", resume.id)
      .eq("generation_id", generationId)
      .select("*")
      .maybeSingle();

    if (!committed) {
      // A newer run took over — never overwrite fresher inventory.
      return rowToState(await loadRow(supabase, userId, resume.id), resume.id);
    }
    const state = rowToState(committed, resume.id);
    if (opts.includeInventory) state.inventory = inventory;
    return state;
  } catch (e) {
    const code =
      e instanceof PromptError
        ? e.code
        : e instanceof GroundingError
          ? "grounding_failed"
          : "extraction_failed";
    console.error(
      JSON.stringify({
        evt: "p0_extraction_failed",
        code,
        model: PROMPT_P0_FACT_INVENTORY.model,
        prompt: PROMPT_P0_FACT_INVENTORY.id,
      }),
    );
    // Persist safe error metadata only — never fabricated fallback facts.
    await supabase
      .from(FACT_INVENTORY_TABLE)
      .update({
        status: "failed",
        inventory_json: null,
        error: code,
        generation_id: null,
        generation_started_at: null,
      })
      .eq("user_id", userId)
      .eq("resume_id", resume.id)
      .eq("generation_id", generationId);

    throw new FactInventoryError(
      code,
      code === "model_unavailable" || code === "not_configured"
        ? "Profile context preparation is temporarily unavailable."
        : "We couldn't prepare your profile context.",
    );
  }
}

// Server-only A -> J answer pipeline.
//
// Detected question
//   -> Prompt I classification
//   -> requireReadyFactInventory()          (the ONLY grounding gate)
//   -> resolve generation mode server-side
//   -> Prompt A (opus, temp 0.3)
//   -> deterministic guards
//   -> Prompt J (opus, temp 0)
//   -> at most one controlled repair + re-scan
//   -> snapshot revalidation + persist
//   -> return only validated answers
//
// Raw resume text never enters this module. No fact, framework, model, prompt
// version, voice card or user id is ever accepted from the browser.
import { classifyQuestion, ClassificationError } from "./classify-question.server";
import { requireReadyFactInventory, ensureReadyFactInventory, FactInventoryError, sha256Hex } from "./fact-inventory.server";
import { flattenInventory, toPromptFacts, type FlattenedInventory } from "./answer-facts";
import { runAnswerGuards, type GuardViolation } from "./answer-guards";
import { PromptError, runPromptValidated } from "./run-prompt.server";
import {
  ANSWER_RETRY_INSTRUCTION,
  PROMPT_A_ANSWER_GENERATION,
  FRAMEWORK_STRUCTURE,
  buildAnswerUser,
  countWords,
  sanitizeJobContextText,
  validateGeneratedAnswer,
  type VariantId,
} from "./prompts/prompt-a-answer-generation";
import {
  PROMPT_J_QUALITY_SCAN,
  QUALITY_SCAN_RETRY_INSTRUCTION,
  buildQualityScanUser,
  hasHardBlocker,
  validateQualityScan,
} from "./prompts/prompt-j-quality-scan";
import { PROMPT_I_CLASSIFICATION } from "./prompts/prompt-i-classification";
import type { QuestionFramework } from "./prompts/prompt-i-classification";
import { auditAnswerRules, type AnswerRuleAudit } from "./answer-rule-audit";
import { extractPartialJsonString } from "./anthropic-stream.server";

export const ANSWERS_TABLE = "generated_answers";
const STALE_LOCK_MS = 180 * 1000;
const MAX_QUESTION_CHARS = 2000;

export type GenerationMode = "writedna" | "resume_only_first_choice" | "resume_only_learned";

export class AnswerPipelineError extends Error {
  readonly code: string;
  /** Internal reason codes for diagnostics. Never shown to users. */
  readonly reasonCodes: string[];
  constructor(code: string, message: string, reasonCodes: string[] = []) {
    super(message);
    this.name = "AnswerPipelineError";
    this.code = code;
    this.reasonCodes = reasonCodes;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export interface JobContextInput {
  title?: string;
  company?: string;
  description?: string;
}

export interface AnswerRequest {
  question: string;
  jobContext?: JobContextInput | null;
  force?: boolean;
}

export interface AnswerVariant {
  id: VariantId;
  answer: string;
  wordCount: number;
  factIdsUsed: string[];
}

export interface AnswerResult {
  status: "ready";
  mode: GenerationMode;
  answerId: string;
  /** Present for writedna / resume_only_learned. */
  answer: string | null;
  wordCount: number | null;
  /** Present only for resume_only_first_choice. */
  variants: AnswerVariant[] | null;
  cached: boolean;
  needsVariantChoice: boolean;
}

interface Budget {
  logicalScans: number;
  providerCalls: number;
  repairs: number;
}

async function resolveWriteDb(injected?: Db): Promise<Db> {
  if (injected) return injected;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/* ------------------------------------------------------------------ */
/* Generation mode                                                     */
/* ------------------------------------------------------------------ */

export interface ProfileSnapshot {
  resumeOnly: boolean;
  voiceCardStatus: string | null;
  voiceCardData: unknown | null;
  voiceCardSourceHash: string | null;
  voiceCardPromptVersion: string | null;
  writedimensionStage: string | null;
  fallbackChoiceCompleted: boolean;
  preferredVariantId: string | null;
}

export function resolveGenerationMode(p: ProfileSnapshot): GenerationMode {
  const hasVoiceCard = p.voiceCardStatus === "generated" && !!p.voiceCardData;
  if (hasVoiceCard && !p.resumeOnly) return "writedna";
  return p.fallbackChoiceCompleted ? "resume_only_learned" : "resume_only_first_choice";
}

const STYLE_NOTE: Record<string, string> = {
  A: "Short declarative sentences, outcome first, plain everyday register.",
  B: "Longer connected sentences, context first, measured and slightly formal register.",
};

async function loadProfile(supabase: Db, userId: string): Promise<ProfileSnapshot> {
  const { data } = await supabase
    .from("profiles")
    .select(
      "resume_only, voice_card_status, voice_card_data, voice_card_source_hash, voice_card_prompt_version, writedna_stage, fallback_choice_completed, preferred_variant_id",
    )
    .eq("id", userId)
    .maybeSingle();
  if (!data) throw new AnswerPipelineError("no_profile", "We couldn't load your profile.");
  return {
    resumeOnly: data.resume_only === true,
    voiceCardStatus: data.voice_card_status ?? null,
    voiceCardData: data.voice_card_data ?? null,
    voiceCardSourceHash: data.voice_card_source_hash ?? null,
    voiceCardPromptVersion: data.voice_card_prompt_version ?? null,
    writedimensionStage: data.writedna_stage ?? null,
    fallbackChoiceCompleted: data.fallback_choice_completed === true,
    preferredVariantId: data.preferred_variant_id ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Cache identity                                                      */
/* ------------------------------------------------------------------ */

export function normalizeQuestionText(question: string): string {
  return question.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ?]/g, "").trim();
}

function normalizeJobContext(job?: JobContextInput | null): string {
  if (!job) return "";
  return [job.title, job.company, job.description]
    .filter(Boolean)
    .map((v) => sanitizeJobContextText(String(v)))
    .join(" | ")
    .toLowerCase();
}

/** Every generation-affecting input contributes to the cache identity. */
export async function computeAnswerCacheKey(input: {
  question: string;
  framework: QuestionFramework;
  mode: GenerationMode;
  inventorySourceHash: string;
  voiceCardSourceHash: string | null;
  voiceCardPromptVersion: string | null;
  writednaStage: string | null;
  preferredVariantId: string | null;
  jobContext?: JobContextInput | null;
}): Promise<{ cacheKey: string; questionHash: string; jobContextHash: string | null }> {
  const questionHash = await sha256Hex(normalizeQuestionText(input.question));
  const jobNorm = normalizeJobContext(input.jobContext);
  const jobContextHash = jobNorm ? await sha256Hex(jobNorm) : null;
  const cacheKey = await sha256Hex(
    [
      questionHash,
      input.framework,
      input.mode,
      input.inventorySourceHash,
      PROMPT_I_CLASSIFICATION.version,
      PROMPT_A_ANSWER_GENERATION.version,
      PROMPT_J_QUALITY_SCAN.version,
      PROMPT_A_ANSWER_GENERATION.model,
      PROMPT_J_QUALITY_SCAN.model,
      input.voiceCardSourceHash ?? "no-voice-card",
      input.voiceCardPromptVersion ?? "-",
      input.writednaStage ?? "-",
      input.preferredVariantId ?? "-",
      jobContextHash ?? "no-job-context",
    ].join("|"),
  );
  return { cacheKey, questionHash, jobContextHash };
}

/* ------------------------------------------------------------------ */
/* Single validated answer (A -> guards -> J -> repair -> re-scan)     */
/* ------------------------------------------------------------------ */

/** Untrusted job context flattened to sanitized plain text ("" when absent). */
function jobContextToText(job?: JobContextInput | null): string {
  if (!job) return "";
  return [job.title, job.company, job.description]
    .filter(Boolean)
    .map((v) => sanitizeJobContextText(String(v)))
    .join("\n");
}



interface GenerateOneInput {
  question: string;
  framework: QuestionFramework;
  flat: FlattenedInventory;
  voiceCard: unknown | null;
  jobContext?: JobContextInput | null;
  variant?: VariantId | null;
  preferredStyleNote?: string | null;
  budget: Budget;
  /**
   * Optional live preview of the Prompt A draft. Delivery only: the text is
   * an UNVALIDATED draft and never replaces the validated answer that this
   * function returns after guards + Prompt J + repair + post-guard.
   */
  onDraftDelta?: ((text: string) => void) | null;
}

/** Blocking guard reason codes, de-duplicated. Diagnostics only. */
function guardCodes(v: GuardViolation[]): string[] {
  return [...new Set(v.filter((x) => x.blocking !== false).map((x) => x.code))];
}

async function scan(
  input: GenerateOneInput,
  answer: string,
  opts: { deterministicViolations?: string[]; requireRevision?: boolean } = {},
) {
  input.budget.logicalScans += 1;
  const run = await runPromptValidated(
    PROMPT_J_QUALITY_SCAN,
    buildQualityScanUser({
      question: input.question,
      framework: input.framework,
      answer,
      voiceCard: input.voiceCard,
      facts: toPromptFacts(input.flat),
      jobContext: jobContextToText(input.jobContext) || null,
      deterministicViolations: opts.deterministicViolations ?? null,
      requireRevision: opts.requireRevision === true,
    }),
    validateQualityScan,
    QUALITY_SCAN_RETRY_INSTRUCTION,
  );
  input.budget.providerCalls += run.attempts;
  return run.value;
}

function logGuardFailure(stage: string, guards: ReturnType<typeof runAnswerGuards>) {
  console.warn(
    JSON.stringify({
      evt: "answer_guard_failed",
      stage,
      codes: guardCodes(guards.violations),
      details: guards.violations.filter((v) => v.blocking !== false).map((v) => v.detail),
    }),
  );
}

/** Human-readable constraint feedback for Prompt J. Never contains user data. */
function guardFeedback(guards: ReturnType<typeof runAnswerGuards>): string[] {
  return guards.violations
    .filter((v) => v.blocking !== false)
    .map((v) => `${v.code}: ${v.detail}`);
}

function qualityFailed(codes: string[]): AnswerPipelineError {
  return new AnswerPipelineError(
    "quality_failed",
    "We couldn't produce an answer you can trust. Try again.",
    [...new Set(codes)],
  );
}

export async function generateValidatedVariant(input: GenerateOneInput): Promise<{
  answer: string;
  factIdsUsed: string[];
  wordCount: number;
  blockingCodes: string[];
  revisionCount: number;
  ruleAudit: AnswerRuleAudit;
}> {
  const promptFacts = toPromptFacts(input.flat);
  const allowedIds = promptFacts.map((f) => f.id);

  // 1. Prompt A (one strict format retry inside the runner).
  // Draft preview: forward ONLY the incremental `answer` field of the model's
  // JSON. The JSON envelope, fact ids and every other internal field stay
  // server-side.
  let previewBuffer = "";
  let previewSent = "";
  const onDelta = input.onDraftDelta
    ? (chunk: string) => {
        previewBuffer += chunk;
        const soFar = extractPartialJsonString(previewBuffer, "answer");
        if (soFar.length > previewSent.length) {
          const delta = soFar.slice(previewSent.length);
          previewSent = soFar;
          input.onDraftDelta?.(delta);
        }
      }
    : undefined;

  const a = await runPromptValidated(
    PROMPT_A_ANSWER_GENERATION,
    buildAnswerUser({
      question: input.question,
      framework: input.framework,
      frameworkStructure: FRAMEWORK_STRUCTURE[input.framework],
      voiceCard: input.voiceCard,
      facts: promptFacts,
      jobContext: input.jobContext ?? null,
      variant: input.variant ?? null,
      preferredStyleNote: input.preferredStyleNote ?? null,
    }),
    (v) => validateGeneratedAnswer(v, allowedIds),
    ANSWER_RETRY_INSTRUCTION,
    onDelta ? { onDelta } : {},
  );
  input.budget.providerCalls += a.attempts;
  const draft = a.value;

  // Deterministic 29-rule audit of whatever answer ends up shipping.
  // Evidence only: it never blocks and never calls a model.
  const makeAudit = (answer: string, violations: GuardViolation[], factIdsUsed: string[]) =>
    auditAnswerRules({
      answer,
      flat: input.flat,
      violations,
      factIdsUsed,
      allowedFactIds: allowedIds,
      jobContextText: jobContextToText(input.jobContext),
    });

  // 2. Deterministic guards on the draft.
  const draftGuards = runAnswerGuards(draft.answer, input.flat);

  // 3. Prompt J initial scan.
  const firstScan = await scan(input, draft.answer);

  // 4. Clean answers are shipped untouched — never paraphrase a passing answer.
  if (firstScan.passed && draftGuards.passed) {
    return {
      answer: draft.answer,
      factIdsUsed: draft.factIdsUsed,
      wordCount: draft.wordCount,
      blockingCodes: [],
      revisionCount: 0,
      ruleAudit: makeAudit(draft.answer, draftGuards.violations, draft.factIdsUsed),
    };
  }

  if (!draftGuards.passed) logGuardFailure("draft", draftGuards);

  // 5. A draft that only fails soft advisory checks (and passes every
  //    deterministic guard and every hard blocker) ships as-is. Soft checks are
  //    stylistic opinions; failing closed on them is a false-positive rejection.
  if (draftGuards.passed && !hasHardBlocker(firstScan) && !firstScan.revisedAnswer) {
    return {
      answer: draft.answer,
      factIdsUsed: draft.factIdsUsed,
      wordCount: draft.wordCount,
      blockingCodes: firstScan.blockingCodes,
      revisionCount: 0,
      ruleAudit: makeAudit(draft.answer, draftGuards.violations, draft.factIdsUsed),
    };
  }

  // 6. Repair path. At most two revision attempts, no unbounded loop.
  let candidate = firstScan.revisedAnswer;
  let corrections = 0;

  // The scan produced no revision but the deterministic guards rejected the
  // draft: spend the single correction opportunity telling J exactly which
  // deterministic constraints were violated.
  if (!candidate) {
    if (draftGuards.passed) {
      throw qualityFailed([...firstScan.blockingCodes]);
    }
    corrections += 1;
    const forced = await scan(input, draft.answer, {
      deterministicViolations: guardFeedback(draftGuards),
      requireRevision: true,
    });
    candidate = forced.revisedAnswer;
    if (!candidate) {
      throw qualityFailed([...guardCodes(draftGuards.violations), ...forced.blockingCodes]);
    }
  }
  input.budget.repairs += 1;

  // 7. Deterministic validation of the revision, before any re-scan.
  let candidateGuards = runAnswerGuards(candidate, input.flat);
  if (!candidateGuards.passed) {
    logGuardFailure("repair", candidateGuards);
    if (corrections >= 1) {
      throw qualityFailed(guardCodes(candidateGuards.violations));
    }
    corrections += 1;
    const corrected = await scan(input, candidate, {
      deterministicViolations: guardFeedback(candidateGuards),
      requireRevision: true,
    });
    input.budget.repairs += 1;
    if (!corrected.revisedAnswer) {
      throw qualityFailed(guardCodes(candidateGuards.violations));
    }
    candidate = corrected.revisedAnswer;
    candidateGuards = runAnswerGuards(candidate, input.flat);
    if (!candidateGuards.passed) {
      logGuardFailure("repair_2", candidateGuards);
      throw qualityFailed(guardCodes(candidateGuards.violations));
    }
  }

  // 8. Final re-scan. Only hard blockers can stop a deterministically clean
  //    answer; soft checks are recorded as diagnostics.
  const finalScan = await scan(input, candidate);
  if (hasHardBlocker(finalScan)) {
    throw qualityFailed(finalScan.blockingCodes);
  }

  // 9. Final deterministic post-guard on exactly what ships.
  const shipGuards = runAnswerGuards(candidate, input.flat);
  if (!shipGuards.passed) {
    logGuardFailure("final", shipGuards);
    throw qualityFailed(guardCodes(shipGuards.violations));
  }

  // 10. Deterministic 29-rule audit of the shipped answer. Evidence only —
  //     it never blocks and never calls a model.
  const ruleAudit = makeAudit(candidate, shipGuards.violations, draft.factIdsUsed);

  return {
    answer: candidate,
    // The repair may drop facts; keep only ids whose value survives verbatim-ish.
    factIdsUsed: draft.factIdsUsed,
    wordCount: countWords(candidate),
    blockingCodes: finalScan.blockingCodes,
    revisionCount: corrections + 1,
    ruleAudit,
  };
}

/* ------------------------------------------------------------------ */
/* Orchestrator                                                        */
/* ------------------------------------------------------------------ */

export async function generateValidatedAnswer(
  supabase: Db,
  userId: string,
  request: AnswerRequest,
  opts: { writeDb?: Db; onDraftDelta?: ((text: string) => void) | null } = {},
): Promise<AnswerResult> {
  const write = await resolveWriteDb(opts.writeDb);
  const question = String(request.question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
  if (question.length < 5) throw new AnswerPipelineError("bad_question", "That question is too short to answer.");

  // 1. Prompt I — server-side classification. Client frameworks are ignored.
  let framework: QuestionFramework;
  try {
    framework = (await classifyQuestion(supabase, question)).framework;
  } catch (e) {
    if (e instanceof ClassificationError) throw new AnswerPipelineError(e.code, e.message);
    throw e;
  }

  // 2. The ONLY grounding gate.
  let gate: Awaited<ReturnType<typeof requireReadyFactInventory>>;
  try {
    gate = await ensureReadyFactInventory(supabase, userId, { writeDb: write });
  } catch (e) {
    if (e instanceof FactInventoryError) throw new AnswerPipelineError(e.code, e.message);
    throw e;
  }

  const flat = flattenInventory(gate.inventory);
  if (flat.facts.length === 0) {
    throw new AnswerPipelineError("inventory_empty", "Your profile context has no usable facts yet.");
  }

  // 3. Mode + voice context.
  const profile = await loadProfile(supabase, userId);
  const mode = resolveGenerationMode(profile);
  const voiceCard = mode === "writedna" ? profile.voiceCardData : null;
  const preferredStyleNote =
    mode === "resume_only_learned" && profile.preferredVariantId
      ? (STYLE_NOTE[profile.preferredVariantId] ?? null)
      : null;

  // 4. Cache identity across every generation-affecting input.
  const { cacheKey, questionHash, jobContextHash } = await computeAnswerCacheKey({
    question,
    framework,
    mode,
    inventorySourceHash: gate.sourceHash,
    voiceCardSourceHash: profile.voiceCardSourceHash,
    voiceCardPromptVersion: profile.voiceCardPromptVersion,
    writednaStage: profile.writedimensionStage,
    preferredVariantId: profile.preferredVariantId,
    jobContext: request.jobContext,
  });

  const existing = await loadAnswerRow(supabase, userId, cacheKey);

  // 5. Cache hit — zero model calls.
  if (!request.force && existing?.status === "ready") {
    return rowToResult(existing, true);
  }

  // 6. Another generation already in flight.
  if (
    existing?.status === "generating" &&
    existing.generation_started_at &&
    Date.now() - new Date(existing.generation_started_at).getTime() < STALE_LOCK_MS
  ) {
    throw new AnswerPipelineError("in_progress", "Your answer is still being written.");
  }

  // 7. Take the generation lock.
  const generationId = crypto.randomUUID();
  const { data: locked, error: lockErr } = await write
    .from(ANSWERS_TABLE)
    .upsert(
      {
        user_id: userId,
        resume_id: gate.resumeId,
        cache_key: cacheKey,
        question_hash: questionHash,
        question_text: question,
        framework,
        mode,
        status: "generating",
        generation_id: generationId,
        generation_started_at: new Date().toISOString(),
        quality_passed: false,
        error: null,
        prompt_i_version: PROMPT_I_CLASSIFICATION.version,
        prompt_a_version: PROMPT_A_ANSWER_GENERATION.version,
        prompt_j_version: PROMPT_J_QUALITY_SCAN.version,
        model_a: PROMPT_A_ANSWER_GENERATION.model,
        model_j: PROMPT_J_QUALITY_SCAN.model,
        inventory_source_hash: gate.sourceHash,
        voice_card_source_hash: profile.voiceCardSourceHash,
        writedna_version: profile.writedimensionStage,
        job_context_hash: jobContextHash,
      },
      { onConflict: "user_id,cache_key" },
    )
    .select("id, generation_id")
    .maybeSingle();

  if (lockErr) throw new AnswerPipelineError("lock_failed", "We couldn't start writing your answer.");
  if (!locked || locked.generation_id !== generationId) {
    throw new AnswerPipelineError("in_progress", "Your answer is still being written.");
  }

  const budget: Budget = { logicalScans: 0, providerCalls: 0, repairs: 0 };
  const base = {
    question,
    framework,
    flat,
    voiceCard,
    jobContext: request.jobContext ?? null,
    preferredStyleNote,
    budget,
  };

  try {
    let variants: AnswerVariant[] | null = null;
    let answerText: string | null = null;
    let wordCount: number | null = null;
    let factIds: string[] = [];
    let revisionCount = 0;
    let blockingCodes: string[] = [];
    // Deterministic 29-rule audit of exactly what ships. Never blocks.
    let ruleAudit: AnswerRuleAudit | Record<string, AnswerRuleAudit> | null = null;

    if (mode === "resume_only_first_choice") {
      // Both variants are validated independently. A half-valid pair is never shown.
      const [va, vb] = await Promise.all([
        generateValidatedVariant({ ...base, variant: "A" }),
        generateValidatedVariant({ ...base, variant: "B" }),
      ]);
      variants = [
        { id: "A", answer: va.answer, wordCount: va.wordCount, factIdsUsed: va.factIdsUsed },
        { id: "B", answer: vb.answer, wordCount: vb.wordCount, factIdsUsed: vb.factIdsUsed },
      ];
      factIds = [...new Set([...va.factIdsUsed, ...vb.factIdsUsed])];
      revisionCount = va.revisionCount + vb.revisionCount;
      blockingCodes = [...new Set([...va.blockingCodes, ...vb.blockingCodes])];
      ruleAudit = { A: va.ruleAudit, B: vb.ruleAudit };
    } else {
      // Draft preview is only wired for the single-answer modes; the A/B mode
      // runs two generations concurrently and their deltas would interleave.
      const one = await generateValidatedVariant({ ...base, onDraftDelta: opts.onDraftDelta ?? null });
      answerText = one.answer;
      wordCount = one.wordCount;
      factIds = one.factIdsUsed;
      revisionCount = one.revisionCount;
      blockingCodes = one.blockingCodes;
      ruleAudit = one.ruleAudit;
    }

    // 8. Snapshot revalidation — the source must not have moved under us.
    await assertSnapshotUnchanged(supabase, userId, gate.sourceHash, profile);

    const { data: committed } = await write
      .from(ANSWERS_TABLE)
      .update({
        status: "ready",
        answer_text: answerText,
        word_count: wordCount,
        variants,
        fact_ids_used: factIds,
        quality_passed: true,
        quality_blocking: blockingCodes,
        answer_rule_audit: ruleAudit,
        revision_count: revisionCount,
        logical_scan_count: budget.logicalScans,
        provider_call_count: budget.providerCalls,
        generated_at: new Date().toISOString(),
        generation_id: null,
        generation_started_at: null,
        error: null,
      })
      .eq("user_id", userId)
      .eq("cache_key", cacheKey)
      .eq("generation_id", generationId)
      .select("*")
      .maybeSingle();

    if (!committed) throw new AnswerPipelineError("superseded", "Please try again.");
    return rowToResult(committed, false);
  } catch (e) {
    const code =
      e instanceof AnswerPipelineError
        ? e.code
        : e instanceof PromptError
          ? e.code
          : "pipeline_failed";
    const reasonCodes = e instanceof AnswerPipelineError ? e.reasonCodes : [];
    console.error(
      JSON.stringify({ evt: "answer_pipeline_failed", code, reasonCodes, mode, framework }),
    );

    await write
      .from(ANSWERS_TABLE)
      .update({
        status: "failed",
        answer_text: null,
        variants: null,
        quality_passed: false,
        quality_blocking: reasonCodes,
        error: code,
        revision_count: budget.repairs,
        logical_scan_count: budget.logicalScans,
        provider_call_count: budget.providerCalls,
        generation_id: null,
        generation_started_at: null,
      })
      .eq("user_id", userId)
      .eq("cache_key", cacheKey)
      .eq("generation_id", generationId);

    if (e instanceof AnswerPipelineError) throw e;
    throw new AnswerPipelineError(
      code,
      code === "model_unavailable" || code === "not_configured"
        ? "Answer writing is temporarily unavailable."
        : "We couldn't produce an answer you can trust. Try again.",
    );
  }
}

/** Commit-time guard against resume / Voice Card mutation mid-generation. */
async function assertSnapshotUnchanged(
  supabase: Db,
  userId: string,
  inventorySourceHash: string,
  profile: ProfileSnapshot,
) {
  let fresh: Awaited<ReturnType<typeof requireReadyFactInventory>>;
  try {
    fresh = await requireReadyFactInventory(supabase, userId);
  } catch {
    throw new AnswerPipelineError("source_changed", "Your profile changed while we were writing. Try again.");
  }
  if (fresh.sourceHash !== inventorySourceHash) {
    throw new AnswerPipelineError("source_changed", "Your profile changed while we were writing. Try again.");
  }
  const now = await loadProfile(supabase, userId);
  if (
    now.voiceCardStatus !== profile.voiceCardStatus ||
    now.voiceCardSourceHash !== profile.voiceCardSourceHash ||
    now.fallbackChoiceCompleted !== profile.fallbackChoiceCompleted
  ) {
    throw new AnswerPipelineError("source_changed", "Your profile changed while we were writing. Try again.");
  }
}

async function loadAnswerRow(supabase: Db, userId: string, cacheKey: string) {
  const { data } = await supabase
    .from(ANSWERS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .eq("cache_key", cacheKey)
    .maybeSingle();
  return data ?? null;
}

function rowToResult(row: Record<string, any>, cached: boolean): AnswerResult {
  const variants = Array.isArray(row.variants) ? (row.variants as AnswerVariant[]) : null;
  return {
    status: "ready",
    mode: row.mode as GenerationMode,
    answerId: row.id,
    answer: row.answer_text ?? null,
    wordCount: row.word_count ?? null,
    variants,
    cached,
    needsVariantChoice: row.mode === "resume_only_first_choice" && !!variants,
  };
}

/* ------------------------------------------------------------------ */
/* Resume-only variant selection                                       */
/* ------------------------------------------------------------------ */

/**
 * Stores the phrasing preference as a future voice signal. No Edit-Delta DNA
 * recalculation happens here, and no synthetic Voice Card is created.
 */
export async function recordVariantPreference(
  supabase: Db,
  userId: string,
  answerId: string,
  variantId: VariantId,
  opts: { writeDb?: Db } = {},
): Promise<{ ok: true; answer: string }> {
  if (variantId !== "A" && variantId !== "B") {
    throw new AnswerPipelineError("bad_variant", "Unknown option.");
  }
  const write = await resolveWriteDb(opts.writeDb);
  const { data: row } = await supabase
    .from(ANSWERS_TABLE)
    .select("id, user_id, variants, mode, status")
    .eq("id", answerId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!row || row.status !== "ready" || !Array.isArray(row.variants)) {
    throw new AnswerPipelineError("not_found", "That answer is no longer available.");
  }
  const chosen = (row.variants as AnswerVariant[]).find((v) => v.id === variantId);
  if (!chosen) throw new AnswerPipelineError("not_found", "That option is no longer available.");

  await write
    .from("profiles")
    .update({
      fallback_choice_completed: true,
      preferred_variant_id: variantId,
      preferred_variant_answer_id: answerId,
      preferred_variant_selected_at: new Date().toISOString(),
    })
    .eq("id", userId);

  await write
    .from(ANSWERS_TABLE)
    .update({ answer_text: chosen.answer, word_count: chosen.wordCount })
    .eq("id", answerId)
    .eq("user_id", userId);

  return { ok: true, answer: chosen.answer };
}

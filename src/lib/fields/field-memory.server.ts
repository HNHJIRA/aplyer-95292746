// Server-side application field memory.
//
// SECURITY MODEL
// - Every row is scoped to the authenticated user id resolved server-side.
//   A user id is never accepted from the browser.
// - Writes go through supabaseAdmin (the table grants no INSERT/UPDATE to
//   `authenticated`), so a stolen anon token cannot forge or edit memory.
// - Sensitive questions (password, SSN, government id, banking, security
//   questions) are refused at both resolve and save time.
// - A user-confirmed correction is never silently overwritten by an
//   unconfirmed suggestion.
import {
  isFieldType,
  isSensitiveQuestion,
  mayAutofill,
  normalizeQuestion,
  normalizeYesNo,
  type FieldConfidence,
  type FieldType,
} from "./field-types";
import { matchQuestion, type MatchCandidate } from "./question-match";

const TABLE = "application_field_answers";
const MAX_FIELDS_PER_REQUEST = 60;
const MAX_OPTIONS = 60;

type Db = { from: (t: string) => any };

export class FieldMemoryError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "FieldMemoryError";
  }
}

export interface FieldQuery {
  fieldId: string;
  questionText: string;
  fieldType: FieldType;
  options?: string[];
}

export type FieldAction = "FILL" | "ASK" | "SKIP";

export interface FieldDecision {
  fieldId: string;
  action: FieldAction;
  /** Present only for FILL. */
  value: string | null;
  confidence: FieldConfidence;
  reason: string;
  fieldType: FieldType;
  /** Options the user may pick from when action is ASK. */
  options: string[];
  questionText: string;
  /** Hash of the remembered answer that was used; present only for FILL. */
  memoryHash?: string;

}

interface MemoryRow extends MatchCandidate {
  id: string;
  fieldType: string;
  answerValue: string;
  optionsSnapshot: string[];
  confirmedByUser: boolean;
  updatedAt: string;
}

export function sanitizeOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((o) => String(o ?? "").trim())
    .filter((o) => o.length > 0 && o.length <= 200)
    .slice(0, MAX_OPTIONS);
}

export function normalizeFieldQueries(input: unknown): FieldQuery[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_FIELDS_PER_REQUEST).flatMap((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const questionText = String(r.questionText ?? "").trim().slice(0, 500);
    const fieldId = String(r.fieldId ?? "").slice(0, 200);
    const fieldType = isFieldType(r.fieldType) ? r.fieldType : "UNKNOWN";
    if (!fieldId || questionText.length < 2) return [];
    return [{ fieldId, questionText, fieldType, options: sanitizeOptions(r.options) }];
  });
}

async function loadMemory(db: Db, userId: string): Promise<MemoryRow[]> {
  const { data } = await db
    .from(TABLE)
    .select(
      "id, question_hash, normalized_question, question_text, field_type, answer_value, options_snapshot, confirmed_by_user, updated_at",
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(500);

  return (data ?? []).map((r: Record<string, any>) => ({
    id: r.id,
    questionHash: r.question_hash,
    normalizedQuestion: r.normalized_question,
    questionText: r.question_text,
    fieldType: r.field_type,
    answerValue: r.answer_value,
    optionsSnapshot: Array.isArray(r.options_snapshot) ? r.options_snapshot : [],
    confirmedByUser: r.confirmed_by_user === true,
    updatedAt: r.updated_at,
  }));
}

/** A remembered value is only usable if it is still one of the live options. */
function valueIsSelectable(value: string, options: string[], fieldType: FieldType): string | null {
  if (fieldType === "YES_NO") {
    const yn = normalizeYesNo(value);
    if (!yn) return null;
    if (options.length === 0) return yn;
    const hit = options.find((o) => normalizeYesNo(o) === yn || normalizeQuestion(o) === normalizeQuestion(yn));
    return hit ?? null;
  }
  if (options.length === 0) return value;
  const exact = options.find((o) => o === value);
  if (exact) return exact;
  const loose = options.find((o) => normalizeQuestion(o) === normalizeQuestion(value));
  return loose ?? null;
}

/**
 * Decides, per field, whether Aplyer may fill it, must ask the user, or must
 * leave it alone entirely. This is the single decision point used by
 * "Autofill All".
 */
export async function resolveFieldAnswers(
  db: Db,
  userId: string,
  fields: FieldQuery[],
): Promise<FieldDecision[]> {
  const memory = await loadMemory(db, userId);

  return fields.map((f): FieldDecision => {
    const options = sanitizeOptions(f.options);
    const base = {
      fieldId: f.fieldId,
      fieldType: f.fieldType,
      options,
      questionText: f.questionText,
    };

    if (isSensitiveQuestion(f.questionText)) {
      return { ...base, action: "SKIP", value: null, confidence: "LOW", reason: "sensitive_field" };
    }
    if (f.fieldType === "FILE" || f.fieldType === "UNKNOWN") {
      return { ...base, action: "SKIP", value: null, confidence: "LOW", reason: "unsupported_field_type" };
    }

    // Only memory of the same field type may answer a field.
    const candidates = memory.filter((m) => m.fieldType === f.fieldType);
    const { match, confidence, similarity: score } = matchQuestion(f.questionText, candidates);

    if (!match) {
      return { ...base, action: "ASK", value: null, confidence: "LOW", reason: "no_memory" };
    }
    const usable = valueIsSelectable(match.answerValue, options, f.fieldType);
    if (!usable) {
      return { ...base, action: "ASK", value: null, confidence: "LOW", reason: "saved_value_not_available" };
    }
    if (!mayAutofill(confidence)) {
      return { ...base, action: "ASK", value: usable, confidence, reason: "low_confidence" };
    }
    return {
      ...base,
      action: "FILL",
      value: usable,
      confidence,
      reason: confidence === "HIGH" ? "exact_previous_answer" : `similar_question_${score.toFixed(2)}`,
    };
  });
}

export interface SaveFieldAnswerInput {
  questionText: string;
  fieldType: FieldType;
  answerValue: string;
  options?: string[];
  /** "user" = explicitly chosen, "correction" = user edited an autofill. */
  source?: "user" | "correction" | "suggestion";
  confirmedByUser?: boolean;
}

/**
 * Upserts one remembered answer. A confirmed answer can only be replaced by
 * another confirmed answer — an unconfirmed suggestion never overwrites a
 * correction the user made.
 */
export async function saveFieldAnswer(
  db: Db,
  userId: string,
  input: SaveFieldAnswerInput,
): Promise<{ ok: true; questionHash: string; overwritten: boolean }> {
  const questionText = String(input.questionText ?? "").trim().slice(0, 500);
  if (questionText.length < 2) throw new FieldMemoryError("bad_question", "That question is too short to remember.");
  if (isSensitiveQuestion(questionText)) {
    throw new FieldMemoryError("sensitive_field", "Aplyer never stores answers to this kind of question.");
  }
  if (!isFieldType(input.fieldType) || input.fieldType === "FILE" || input.fieldType === "UNKNOWN") {
    throw new FieldMemoryError("unsupported_field_type", "This field type can't be remembered.");
  }

  let answerValue = String(input.answerValue ?? "").trim().slice(0, 500);
  if (input.fieldType === "YES_NO") {
    const yn = normalizeYesNo(answerValue);
    if (!yn) throw new FieldMemoryError("bad_answer", "Pick Yes or No.");
    answerValue = yn;
  }
  if (!answerValue) throw new FieldMemoryError("bad_answer", "There is no answer to remember.");

  const normalized = normalizeQuestion(questionText);
  const questionHash = await sha256Hex(`${input.fieldType}|${normalized}`);
  const confirmed = input.confirmedByUser !== false;
  const source = input.source ?? "user";

  const { data: existing } = await db
    .from(TABLE)
    .select("id, confirmed_by_user, answer_value")
    .eq("user_id", userId)
    .eq("question_hash", questionHash)
    .eq("field_type", input.fieldType)
    .maybeSingle();

  if (existing?.confirmed_by_user === true && !confirmed) {
    // Never silently overwrite a user-confirmed correction.
    return { ok: true, questionHash, overwritten: false };
  }

  const now = new Date().toISOString();
  const { error } = await db.from(TABLE).upsert(
    {
      user_id: userId,
      question_hash: questionHash,
      normalized_question: normalized,
      question_text: questionText,
      field_type: input.fieldType,
      answer_value: answerValue,
      options_snapshot: sanitizeOptions(input.options),
      source,
      confidence: confirmed ? "HIGH" : "LOW",
      confirmed_by_user: confirmed,
      last_used_at: now,
      updated_at: now,
    },
    { onConflict: "user_id,question_hash,field_type" },
  );

  if (error) throw new FieldMemoryError("save_failed", "We couldn't save that answer.");
  return { ok: true, questionHash, overwritten: Boolean(existing) };
}

/** Records that remembered answers were actually used on a page. */
export async function markFieldAnswersUsed(db: Db, userId: string, questionHashes: string[]) {
  const hashes = [...new Set(questionHashes.filter(Boolean))].slice(0, MAX_FIELDS_PER_REQUEST);
  if (hashes.length === 0) return;
  await db
    .from(TABLE)
    .update({ last_used_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("question_hash", hashes);
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

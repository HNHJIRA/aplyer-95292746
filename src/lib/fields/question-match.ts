// Deterministic question matching for field memory.
//
// Applications reword the same question constantly ("Will you need sponsorship
// now or in the future?" vs "Do you require visa sponsorship?"). Matching is
// deterministic and local: normalize, hash, and fall back to token similarity.
// No model call is ever made for this.
import { normalizeQuestion, type FieldConfidence } from "./field-types";

/** Words that carry no discriminating signal in application questions. */
const STOP_WORDS = new Set([
  "a", "an", "the", "do", "does", "did", "are", "is", "was", "were", "you", "your",
  "yours", "will", "would", "can", "could", "should", "have", "has", "had", "any",
  "to", "of", "in", "on", "for", "at", "by", "or", "and", "with", "this", "that",
  "please", "select", "choose", "if", "be", "been", "we", "us", "our", "it", "as",
  "now", "future", "currently", "ever", "may", "must", "need", "needs",
]);

/** Domain synonyms folded to one canonical token before comparison. */
const SYNONYMS: Record<string, string> = {
  visa: "sponsorship",
  sponsor: "sponsorship",
  sponsoring: "sponsorship",
  sponsorships: "sponsorship",
  require: "requirement",
  required: "requirement",
  requires: "requirement",
  requiring: "requirement",
  authorised: "authorized",
  authorisation: "authorization",
  authorized: "authorized",
  authorization: "authorized",
  legally: "legal",
  eligible: "authorized",
  eligibility: "authorized",
  usa: "us",
  "united": "us",
  states: "us",
  america: "us",
  american: "us",
  relocate: "relocation",
  relocating: "relocation",
  notice: "noticeperiod",
  period: "noticeperiod",
  gender: "gender",
  salary: "compensation",
  compensation: "compensation",
  experience: "experience",
  experienced: "experience",
  years: "years",
  yrs: "years",
};

export function tokenize(text: string): string[] {
  return normalizeQuestion(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map((w) => SYNONYMS[w] ?? w);
}

/** Sørensen-Dice coefficient over the token sets. Range 0..1. */
export function similarity(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let overlap = 0;
  for (const t of sa) if (sb.has(t)) overlap += 1;
  return (2 * overlap) / (sa.size + sb.size);
}

/** Above this a reworded question is treated as the same question. */
export const MEDIUM_THRESHOLD = 0.72;

export interface MatchCandidate {
  questionHash: string;
  normalizedQuestion: string;
  questionText: string;
}

export interface MatchResult<T extends MatchCandidate> {
  match: T | null;
  confidence: FieldConfidence;
  similarity: number;
}

/**
 * Exact normalized hash -> HIGH. Strong token similarity -> MEDIUM.
 * Anything weaker returns no match, and the caller asks the user.
 */
export function matchQuestion<T extends MatchCandidate>(
  question: string,
  candidates: T[],
): MatchResult<T> {
  const normalized = normalizeQuestion(question);
  const exact = candidates.find((c) => c.normalizedQuestion === normalized);
  if (exact) return { match: exact, confidence: "HIGH", similarity: 1 };

  let best: T | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = similarity(normalized, c.normalizedQuestion);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (best && bestScore >= MEDIUM_THRESHOLD) {
    return { match: best, confidence: "MEDIUM", similarity: bestScore };
  }
  return { match: null, confidence: "LOW", similarity: bestScore };
}

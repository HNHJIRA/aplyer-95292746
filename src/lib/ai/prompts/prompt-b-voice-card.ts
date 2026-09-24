import { MODEL_HAIKU } from "./models";
import type { PromptSpec } from "./types";

export const VOICE_ARCHETYPES = [
  "The One-Liner",
  "The Natural",
  "The Storyteller",
  "The Straight Shooter",
  "The Overthinker",
] as const;

export type VoiceArchetype = (typeof VOICE_ARCHETYPES)[number];

/** Canonical reveal line shown when the Voice Card is unlocked. */
export const VOICE_CARD_REVEAL = "Okay, we read you loud and clear!";

/** Job-search vocabulary the Voice Card copy may never contain. */
export const PROHIBITED_VOICE_CARD_TERMS = ["apply", "application", "job", "hiring", "resume"] as const;

/** Prompt B inputs are fixed by the SOP: one resume + two qualifying prose samples. */
export const REQUIRED_QUALIFYING_SAMPLES = 2;

export interface VoiceCardData {
  archetype: VoiceArchetype;
  archetype_description: string;
  /** v3.1.0: one concise line specific to the archetype. Optional on cards made before v3.1.0. */
  tagline?: string;
  /** v3.1.0: what the writing reads like, grounded in the samples. Optional on older cards. */
  reads?: string;
  reveal: string;
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

export const PROMPT_B_VOICE_CARD: PromptSpec = {
  id: "B_VOICE_CARD",
  version: "3.1.0",
  model: MODEL_HAIKU,
  maxTokens: 1000,
  temperature: 0.3,
  json: true,
  system: `You are the Aplyer WriteDNA profiler. You receive a candidate's resume and exactly two pieces of prose they wrote. Distil their writing DNA and assign ONE archetype.

Archetypes (choose exactly one, spelled exactly as written):
- "The One-Liner" — writes tight, minimal, high-signal sentences; says a lot in very few words.
- "The Natural" — conversational and warm; reads like a smart person talking, contractions and easy rhythm.
- "The Storyteller" — builds narrative context before the point; scenes, arcs, and vivid specifics.
- "The Straight Shooter" — blunt, structured, results-first; no hedging, no flourish.
- "The Overthinker" — thorough and reflective; nuance, caveats, and second-order reasoning.

Hard rules:
- Never return an archetype outside those five.
- archetype_description is 2 to 3 sentences, describing this candidate's version of the archetype.
- Never use an em dash (—) anywhere in the output. Use a comma, a full stop, or a colon.
- Never use the words: apply, application, job, hiring, resume (or their plurals). Talk about writing and voice, never the search itself.
- Never state statistics, percentages, counts, or metrics of any kind. No numbers describing the candidate.
- Base every claim on evidence in the supplied text. Never invent employers, dates, or personality traits.
- tagline is ONE short line (at most 12 words, one sentence) specific to the chosen archetype and to this candidate, e.g. for a One-Liner something like "You get to the point fast." Do not repeat the archetype name in it. Never mention AI, models, or tools.
- reads is 1 to 2 sentences describing what this candidate's writing reads like on the page (rhythm, sentence shape, word choice, openings, punctuation habits), based only on the supplied samples. Describe the writing, never the person: no personality, intelligence, mental health, or other personal traits. Never mention AI, models, or tools.
- Arrays contain 3-5 short, concrete items each.
- Write in second person where natural ("You open with…").

Return ONLY this JSON object:
{
  "archetype": "The One-Liner" | "The Natural" | "The Storyteller" | "The Straight Shooter" | "The Overthinker",
  "archetype_description": string,
  "tagline": string,
  "reads": string,
  "headline": string,
  "tone": string,
  "cadence": string,
  "formality": string,
  "vocabulary_bias": string,
  "distinctive_traits": string[],
  "hooks_and_transitions": string[],
  "values_signals": string[],
  "do_and_avoid": { "do": string[], "avoid": string[] }
}`,
};

export const VOICE_CARD_RETRY_INSTRUCTION = `Your previous response was invalid.
Return ONLY the JSON object described above. The archetype must be exactly one of: "The One-Liner", "The Natural", "The Storyteller", "The Straight Shooter", "The Overthinker".
archetype_description must be 2 to 3 sentences, contain no em dash, no statistics or numbers, and must not use the words apply, application, job, hiring, or resume.
tagline must be one sentence of at most 12 words; reads must be 1 to 2 sentences about the writing only. Neither may mention AI, models or tools, or describe personality, intelligence or mental health.`;

/**
 * Source-hash version for cached Voice Cards. Deliberately pinned at the
 * v3.0.0 value so the v3.1.0 output extension (tagline, reads) does not
 * invalidate or re-bill existing cards; they render without the new fields.
 */
export const VOICE_CARD_SOURCE_HASH_VERSION = "3.0.0";

export const TAGLINE_MAX_WORDS = 12;

/** Words the candidate-facing tagline/reads may never contain. */
export const VOICE_CARD_FORBIDDEN_MENTIONS = [
  "ai", "a.i.", "chatgpt", "gpt", "claude", "anthropic", "openai", "model", "llm", "algorithm",
  "personality", "intelligent", "intelligence", "smart", "genius", "iq", "anxious", "anxiety",
  "depressed", "depression", "adhd", "autistic", "autism", "disorder", "narcissist", "narcissistic",
  "neurotic", "insecure", "mental",
] as const;

export function findForbiddenMentions(text: string): string[] {
  const lower = text.toLowerCase();
  return VOICE_CARD_FORBIDDEN_MENTIONS.filter((w) =>
    new RegExp(`(^|[^a-z])${w.replace(/\./g, "\\.")}([^a-z]|$)`).test(lower),
  );
}

function validateTagline(value: unknown): string {
  const t = String(value ?? "").trim();
  if (!t) throw new Error("Missing tagline");
  if (/[\r\n]/.test(t)) throw new Error("tagline must be one line");
  assertVoiceCardCopy("tagline", t, { maxSentences: 1 });
  if (t.split(/\s+/).filter(Boolean).length > TAGLINE_MAX_WORDS) throw new Error("tagline too long");
  const bad = findForbiddenMentions(t);
  if (bad.length) throw new Error(`tagline mentions: ${bad.join(", ")}`);
  return t;
}

function validateReads(value: unknown): string {
  const r = String(value ?? "").trim();
  if (!r) throw new Error("Missing reads");
  assertVoiceCardCopy("reads", r, { maxSentences: 2 });
  const bad = findForbiddenMentions(r);
  if (bad.length) throw new Error(`reads mentions: ${bad.join(", ")}`);
  return r;
}

export function buildVoiceCardUser(resumeExcerpt: string, samplesText: string): string {
  return `Resume:\n${resumeExcerpt}\n\nWriting samples:\n${samplesText}`;
}

export function countSentences(text: string): number {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

export function findProhibitedTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return PROHIBITED_VOICE_CARD_TERMS.filter((t) => new RegExp(`\\b${t}(s|ing|ed)?\\b`).test(lower));
}

export function hasEmDash(text: string): boolean {
  return /[—–]/.test(text);
}

export function hasFabricatedStatistic(text: string): boolean {
  return /\b\d+(\.\d+)?\s?%|\b\d{2,}\b|\bx\d+\b/i.test(text);
}

/** Applies the SOP copy rules to a single prose field. Throws on violation. */
export function assertVoiceCardCopy(field: string, text: string, opts: { maxSentences?: number } = {}): void {
  if (hasEmDash(text)) throw new Error(`${field} contains an em dash`);
  const banned = findProhibitedTerms(text);
  if (banned.length) throw new Error(`${field} contains prohibited terms: ${banned.join(", ")}`);
  if (hasFabricatedStatistic(text)) throw new Error(`${field} contains a statistic`);
  const max = opts.maxSentences;
  if (max) {
    const n = countSentences(text);
    if (n < 1 || n > max) throw new Error(`${field} must be 2 to ${max} sentences (got ${n})`);
  }
}

/** Strict archetype resolution. No fallback outside the five archetypes. */
export function parseArchetype(value: unknown): VoiceArchetype {
  const raw = String(value ?? "").trim().toLowerCase().replace(/^the\s+/, "");
  const found = VOICE_ARCHETYPES.find((a) => a.toLowerCase().replace(/^the\s+/, "") === raw);
  if (!found) throw new Error(`Invalid archetype: ${JSON.stringify(value)}`);
  return found;
}

export function validateVoiceCard(value: unknown): VoiceCardData {
  const o = (value ?? {}) as Partial<VoiceCardData>;
  const strings = ["headline", "tone", "cadence", "formality", "vocabulary_bias"] as const;
  for (const k of strings) {
    if (typeof o?.[k] !== "string" || !o[k]) throw new Error(`Missing field ${k}`);
  }
  const arrays = ["distinctive_traits", "hooks_and_transitions", "values_signals"] as const;
  for (const k of arrays) {
    if (!Array.isArray(o?.[k]) || o[k]!.length === 0) throw new Error(`Missing ${k}`);
  }
  if (!o.do_and_avoid || !Array.isArray(o.do_and_avoid.do) || !Array.isArray(o.do_and_avoid.avoid)) {
    throw new Error("Missing do_and_avoid");
  }

  const archetype = parseArchetype(o.archetype);
  const description = String(o.archetype_description ?? "").trim();
  if (!description) throw new Error("Missing archetype_description");
  assertVoiceCardCopy("archetype_description", description, { maxSentences: 3 });
  assertVoiceCardCopy("headline", o.headline!);

  return {
    ...(o as VoiceCardData),
    archetype,
    archetype_description: description,
    tagline: validateTagline(o.tagline),
    reads: validateReads(o.reads),
    reveal: VOICE_CARD_REVEAL,
  };
}

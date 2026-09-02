// The 29 answer-generation rules, expressed as DETERMINISTIC checks.
//
// This module never calls a model. Every rule is a pure function of
//   (final answer, P0-grounded guard report, generation metadata)
// so an audit is reproducible: the same answer always produces the same
// report, and the report can be shown to a client as proof the generation
// rules were actually enforced.
//
// This is NOT the Human Score (human-likeness) and NOT the A->J quality
// scan (answer correctness/safety). It answers exactly one question:
// "did the shipped answer obey the generation rules?".
import {
  ANSWER_MAX_WORDS,
  ANSWER_MIN_WORDS,
  HARD_BANNED_TERMS,
  countWords,
} from "../prompts/prompt-a-answer-generation";
import { TOOL_LEXICON, type GuardViolation } from "../answer-guards";
import { normalizeText } from "../fact-inventory-grounding";
import type { FlattenedInventory } from "../answer-facts";

export const RULE_AUDIT_VERSION = "1.0.0";
export const TOTAL_RULES = 29;

export interface RuleContext {
  answer: string;
  flat: FlattenedInventory;
  /** Blocking + advisory violations from the deterministic post-guard. */
  violations: GuardViolation[];
  factIdsUsed: string[];
  allowedFactIds: string[];
  jobContextText: string | null;
}

export interface RuleResult {
  ruleId: string;
  title: string;
  passed: boolean;
  /** 0-100. Graded rules may score between the extremes. */
  score: number;
  reason: string;
}

export interface RuleDefinition {
  id: string;
  title: string;
  evaluate: (ctx: RuleContext) => { passed: boolean; score?: number; reason: string };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordsOf(text: string): string[] {
  return normalizeText(text).split(/\s+/).filter(Boolean);
}

function has(ctx: RuleContext, code: string): boolean {
  return ctx.violations.some((v) => v.code === code && v.blocking !== false);
}

function detailsFor(ctx: RuleContext, code: string): string {
  return ctx.violations
    .filter((v) => v.code === code)
    .map((v) => v.detail)
    .slice(0, 4)
    .join(", ");
}

function guardRule(
  id: string,
  title: string,
  codes: string[],
  okReason: string,
): RuleDefinition {
  return {
    id,
    title,
    evaluate: (ctx) => {
      const hit = codes.find((c) => has(ctx, c));
      return hit
        ? { passed: false, reason: `${hit}: ${detailsFor(ctx, hit)}` }
        : { passed: true, reason: okReason };
    },
  };
}

const VAGUE_ADJECTIVES = [
  "amazing", "incredible", "awesome", "great", "huge", "massive", "various",
  "numerous", "several", "significant", "substantial", "extensive", "innovative",
  "strategic", "impactful", "meaningful", "valuable", "exciting", "unique",
];

const HEDGES = [
  "kind of", "sort of", "i guess", "somewhat", "maybe", "perhaps", "arguably",
  "more or less", "a bit of a", "i think maybe",
];

const PREAMBLE_SIGNOFF = [
  "in conclusion", "to summarize", "in summary", "to sum up", "thank you for",
  "thanks for reading", "i hope this helps", "to answer your question",
  "as mentioned above", "first of all",
];

const FLATTERY = [
  "dream job", "dream company", "esteemed", "your amazing", "love your product",
  "huge fan", "big fan of", "admire your", "prestigious",
];

const AI_TELLS = [
  "as an ai", "language model", "as a large language", "i cannot browse",
  "based on the information provided", "i do not have access to",
];

const PLACEHOLDERS = [
  "lorem ipsum", "xyz company", "company name", "[insert", "your company here",
  "tbd", "todo",
];

/** Acronyms everyone in hiring understands; never flagged as unexplained. */
const COMMON_ACRONYMS = new Set([
  "AI", "API", "APIS", "AWS", "B2B", "B2C", "CEO", "CI", "CD", "CRM", "CSS", "CTO",
  "DB", "EU", "GCP", "HR", "HTML", "HTTP", "IT", "KPI", "ML", "OKR", "PR", "QA",
  "REST", "ROI", "SaaS", "SDK", "SEO", "SLA", "SQL", "SRE", "UI", "UK", "US", "USA",
  "UX", "VP", "XML", "JSON",
]);

function padded(text: string): string {
  return ` ${normalizeText(text).replace(/[^a-z0-9.+#& ]/g, " ").replace(/\s+/g, " ").trim()} `;
}

function containsAny(text: string, phrases: readonly string[]): string | null {
  const hay = ` ${normalizeText(text)} `;
  for (const p of phrases) {
    if (hay.includes(` ${normalizeText(p)} `) || hay.includes(normalizeText(p))) return p;
  }
  return null;
}

function toolsIn(text: string): string[] {
  const hay = padded(text);
  return TOOL_LEXICON.filter((t) => hay.includes(` ${normalizeText(t)} `));
}

/* ------------------------------------------------------------------ */
/* The 29 rules                                                        */
/* ------------------------------------------------------------------ */

export const RULES: RuleDefinition[] = [
  {
    id: "rule_01_bluf_direct_open",
    title: "BLUF: opens by answering, not by restating the prompt",
    evaluate: (ctx) => {
      const first = sentences(ctx.answer)[0] ?? "";
      const bad = /^(the question|this question|you asked|in this answer|i would say that|when it comes to)/i.test(
        first.trim(),
      );
      return bad
        ? { passed: false, reason: `windup opening: "${first.slice(0, 60)}"` }
        : { passed: true, reason: "first sentence answers directly" };
    },
  },
  guardRule("rule_02_no_i_opening", "Never opens with the word \"I\"", ["opens_with_i"], "opening word is not \"I\""),
  {
    id: "rule_03_first_person_ownership",
    title: "First person maintained after the opening",
    evaluate: (ctx) => {
      const w = wordsOf(ctx.answer);
      const i = w.filter((x) => x === "i" || x === "my" || x === "me").length;
      return i > 0
        ? { passed: true, reason: `${i} first-person markers` }
        : { passed: false, reason: "no first-person voice found" };
    },
  },
  {
    id: "rule_04_specificity_gate",
    title: "Carries at least one concrete inventory-backed detail",
    evaluate: (ctx) => {
      const hay = padded(ctx.answer);
      const corpus = padded(ctx.flat.corpus);
      const hits = toolsIn(ctx.answer).filter((t) => corpus.includes(` ${normalizeText(t)} `));
      const numbers = (ctx.answer.match(/\b\d[\d,.%]*\b/g) ?? []).filter((n) =>
        normalizeText(ctx.flat.corpus).includes(normalizeText(n)),
      );
      const employers = ctx.flat.roles
        .map((r) => normalizeText(r.company ?? ""))
        .filter((c) => c.length >= 3 && hay.includes(` ${c} `));
      const total = hits.length + numbers.length + employers.length;
      return total > 0
        ? { passed: true, reason: `${total} grounded specifics` }
        : { passed: false, reason: "no grounded specific detail detected" };
    },
  },
  {
    id: "rule_05_concrete_language",
    title: "Concrete nouns and verbs beat vague adjectives",
    evaluate: (ctx) => {
      const w = wordsOf(ctx.answer);
      const vague = w.filter((x) => VAGUE_ADJECTIVES.includes(x));
      const ratio = w.length ? vague.length / w.length : 0;
      const passed = ratio <= 0.03;
      return {
        passed,
        score: passed ? 100 : Math.max(0, 100 - Math.round(ratio * 1000)),
        reason: passed ? `${vague.length} vague adjectives` : `too vague: ${vague.join(", ")}`,
      };
    },
  },
  {
    id: "rule_06_one_idea_per_sentence",
    title: "One idea per sentence; no runaway sentences",
    evaluate: (ctx) => {
      const lens = sentences(ctx.answer).map((s) => countWords(s));
      const longest = lens.length ? Math.max(...lens) : 0;
      return longest <= 45
        ? { passed: true, reason: `longest sentence ${longest} words` }
        : { passed: false, reason: `sentence of ${longest} words` };
    },
  },
  {
    id: "rule_07_sentence_variety",
    title: "Sentence length varies deliberately",
    evaluate: (ctx) => {
      const lens = sentences(ctx.answer).map((s) => countWords(s));
      if (lens.length < 3) return { passed: true, reason: "too few sentences to judge" };
      const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
      const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
      const passed = sd >= 3;
      return {
        passed,
        score: passed ? 100 : Math.round((sd / 3) * 100),
        reason: `length stdev ${sd.toFixed(1)}`,
      };
    },
  },
  {
    id: "rule_08_no_preamble_or_signoff",
    title: "No preamble, no summary sign-off",
    evaluate: (ctx) => {
      const hit = containsAny(ctx.answer, PREAMBLE_SIGNOFF);
      return hit ? { passed: false, reason: `found "${hit}"` } : { passed: true, reason: "no filler framing" };
    },
  },
  {
    id: "rule_09_no_hedging",
    title: "No hedging that undercuts the claim",
    evaluate: (ctx) => {
      const hit = containsAny(ctx.answer, HEDGES);
      return hit ? { passed: false, reason: `found "${hit}"` } : { passed: true, reason: "claims stated plainly" };
    },
  },
  {
    id: "rule_10_no_flattery",
    title: "No empty enthusiasm or flattery of the employer",
    evaluate: (ctx) => {
      const hit = containsAny(ctx.answer, FLATTERY);
      return hit ? { passed: false, reason: `found "${hit}"` } : { passed: true, reason: "no flattery" };
    },
  },
  guardRule(
    "rule_11_no_banned_vocabulary",
    "None of the hard-banned vocabulary",
    ["banned_vocabulary"],
    `checked against ${HARD_BANNED_TERMS.length} banned terms`,
  ),
  {
    id: "rule_12_no_em_dash",
    title: "No em dashes",
    evaluate: (ctx) =>
      /[—–]/.test(ctx.answer)
        ? { passed: false, reason: "em/en dash present" }
        : { passed: true, reason: "plain punctuation only" },
  },
  {
    id: "rule_13_no_rhetorical_or_exclamation",
    title: "No rhetorical questions, no exclamation marks",
    evaluate: (ctx) => {
      if (ctx.answer.includes("!")) return { passed: false, reason: "exclamation mark" };
      return ctx.answer.includes("?")
        ? { passed: false, reason: "rhetorical question" }
        : { passed: true, reason: "declarative throughout" };
    },
  },
  guardRule(
    "rule_14_no_lists_or_markdown",
    "Flowing prose only — no lists, bullets or markdown",
    ["markdown_or_list"],
    "prose only",
  ),
  {
    id: "rule_15_no_unexplained_acronyms",
    title: "No unexplained acronyms or jargon",
    evaluate: (ctx) => {
      const corpus = normalizeText(ctx.flat.corpus);
      const unknown = [...new Set(ctx.answer.match(/\b[A-Z]{2,5}\b/g) ?? [])].filter(
        (a) => !COMMON_ACRONYMS.has(a.toUpperCase()) && !corpus.includes(a.toLowerCase()),
      );
      return unknown.length === 0
        ? { passed: true, reason: "all acronyms known or grounded" }
        : { passed: false, reason: `unexplained: ${unknown.join(", ")}` };
    },
  },
  {
    id: "rule_16_ownership_not_we",
    title: "Says what the candidate did, not what teams generally do",
    evaluate: (ctx) => {
      const w = wordsOf(ctx.answer);
      const we = w.filter((x) => x === "we" || x === "our").length;
      const i = w.filter((x) => x === "i" || x === "my").length;
      const passed = we <= i;
      return {
        passed,
        score: passed ? 100 : Math.max(0, 100 - (we - i) * 20),
        reason: `${i} first-person vs ${we} collective markers`,
      };
    },
  },
  guardRule(
    "rule_17_grounded_numbers",
    "Numbers, metrics and team sizes come only from the inventory",
    ["unsupported_number"],
    "every number is inventory-backed",
  ),
  guardRule(
    "rule_18_grounded_durations",
    "Durations and years-of-experience are inventory-backed",
    ["unsupported_duration"],
    "durations grounded",
  ),
  guardRule(
    "rule_19_grounded_dates",
    "Dates appear only when the inventory contains them",
    ["unsupported_date"],
    "dates grounded",
  ),
  guardRule(
    "rule_20_date_precision",
    "No invented date precision beyond the inventory",
    ["unsupported_date_precision"],
    "date precision matches the inventory",
  ),
  guardRule(
    "rule_21_no_cross_role_attribution",
    "Claims stay attached to the role they belong to",
    ["cross_role_attribution", "cross_role_temporal_mismatch"],
    "no facts moved between employers",
  ),
  guardRule(
    "rule_22_tense_currency",
    "Nothing is claimed as current unless the role is current",
    ["invalid_current_tense"],
    "tense matches role currency",
  ),
  guardRule(
    "rule_23_grounded_tools",
    "Tools and technologies claimed are inventory-backed",
    ["unsupported_tool"],
    "tool claims grounded",
  ),
  {
    id: "rule_24_word_count_in_range",
    title: `Answer stays within ${ANSWER_MIN_WORDS}-${ANSWER_MAX_WORDS} words`,
    evaluate: (ctx) => {
      const n = countWords(ctx.answer);
      const passed = n >= ANSWER_MIN_WORDS && n <= ANSWER_MAX_WORDS;
      return { passed, reason: `${n} words` };
    },
  },
  {
    id: "rule_25_fact_ids_reported",
    title: "Facts used are reported and come from the supplied list",
    evaluate: (ctx) => {
      if (ctx.factIdsUsed.length === 0) return { passed: false, reason: "no fact ids reported" };
      const allowed = new Set(ctx.allowedFactIds);
      const stray = ctx.factIdsUsed.filter((id) => !allowed.has(id));
      return stray.length === 0
        ? { passed: true, reason: `${ctx.factIdsUsed.length} inventory facts reported` }
        : { passed: false, reason: `unknown fact ids: ${stray.slice(0, 3).join(", ")}` };
    },
  },
  {
    id: "rule_26_no_job_context_leak",
    title: "Job description skills never become candidate experience",
    evaluate: (ctx) => {
      if (!ctx.jobContextText) return { passed: true, reason: "no job context supplied" };
      const corpus = padded(ctx.flat.corpus);
      const job = padded(ctx.jobContextText);
      const leaked = toolsIn(ctx.answer).filter(
        (t) => job.includes(` ${normalizeText(t)} `) && !corpus.includes(` ${normalizeText(t)} `),
      );
      return leaked.length === 0
        ? { passed: true, reason: "no job-description claims adopted" }
        : { passed: false, reason: `claimed from job post only: ${leaked.join(", ")}` };
    },
  },
  {
    id: "rule_27_no_ai_self_reference",
    title: "No AI self-reference or model tells",
    evaluate: (ctx) => {
      const hit = containsAny(ctx.answer, AI_TELLS);
      return hit ? { passed: false, reason: `found "${hit}"` } : { passed: true, reason: "no AI tells" };
    },
  },
  {
    id: "rule_28_no_placeholders",
    title: "No placeholder or template residue",
    evaluate: (ctx) => {
      if (/\[[^\]]{2,40}\]|\{\{[^}]+\}\}|<[a-z_ ]{2,30}>/i.test(ctx.answer)) {
        return { passed: false, reason: "template placeholder syntax" };
      }
      const hit = containsAny(ctx.answer, PLACEHOLDERS);
      return hit ? { passed: false, reason: `found "${hit}"` } : { passed: true, reason: "no placeholders" };
    },
  },
  {
    id: "rule_29_natural_voice_no_repetition",
    title: "Reads naturally — no repeated openers or drum-beat words",
    evaluate: (ctx) => {
      const openers = sentences(ctx.answer).map((s) => wordsOf(s)[0] ?? "");
      const counts = new Map<string, number>();
      for (const o of openers) if (o) counts.set(o, (counts.get(o) ?? 0) + 1);
      const repeatedOpener = [...counts.entries()].find(([, n]) => n > 2);
      if (repeatedOpener) {
        return { passed: false, reason: `"${repeatedOpener[0]}" opens ${repeatedOpener[1]} sentences` };
      }
      const stop = new Set([
        "the", "and", "a", "to", "of", "in", "that", "it", "with", "for", "on", "was",
        "were", "i", "my", "we", "our", "as", "at", "by", "from", "this", "which", "an",
        "is", "are", "had", "has", "have", "but", "so", "then", "after", "when", "into",
        "their", "them", "they", "its", "it's", "not", "no", "up", "out", "over", "each",
      ]);
      const freq = new Map<string, number>();
      for (const w of wordsOf(ctx.answer)) {
        if (w.length < 4 || stop.has(w)) continue;
        freq.set(w, (freq.get(w) ?? 0) + 1);
      }
      const overused = [...freq.entries()].find(([, n]) => n > 5);
      return overused
        ? { passed: false, reason: `"${overused[0]}" repeated ${overused[1]} times` }
        : { passed: true, reason: "no repetitive patterning" };
    },
  },
];

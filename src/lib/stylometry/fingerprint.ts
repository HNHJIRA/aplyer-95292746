/**
 * Stylometric fingerprint engine — deterministic, pure, no I/O, no AI.
 *
 * Input: the candidate's exact writing sample. Output: 40+ metrics, each
 * with a definition, unit, raw counts and a reliability status. Nothing here
 * knows about generated answers, providers or any baseline.
 *
 * Reliability (Demo Specification 9.17.26, Part 3 stress-test items 1–4):
 * - MIN_SAMPLE_WORDS = 300 (spec item 4). Below it, every metric except the
 *   exact size counts is `insufficient_data` and its `value` is null. The
 *   computed number is kept in `observed` for internal diagnostics only.
 * - A metric with a zero denominator is `insufficient_data` (value null) or
 *   `not_applicable` (e.g. paragraph spread with one paragraph). Never 0.
 * - Spread / length-sensitive metrics (raw TTR, hapax ratio, all standard
 *   deviations, coefficient of variation, opening diversity) are never
 *   `headlineEligible` (spec items 1–3). MATTR uses a 50-word window (item 1).
 * - Per-100-word rates carry a 95% binomial (normal approximation)
 *   uncertainty band, as the spec asks for visible uncertainty (item 3).
 */
import { tokenize, type Token, type Tokenized } from "./tokenize";
import * as L from "./lexicon";

export const FINGERPRINT_VERSION = "1.0.0";
/** Spec item 4: "Gate the scoreboard behind a 300-word writing sample." */
export const MIN_SAMPLE_WORDS = 300;
/** Spec item 1: MATTR with a 50-word window. */
export const MATTR_WINDOW = 50;
/** Definitional cut-offs (category boundaries, not baselines). */
export const SHORT_WORD_MAX_LETTERS = 3;
export const LONG_WORD_MIN_LETTERS = 7;
export const SHORT_SENTENCE_MAX_WORDS = 8;
export const LONG_SENTENCE_MIN_WORDS = 25;

export type Reliability = "reliable" | "insufficient_data" | "not_applicable";
export type MetricUnit =
  | "count"
  | "per_100_words"
  | "percent_of_words"
  | "percent_of_sentences"
  | "percent_of_lines"
  | "percent_of_pronouns"
  | "ratio"
  | "letters"
  | "words";
export type MetricCategory =
  | "lexical"
  | "sentence"
  | "voice"
  | "punctuation"
  | "function_words"
  | "discourse"
  | "formatting";

export interface Metric {
  name: string;
  label: string;
  category: MetricCategory;
  unit: MetricUnit;
  definition: string;
  /** Usable value; null whenever reliability !== "reliable". */
  value: number | null;
  /** Computed number even when unreliable (internal diagnostics only), null if not computable. */
  observed: number | null;
  numerator?: number;
  denominator?: number;
  /** ± half-width of a 95% band for proportion-based rates, same unit as value. */
  uncertainty95?: number;
  reliability: Reliability;
  /** False for metrics the spec says must never be headline markers. */
  headlineEligible: boolean;
}

export interface Fingerprint {
  version: string;
  wordCount: number;
  minSampleWords: number;
  sufficient: boolean;
  counts: { words: number; numbers: number; urls: number; emails: number; sentences: number; paragraphs: number; lines: number };
  metrics: Metric[];
  reliableMetrics: string[];
  suppressedMetrics: string[];
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const letters = (w: Token) => (w.text.match(/\p{L}/gu) ?? []).length;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const countChar = (s: string, re: RegExp) => (s.match(re) ?? []).length;

function countPhrases(norms: string[], phrases: string[]): number {
  let n = 0;
  for (const p of phrases) {
    const parts = p.split(" ");
    for (let i = 0; i + parts.length <= norms.length; i++) {
      if (parts.every((w, j) => norms[i + j] === w)) n++;
    }
  }
  return n;
}

function mattr(norms: string[], window: number): number | null {
  if (norms.length < window) return null;
  let total = 0;
  const freq = new Map<string, number>();
  for (let i = 0; i < window; i++) freq.set(norms[i], (freq.get(norms[i]) ?? 0) + 1);
  total += freq.size / window;
  for (let i = window; i < norms.length; i++) {
    const out = norms[i - window];
    const c = freq.get(out)! - 1;
    if (c) freq.set(out, c);
    else freq.delete(out);
    freq.set(norms[i], (freq.get(norms[i]) ?? 0) + 1);
    total += freq.size / window;
  }
  return total / (norms.length - window + 1);
}

interface Spec {
  name: string;
  label: string;
  category: MetricCategory;
  unit: MetricUnit;
  definition: string;
  compute: () => { observed: number | null; numerator?: number; denominator?: number; notApplicable?: boolean };
  /** Exact counts are reliable at any length. */
  exactCount?: boolean;
  headlineEligible?: boolean;
  /** Proportion-based: attach a binomial uncertainty band. */
  binomial?: boolean;
}

export function computeFingerprint(writingSample: string): Fingerprint {
  const t: Tokenized = tokenize(writingSample);
  const W = t.words.length;
  const norms = t.words.map((w) => w.norm);
  const S = t.sentences.length;
  const sentLens = t.sentences.map((s) => s.words.length);
  const wordLens = t.words.map(letters);
  // Decimal points / thousands separators inside numbers are not punctuation.
  const P = t.punctuationText.replace(/(?<=\p{N})[.,](?=\p{N})/gu, "");
  const sufficient = W >= MIN_SAMPLE_WORDS;

  const inSet = (s: Set<string>) => norms.filter((n) => s.has(n)).length;
  const per100 = (n: number) => () => ({ observed: W ? (n / W) * 100 : null, numerator: n, denominator: W });
  const pctSent = (n: number) => () => ({ observed: S ? (n / S) * 100 : null, numerator: n, denominator: S });
  const rateSet = (s: Set<string>) => per100(inSet(s));

  const contractions = norms.filter((n) => L.CONTRACTION_SUFFIX.test(n) || L.S_CONTRACTION.has(n) || n === "can't" || n === "won't").length;
  const firstS = inSet(L.FIRST_SINGULAR);
  const firstP = inSet(L.FIRST_PLURAL);
  const second = inSet(L.SECOND);
  const third = inSet(L.THIRD);
  const personal = firstS + firstP + second + third;
  const types = new Set(norms);
  const freq = new Map<string, number>();
  for (const n of norms) freq.set(n, (freq.get(n) ?? 0) + 1);
  const hapax = [...freq.values()].filter((c) => c === 1).length;
  const firstWords = t.sentences.map((s) => s.words[0].norm);
  const numbers = t.tokens.filter((x) => x.type === "number").length;
  const sentenceInitial = new Set(t.sentences.map((s) => s.words[0]));
  const capsMid = t.words.filter((w) => !sentenceInitial.has(w) && /^\p{Lu}/u.test(w.text) && w.norm !== "i" && !/^\p{Lu}+$/u.test(w.text)).length;
  const allCaps = t.words.filter((w) => letters(w) >= 2 && /^[\p{Lu}'’-]+$/u.test(w.text)).length;
  const hyphenated = t.words.filter((w) => w.text.includes("-")).length;
  const apostrophes = countChar(P, /(?<=\p{L})['’ʼ](?=\p{L})/gu);
  const quoteMarks = countChar(P, /["“”«»„]/gu) + countChar(P, /(?<![\p{L}\p{N}])['‘’]|['‘’](?![\p{L}\p{N}])/gu);
  const punctAll = countChar(P, /[.,;:!?…"“”«»„()[\]{}—–]/gu) + countChar(P, /(?:^|\s)-(?=\s|$)/gu) + apostrophes;
  const paraLens = t.paragraphs.map((p) => p.words);
  const nonEmptyLines = t.lines.length;
  const bulletLines = t.lines.filter((l) => l.bullet).length;
  const bin = (lo: number, hi: number) => wordLens.filter((x) => x >= lo && x <= hi).length;

  const specs: Spec[] = [
    // LEXICAL
    { name: "word_count", label: "Word count", category: "lexical", unit: "count", exactCount: true, definition: "Number of word tokens (numbers, URLs and emails excluded; contractions and hyphenated words count once).", compute: () => ({ observed: W }) },
    { name: "unique_word_count", label: "Unique words", category: "lexical", unit: "count", exactCount: true, definition: "Number of distinct word tokens, case-insensitive.", compute: () => ({ observed: types.size }) },
    { name: "raw_type_token_ratio", label: "Raw type-token ratio", category: "lexical", unit: "ratio", definition: "Unique words ÷ words. Length-dependent; never a headline marker (spec item 1).", compute: () => ({ observed: W ? types.size / W : null, numerator: types.size, denominator: W }) },
    { name: "mattr_50", label: "Lexical diversity (MATTR, 50-word window)", category: "lexical", unit: "ratio", headlineEligible: true, definition: "Mean type-token ratio over every consecutive 50-word window (Covington & McFall). Requires ≥ 50 words.", compute: () => ({ observed: mattr(norms, MATTR_WINDOW), denominator: W }) },
    { name: "hapax_ratio", label: "Hapax legomena ratio", category: "lexical", unit: "ratio", definition: "Words used exactly once ÷ unique words. Vocabulary-richness signal; length-dependent, never headline.", compute: () => ({ observed: types.size ? hapax / types.size : null, numerator: hapax, denominator: types.size }) },
    { name: "avg_word_length", label: "Average word length", category: "lexical", unit: "letters", headlineEligible: true, definition: "Mean letters per word (apostrophes and hyphens not counted).", compute: () => ({ observed: W ? mean(wordLens) : null, numerator: wordLens.reduce((a, b) => a + b, 0), denominator: W }) },
    { name: "median_word_length", label: "Median word length", category: "lexical", unit: "letters", headlineEligible: true, definition: "Median letters per word.", compute: () => ({ observed: W ? median(wordLens) : null, denominator: W }) },
    { name: "word_length_sd", label: "Word length spread", category: "lexical", unit: "letters", definition: "Sample standard deviation of letters per word. Spread metric, never headline.", compute: () => ({ observed: W >= 2 ? sd(wordLens) : null, denominator: W }) },
    { name: "short_word_rate", label: "Short words", category: "lexical", unit: "per_100_words", binomial: true, headlineEligible: true, definition: `Words of ≤ ${SHORT_WORD_MAX_LETTERS} letters per 100 words.`, compute: per100(bin(1, SHORT_WORD_MAX_LETTERS)) },
    { name: "long_word_rate", label: "Long words", category: "lexical", unit: "per_100_words", binomial: true, headlineEligible: true, definition: `Words of ≥ ${LONG_WORD_MIN_LETTERS} letters per 100 words.`, compute: per100(bin(LONG_WORD_MIN_LETTERS, Infinity)) },
    { name: "word_length_1_3_share", label: "Words 1–3 letters", category: "lexical", unit: "percent_of_words", binomial: true, headlineEligible: true, definition: "Share of words with 1–3 letters (length distribution bin).", compute: per100(bin(1, 3)) },
    { name: "word_length_4_6_share", label: "Words 4–6 letters", category: "lexical", unit: "percent_of_words", binomial: true, headlineEligible: true, definition: "Share of words with 4–6 letters.", compute: per100(bin(4, 6)) },
    { name: "word_length_7_9_share", label: "Words 7–9 letters", category: "lexical", unit: "percent_of_words", binomial: true, headlineEligible: true, definition: "Share of words with 7–9 letters.", compute: per100(bin(7, 9)) },
    { name: "word_length_10_plus_share", label: "Words 10+ letters", category: "lexical", unit: "percent_of_words", binomial: true, headlineEligible: true, definition: "Share of words with 10 or more letters.", compute: per100(bin(10, Infinity)) },
    { name: "function_word_rate", label: "Function words", category: "lexical", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "Closed-class words (determiners, pronouns, prepositions, conjunctions, auxiliaries, modals, negators) per 100 words.", compute: rateSet(L.FUNCTION_WORDS) },
    { name: "content_word_ratio", label: "Content words", category: "lexical", unit: "percent_of_words", binomial: true, headlineEligible: true, definition: "Words not in the function-word list, as a share of words.", compute: per100(W - inSet(L.FUNCTION_WORDS)) },
    { name: "numeric_token_rate", label: "Numbers", category: "formatting", unit: "per_100_words", headlineEligible: true, definition: "Number tokens (e.g. 38, 3.5, 40%) per 100 words.", compute: per100(numbers) },

    // SENTENCE
    { name: "sentence_count", label: "Sentence count", category: "sentence", unit: "count", exactCount: true, definition: "Sentences split at . ! ? … runs, bullet items and paragraph breaks. Decimal points and thousands separators inside numbers are never punctuation.", compute: () => ({ observed: S }) },
    { name: "avg_sentence_length", label: "Average sentence length", category: "sentence", unit: "words", headlineEligible: true, definition: "Words ÷ sentences.", compute: () => ({ observed: S ? W / S : null, numerator: W, denominator: S }) },
    { name: "median_sentence_length", label: "Median sentence length", category: "sentence", unit: "words", headlineEligible: true, definition: "Median words per sentence.", compute: () => ({ observed: S ? median(sentLens) : null, denominator: S }) },
    { name: "sentence_length_sd", label: "Sentence length variance (SD)", category: "sentence", unit: "words", definition: "Sample SD of words per sentence. Removed from headline by spec item 2; internal signal only.", compute: () => ({ observed: S >= 2 ? sd(sentLens) : null, denominator: S }) },
    { name: "sentence_length_cv", label: "Sentence length variation (CV)", category: "sentence", unit: "ratio", definition: "SD ÷ mean of sentence length. Spread metric, never headline.", compute: () => ({ observed: S >= 2 ? sd(sentLens) / mean(sentLens) : null, denominator: S }) },
    { name: "short_sentence_rate", label: "Short sentences", category: "sentence", unit: "percent_of_sentences", binomial: true, headlineEligible: true, definition: `Share of sentences with ≤ ${SHORT_SENTENCE_MAX_WORDS} words.`, compute: pctSent(sentLens.filter((x) => x <= SHORT_SENTENCE_MAX_WORDS).length) },
    { name: "long_sentence_rate", label: "Long sentences", category: "sentence", unit: "percent_of_sentences", binomial: true, headlineEligible: true, definition: `Share of sentences with ≥ ${LONG_SENTENCE_MIN_WORDS} words.`, compute: pctSent(sentLens.filter((x) => x >= LONG_SENTENCE_MIN_WORDS).length) },
    { name: "question_sentence_rate", label: "Questions", category: "sentence", unit: "percent_of_sentences", binomial: true, headlineEligible: true, definition: "Share of sentences ending in ? (sentence-ending pattern).", compute: pctSent(t.sentences.filter((s) => s.terminal.includes("?")).length) },
    { name: "exclamation_sentence_rate", label: "Exclamations", category: "sentence", unit: "percent_of_sentences", binomial: true, headlineEligible: true, definition: "Share of sentences ending in ! (sentence-ending pattern).", compute: pctSent(t.sentences.filter((s) => s.terminal.includes("!")).length) },
    { name: "unterminated_sentence_rate", label: "Sentences without end punctuation", category: "sentence", unit: "percent_of_sentences", binomial: true, headlineEligible: true, definition: "Share of sentences ended by a line/paragraph break or end of text, not . ! ? …", compute: pctSent(t.sentences.filter((s) => !s.terminal).length) },
    { name: "pronoun_start_rate", label: "Sentences opening with a pronoun", category: "sentence", unit: "percent_of_sentences", binomial: true, headlineEligible: true, definition: "Share of sentences whose first word is a personal pronoun (sentence-start pattern).", compute: pctSent(firstWords.filter((w) => L.PERSONAL_PRONOUNS.has(w)).length) },
    { name: "i_start_rate", label: "Sentences opening with “I”", category: "sentence", unit: "percent_of_sentences", binomial: true, headlineEligible: true, definition: "Share of sentences whose first word is I or an I-contraction (I'm, I've…).", compute: pctSent(firstWords.filter((w) => w === "i" || /^i'/.test(w)).length) },
    { name: "conjunction_start_rate", label: "Sentences opening with a conjunction", category: "sentence", unit: "percent_of_sentences", binomial: true, headlineEligible: true, definition: "Share of sentences whose first word is a conjunction (And, But, So, Because…).", compute: pctSent(firstWords.filter((w) => L.CONJUNCTIONS.has(w)).length) },
    { name: "sentence_opening_diversity", label: "Sentence-opening diversity", category: "discourse", unit: "ratio", definition: "Distinct first words ÷ sentences. Length-dependent, never headline.", compute: () => ({ observed: S ? new Set(firstWords).size / S : null, numerator: new Set(firstWords).size, denominator: S }) },

    // VOICE / PERSON
    { name: "first_person_singular_rate", label: "First person singular (I/me/my)", category: "voice", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "I, me, my, mine, myself per 100 words and I'm/I've/I'll/I'd.", compute: per100(firstS + norms.filter((n) => /^i'(m|ve|ll|d)$/.test(n)).length) },
    { name: "first_person_plural_rate", label: "First person plural (we/us/our)", category: "voice", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "we, us, our, ours, ourselves (and we're/we've/we'll/we'd) per 100 words.", compute: per100(firstP + norms.filter((n) => /^we'(re|ve|ll|d)$/.test(n)).length) },
    { name: "first_person_rate", label: "First-person density", category: "voice", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "All first-person pronouns (singular + plural, including contracted forms) per 100 words.", compute: per100(firstS + firstP + norms.filter((n) => /^(i|we)'(m|re|ve|ll|d)$/.test(n)).length) },
    { name: "second_person_rate", label: "Second person (you/your)", category: "voice", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "you, your, yours, yourself(ves) and you're/you've/you'll/you'd per 100 words.", compute: per100(second + norms.filter((n) => /^you'(re|ve|ll|d)$/.test(n)).length) },
    { name: "third_person_rate", label: "Third person (he/she/it/they)", category: "voice", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "Third-person personal pronouns per 100 words.", compute: per100(third) },
    { name: "first_person_share_of_pronouns", label: "First person share of pronouns", category: "voice", unit: "percent_of_pronouns", binomial: true, headlineEligible: true, definition: "First-person ÷ all personal pronouns (personal pronoun distribution).", compute: () => ({ observed: personal ? ((firstS + firstP) / personal) * 100 : null, numerator: firstS + firstP, denominator: personal }) },
    { name: "possessive_pronoun_rate", label: "Possessive pronouns", category: "voice", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "my, mine, our, your, his, her, its, their… per 100 words.", compute: rateSet(L.POSSESSIVES) },
    { name: "contraction_rate", label: "Contractions", category: "voice", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "Words with n't, 're, 've, 'll, 'd, 'm, or an unambiguous 's (it's, that's…) per 100 words. Possessive 's is not counted.", compute: per100(contractions) },
    { name: "modal_verb_rate", label: "Modal verbs", category: "voice", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "will, would, shall, should, can, could, may, might, must, ought per 100 words.", compute: rateSet(L.MODALS) },

    // PUNCTUATION (per 100 words, counted on original text; URLs/emails/bullet markers excluded)
    ...(
      [
        ["comma_rate", "Commas", ",", /,/gu],
        ["period_rate", "Periods", ". (ellipses excluded)", /(?<!\.)\.(?!\.)/gu],
        ["question_mark_rate", "Question marks", "?", /\?/gu],
        ["exclamation_mark_rate", "Exclamation marks", "!", /!/gu],
        ["colon_rate", "Colons", ":", /:/gu],
        ["semicolon_rate", "Semicolons", ";", /;/gu],
        ["parenthesis_rate", "Parentheses / brackets", "opening ( [ {", /[([{]/gu],
        ["em_dash_rate", "Em dashes", "— (U+2014). Hyphens inside words are NOT counted", /—/gu],
        ["en_dash_rate", "En dashes", "– (U+2013)", /–/gu],
        ["spaced_hyphen_rate", "Spaced hyphens", "a hyphen with space on both sides ( - ), used as a dash", /(?<=\s)-(?=\s)/gu],
        ["ellipsis_rate", "Ellipses", "… or a run of 2+ periods (each run counts once)", /…|\.{2,}/gu],
      ] as const
    ).map(([name, label, what, re]): Spec => ({ name, label, category: "punctuation", unit: "per_100_words", headlineEligible: true, definition: `Occurrences of ${what} per 100 words.`, compute: per100(countChar(P, re)) })),
    { name: "apostrophe_rate", label: "Apostrophes", category: "punctuation", unit: "per_100_words", headlineEligible: true, definition: "In-word apostrophes (contractions, possessives: don't, Sam's) per 100 words; quote marks and URL/email characters excluded.", compute: per100(Math.max(0, apostrophes)) },
    { name: "quotation_mark_rate", label: "Quotation marks", category: "punctuation", unit: "per_100_words", headlineEligible: true, definition: "Double quotes (\" “ ” « » „) and single quotes not inside a word, per 100 words.", compute: per100(quoteMarks) },
    { name: "hyphenated_word_rate", label: "Hyphenated words", category: "punctuation", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "Words containing an internal hyphen (well-known) per 100 words. Normal hyphens, not dashes.", compute: per100(hyphenated) },
    { name: "punctuation_density", label: "Punctuation density", category: "punctuation", unit: "per_100_words", headlineEligible: true, definition: "All punctuation marks (. , ; : ! ? … quotes brackets dashes spaced hyphens apostrophes; not in-word hyphens) per 100 words.", compute: per100(punctAll) },

    // FUNCTION-WORD CATEGORIES
    { name: "article_rate", label: "Articles", category: "function_words", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "a, an, the per 100 words.", compute: rateSet(L.ARTICLES) },
    { name: "determiner_rate", label: "Determiners", category: "function_words", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "Determiners (articles, demonstratives, possessive determiners, quantifiers) per 100 words.", compute: rateSet(L.DETERMINERS) },
    { name: "conjunction_rate", label: "Conjunctions", category: "function_words", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "Coordinating + subordinating conjunctions per 100 words.", compute: rateSet(L.CONJUNCTIONS) },
    { name: "coordinating_conjunction_rate", label: "Coordinating conjunctions", category: "function_words", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "and, but, or, nor, for, yet, so per 100 words.", compute: rateSet(L.COORD_CONJ) },
    { name: "subordinating_conjunction_rate", label: "Subordinating conjunctions", category: "function_words", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "because, although, if, when, while… per 100 words (clause usage).", compute: rateSet(L.SUBORD_CONJ) },
    { name: "preposition_rate", label: "Prepositions", category: "function_words", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "Prepositions per 100 words.", compute: rateSet(L.PREPOSITIONS) },
    { name: "auxiliary_verb_rate", label: "Auxiliary verbs", category: "function_words", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "Forms of be/have/do and modals per 100 words.", compute: rateSet(L.AUXILIARIES) },
    { name: "pronoun_rate", label: "Pronouns (all)", category: "function_words", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "Personal, demonstrative, relative and indefinite pronouns per 100 words.", compute: rateSet(L.PRONOUNS) },

    // DISCOURSE / STYLE
    { name: "connective_rate", label: "Connectives", category: "discourse", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "Clause-linking words (and, but, because, however, therefore…) per 100 words.", compute: rateSet(L.CONNECTIVES) },
    { name: "transition_rate", label: "Transition words", category: "discourse", unit: "per_100_words", headlineEligible: true, definition: "Transition words and phrases (however, moreover, for example, as a result…) per 100 words.", compute: per100(inSet(L.TRANSITIONS) + countPhrases(norms, L.TRANSITION_PHRASES)) },
    { name: "hedge_rate", label: "Hedging", category: "discourse", unit: "per_100_words", headlineEligible: true, definition: "Hedges (maybe, perhaps, probably, I think, sort of…) per 100 words.", compute: per100(inSet(L.HEDGES) + countPhrases(norms, L.HEDGE_PHRASES)) },
    { name: "intensifier_rate", label: "Intensifiers", category: "discourse", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "very, really, extremely, truly… per 100 words.", compute: rateSet(L.INTENSIFIERS) },
    { name: "negation_rate", label: "Negation", category: "discourse", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "not, no, never, nothing… plus n't contractions per 100 words.", compute: per100(inSet(L.NEGATIONS) + norms.filter((n) => n.endsWith("n't")).length) },
    { name: "filler_rate", label: "Filler words", category: "discourse", unit: "per_100_words", headlineEligible: true, definition: "just, basically, actually, literally, you know, I mean… per 100 words.", compute: per100(inSet(L.FILLERS) + countPhrases(norms, L.FILLER_PHRASES)) },
    { name: "discourse_marker_rate", label: "Discourse markers", category: "discourse", unit: "per_100_words", headlineEligible: true, definition: "well, so, anyway, honestly, to be honest, by the way… per 100 words.", compute: per100(inSet(L.DISCOURSE_MARKERS) + countPhrases(norms, L.DISCOURSE_PHRASES)) },

    // FORMATTING / PATTERN
    { name: "paragraph_count", label: "Paragraph count", category: "formatting", unit: "count", exactCount: true, definition: "Blocks of text separated by blank lines.", compute: () => ({ observed: t.paragraphs.length }) },
    { name: "avg_paragraph_length", label: "Average paragraph length", category: "formatting", unit: "words", headlineEligible: true, definition: "Words ÷ paragraphs.", compute: () => ({ observed: t.paragraphs.length ? W / t.paragraphs.length : null, numerator: W, denominator: t.paragraphs.length }) },
    { name: "paragraph_length_sd", label: "Paragraph length spread", category: "formatting", unit: "words", definition: "Sample SD of words per paragraph. Not applicable with fewer than 2 paragraphs; never headline.", compute: () => (paraLens.length >= 2 ? { observed: sd(paraLens), denominator: paraLens.length } : { observed: null, notApplicable: true }) },
    { name: "bullet_line_rate", label: "Bullet / list lines", category: "formatting", unit: "percent_of_lines", headlineEligible: true, definition: "Share of non-empty lines that start with a bullet or list marker (-, *, •, 1., 1)).", compute: () => ({ observed: nonEmptyLines ? (bulletLines / nonEmptyLines) * 100 : null, numerator: bulletLines, denominator: nonEmptyLines }) },
    { name: "mid_sentence_capital_rate", label: "Capitalised words mid-sentence", category: "formatting", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "Words starting with a capital letter that are not sentence-initial, not “I” and not all-caps, per 100 words (capitalisation pattern).", compute: per100(capsMid) },
    { name: "all_caps_word_rate", label: "ALL-CAPS words", category: "formatting", unit: "per_100_words", binomial: true, headlineEligible: true, definition: "Words of 2+ letters written entirely in capitals per 100 words.", compute: per100(allCaps) },
  ];

  const metrics: Metric[] = specs.map((s) => {
    const r = s.compute();
    const observed = r.observed === null || !Number.isFinite(r.observed) ? null : round(r.observed);
    let reliability: Reliability;
    if (r.notApplicable) reliability = "not_applicable";
    else if (s.exactCount) reliability = "reliable";
    else if (observed === null || !sufficient) reliability = "insufficient_data";
    else reliability = "reliable";
    const m: Metric = {
      name: s.name,
      label: s.label,
      category: s.category,
      unit: s.unit,
      definition: s.definition,
      value: reliability === "reliable" ? observed : null,
      observed,
      reliability,
      headlineEligible: !!s.headlineEligible,
    };
    if (r.numerator !== undefined) m.numerator = r.numerator;
    if (r.denominator !== undefined) m.denominator = r.denominator;
    if (s.binomial && r.numerator !== undefined && r.denominator && r.numerator <= r.denominator) {
      const p = r.numerator / r.denominator;
      m.uncertainty95 = round(1.96 * Math.sqrt((p * (1 - p)) / r.denominator) * 100);
    }
    return m;
  });

  return {
    version: FINGERPRINT_VERSION,
    wordCount: W,
    minSampleWords: MIN_SAMPLE_WORDS,
    sufficient,
    counts: {
      words: W,
      numbers,
      urls: t.tokens.filter((x) => x.type === "url").length,
      emails: t.tokens.filter((x) => x.type === "email").length,
      sentences: S,
      paragraphs: t.paragraphs.length,
      lines: nonEmptyLines,
    },
    metrics,
    reliableMetrics: metrics.filter((m) => m.reliability === "reliable").map((m) => m.name),
    suppressedMetrics: metrics.filter((m) => m.reliability !== "reliable").map((m) => m.name),
  };
}

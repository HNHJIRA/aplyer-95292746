// Deterministic post-guard for generated answers.
//
// This is NOT a second grounding engine: it reuses the P0 grounding primitives
// (normalizeText, numericTokens, durationClaims) so "supported" means the same
// thing here as it does during extraction.
//
// It validates typed candidate claims, not arbitrary tokens: metrics, dates,
// durations, employers, claimed tools, team sizes and tense/currency. Ordinary
// structural language is never rejected just for containing common words.
import { durationClaims, normalizeText, numericTokens } from "./fact-inventory-grounding";
import {
  ANSWER_MAX_WORDS,
  ANSWER_MIN_WORDS,
  HARD_BANNED_TERMS,
  countWords,
} from "./prompts/prompt-a-answer-generation";
import { evaluateTemporal, type TemporalCode } from "./temporal";
import type { FlattenedInventory } from "./answer-facts";

export type GuardCode =
  | "empty_answer"
  | "word_count_out_of_range"
  | "opens_with_i"
  | "banned_vocabulary"
  | "markdown_or_list"
  | "unsupported_number"
  | "unsupported_duration"
  | "unsupported_tool"
  | "cross_role_attribution"
  | TemporalCode;

export interface GuardViolation {
  code: GuardCode;
  detail: string;
  /** Non-blocking violations are diagnostics only and never fail the answer. */
  blocking?: boolean;
}

export interface GuardReport {
  passed: boolean;
  violations: GuardViolation[];
}


/**
 * Bounded lexicon of tools/technologies. A term from this list appearing in the
 * answer is read as a claim of hands-on experience and must be supported. Terms
 * outside the lexicon are left to Prompt J — we would rather miss an exotic tool
 * than reject ordinary prose.
 */
export const TOOL_LEXICON = [
  "react", "angular", "vue", "svelte", "next.js", "nextjs", "node.js", "nodejs", "deno",
  "typescript", "javascript", "python", "java", "kotlin", "swift", "golang", "rust", "ruby",
  "rails", "django", "flask", "laravel", "php", "c++", "c#", ".net", "spring",
  "kubernetes", "docker", "terraform", "ansible", "jenkins", "circleci", "github actions",
  "aws", "azure", "gcp", "google cloud", "lambda", "s3", "ec2", "cloudflare",
  "postgres", "postgresql", "mysql", "mongodb", "redis", "elasticsearch", "dynamodb",
  "snowflake", "databricks", "spark", "hadoop", "kafka", "rabbitmq", "airflow",
  "tensorflow", "pytorch", "scikit-learn", "pandas", "numpy",
  "graphql", "rest api", "grpc", "kibana", "grafana", "prometheus", "datadog", "splunk",
  "salesforce", "hubspot", "sap", "oracle", "workday", "servicenow", "netsuite",
  "jira", "confluence", "asana", "trello", "notion", "figma", "sketch", "adobe xd",
  "photoshop", "illustrator", "tableau", "power bi", "looker", "excel", "sql",
  "git", "github", "gitlab", "bitbucket", "linux", "bash", "supabase", "firebase", "stripe",
] as const;

const NON_CLAIM_NUMBER_WORDS = new Set(["one", "two", "first", "second"]);

/** Spelled-out quantities that make a duration claim, e.g. "five years". */
const SPELLED_NUMBERS: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
  nine: "9", ten: "10", eleven: "11", twelve: "12", fifteen: "15", twenty: "20",
};

const SPELLED_DURATION_RE = new RegExp(
  `\\b(${Object.keys(SPELLED_NUMBERS).join("|")})\\s+(years?|months?)\\b`,
  "gi",
);

function spelledDurationClaims(text: string): Array<{ word: string; unit: string }> {
  const out: Array<{ word: string; unit: string }> = [];
  const normalized = normalizeText(text);
  for (const m of normalized.matchAll(SPELLED_DURATION_RE)) {
    out.push({ word: m[1]!.toLowerCase(), unit: m[2]!.toLowerCase() });
  }
  return out;
}


/**
 * Normalized text with sentence punctuation turned into separators so word
 * matching is not defeated by a trailing comma. Characters that are part of
 * tool names (. + # &) are preserved.
 */
function words(s: string): string {
  return normalizeText(s).replace(/[,;:!?'"()]/g, " ").replace(/\s+/g, " ").trim();
}

function pad(s: string): string {
  return ` ${words(s)} `;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

/**
 * Numbers that are part of a claim rather than incidental prose. Four-digit
 * years are excluded here — they are dates, and temporal.ts validates them
 * role-aware instead of as bare metrics.
 */
function claimNumbers(text: string): string[] {
  return numericTokens(text).filter(
    (n) => !NON_CLAIM_NUMBER_WORDS.has(n) && !/^(19|20)\d{2}$/.test(n),
  );
}

export function runAnswerGuards(answer: string, flat: FlattenedInventory): GuardReport {
  const violations: GuardViolation[] = [];
  const add = (code: GuardCode, detail: string) => violations.push({ code, detail, blocking: true });

  const text = (answer ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { passed: false, violations: [{ code: "empty_answer", detail: "empty" }] };

  // 1. Length policy.
  const words = countWords(text);
  if (words < ANSWER_MIN_WORDS || words > ANSWER_MAX_WORDS) {
    add("word_count_out_of_range", `${words} words`);
  }

  // 2. No-I opening rule.
  if (/^i\b/i.test(text)) add("opens_with_i", "answer opens with I");

  // 3. Hard-banned vocabulary.
  const padded = pad(text);
  for (const term of HARD_BANNED_TERMS) {
    if (padded.includes(` ${normalizeText(term)} `)) add("banned_vocabulary", term);
  }

  // 4. Formatting rules — prose only.
  if (/(^|\s)[-*•]\s|\n\s*\d+\.\s|#{1,6}\s|\*\*/.test(answer)) {
    add("markdown_or_list", "list or markdown formatting");
  }

  const corpus = normalizeText(flat.corpus);
  const paddedCorpus = pad(flat.corpus);
  const supportedNumbers = new Set(claimNumbers(flat.corpus));

  // 5. Metrics, team sizes, percentages and any other claim number.
  for (const n of claimNumbers(text)) {
    if (!supportedNumbers.has(n)) add("unsupported_number", n);
  }

  // 6. Durations and years-of-experience claims (digits and spelled out).
  for (const d of durationClaims(text)) {
    if (!corpus.includes(d)) add("unsupported_duration", d);
  }
  for (const d of spelledDurationClaims(text)) {
    // A spelled duration is supported only when the same duration, in either
    // spelling, is present in the inventory corpus.
    const digits = SPELLED_NUMBERS[d.word];
    const digitForm = digits ? `${digits} ${d.unit}` : null;
    const supported =
      paddedCorpus.includes(` ${d.word} ${d.unit} `) ||
      (digitForm ? corpus.includes(digitForm) : false);
    if (!supported) add("unsupported_duration", `${d.word} ${d.unit}`);
  }


  // 7. Dates, precision, cross-role windows and tense — all role-aware.
  for (const t of evaluateTemporal(text, flat)) {
    violations.push({ code: t.code, detail: t.detail, blocking: t.blocking });
  }

  // 8. Tools claimed as experience.
  for (const tool of TOOL_LEXICON) {
    const t = normalizeText(tool);
    if (!t) continue;
    if (padded.includes(` ${t} `) && !paddedCorpus.includes(` ${t} `)) add("unsupported_tool", tool);
  }

  // 10. Cross-role attribution: a number in a sentence naming one employer must
  //     be supported by that employer's own facts.
  const roleNames = flat.roles
    .map((r) => ({ role: r, name: normalizeText(r.company ?? "") }))
    .filter((r) => r.name.length >= 3);

  if (roleNames.length > 1) {
    for (const sentence of sentences(text)) {
      const padSentence = pad(sentence);
      const mentioned = roleNames.filter((r) => padSentence.includes(` ${r.name} `));
      if (mentioned.length !== 1) continue;
      const owner = mentioned[0]!.role;
      const ownFacts = flat.facts.filter((f) => f.roleIndex === owner.index);
      const ownNumbers = new Set(
        claimNumbers(ownFacts.map((f) => `${f.value} ${f.evidence}`).join(" ")),
      );
      // Facts not tied to any role (skills, summary) stay usable everywhere.
      const neutralNumbers = new Set(
        claimNumbers(flat.facts.filter((f) => f.roleIndex === null).map((f) => f.value).join(" ")),
      );
      const roleDateNumbers = new Set(
        claimNumbers([owner.startDate, owner.endDate].filter(Boolean).join(" ")),
      );
      for (const n of claimNumbers(sentence)) {
        if (!ownNumbers.has(n) && !neutralNumbers.has(n) && !roleDateNumbers.has(n)) {
          add("cross_role_attribution", `${owner.company ?? "role"}:${n}`);
        }
      }
    }
  }

  return { passed: !violations.some((v) => v.blocking !== false), violations };
}

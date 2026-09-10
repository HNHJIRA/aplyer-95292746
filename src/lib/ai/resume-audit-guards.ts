// Resume Red Flag Audit — deterministic, pure, server-side guards.
//
// SCOPE RULES (non-negotiable):
//  1. These guards run ONLY on AI-generated audit commentary. The candidate's
//     own resume text is source material and is never rewritten or rejected.
//  2. Everything here is deterministic and model-free. No network, no clock
//     reads inside pure helpers (the runtime date is always injected).
//  3. These guards are Resume-Audit specific. They deliberately do NOT reuse
//     the A→J answer guards, whose grounding assumptions (P0 fact inventory,
//     role windows, first-person answer voice) do not apply here.

export type ResumeAuditGuardCode =
  | "em_dash"
  | "en_dash"
  | "prohibited_hyphen"
  | "rule_of_three"
  | "candidate_name_reference"
  | "third_person_pronoun"
  | "duplicate_strength_opening"
  | "strength_too_long"
  | "current_year_mismatch"
  | "ungrounded_employer"
  | "ungrounded_tool"
  | "ungrounded_metric";

export interface ResumeAuditGuardViolation {
  code: ResumeAuditGuardCode;
  field: string;
  detail: string;
}

export interface ResumeAuditGuardContext {
  /** Raw resume text. Used for grounding only; never mutated, never logged. */
  resumeText: string;
  /** Runtime date the audit was generated against. */
  now: Date;
  /** Max words allowed in a single strength. */
  maxStrengthWords?: number;
}

/** A generated field to be checked: a label plus its text. */
export interface GeneratedField {
  field: string;
  text: string;
}

export const MAX_STRENGTH_WORDS = 22;

/* ------------------------------------------------------------------ */
/* text helpers                                                        */
/* ------------------------------------------------------------------ */

const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
}

export function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* 1. dashes and prohibited hyphen punctuation                         */
/* ------------------------------------------------------------------ */

/**
 * A hyphen is fine inside a compound word ("data-driven", "cross-functional").
 * It is prohibited when used as sentence punctuation, i.e. surrounded by
 * whitespace or trailing a word as a clause break.
 */
const PUNCTUATION_HYPHEN_RE = /(?:\s-{1,2}\s|\s-{2,}|\w-{2,}\w)/;

export function checkDashes(fields: GeneratedField[]): ResumeAuditGuardViolation[] {
  const out: ResumeAuditGuardViolation[] = [];
  for (const { field, text } of fields) {
    if (text.includes(EM_DASH)) {
      out.push({ code: "em_dash", field, detail: "Generated commentary contains an em dash." });
    }
    if (text.includes(EN_DASH)) {
      out.push({ code: "en_dash", field, detail: "Generated commentary contains an en dash." });
    }
    if (PUNCTUATION_HYPHEN_RE.test(text)) {
      out.push({
        code: "prohibited_hyphen",
        field,
        detail: "Generated commentary uses a hyphen as sentence punctuation.",
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 2. rule of three                                                    */
/* ------------------------------------------------------------------ */

const LIST_RE = /([^.;:!?]*?,[^.;:!?]*?)\s+(?:and|or)\s+([^.;:!?]+)/gi;

/** Counts the items in a coordinated list; returns 0 when there is no list. */
export function coordinatedListSize(sentence: string): number {
  let max = 0;
  LIST_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LIST_RE.exec(sentence)) !== null) {
    const head = m[1] ?? "";
    const items = head
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean).length;
    const total = items + 1;
    if (total > max) max = total;
  }
  return max;
}

export function checkRuleOfThree(fields: GeneratedField[]): ResumeAuditGuardViolation[] {
  const out: ResumeAuditGuardViolation[] = [];
  for (const { field, text } of fields) {
    for (const sentence of sentences(text)) {
      if (coordinatedListSize(sentence) === 3) {
        out.push({
          code: "rule_of_three",
          field,
          detail: "Generated commentary uses a three-item list construction.",
        });
        break;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3. candidate-facing voice                                           */
/* ------------------------------------------------------------------ */

const THIRD_PERSON_RE = /\b(?:he|she|his|her|hers|him|himself|herself)\b/i;

const NAME_STOPWORDS = new Set([
  "resume", "cv", "curriculum", "vitae", "profile", "summary", "professional",
  "experience", "education", "skills", "contact", "phone", "email", "linkedin",
]);

/**
 * Best-effort candidate name extraction: the first line of a resume is the
 * name in effectively every real-world layout. Returns individual name tokens
 * (>= 3 chars) so both "Marcus" and "Johnson" are caught.
 */
export function extractCandidateNames(resumeText: string): string[] {
  const firstLines = resumeText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  const tokens: string[] = [];
  for (const line of firstLines) {
    if (line.includes("@") || /\d{3}/.test(line)) continue;
    const parts = line.split(/[\s,|]+/).filter(Boolean);
    if (parts.length > 5) continue;
    const named = parts.filter((p) => /^[A-Z][a-zA-Z'\u2019.-]{2,}$/.test(p));
    if (named.length >= 2 && named.every((p) => !NAME_STOPWORDS.has(p.toLowerCase()))) {
      tokens.push(...named.map((p) => p.replace(/[.]/g, "")));
      break;
    }
  }
  return Array.from(new Set(tokens));
}

export function checkCandidateVoice(
  fields: GeneratedField[],
  candidateNames: string[],
): ResumeAuditGuardViolation[] {
  const out: ResumeAuditGuardViolation[] = [];
  const lowerNames = candidateNames.map((n) => n.toLowerCase());
  for (const { field, text } of fields) {
    const lower = normalize(text);
    if (THIRD_PERSON_RE.test(text)) {
      out.push({
        code: "third_person_pronoun",
        field,
        detail: "Generated commentary uses a third-person pronoun instead of addressing you directly.",
      });
    }
    for (const name of lowerNames) {
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:'s|\u2019s)?\\b`, "i");
      if (re.test(lower)) {
        out.push({
          code: "candidate_name_reference",
          field,
          detail: "Generated commentary refers to the candidate by name instead of 'you'.",
        });
        break;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 4. strengths                                                        */
/* ------------------------------------------------------------------ */

export function checkStrengths(
  strengths: string[],
  maxWords: number = MAX_STRENGTH_WORDS,
): ResumeAuditGuardViolation[] {
  const out: ResumeAuditGuardViolation[] = [];
  let previousOpening = "";
  strengths.forEach((raw, i) => {
    const text = raw.trim();
    const field = `strengths[${i}]`;
    const count = words(text).length;
    if (count > maxWords) {
      out.push({
        code: "strength_too_long",
        field,
        detail: `Strength is ${count} words; the limit is ${maxWords}.`,
      });
    }
    const opening = (words(text)[0] ?? "").toLowerCase().replace(/[^a-z0-9']/g, "");
    if (opening && opening === previousOpening) {
      out.push({
        code: "duplicate_strength_opening",
        field,
        detail: "Two consecutive strengths begin with the same word.",
      });
    }
    previousOpening = opening;
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* 5. current-year consistency                                         */
/* ------------------------------------------------------------------ */

/**
 * Patterns that assert something about the CURRENT moment. Historical resume
 * dates ("certified in 2023", "left in 2025") never match, so a legitimate
 * resume year is never rejected.
 */
const CURRENT_YEAR_PATTERNS: RegExp[] = [
  /\bas of\s+((?:19|20)\d{2})\b/gi,
  /\b(?:current(?:ly)?|right now|at present|nowadays|today)\b[^.?!]{0,60}?\b((?:19|20)\d{2})\b/gi,
  /\b(?:this|the current)\s+year\b[^.?!]{0,30}?\b((?:19|20)\d{2})\b/gi,
  /\b(?:being\s+)?(?:reviewed|screened|read|assessed|evaluated|hiring|recruiting)\b[^.?!]{0,30}?\bin\s+((?:19|20)\d{2})\b/gi,
  /\bin\s+((?:19|20)\d{2})\b[^.?!]{0,40}?\b(?:recruiters (?:are|expect|want)|you are now|it is now|hiring managers (?:are|expect))\b/gi,
  /\b(?:we are|it is|it's|we're)\s+(?:in\s+)?((?:19|20)\d{2})\b/gi,
];

export function checkCurrentYear(
  fields: GeneratedField[],
  now: Date,
): ResumeAuditGuardViolation[] {
  const runtimeYear = now.getUTCFullYear();
  const out: ResumeAuditGuardViolation[] = [];
  for (const { field, text } of fields) {
    for (const pattern of CURRENT_YEAR_PATTERNS) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const year = Number(m[1]);
        if (Number.isFinite(year) && year !== runtimeYear) {
          out.push({
            code: "current_year_mismatch",
            field,
            detail: `Generated commentary treats ${year} as the current year; the current year is ${runtimeYear}.`,
          });
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 6. light grounding                                                  */
/* ------------------------------------------------------------------ */

/** Recruiter vocabulary that is legitimately generated, not resume-sourced. */
const GENERATED_VOCAB = new Set(
  [
    "ats", "applicant", "tracking", "system", "linkedin", "pdf", "docx", "word",
    "professional", "summary", "experience", "education", "skills", "resume",
    "recruiter", "recruiters", "hiring", "manager", "managers", "you", "your",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december", "did", "the", "this", "that",
    "add", "swap", "cut", "lead", "led", "own", "quantify", "no", "yes", "if",
  ].map((w) => w.toLowerCase()),
);

/** Tools we can check deterministically. Absent tools are simply not checked. */
export const TOOL_VOCAB = [
  "salesforce", "hubspot", "marketo", "mailchimp", "pardot", "google analytics",
  "ga4", "looker", "tableau", "power bi", "excel", "sql", "python", "r", "sas",
  "jira", "confluence", "asana", "trello", "figma", "sketch", "adobe", "photoshop",
  "aws", "azure", "gcp", "docker", "kubernetes", "terraform", "react", "angular",
  "vue", "node", "java", "typescript", "javascript", "snowflake", "databricks",
  "segment", "amplitude", "mixpanel", "zendesk", "servicenow", "sap", "oracle",
  "netsuite", "quickbooks", "workday", "greenhouse", "lever", "shopify", "stripe",
];

const PROPER_NOUN_RE = /\b([A-Z][a-zA-Z0-9&.]*(?:\s+[A-Z][a-zA-Z0-9&.]*)*)\b/g;

function resumeContains(resumeLower: string, needle: string): boolean {
  return resumeLower.includes(needle.toLowerCase());
}

/** Digits present anywhere in the resume, normalized for comparison. */
function resumeNumbers(resumeText: string): Set<string> {
  const set = new Set<string>();
  for (const m of resumeText.matchAll(/\d[\d,.]*/g)) {
    set.add(m[0].replace(/[,\s]/g, "").replace(/\.$/, ""));
  }
  return set;
}

/** Metric-looking numbers only: percentages, currency, magnitudes, big numbers. */
const METRIC_RE = /(\$\s?\d[\d,.]*\s?[kmb]?|\b\d[\d,.]*\s?%|\b\d[\d,.]*\s?[kmb]\b|\b\d{4,}\b|\b\d[\d,.]*x\b)/gi;

/**
 * Fix advice and the closing priority are PRESCRIPTIVE: they tell the candidate
 * what to write next, so they legitimately contain example wording, example
 * numbers, and tool names the resume does not have yet. Grounding applies to
 * statements ABOUT the resume, not to suggestions for it.
 */
function isPrescriptiveField(field: string): boolean {
  return field.includes("fixPoints") || field === "topPriority";
}

/** Quoted spans are suggested wording, not claims about the resume. */
function stripQuoted(text: string): string {
  return text.replace(/["\u201c\u201d'\u2018\u2019][^"\u201c\u201d\n]{0,200}?["\u201c\u201d]/g, " ");
}

export function checkGrounding(
  fields: GeneratedField[],
  resumeText: string,
): ResumeAuditGuardViolation[] {
  const out: ResumeAuditGuardViolation[] = [];
  const resumeLower = resumeText.toLowerCase();
  const numbers = resumeNumbers(resumeText);

  for (const { field, text: rawText } of fields) {
    if (isPrescriptiveField(field)) continue;
    const text = stripQuoted(rawText);

    // employers / proper nouns
    PROPER_NOUN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = PROPER_NOUN_RE.exec(text)) !== null) {
      const phrase = (m[1] ?? "").trim();
      if (!phrase || phrase.length < 3) continue;
      const lower = phrase.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      // Skip sentence-initial capitalisation and known recruiter vocabulary.
      const tokens = lower.split(/\s+/);
      if (tokens.every((t) => GENERATED_VOCAB.has(t))) continue;
      const start = m.index;
      const before = text.slice(Math.max(0, start - 2), start);
      const sentenceInitial = start === 0 || /[.!?]\s$/.test(before) || /^\s*$/.test(before);
      if (sentenceInitial && tokens.length === 1) continue;
      if (resumeContains(resumeLower, lower)) continue;
      // A multi-word phrase may be a partial match of a resume entity.
      if (tokens.length > 1 && tokens.some((t) => !GENERATED_VOCAB.has(t) && resumeContains(resumeLower, t))) {
        continue;
      }
      out.push({
        code: "ungrounded_employer",
        field,
        detail: "Generated commentary names an organisation that is not in the resume.",
      });
    }

    // tools
    const textLower = text.toLowerCase();
    for (const tool of TOOL_VOCAB) {
      const re = new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(textLower) && !resumeContains(resumeLower, tool)) {
        out.push({
          code: "ungrounded_tool",
          field,
          detail: "Generated commentary names a tool that is not in the resume.",
        });
      }
    }

    // metrics
    METRIC_RE.lastIndex = 0;
    let n: RegExpExecArray | null;
    while ((n = METRIC_RE.exec(text)) !== null) {
      const raw = (n[1] ?? "").replace(/[\s$%]/g, "").replace(/[,]/g, "").replace(/\.$/, "");
      const digits = raw.replace(/[^0-9.]/g, "");
      if (!digits) continue;
      if (numbers.has(digits) || resumeLower.includes(digits)) continue;
      out.push({
        code: "ungrounded_metric",
        field,
        detail: "Generated commentary cites a metric that is not in the resume.",
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* combined guard                                                      */
/* ------------------------------------------------------------------ */

export interface GuardableAudit {
  overallTakePoints: string[];
  redFlags: Array<{ flag: string; whyPoints: string[]; fixPoints: string[]; employer: string | null }>;
  strengths: string[];
  topPriority: string;
}

export function collectGeneratedFields(audit: GuardableAudit): GeneratedField[] {
  const fields: GeneratedField[] = [];
  audit.overallTakePoints.forEach((t, i) => fields.push({ field: `overallTakePoints[${i}]`, text: t }));
  audit.redFlags.forEach((f, i) => {
    fields.push({ field: `redFlags[${i}].flag`, text: f.flag });
    f.whyPoints.forEach((t, j) => fields.push({ field: `redFlags[${i}].whyPoints[${j}]`, text: t }));
    f.fixPoints.forEach((t, j) => fields.push({ field: `redFlags[${i}].fixPoints[${j}]`, text: t }));
  });
  audit.strengths.forEach((t, i) => fields.push({ field: `strengths[${i}]`, text: t }));
  fields.push({ field: "topPriority", text: audit.topPriority });
  return fields;
}

export function runResumeAuditGuards(
  audit: GuardableAudit,
  ctx: ResumeAuditGuardContext,
): ResumeAuditGuardViolation[] {
  const fields = collectGeneratedFields(audit);
  return [
    ...checkDashes(fields),
    ...checkRuleOfThree(fields),
    ...checkCandidateVoice(fields, extractCandidateNames(ctx.resumeText)),
    ...checkStrengths(audit.strengths, ctx.maxStrengthWords ?? MAX_STRENGTH_WORDS),
    ...checkCurrentYear(fields, ctx.now),
    ...checkGrounding(fields, ctx.resumeText),
  ];
}

/** Guard summary safe for logs: codes and fields only, never resume text. */
export function guardSummary(violations: ResumeAuditGuardViolation[]): string {
  return violations.map((v) => `${v.code}@${v.field}`).join(", ");
}

/* ------------------------------------------------------------------ */
/* deterministic red-flag ordering                                     */
/* ------------------------------------------------------------------ */

export interface EmploymentEntry {
  label: string;
  start: number;
  end: number;
  order: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const PRESENT_SCORE = 9_999_999;

const DATE_RANGE_RE = new RegExp(
  String.raw`((?:[A-Za-z]{3,9}\.?\s+)?(?:19|20)\d{2})\s*(?:-|\u2013|\u2014|to|until|\u2192)\s*(present|current|now|(?:[A-Za-z]{3,9}\.?\s+)?(?:19|20)\d{2})`,
  "i",
);

function scoreDate(token: string): number {
  const t = token.trim().toLowerCase();
  if (/^(present|current|now)$/.test(t)) return PRESENT_SCORE;
  const year = Number(t.match(/(19|20)\d{2}/)?.[0] ?? 0);
  if (!year) return 0;
  const monthWord = t.match(/[a-z]{3,9}/)?.[0];
  const month = monthWord ? (MONTHS[monthWord] ?? MONTHS[monthWord.slice(0, 3)] ?? 6) : 6;
  return year * 12 + month;
}

/**
 * Parses employment entries from resume text. An entry is any line carrying a
 * date range; the label is that line plus the preceding line, which is where
 * company names usually live in two-line entry layouts.
 */
export function parseEmploymentHistory(resumeText: string): EmploymentEntry[] {
  const lines = resumeText.split(/\r?\n/).map((l) => l.trim());
  const entries: EmploymentEntry[] = [];
  lines.forEach((line, i) => {
    const m = line.match(DATE_RANGE_RE);
    if (!m) return;
    const start = scoreDate(m[1] ?? "");
    const end = scoreDate(m[2] ?? "");
    const context = [lines[i - 2] ?? "", lines[i - 1] ?? "", line, lines[i + 1] ?? ""].join(" ");
    const label = context.replace(DATE_RANGE_RE, " ").replace(/\s+/g, " ").trim();
    entries.push({ label, start, end, order: entries.length });
  });
  return entries;
}

function matchEntry(
  flag: { flag: string; whyPoints: string[]; fixPoints: string[]; employer: string | null },
  history: EmploymentEntry[],
): EmploymentEntry | null {
  const employer = (flag.employer ?? "").trim().toLowerCase();
  if (employer) {
    const direct = history.find((h) => h.label.toLowerCase().includes(employer));
    if (direct) return direct;
  }
  const hay = [flag.flag, ...flag.whyPoints, ...flag.fixPoints].join(" ").toLowerCase();
  let best: EmploymentEntry | null = null;
  for (const h of history) {
    for (const token of h.label.split(/[^A-Za-z0-9&]+/)) {
      if (token.length < 4) continue;
      const t = token.toLowerCase();
      if (GENERATED_VOCAB.has(t)) continue;
      if (hay.includes(t)) {
        if (!best || h.end > best.end) best = h;
      }
    }
  }
  return best;
}

/**
 * Deterministic ordering: employment-related flags first, sorted most recent
 * role to oldest (resume dates are the source of truth, never model order or
 * alphabetical). Non-employment flags keep their model order and follow.
 */
export function orderRedFlags<
  T extends { flag: string; whyPoints: string[]; fixPoints: string[]; employer: string | null },
>(redFlags: T[], resumeText: string): T[] {
  const history = parseEmploymentHistory(resumeText);
  const decorated = redFlags.map((flag, index) => ({
    flag,
    index,
    entry: history.length ? matchEntry(flag, history) : null,
  }));
  const employment = decorated.filter((d) => d.entry !== null);
  const other = decorated.filter((d) => d.entry === null);
  employment.sort((a, b) => {
    const ea = a.entry!;
    const eb = b.entry!;
    if (eb.end !== ea.end) return eb.end - ea.end;
    if (eb.start !== ea.start) return eb.start - ea.start;
    return a.index - b.index;
  });
  other.sort((a, b) => a.index - b.index);
  return [...employment, ...other].map((d) => d.flag);
}

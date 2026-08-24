// Deterministic, server-side semantic guardrails for the P0 fact inventory.
//
// Structural JSON validity is not enough: the model must never be trusted to
// state candidate facts that the resume does not support. Everything here is
// pure and synchronous so it can be unit-tested without a provider.
import type {
  DraftInventory,
  Fact,
  ResumeFactInventory,
  SkillFact,
} from "./prompts/prompt-p0-fact-inventory";
import { FACT_INVENTORY_SCHEMA_VERSION } from "./prompts/prompt-p0-fact-inventory";

export interface GroundingRejection {
  factId: string;
  value: string;
  reason:
    | "evidence_not_in_resume"
    | "unsupported_number"
    | "unsupported_duration"
    | "unsupported_strengthening"
    | "duplicate_fact";
}

export interface GroundingReport {
  inventory: ResumeFactInventory;
  rejections: GroundingRejection[];
  keptFactCount: number;
}

export class GroundingError extends Error {
  readonly rejections: GroundingRejection[];
  constructor(message: string, rejections: GroundingRejection[] = []) {
    super(message);
    this.name = "GroundingError";
    this.rejections = rejections;
  }
}

/** Share of checkable facts that may be dropped before the run is untrustworthy. */
const MAX_REJECTION_RATIO = 0.4;

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^a-z0-9%$.,'/+#&()\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(input: string): string[] {
  return normalizeText(input).split(" ").filter(Boolean);
}

/** Longest run of consecutive evidence tokens that appears in the resume. */
function longestContiguousRun(evidenceTokens: string[], haystack: string): number {
  let best = 0;
  for (let i = 0; i < evidenceTokens.length; i++) {
    for (let j = i + best + 1; j <= evidenceTokens.length; j++) {
      const window = ` ${evidenceTokens.slice(i, j).join(" ")} `;
      if (haystack.includes(window)) best = Math.max(best, j - i);
      else break;
    }
  }
  return best;
}

/**
 * Evidence is grounded when it is verbatim (after whitespace/case
 * normalization) or an almost-verbatim fragment of the resume.
 */
export function isEvidenceGrounded(evidence: string, normalizedResume: string): boolean {
  const padded = ` ${normalizedResume} `;
  const normEvidence = normalizeText(evidence);
  if (!normEvidence) return false;
  if (padded.includes(` ${normEvidence} `) || normalizedResume.includes(normEvidence)) return true;

  const evTokens = tokens(evidence);
  if (evTokens.length === 0) return false;
  const present = evTokens.filter((t) => padded.includes(` ${t} `)).length;
  const coverage = present / evTokens.length;
  const run = longestContiguousRun(evTokens, padded);
  return coverage >= 0.9 && run >= Math.min(5, evTokens.length);
}

const NUMBER_RE = /(?:\$|€|£)?\d[\d,.]*\s*(?:%|k|m|bn|b|\+)?/gi;

export function numericTokens(input: string): string[] {
  const out = (normalizeText(input).match(NUMBER_RE) ?? [])
    .map((n) => n.replace(/\s+/g, "").replace(/[,.]$/, ""))
    .filter((n) => /\d/.test(n));
  return out;
}

const DURATION_RE = /\b\d+\+?\s*(?:\+\s*)?(?:year|yr|yrs|years|month|months|mo)\b/gi;

export function durationClaims(input: string): string[] {
  return (normalizeText(input).match(DURATION_RE) ?? []).map((s) => s.replace(/\s+/g, " ").trim());
}

/** Words that strengthen scope/seniority/expertise beyond a plain statement. */
const STRENGTHENING_TERMS = [
  "expert",
  "expertise",
  "mastery",
  "mastered",
  "advanced",
  "senior-level",
  "world-class",
  "best-in-class",
  "led",
  "leading",
  "managed",
  "managing",
  "owned",
  "spearheaded",
  "directed",
  "supervised",
  "architected",
  "founded",
  "head of",
  "in charge of",
  "single-handedly",
  "extensive",
  "deep experience",
];

export function unsupportedStrengthening(value: string, evidence: string): string | null {
  const v = ` ${normalizeText(value)} `;
  const e = ` ${normalizeText(evidence)} `;
  for (const term of STRENGTHENING_TERMS) {
    if (v.includes(` ${term} `) && !e.includes(term)) return term;
  }
  return null;
}

interface FactCheckContext {
  normalizedResume: string;
  seen: Set<string>;
  rejections: GroundingRejection[];
}

function checkFact(fact: Fact, ctx: FactCheckContext): boolean {
  const push = (reason: GroundingRejection["reason"]) => {
    ctx.rejections.push({ factId: fact.id, value: fact.value, reason });
    return false;
  };

  if (!isEvidenceGrounded(fact.evidence, ctx.normalizedResume)) return push("evidence_not_in_resume");

  // Numbers in the fact must appear in its evidence AND in the resume itself.
  const resumeNumbers = new Set(numericTokens(ctx.normalizedResume));
  const evidenceNumbers = new Set(numericTokens(fact.evidence));
  for (const n of numericTokens(fact.value)) {
    if (!evidenceNumbers.has(n) || !resumeNumbers.has(n)) return push("unsupported_number");
  }

  // Durations ("5 years") must be literally present in the resume text.
  for (const d of durationClaims(fact.value)) {
    if (!ctx.normalizedResume.includes(d)) return push("unsupported_duration");
  }

  if (unsupportedStrengthening(fact.value, fact.evidence)) return push("unsupported_strengthening");

  const dedupeKey = `${fact.sourceSection}|${fact.id}`;
  if (ctx.seen.has(dedupeKey)) return push("duplicate_fact");
  ctx.seen.add(dedupeKey);
  return true;
}

function filterFacts<T extends Fact>(facts: T[], ctx: FactCheckContext): T[] {
  return facts.filter((f) => checkFact(f, ctx));
}

/** Contact/identity scalars are kept only when they literally occur in the resume. */
function groundScalar(value: string | null, normalizedResume: string): string | null {
  if (!value) return null;
  const norm = normalizeText(value);
  if (!norm) return null;
  return normalizedResume.includes(norm) ? value : null;
}

/**
 * Applies all semantic guardrails. Ungrounded facts are dropped. If the model
 * output is so unreliable that a large share of facts fail, the whole run is
 * rejected rather than committing partial, untrustworthy truth.
 */
export function applyGrounding(
  draft: DraftInventory,
  resumeText: string,
  sourceResumeId: string,
): GroundingReport {
  const normalizedResume = normalizeText(resumeText);
  const ctx: FactCheckContext = { normalizedResume, seen: new Set(), rejections: [] };

  let considered = 0;
  const count = <T extends Fact>(list: T[]) => {
    considered += list.length;
    return list;
  };

  const inventory: ResumeFactInventory = {
    schemaVersion: FACT_INVENTORY_SCHEMA_VERSION,
    sourceResumeId,
    identity: {
      name: groundScalar(draft.identity.name, normalizedResume),
      location: groundScalar(draft.identity.location, normalizedResume),
    },
    contact: {
      email: groundScalar(draft.contact.email, normalizedResume),
      phone: groundScalar(draft.contact.phone, normalizedResume),
      linkedin: groundScalar(draft.contact.linkedin, normalizedResume),
      portfolio: groundScalar(draft.contact.portfolio, normalizedResume),
    },
    professionalSummaryFacts: filterFacts(count(draft.professionalSummaryFacts), ctx),
    experience: draft.experience.map((e) => ({
      ...e,
      facts: filterFacts(count(e.facts), ctx),
      technologies: filterFacts(count(e.technologies), ctx),
      achievements: filterFacts(count(e.achievements), ctx),
    })),
    education: draft.education.map((e) => ({ ...e, facts: filterFacts(count(e.facts), ctx) })),
    skills: filterFacts(count(draft.skills), ctx) as SkillFact[],
    certifications: filterFacts(count(draft.certifications), ctx),
    projects: draft.projects.map((p) => ({
      ...p,
      technologies: filterFacts(count(p.technologies), ctx),
      responsibilities: filterFacts(count(p.responsibilities), ctx),
      outcomes: filterFacts(count(p.outcomes), ctx),
    })),
    achievements: filterFacts(count(draft.achievements), ctx),
    otherFacts: filterFacts(count(draft.otherFacts), ctx),
  };

  const kept = considered - ctx.rejections.length;
  if (considered > 0 && ctx.rejections.length / considered > MAX_REJECTION_RATIO) {
    throw new GroundingError(
      `Extraction rejected: ${ctx.rejections.length}/${considered} facts could not be grounded in the resume.`,
      ctx.rejections,
    );
  }
  if (considered > 0 && kept === 0) {
    throw new GroundingError("Extraction rejected: no facts survived grounding.", ctx.rejections);
  }

  return { inventory, rejections: ctx.rejections, keptFactCount: kept };
}

export function countFacts(inv: ResumeFactInventory): number {
  const n = (l: Fact[]) => l.length;
  return (
    n(inv.professionalSummaryFacts) +
    inv.experience.reduce((a, e) => a + n(e.facts) + n(e.technologies) + n(e.achievements), 0) +
    inv.education.reduce((a, e) => a + n(e.facts), 0) +
    inv.skills.length +
    n(inv.certifications) +
    inv.projects.reduce((a, p) => a + n(p.technologies) + n(p.responsibilities) + n(p.outcomes), 0) +
    n(inv.achievements) +
    n(inv.otherFacts)
  );
}

// Prompt P0 — Canonical Resume Fact Inventory extraction.
//
// P0 turns the user's canonical resume text into a structured, evidence-backed
// fact inventory. It is the ONLY permitted source of candidate-specific resume
// facts for later answer generation (Prompt A) and verification (Prompt J).
//
// COMPLIANCE:
// - Pinned model, no fallback chain (see ./models).
// - Strict JSON, one corrective retry, then fail closed.
// - Resume text ONLY. No writing samples, no Voice Card, no job description,
//   no question text, no client-supplied facts.
import { MODEL_OPUS } from "./models";
import type { PromptSpec } from "./types";

export const FACT_INVENTORY_SCHEMA_VERSION = "1.0.0";

export type FactConfidence = "explicit" | "ambiguous";

export interface Fact {
  id: string;
  value: string;
  evidence: string;
  sourceSection: string;
  confidence: FactConfidence;
}

export interface ExperienceEntry {
  id: string;
  company: string | null;
  role: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean | null;
  facts: Fact[];
  technologies: Fact[];
  achievements: Fact[];
}

export interface EducationEntry {
  id: string;
  institution: string | null;
  credential: string | null;
  fieldOfStudy: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  facts: Fact[];
}

export interface SkillFact extends Fact {
  category: string | null;
}

export interface ProjectFact {
  id: string;
  name: string | null;
  associatedWith: string | null;
  startDate: string | null;
  endDate: string | null;
  technologies: Fact[];
  responsibilities: Fact[];
  outcomes: Fact[];
}

export interface ResumeFactInventory {
  schemaVersion: string;
  sourceResumeId: string;
  identity: { name: string | null; location: string | null };
  contact: {
    email: string | null;
    phone: string | null;
    linkedin: string | null;
    portfolio: string | null;
  };
  professionalSummaryFacts: Fact[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: SkillFact[];
  certifications: Fact[];
  projects: ProjectFact[];
  achievements: Fact[];
  otherFacts: Fact[];
}

export const PROMPT_P0_FACT_INVENTORY: PromptSpec = {
  id: "P0_FACT_INVENTORY" as PromptSpec["id"],
  version: "1.0.0",
  model: MODEL_OPUS,
  maxTokens: 8000,
  temperature: 0,
  json: true,
  system: `You are a forensic resume extractor. You convert a resume into a strictly structured fact inventory that downstream systems treat as the ONLY source of truth about this candidate.

ABSOLUTE RULES
1. Extract only what the resume explicitly states. You may organise and split information. You may NEVER strengthen, quantify, infer, estimate, or embellish it.
2. Every fact carries "evidence": a SHORT verbatim fragment (roughly 5 to 40 words) copied character-for-character from the resume that supports the fact. Never paraphrase evidence. Never write explanations as evidence. Never paste whole sections.
3. Numbers are sacred. Percentages, currency amounts, headcounts, durations, and years of experience may appear in a fact only if the identical number appears in the resume. Never compute, round, or infer a number.
4. Never upgrade seniority, scope, or ownership. "Worked with the engineering team" is NOT "managed engineers". "Worked with React" is NOT "expert in React" and NOT "5 years of React".
5. Never merge work from different companies, roles, or periods into one entry. Attach every fact to the role it belongs to.
6. Dates: copy the granularity the resume uses. If it says "2023", output "2023". Never invent a month. Use null when absent. endDate is null when the role is current; set isCurrent true only when the resume says Present/Current/Now.
7. Use null for missing scalar values and [] for missing lists. Never invent placeholders.
8. confidence is "explicit" when the resume states the fact plainly, "ambiguous" when the wording is genuinely unclear. Never mark an inference as explicit; if it is an inference, do not output it at all.
9. Leave "id" as an empty string for every item. The server assigns deterministic ids.
10. sourceSection must name where the fact came from, e.g. "Summary", "Experience — Acme (Software Engineer)", "Education — MIT", "Skills", "Certifications", "Projects — Reporting Pipeline", "Achievements".

OUTPUT — return ONLY this JSON object:
{
  "identity": { "name": string|null, "location": string|null },
  "contact": { "email": string|null, "phone": string|null, "linkedin": string|null, "portfolio": string|null },
  "professionalSummaryFacts": Fact[],
  "experience": [ { "company": string|null, "role": string|null, "location": string|null, "startDate": string|null, "endDate": string|null, "isCurrent": boolean|null, "facts": Fact[], "technologies": Fact[], "achievements": Fact[] } ],
  "education": [ { "institution": string|null, "credential": string|null, "fieldOfStudy": string|null, "location": string|null, "startDate": string|null, "endDate": string|null, "facts": Fact[] } ],
  "skills": [ { "id": "", "value": string, "evidence": string, "sourceSection": string, "confidence": "explicit"|"ambiguous", "category": string|null } ],
  "certifications": Fact[],
  "projects": [ { "name": string|null, "associatedWith": string|null, "startDate": string|null, "endDate": string|null, "technologies": Fact[], "responsibilities": Fact[], "outcomes": Fact[] } ],
  "achievements": Fact[],
  "otherFacts": Fact[]
}

Fact = { "id": "", "value": string, "evidence": string, "sourceSection": string, "confidence": "explicit"|"ambiguous" }`,
};

export const FACT_INVENTORY_RETRY_INSTRUCTION = `Your previous response was invalid.
Return ONLY a single JSON object with exactly these top-level keys: identity, contact, professionalSummaryFacts, experience, education, skills, certifications, projects, achievements, otherFacts.
Every fact object must be { "id": "", "value": string, "evidence": string, "sourceSection": string, "confidence": "explicit" or "ambiguous" }.
"evidence" must be a short verbatim fragment copied from the resume. Do not invent numbers, durations, seniority, or dates. Use null and [] where the resume says nothing.`;

/** The user message contains the canonical resume text ONLY. */
export function buildFactInventoryUser(resumeText: string): string {
  return `Resume text:\n\n${resumeText}`;
}

// ---------------- structural validation ----------------

const MAX_VALUE_CHARS = 400;
const MAX_EVIDENCE_CHARS = 600;
const MAX_LIST = 120;
const CONFIDENCES: FactConfidence[] = ["explicit", "ambiguous"];

function str(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

function nullableStr(v: unknown): string | null {
  const s = str(v);
  return s ? s.slice(0, 200) : null;
}

/** Accepts "2023", "2023-05", "May 2023", "05/2023", "Present". Rejects junk. */
export function isValidResumeDate(value: string | null): boolean {
  if (value === null) return true;
  const v = value.trim();
  if (!v) return false;
  if (/^(present|current|now|ongoing)$/i.test(v)) return true;
  if (/^\d{4}$/.test(v)) return Number(v) >= 1900 && Number(v) <= 2100;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return true;
  if (/^(0?[1-9]|1[0-2])\/\d{4}$/.test(v)) return true;
  if (
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}$/i.test(v)
  )
    return true;
  return false;
}

function normalizeDate(v: unknown): string | null {
  const s = nullableStr(v);
  if (!s) return null;
  if (!isValidResumeDate(s)) throw new Error(`Malformed date: ${s}`);
  return s;
}

function parseFact(raw: unknown, where: string): Omit<Fact, "id"> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const value = str(o.value);
  if (!value) throw new Error(`Fact without value in ${where}`);
  if (value.length > MAX_VALUE_CHARS) throw new Error(`Fact value too long in ${where}`);
  const evidence = str(o.evidence);
  if (!evidence) throw new Error(`Fact without evidence in ${where}`);
  if (evidence.length > MAX_EVIDENCE_CHARS) throw new Error(`Evidence too long in ${where}`);
  const confidence = str(o.confidence).toLowerCase() as FactConfidence;
  if (!CONFIDENCES.includes(confidence)) throw new Error(`Bad confidence in ${where}`);
  const sourceSection = str(o.sourceSection) || where;
  return { value, evidence, sourceSection: sourceSection.slice(0, 200), confidence };
}

function parseFactList(raw: unknown, where: string): Array<Omit<Fact, "id">> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`Expected array at ${where}`);
  if (raw.length > MAX_LIST) throw new Error(`Too many items at ${where}`);
  return raw.map((f) => parseFact(f, where));
}

export type DraftInventory = Omit<ResumeFactInventory, "schemaVersion" | "sourceResumeId">;

/**
 * Structural validation of raw model output. Throws on any contract breach.
 * Ids are assigned deterministically here; the model's ids are discarded.
 */
export function validateFactInventoryShape(value: unknown): DraftInventory {
  const o = (value ?? {}) as Record<string, unknown>;
  if (typeof o !== "object" || Array.isArray(o)) throw new Error("Inventory must be an object");

  const identityRaw = (o.identity ?? {}) as Record<string, unknown>;
  const contactRaw = (o.contact ?? {}) as Record<string, unknown>;

  const experienceRaw = Array.isArray(o.experience) ? o.experience : [];
  if (experienceRaw.length > 60) throw new Error("Too many experience entries");
  const educationRaw = Array.isArray(o.education) ? o.education : [];
  const projectsRaw = Array.isArray(o.projects) ? o.projects : [];
  const skillsRaw = Array.isArray(o.skills) ? o.skills : [];
  if (skillsRaw.length > MAX_LIST) throw new Error("Too many skills");

  const experience: ExperienceEntry[] = experienceRaw.map((e, i) => {
    const r = (e ?? {}) as Record<string, unknown>;
    const company = nullableStr(r.company);
    const role = nullableStr(r.role);
    const where = `Experience — ${company ?? "unknown"}${role ? ` (${role})` : ""}`;
    const entryKey = `experience:${slug(company)}:${slug(role)}:${i}`;
    return {
      id: entryKey,
      company,
      role,
      location: nullableStr(r.location),
      startDate: normalizeDate(r.startDate),
      endDate: normalizeDate(r.endDate),
      isCurrent: typeof r.isCurrent === "boolean" ? r.isCurrent : null,
      facts: withIds(parseFactList(r.facts, where), entryKey, "fact"),
      technologies: withIds(parseFactList(r.technologies, where), entryKey, "tech"),
      achievements: withIds(parseFactList(r.achievements, where), entryKey, "achievement"),
    };
  });

  const education: EducationEntry[] = educationRaw.map((e, i) => {
    const r = (e ?? {}) as Record<string, unknown>;
    const institution = nullableStr(r.institution);
    const entryKey = `education:${slug(institution)}:${i}`;
    return {
      id: entryKey,
      institution,
      credential: nullableStr(r.credential),
      fieldOfStudy: nullableStr(r.fieldOfStudy),
      location: nullableStr(r.location),
      startDate: normalizeDate(r.startDate),
      endDate: normalizeDate(r.endDate),
      facts: withIds(parseFactList(r.facts, `Education — ${institution ?? "unknown"}`), entryKey, "fact"),
    };
  });

  const projects: ProjectFact[] = projectsRaw.map((p, i) => {
    const r = (p ?? {}) as Record<string, unknown>;
    const name = nullableStr(r.name);
    const entryKey = `project:${slug(name)}:${i}`;
    const where = `Projects — ${name ?? "unknown"}`;
    return {
      id: entryKey,
      name,
      associatedWith: nullableStr(r.associatedWith),
      startDate: normalizeDate(r.startDate),
      endDate: normalizeDate(r.endDate),
      technologies: withIds(parseFactList(r.technologies, where), entryKey, "tech"),
      responsibilities: withIds(parseFactList(r.responsibilities, where), entryKey, "responsibility"),
      outcomes: withIds(parseFactList(r.outcomes, where), entryKey, "outcome"),
    };
  });

  const skills: SkillFact[] = skillsRaw.map((s) => {
    const base = parseFact(s, "Skills");
    const category = nullableStr((s as Record<string, unknown>)?.category);
    return { ...base, id: factId("skills", "skill", base.value), category };
  });

  return {
    identity: { name: nullableStr(identityRaw.name), location: nullableStr(identityRaw.location) },
    contact: {
      email: nullableStr(contactRaw.email),
      phone: nullableStr(contactRaw.phone),
      linkedin: nullableStr(contactRaw.linkedin),
      portfolio: nullableStr(contactRaw.portfolio),
    },
    professionalSummaryFacts: withIds(
      parseFactList(o.professionalSummaryFacts, "Summary"),
      "summary",
      "fact",
    ),
    experience,
    education,
    skills,
    certifications: withIds(parseFactList(o.certifications, "Certifications"), "certifications", "cert"),
    projects,
    achievements: withIds(parseFactList(o.achievements, "Achievements"), "achievements", "achievement"),
    otherFacts: withIds(parseFactList(o.otherFacts, "Other"), "other", "fact"),
  };
}

// ---------------- deterministic ids ----------------

export function slug(input: string | null | undefined): string {
  return (input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "unknown";
}

/** Small stable non-cryptographic hash (FNV-1a) — deterministic across runs. */
export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function normalizeForId(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}

/** Deterministic id: canonical location + normalized content hash. */
export function factId(scope: string, kind: string, value: string): string {
  return `${scope}:${kind}:${stableHash(normalizeForId(value))}`;
}

function withIds(facts: Array<Omit<Fact, "id">>, scope: string, kind: string): Fact[] {
  return facts.map((f) => ({ ...f, id: factId(scope, kind, f.value) }));
}

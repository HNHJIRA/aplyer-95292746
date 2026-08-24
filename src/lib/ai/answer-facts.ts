// Flattens the canonical P0 fact inventory into the id-tagged list that is the
// ONLY candidate-fact input Prompt A and Prompt J ever receive.
//
// Raw resume text is never produced here. Nothing from the browser is merged in.
import type {
  ExperienceEntry,
  Fact,
  ResumeFactInventory,
} from "./prompts/prompt-p0-fact-inventory";
import type { PromptAFact } from "./prompts/prompt-a-answer-generation";

export interface FlatFact extends PromptAFact {
  evidence: string;
  /** Index of the owning experience entry, or null for non-role facts. */
  roleIndex: number | null;
}

export interface RoleWindow {
  index: number;
  company: string | null;
  role: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}

export interface FlattenedInventory {
  facts: FlatFact[];
  roles: RoleWindow[];
  /** Every fact value + evidence, normalized joining corpus for the guards. */
  corpus: string;
  hasCurrentRole: boolean;
}

function timeframeOf(e: ExperienceEntry): string | null {
  if (!e.startDate && !e.endDate) return null;
  const end = e.isCurrent ? "Present" : (e.endDate ?? "unspecified");
  return `${e.startDate ?? "unspecified"} - ${end}`;
}

function scopeOf(e: ExperienceEntry): string {
  return [e.company, e.role].filter(Boolean).join(" — ") || "Experience";
}

export function flattenInventory(inventory: ResumeFactInventory): FlattenedInventory {
  const facts: FlatFact[] = [];
  const roles: RoleWindow[] = [];
  let n = 0;

  const push = (f: Fact, scope: string, timeframe: string | null, roleIndex: number | null) => {
    const value = (f?.value ?? "").trim();
    if (!value) return;
    n += 1;
    facts.push({
      id: `F${n}`,
      value,
      scope,
      timeframe,
      evidence: (f.evidence ?? "").trim(),
      roleIndex,
    });
  };

  for (const f of inventory.professionalSummaryFacts ?? []) push(f, "Professional summary", null, null);

  (inventory.experience ?? []).forEach((e, i) => {
    roles.push({
      index: i,
      company: e.company,
      role: e.role,
      startDate: e.startDate,
      endDate: e.endDate,
      isCurrent: e.isCurrent === true,
    });
    const scope = scopeOf(e);
    const tf = timeframeOf(e);
    for (const f of e.facts ?? []) push(f, scope, tf, i);
    for (const f of e.technologies ?? []) push(f, `${scope} (technologies)`, tf, i);
    for (const f of e.achievements ?? []) push(f, `${scope} (achievements)`, tf, i);
  });

  for (const e of inventory.education ?? []) {
    const scope = [e.institution, e.credential].filter(Boolean).join(" — ") || "Education";
    const tf = e.startDate || e.endDate ? `${e.startDate ?? "unspecified"} - ${e.endDate ?? "unspecified"}` : null;
    for (const f of e.facts ?? []) push(f, scope, tf, null);
  }

  for (const s of inventory.skills ?? []) push(s, s.category ? `Skills (${s.category})` : "Skills", null, null);
  for (const c of inventory.certifications ?? []) push(c, "Certifications", null, null);

  for (const p of inventory.projects ?? []) {
    const scope = `Project${p.name ? ` — ${p.name}` : ""}`;
    const tf = p.startDate || p.endDate ? `${p.startDate ?? "unspecified"} - ${p.endDate ?? "unspecified"}` : null;
    for (const f of p.technologies ?? []) push(f, `${scope} (technologies)`, tf, null);
    for (const f of p.responsibilities ?? []) push(f, scope, tf, null);
    for (const f of p.outcomes ?? []) push(f, `${scope} (outcomes)`, tf, null);
  }

  for (const a of inventory.achievements ?? []) push(a, "Achievements", null, null);
  for (const o of inventory.otherFacts ?? []) push(o, "Other", null, null);

  const corpus = facts
    .map((f) => `${f.value} ${f.evidence} ${f.scope} ${f.timeframe ?? ""}`)
    .concat(roles.map((r) => [r.company, r.role, r.startDate, r.endDate].filter(Boolean).join(" ")))
    .join(" \n ");

  return {
    facts,
    roles,
    corpus,
    hasCurrentRole: roles.some((r) => r.isCurrent),
  };
}

/** The list handed to the prompts — evidence and internal indices are stripped. */
export function toPromptFacts(flat: FlattenedInventory): PromptAFact[] {
  return flat.facts.map(({ id, value, scope, timeframe }) => ({ id, value, scope, timeframe }));
}

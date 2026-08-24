// Role-aware temporal validation for generated answers.
//
// This module owns EVERY date/tense decision the deterministic guard makes.
// Two principles:
//   1. Never require more precision than the P0 inventory actually contains.
//      A year-only inventory supports "in 2023" but not "March 2023".
//   2. Validate against the role-scoped inventory, not a flat bag of dates:
//      a year that belongs to Company B does not license a claim about
//      Company A.
// Ambiguous-but-not-contradictory phrasing is reported, never blocked.
import { normalizeText } from "./fact-inventory-grounding";
import type { FlattenedInventory, RoleWindow } from "./answer-facts";

export type TemporalCode =
  | "unsupported_date"
  | "unsupported_date_precision"
  | "cross_role_temporal_mismatch"
  | "invalid_current_tense"
  | "ambiguous_temporal_reference";

export interface TemporalViolation {
  code: TemporalCode;
  detail: string;
  /** Non-blocking findings are diagnostics only. */
  blocking: boolean;
}

export const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

/** Month words that are also ordinary English words. */
const AMBIGUOUS_MONTHS = new Set(["may", "march", "august"]);

const MONTH_ABBR: Record<string, string> = {
  jan: "january", feb: "february", mar: "march", apr: "april", jun: "june",
  jul: "july", aug: "august", sep: "september", sept: "september",
  oct: "october", nov: "november", dec: "december",
};

const TEMPORAL_PREPOSITIONS = [
  "in", "by", "since", "from", "until", "till", "during", "around", "through",
  "before", "after", "starting", "began", "begun", "beginning", "ended", "ending",
];

const CURRENCY_MARKERS = [
  "currently", "at present", "right now", "these days", "today i", "i am now", "presently",
];

const PRESENT_FIRST_PERSON_RE =
  /\bi\s+(?:currently\s+)?(?:lead|manage|own|run|build|maintain|oversee|report|work|handle|drive)\b/i;

const AMBIGUOUS_REFERENCES = [
  "last year", "a few years ago", "recent years", "back then",
  "some years ago", "a while back", "in recent times",
];

const YEAR_RE = /\b(19|20)\d{2}\b/g;
const QUARTER_RE = /\bq[1-4]\s?(?:of\s)?(?:'?\d{2}|(?:19|20)\d{2})?\b/gi;

/**
 * Canonical form for a date expression. Normalizes dash variants, "to"
 * ranges, month abbreviations and open-ended markers — without inventing any
 * precision that was not written down.
 */
export function normalizeDateExpression(input: string): string {
  let s = normalizeText(input ?? "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+to\s+/g, "-")
    .replace(/\b(present|current|currently|now|ongoing|to date|till date)\b/g, "present")
    .replace(/\s+/g, " ")
    .trim();
  for (const [abbr, full] of Object.entries(MONTH_ABBR)) {
    s = s.replace(new RegExp(`\\b${abbr}\\.?\\b`, "g"), full);
  }
  return s;
}

function yearsIn(text: string): string[] {
  return [...(normalizeText(text).match(YEAR_RE) ?? [])];
}

/** Years covered by a role window, expanded across an explicit range. */
export function roleYears(role: RoleWindow, currentYear = new Date().getUTCFullYear()): Set<string> {
  const out = new Set<string>();
  const start = yearsIn(role.startDate ?? "")[0];
  const endRaw = role.isCurrent ? String(currentYear) : yearsIn(role.endDate ?? "")[0];
  if (!start && !endRaw) return out;
  const a = Number(start ?? endRaw);
  const b = Number(endRaw ?? start);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  for (let y = lo; y <= hi; y++) out.add(String(y));
  return out;
}

/** Months explicitly stated anywhere in the inventory. */
function inventoryMonths(flat: FlattenedInventory): Set<string> {
  const corpus = normalizeDateExpression(
    `${flat.corpus} ${flat.roles.map((r) => `${r.startDate ?? ""} ${r.endDate ?? ""}`).join(" ")}`,
  );
  const found = new Set<string>();
  for (const m of MONTHS) if (new RegExp(`\\b${m}\\b`).test(corpus)) found.add(m);
  return found;
}

/** Month tokens used as an actual date reference in the answer. */
export function monthClaims(answer: string): string[] {
  const s = normalizeDateExpression(answer).replace(/[,;:.!?()]/g, " ").replace(/\s+/g, " ");
  const claims: string[] = [];
  for (const m of MONTHS) {
    const unambiguous = new RegExp(`\\b${m}\\b`);
    if (!unambiguous.test(s)) continue;
    if (!AMBIGUOUS_MONTHS.has(m)) {
      claims.push(m);
      continue;
    }
    const withNumber = new RegExp(`\\b(?:\\d{1,2}\\s+${m}\\b|${m}\\s+(?:\\d{1,2}|(?:19|20)\\d{2})\\b)`);
    const afterPreposition = new RegExp(`\\b(?:${TEMPORAL_PREPOSITIONS.join("|")})\\s+${m}\\b`);
    if (withNumber.test(s) || afterPreposition.test(s)) claims.push(m);
  }
  return claims;
}

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

function padded(s: string): string {
  return ` ${normalizeText(s).replace(/[,;:!?'"()]/g, " ").replace(/\s+/g, " ").trim()} `;
}

/**
 * Full temporal evaluation of an answer against the role-scoped inventory.
 */
export function evaluateTemporal(answer: string, flat: FlattenedInventory): TemporalViolation[] {
  const out: TemporalViolation[] = [];
  const add = (code: TemporalCode, detail: string, blocking = true) =>
    out.push({ code, detail, blocking });

  const text = (answer ?? "").replace(/\s+/g, " ").trim();
  if (!text) return out;

  const normalized = normalizeDateExpression(text);
  const supportedYears = new Set<string>([
    ...yearsIn(flat.corpus),
    ...flat.roles.flatMap((r) => [...roleYears(r)]),
  ]);

  // 1. Years the inventory never states.
  for (const y of new Set(yearsIn(text))) {
    if (!supportedYears.has(y)) add("unsupported_date", y);
  }

  // 2. Precision the inventory never contains (months, quarters).
  const statedMonths = inventoryMonths(flat);
  for (const m of new Set(monthClaims(text))) {
    if (!statedMonths.has(m)) add("unsupported_date_precision", m);
  }
  const inventoryHasQuarter = /\bq[1-4]\b/.test(normalizeText(flat.corpus));
  for (const q of new Set(normalized.match(QUARTER_RE) ?? [])) {
    if (!inventoryHasQuarter) add("unsupported_date_precision", q.trim());
  }

  // 3. Ambiguous but non-contradictory references — reported, not blocked.
  for (const phrase of AMBIGUOUS_REFERENCES) {
    if (padded(text).includes(` ${phrase} `)) add("ambiguous_temporal_reference", phrase, false);
  }

  const namedRoles = flat.roles
    .map((r) => ({ role: r, name: normalizeText(r.company ?? "") }))
    .filter((r) => r.name.length >= 3);

  const neutralYears = new Set(
    yearsIn(flat.facts.filter((f) => f.roleIndex === null).map((f) => `${f.value} ${f.timeframe ?? ""}`).join(" ")),
  );

  for (const sentence of sentencesOf(text)) {
    const padSentence = padded(sentence);
    const mentioned = namedRoles.filter((r) => padSentence.includes(` ${r.name} `));
    if (mentioned.length !== 1) continue;
    const owner = mentioned[0]!.role;
    const owned = roleYears(owner);

    // 4. Cross-role temporal mismatch — a year tied to a different employer.
    for (const y of new Set(yearsIn(sentence))) {
      if (!supportedYears.has(y)) continue; // already reported as unsupported_date
      if (owned.has(y) || neutralYears.has(y)) continue;
      add("cross_role_temporal_mismatch", `${owner.company ?? "role"}:${y}`);
    }

    // 5. Present-tense claims about a role that has ended.
    if (!owner.isCurrent) {
      const currency = CURRENCY_MARKERS.find((t) => padSentence.includes(` ${normalizeText(t)} `));
      if (currency || PRESENT_FIRST_PERSON_RE.test(sentence)) {
        add("invalid_current_tense", `${owner.company ?? "role"}:${currency ?? "present tense"}`);
      }
    }
  }

  // 6. Global currency claim with no current role anywhere.
  if (!flat.hasCurrentRole) {
    for (const t of CURRENCY_MARKERS) {
      if (padded(text).includes(` ${normalizeText(t)} `)) add("invalid_current_tense", t);
    }
  }

  return out;
}

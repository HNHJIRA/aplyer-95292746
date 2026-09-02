// Canonical application-field taxonomy, shared by the backend and mirrored by
// the extension's Field Intelligence Detector.
//
// Nothing here touches the DOM: these are the pure rules for what a field is,
// whether it may ever be auto-filled, and how a question is normalized.

export const FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "ESSAY",
  "YES_NO",
  "RADIO",
  "DROPDOWN",
  "DATE",
  "NUMBER",
  "URL",
  "FILE",
  "CHECKBOX",
  "UNKNOWN",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Field types that hold a short, reusable value worth remembering. */
export const MEMORABLE_TYPES: readonly FieldType[] = [
  "TEXT",
  "TEXTAREA",
  "YES_NO",
  "RADIO",
  "DROPDOWN",
  "DATE",
  "NUMBER",
  "URL",
  "CHECKBOX",
];

export function isMemorableType(t: FieldType): boolean {
  return MEMORABLE_TYPES.includes(t);
}

/** Types that pick one of a rendered option list. */
export function isOptionType(t: FieldType): boolean {
  return t === "YES_NO" || t === "RADIO" || t === "DROPDOWN";
}

export function isFieldType(v: unknown): v is FieldType {
  return typeof v === "string" && (FIELD_TYPES as readonly string[]).includes(v);
}

/** Fields Aplyer may never write into, whatever the memory says. */
export const SENSITIVE_PATTERNS: RegExp[] = [
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\bpin\b/i,
  /\bssn\b/i,
  /social security/i,
  /\bsin\b(?!\w)/i,
  /national (insurance|id|identity)/i,
  /\bpassport\b/i,
  /driver'?s? licen[cs]e/i,
  /government (id|issued)/i,
  /\btax\s?(id|number|file)\b/i,
  /\b(bank|iban|swift|routing|account number|sort code)\b/i,
  /credit card|card number|cvv|cvc/i,
  /security question|mother'?s maiden/i,
  /date of birth|\bdob\b/i,
  /salary (expectation|requirement)?/i,
];

export function isSensitiveQuestion(text: string): boolean {
  const t = String(text ?? "");
  return SENSITIVE_PATTERNS.some((re) => re.test(t));
}

/** Lowercased, punctuation-free, whitespace-collapsed question text. */
export function normalizeQuestion(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

const YES_NO_PATTERNS: RegExp[] = [
  /^(are|is|do|does|did|have|has|had|will|would|can|could|should|were|was|may)\b/,
  /\b(yes|no)\b.*\b(yes|no)\b/,
];

/**
 * Heuristic yes/no detection from question text alone. The extension also uses
 * the rendered control (two radio options labelled yes/no, a two-option select)
 * — this is the text-only signal both sides agree on.
 */
export function looksLikeYesNoQuestion(text: string): boolean {
  const n = normalizeQuestion(text);
  if (!n) return false;
  if (n.split(" ").length > 30) return false;
  return YES_NO_PATTERNS.some((re) => re.test(n));
}

export function normalizeYesNo(value: string): "Yes" | "No" | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(v)) return "Yes";
  if (["no", "n", "false", "0"].includes(v)) return "No";
  return null;
}

export type FieldConfidence = "HIGH" | "MEDIUM" | "LOW";

/** Only HIGH and MEDIUM may be written without asking the user first. */
export function mayAutofill(confidence: FieldConfidence): boolean {
  return confidence === "HIGH" || confidence === "MEDIUM";
}

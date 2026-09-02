// Deterministic mapping from an application field's question text to a value
// the user already gave Aplyer in their profile.
//
// This is Priority 2 of the Autofill All resolution order (after a confirmed
// saved answer, before a generated answer). It never guesses: a field is only
// filled when its question clearly names a profile attribute AND that
// attribute has a value.
import { normalizeQuestion, type FieldType } from "./field-types";

export interface ProfileData {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedin?: string | null;
  portfolio?: string | null;
  website?: string | null;
}

type ProfileKind =
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "location"
  | "linkedin"
  | "portfolio";

const MATCHERS: { kind: ProfileKind; re: RegExp }[] = [
  { kind: "firstName", re: /\b(first name|given name|forename|fname)\b/ },
  { kind: "lastName", re: /\b(last name|family name|surname|lname)\b/ },
  { kind: "fullName", re: /\b(full name|legal name|your name|candidate name|name)\b/ },
  { kind: "email", re: /\b(e ?mail|email address)\b/ },
  { kind: "phone", re: /\b(phone|mobile|telephone|contact number|cell)\b/ },
  { kind: "location", re: /\b(location|city|current city|address|where are you based)\b/ },
  { kind: "linkedin", re: /\blinkedin\b/ },
  { kind: "portfolio", re: /\b(portfolio|personal website|website|personal site|url|github)\b/ },
];

/** Field types a profile value may ever be written into. */
const ALLOWED_TYPES: FieldType[] = ["TEXT", "TEXTAREA", "URL"];

export function profileKindFor(questionText: string): ProfileKind | null {
  const n = normalizeQuestion(questionText);
  if (!n) return null;
  for (const m of MATCHERS) if (m.re.test(n)) return m.kind;
  return null;
}

function valueFor(kind: ProfileKind, p: ProfileData): string | null {
  const v = (s?: string | null) => {
    const t = String(s ?? "").trim();
    return t.length > 0 ? t : null;
  };
  switch (kind) {
    case "firstName":
      return v(p.firstName);
    case "lastName":
      return v(p.lastName);
    case "fullName":
      return v([p.firstName, p.lastName].filter(Boolean).join(" "));
    case "email":
      return v(p.email);
    case "phone":
      return v(p.phone);
    case "location":
      return v(p.location);
    case "linkedin":
      return v(p.linkedin);
    case "portfolio":
      return v(p.portfolio) ?? v(p.website);
    default:
      return null;
  }
}

/**
 * Returns the profile value for a field, or null when the question doesn't
 * clearly name a profile attribute or the profile has nothing to offer.
 */
export function resolveProfileValue(
  questionText: string,
  fieldType: FieldType,
  profile: ProfileData | null | undefined,
): string | null {
  if (!profile) return null;
  if (!ALLOWED_TYPES.includes(fieldType)) return null;
  const kind = profileKindFor(questionText);
  if (!kind) return null;
  return valueFor(kind, profile);
}

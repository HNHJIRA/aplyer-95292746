/**
 * Demo cost-control policy — pure, deterministic, no I/O.
 *
 * Every numeric limit comes from the server-only `demo_settings` row. Nothing
 * here has a built-in business number: while any value is unset the policy
 * FAILS CLOSED (requests are stored and queued, never generated), so there is
 * no unlimited production path.
 */

export interface DemoSettings {
  max_runs_per_email: number | null;
  session_limit: number | null;
  session_window_seconds: number | null;
  ip_limit: number | null;
  ip_window_seconds: number | null;
  daily_cap_usd: number | string | null;
  reset_timezone: string | null;
  reserve_per_demo_usd: number | string | null;
}

export interface AdmissionCounts {
  /** Prior non-rejected demo requests for this email (excluding this one). */
  email_total: number;
  /** Prior non-rejected requests from this session inside the session window. */
  session_recent: number;
  /** Prior non-rejected requests from this IP inside the IP window. */
  ip_recent: number;
}

export interface SpendSnapshot {
  spent_today_usd: number | string;
  /** Cost events today with no approved price: spend cannot be trusted. */
  unpriced_today: number;
  /** Requests currently generating, INCLUDING the one being decided. */
  inflight: number;
  next_reset: string | null;
  day_start?: string | null;
}

export type QueueReason = "unconfigured" | "rate_limit" | "daily_cap";
export type RejectReason = "email_limit" | "rate_limit";

export type AdmissionDecision =
  | { action: "run" }
  | { action: "queue"; reason: QueueReason }
  | { action: "reject"; reason: RejectReason };

const REQUIRED_KEYS: (keyof DemoSettings)[] = [
  "max_runs_per_email",
  "session_limit",
  "session_window_seconds",
  "ip_limit",
  "ip_window_seconds",
  "daily_cap_usd",
  "reset_timezone",
  "reserve_per_demo_usd",
];

export function missingSettings(s: DemoSettings | null | undefined): string[] {
  if (!s) return [...REQUIRED_KEYS];
  return REQUIRED_KEYS.filter((k) => s[k] === null || s[k] === undefined || s[k] === "");
}

function num(v: number | string | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : (v ?? NaN);
  return Number.isFinite(n) ? (n as number) : NaN;
}

/**
 * Hard daily cap check. Allowed only when every priced cost is known and
 * spent + (in-flight requests x reserve) stays within the cap.
 */
export function spendAllows(s: DemoSettings, spend: SpendSnapshot | null): boolean {
  if (!spend || missingSettings(s).length > 0) return false;
  if (!spend.next_reset) return false; // invalid time zone => fail closed
  if (spend.unpriced_today > 0) return false; // unknown spend => fail closed
  const cap = num(s.daily_cap_usd);
  const reserve = num(s.reserve_per_demo_usd);
  const spent = num(spend.spent_today_usd);
  if (![cap, reserve, spent].every(Number.isFinite)) return false;
  const inflight = Math.max(1, spend.inflight);
  return spent + inflight * reserve <= cap;
}

export function decideAdmission(
  s: DemoSettings | null,
  counts: AdmissionCounts,
  spend: SpendSnapshot | null,
): AdmissionDecision {
  if (!s || missingSettings(s).length > 0) return { action: "queue", reason: "unconfigured" };

  if (counts.email_total >= (s.max_runs_per_email as number)) {
    return { action: "reject", reason: "email_limit" };
  }

  const rateLimited =
    counts.session_recent >= (s.session_limit as number) ||
    counts.ip_recent >= (s.ip_limit as number);
  if (rateLimited) {
    // A first run for this email is captured and delivered later; repeats are refused.
    return counts.email_total === 0
      ? { action: "queue", reason: "rate_limit" }
      : { action: "reject", reason: "rate_limit" };
  }

  if (!spendAllows(s, spend)) return { action: "queue", reason: "daily_cap" };
  return { action: "run" };
}

/* ------------------------------------------------------------------ */
/* Input validation                                                    */
/* ------------------------------------------------------------------ */

/** Same syntax rule the waitlist signup uses. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export function isValidEmail(email: string): boolean {
  return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email);
}

const IDEM_RE = /^[A-Za-z0-9_-]{16,128}$/;
export function isValidIdempotencyKey(v: unknown): v is string {
  return typeof v === "string" && IDEM_RE.test(v);
}

/* ------------------------------------------------------------------ */
/* Cost                                                                */
/* ------------------------------------------------------------------ */

export interface ModelPricing {
  input_usd_per_mtok: number | string;
  output_usd_per_mtok: number | string;
}

/**
 * Returns an estimated USD cost, or null when pricing or token counts are
 * missing. Null means "unpriced" — never a guessed value.
 */
export function computeCost(
  pricing: ModelPricing | null,
  usage: { inputTokens?: number; outputTokens?: number },
): number | null {
  if (!pricing) return null;
  if (typeof usage.inputTokens !== "number" || typeof usage.outputTokens !== "number") return null;
  const i = num(pricing.input_usd_per_mtok);
  const o = num(pricing.output_usd_per_mtok);
  if (!Number.isFinite(i) || !Number.isFinite(o)) return null;
  return Math.round(((usage.inputTokens * i + usage.outputTokens * o) / 1_000_000) * 1e6) / 1e6;
}

/* ------------------------------------------------------------------ */
/* Visitor-facing copy (no costs, providers, models or queue details)  */
/* ------------------------------------------------------------------ */

export const DEMO_COPY = {
  emailRequired: "Please enter your email address to run the demo.",
  emailInvalid: "Please enter a valid email address.",
  fieldsRequired: "resume, jobDescription, and question are all required.",
  submissionKeyRequired: "A valid idempotencyKey is required for each submission.",
  queued:
    "Your comparison has been received. We will generate it and deliver it to your email.",
  processing: "Your answer is already being generated. Please wait a moment.",
  emailLimit: "You have reached the demo limit for this email address.",
  rateLimited: "Too many demo requests. Please try again later.",
  retry: "That request did not finish. Please try again.",
  generic: "Something went wrong. Please try again.",
  unavailable: "The demo is temporarily unavailable. Please try again later.",
} as const;

/**
 * Deterministic word count for the optional writing sample.
 * A word is any whitespace-separated token containing at least one letter or
 * digit (so stray punctuation like "-" or "..." is not counted).
 */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  let n = 0;
  for (const tok of text.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(tok)) n += 1;
  return n;
}

/**
 * Optional writing sample: kept EXACTLY as typed (no trimming, rewriting or
 * cleaning). Missing, null, or whitespace-only becomes null. Any non-string
 * value is invalid (returns undefined).
 */
export function normalizeWritingSample(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  return v.trim() ? v : null;
}

/* ------------------------------------------------------------------ */
/* Weekly per-email allowance (mirror of demo_admit's period walk)     */
/* ------------------------------------------------------------------ */

/** "The allowance resets seven days after the first run, per address." */
export const ALLOWANCE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Counted runs (status <> 'rejected', by created_at) in the CURRENT allowance
 * period. Walks runs in submission order; a run at or after anchor + 7 days
 * starts a new period anchored at that run. Returns 0 once the period expired.
 * Not a rolling window and not calendar weeks. Mirrors the SQL in demo_admit.
 */
export function currentAllowanceCount(createdAtMs: number[], nowMs: number): number {
  let anchor: number | null = null;
  let count = 0;
  for (const t of [...createdAtMs].sort((a, b) => a - b)) {
    if (anchor === null || t >= anchor + ALLOWANCE_PERIOD_MS) {
      anchor = t;
      count = 1;
    } else count += 1;
  }
  return anchor !== null && nowMs < anchor + ALLOWANCE_PERIOD_MS ? count : 0;
}

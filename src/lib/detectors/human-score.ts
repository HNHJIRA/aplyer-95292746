/**
 * Human Score — pure, deterministic, no I/O, no AI.
 *
 * Client formula (Step 7 brief):
 *   worseDetectorScore = max(Copyleaks AI %, Pangram AI %)
 *   shield             = 100 − worseDetectorScore
 * Never averaged, never the better score, never one detector standing in for
 * the other. BOTH detector results are required; anything missing => the
 * Human Score is unavailable (never a zero, never a guess).
 *
 * Scale: both providers report the AI share as a fraction 0–1 in their
 * responses; it is converted to a 0–100 percentage here. Values outside 0–1
 * are rejected as unparseable rather than reinterpreted.
 *
 * Demo Specification 9.17.26, Part 3B item 6: the detector pair is only
 * computed when BOTH answers exceed the minimum word count and are within a
 * configured length tolerance of each other. No tolerance => gate closed.
 */
import { countWords } from "@/lib/demo/policy";

export const DETECTOR_PROVIDERS = ["copyleaks", "pangram"] as const;
export type DetectorProvider = (typeof DETECTOR_PROVIDERS)[number];

export type DetectorOutcome =
  | { provider: DetectorProvider; status: "ok"; aiPercent: number; service: string; durationMs: number }
  | {
      provider: DetectorProvider;
      status: "failed" | "not_configured";
      code: string;
      service: string | null;
      durationMs: number;
      /** True when a provider request was actually sent (a cost event is recorded). */
      called: boolean;
    };

export type HumanScoreResult =
  | { status: "available"; shield: number; worseAiPercent: number; aiPercents: Record<DetectorProvider, number> }
  | { status: "unavailable"; reason: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

function fractionToPercent(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) return null;
  return r2(n * 100);
}

/** Copyleaks AI detector response: `summary.ai` (0–1). null = unparseable. */
export function parseCopyleaks(json: unknown): number | null {
  const s = (json as { summary?: { ai?: unknown } } | null)?.summary;
  return fractionToPercent(s?.ai);
}

/** Pangram response: `fraction_ai` (0–1), else legacy `ai_likelihood` (0–1). null = unparseable. */
export function parsePangram(json: unknown): number | null {
  const o = (json ?? {}) as { fraction_ai?: unknown; ai_likelihood?: unknown };
  if (o.fraction_ai !== undefined && o.fraction_ai !== null) return fractionToPercent(o.fraction_ai);
  return fractionToPercent(o.ai_likelihood);
}

/** Applies the client formula. Requires both detectors; never averages. */
export function computeHumanScore(results: Partial<Record<DetectorProvider, DetectorOutcome | null>>): HumanScoreResult {
  const aiPercents = {} as Record<DetectorProvider, number>;
  for (const p of DETECTOR_PROVIDERS) {
    const r = results[p];
    if (!r) return { status: "unavailable", reason: `${p}_missing` };
    if (r.status !== "ok") return { status: "unavailable", reason: `${p}_${r.status}` };
    if (!Number.isFinite(r.aiPercent) || r.aiPercent < 0 || r.aiPercent > 100) {
      return { status: "unavailable", reason: `${p}_invalid` };
    }
    aiPercents[p] = r.aiPercent;
  }
  const worse = Math.max(...DETECTOR_PROVIDERS.map((p) => aiPercents[p]));
  return { status: "available", shield: r2(100 - worse), worseAiPercent: worse, aiPercents };
}

/** Candidate-facing whole-number Shield. Floored so it never overstates. */
export function displayShield(shield: number): number {
  return Math.floor(shield + 1e-9);
}

export interface HumanScoreConfig {
  /** Whether the badge may render. Off by default (phase decision pending). */
  display: boolean;
  /** Spec: both answers must exceed this many words (200). null => gate closed. */
  minWords: number | null;
  /** Max relative length difference |a−b| / max(a,b). null => gate closed. */
  lengthTolerance: number | null;
}

/** Spec Part 3B item 6 length gate. Checked BEFORE any paid detector call. */
export function detectorGateOpen(aplyerText: string | null, chatgptText: string | null, cfg: HumanScoreConfig | null): boolean {
  if (!cfg || !aplyerText?.trim() || !chatgptText?.trim()) return false;
  const { minWords, lengthTolerance } = cfg;
  if (typeof minWords !== "number" || !Number.isFinite(minWords) || minWords <= 0) return false;
  if (typeof lengthTolerance !== "number" || !Number.isFinite(lengthTolerance) || lengthTolerance < 0) return false;
  const a = countWords(aplyerText);
  const c = countWords(chatgptText);
  if (a <= minWords || c <= minWords) return false;
  return Math.abs(a - c) / Math.max(a, c) <= lengthTolerance;
}

export interface StoredHumanScore {
  aplyer: HumanScoreResult;
  chatgpt: HumanScoreResult;
}

export interface HumanScoreView {
  aplyer: { shield: number };
  chatgpt: { shield: number };
}

/**
 * The only Human Score data that may reach the browser: two whole-number
 * Shield values. Only when display is enabled and BOTH answers have a valid
 * score (a one-sided badge would be a misleading comparison).
 */
export function humanScoreView(stored: unknown, display: boolean): HumanScoreView | null {
  if (!display) return null;
  const s = stored as StoredHumanScore | null;
  if (s?.aplyer?.status !== "available" || s?.chatgpt?.status !== "available") return null;
  return { aplyer: { shield: displayShield(s.aplyer.shield) }, chatgpt: { shield: displayShield(s.chatgpt.shield) } };
}

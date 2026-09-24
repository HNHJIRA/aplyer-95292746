/**
 * Demo scoreboard — pure, deterministic, no I/O, no AI.
 *
 * Demo Specification 9.17.26, Part 3:
 * - Markers are chosen from the candidate's WRITING SAMPLE ONLY, before either
 *   answer exists (`selectMarkers` has no answer parameter), by distance from an
 *   APPROVED ordinary-writer reference, above a CONFIGURED threshold.
 * - The same fixed markers are then measured on both answers.
 * - No reference or no threshold => no selection => scoreboard suppressed.
 *
 * Calculation (documented, deterministic):
 * - Candidate value  = the marker's reliable value on the writing sample.
 * - Answer value     = the same metric computed on the answer text.
 * - Marker distance  = |answer value − candidate value| (shown, marker units).
 * - Standardised     = marker distance ÷ reference spread (the reference SD
 *                      for z_score; the sample SD of the reference values for
 *                      empirical_percentile), so markers in different units
 *                      can be averaged.
 * - Aggregate        = arithmetic mean of standardised distances over the
 *                      selected markers, rounded to 4 d.p.
 * - Closer side      = the lower aggregate; exactly equal => "equal".
 */
import { computeFingerprint, type Fingerprint } from "@/lib/stylometry/fingerprint";
import { rankDistinctiveMarkers, type ReferenceDistribution } from "@/lib/stylometry/distinctiveness";

/** Spec: "display the three or four" most distinctive markers. */
export const MAX_MARKERS = 4;
/** Spec: the scoreboard does not render when NO marker clears the threshold. */
export const MIN_MARKERS = 1;
/** Spec: regeneration "capped at two attempts" — total Aplyer attempts. */
export const MAX_APLYER_ATTEMPTS = 2;

export interface ScoreboardConfig {
  /** Minimum standardised distance from an ordinary writer. null => suppressed. */
  threshold: number | null;
  /** Approved ordinary-writer references. Empty => suppressed. */
  references: ReferenceDistribution[];
}

export interface SelectedMarker {
  metric: string;
  label: string;
  explanation: string;
  unit: string;
  candidateValue: number;
  /** Reference spread used to standardise distances (internal, never sent to the browser). */
  scale: number;
}

export interface MarkerSelection {
  markers: SelectedMarker[];
}

export interface ScoreboardMarkerView {
  metric: string;
  label: string;
  explanation: string;
  unit: string;
  candidateValue: number;
  aplyerValue: number;
  chatgptValue: number;
  aplyerDistance: number;
  chatgptDistance: number;
}

export interface ScoreboardView {
  status: "shown";
  markers: ScoreboardMarkerView[];
  aggregate: { aplyerDistance: number; chatgptDistance: number; closer: "aplyer" | "chatgpt" | "equal" };
}

export interface Comparison {
  view: ScoreboardView;
  /** Markers where the Aplyer answer sits further from the candidate than ChatGPT. */
  aplyerFurtherMarkers: string[];
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

function referenceScale(ref: ReferenceDistribution): number | null {
  if (ref.method === "z_score") return Number.isFinite(ref.sd) && ref.sd > 0 ? ref.sd : null;
  const v = ref.values.filter(Number.isFinite);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
  return sd > 0 ? sd : null;
}

/** Plain-language unit suffix for the candidate-facing table. */
export function unitLabel(unit: string): string {
  switch (unit) {
    case "per_100_words":
      return "per 100 words";
    case "percent_of_words":
    case "percent_of_sentences":
    case "percent_of_lines":
    case "percent_of_pronouns":
      return "%";
    case "letters":
      return "letters";
    case "words":
      return "words";
    default:
      return "";
  }
}

/**
 * Chooses the markers from the writing sample alone. Returns null (suppress)
 * when the sample is missing/insufficient, no approved reference exists, the
 * threshold is not configured, or no marker clears it.
 */
export function selectMarkers(writingSample: string | null, config: ScoreboardConfig | null): MarkerSelection | null {
  if (!writingSample || !config) return null;
  if (typeof config.threshold !== "number" || !Number.isFinite(config.threshold)) return null;
  const refs = (config.references ?? []).filter((r) => r && r.approved === true);
  if (!refs.length) return null;
  const fp: Fingerprint = computeFingerprint(writingSample);
  if (!fp.sufficient) return null;
  const ranked = rankDistinctiveMarkers(fp, refs, { minDistance: config.threshold });
  const byName = new Map(fp.metrics.map((m) => [m.name, m]));
  const refByName = new Map(refs.map((r) => [r.metric, r]));
  const markers: SelectedMarker[] = [];
  for (const d of ranked) {
    if (markers.length >= MAX_MARKERS) break;
    const m = byName.get(d.metric)!;
    const scale = referenceScale(refByName.get(d.metric)!);
    if (scale === null || m.value === null || m.reliability !== "reliable" || !m.headlineEligible) continue;
    markers.push({ metric: m.name, label: m.label, explanation: m.definition, unit: unitLabel(m.unit), candidateValue: m.value, scale });
  }
  return markers.length >= MIN_MARKERS ? { markers } : null;
}

/** Measures the SAME fixed markers on both answers. null => cannot measure safely. */
export function compareAnswers(selection: MarkerSelection, aplyerAnswer: string, chatgptAnswer: string): Comparison | null {
  if (!aplyerAnswer?.trim() || !chatgptAnswer?.trim()) return null;
  const a = new Map(computeFingerprint(aplyerAnswer).metrics.map((m) => [m.name, m]));
  const c = new Map(computeFingerprint(chatgptAnswer).metrics.map((m) => [m.name, m]));
  const markers: ScoreboardMarkerView[] = [];
  const further: string[] = [];
  let sa = 0;
  let sc = 0;
  for (const s of selection.markers) {
    const av = a.get(s.metric)?.observed;
    const cv = c.get(s.metric)?.observed;
    if (typeof av !== "number" || typeof cv !== "number") return null;
    const ad = Math.abs(av - s.candidateValue);
    const cd = Math.abs(cv - s.candidateValue);
    sa += ad / s.scale;
    sc += cd / s.scale;
    if (ad > cd) further.push(s.metric);
    markers.push({
      metric: s.metric,
      label: s.label,
      explanation: s.explanation,
      unit: s.unit,
      candidateValue: r4(s.candidateValue),
      aplyerValue: r4(av),
      chatgptValue: r4(cv),
      aplyerDistance: r4(ad),
      chatgptDistance: r4(cd),
    });
  }
  const n = selection.markers.length;
  const aplyerDistance = r4(sa / n);
  const chatgptDistance = r4(sc / n);
  const closer = aplyerDistance < chatgptDistance ? "aplyer" : chatgptDistance < aplyerDistance ? "chatgpt" : "equal";
  return { view: { status: "shown", markers, aggregate: { aplyerDistance, chatgptDistance, closer } }, aplyerFurtherMarkers: further };
}

/** Existing Prompt A "preferred phrasing style" note naming the failing markers (numbers only, no sample text). */
export function regenerationNote(selection: MarkerSelection, failing: string[]): string {
  const parts = selection.markers
    .filter((m) => failing.includes(m.metric))
    .map((m) => `${m.label}: about ${r4(m.candidateValue)}${m.unit ? " " + m.unit : ""}`);
  return `Match the candidate's measured writing habits. ${parts.join("; ")}.`;
}

export type RegenerateAplyer = (note: string) => Promise<string | null>;

export interface ScoreboardOutcome {
  aplyerText: string;
  scoreboard: ScoreboardView | null;
  attempts: number;
  /** Internal only (logged with the request id, never sent to the visitor). */
  suppressedReason: string | null;
  failingMarkers: string[];
}

/**
 * After both answers are complete: compare on the fixed markers; when the
 * Aplyer answer sits further from the candidate than ChatGPT, regenerate
 * Aplyer (existing revision path) up to MAX_APLYER_ATTEMPTS total. If it is
 * still further, the scoreboard is suppressed (spec, decided September 17).
 */
export async function resolveScoreboard(args: {
  selection: MarkerSelection | null;
  aplyerText: string;
  chatgptText: string | null;
  regenerate: RegenerateAplyer | null;
}): Promise<ScoreboardOutcome> {
  let aplyerText = args.aplyerText;
  let attempts = 1;
  const out = (scoreboard: ScoreboardView | null, suppressedReason: string | null, failingMarkers: string[] = []): ScoreboardOutcome => ({
    aplyerText,
    scoreboard,
    attempts,
    suppressedReason,
    failingMarkers,
  });
  if (!args.selection) return out(null, "no_selection");
  if (!args.chatgptText) return out(null, "no_chatgpt_answer");
  let cmp = compareAnswers(args.selection, aplyerText, args.chatgptText);
  if (!cmp) return out(null, "not_measurable");
  while (cmp.view.aggregate.closer === "chatgpt" && attempts < MAX_APLYER_ATTEMPTS && args.regenerate) {
    attempts += 1;
    const next = await args.regenerate(regenerationNote(args.selection, cmp.aplyerFurtherMarkers)).catch(() => null);
    if (!next) return out(null, "regeneration_failed", cmp.aplyerFurtherMarkers);
    aplyerText = next;
    const again = compareAnswers(args.selection, aplyerText, args.chatgptText);
    if (!again) return out(null, "not_measurable");
    cmp = again;
  }
  if (cmp.view.aggregate.closer === "chatgpt") return out(null, "aplyer_further", cmp.aplyerFurtherMarkers);
  return out(cmp.view, null);
}

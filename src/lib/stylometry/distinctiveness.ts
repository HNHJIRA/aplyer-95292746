/**
 * Distinctiveness interface — pure math, NO built-in baseline.
 *
 * The engine ships with an EMPTY reference set. No mean, SD or percentile is
 * invented. A reference must be supplied as data and marked `approved: true`
 * (client-approved ordinary-writer dataset) before it is used. No threshold
 * is chosen here; callers must pass one explicitly or get an unfiltered rank.
 *
 * Ranking takes ONLY a writing-sample fingerprint. It has no parameter for a
 * generated answer, so the marker choice cannot depend on either side.
 */
import type { Fingerprint, Metric } from "./fingerprint";

export type ReferenceDistribution =
  | { metric: string; method: "z_score"; mean: number; sd: number; n?: number; source: string; approved: boolean }
  | { metric: string; method: "empirical_percentile"; values: number[]; source: string; approved: boolean };

/** Approved ordinary-writer references. Intentionally empty: CLIENT DECISION REQUIRED. */
export const APPROVED_REFERENCE_DISTRIBUTIONS: readonly ReferenceDistribution[] = Object.freeze([]);

export interface Distinctiveness {
  metric: string;
  method: ReferenceDistribution["method"];
  value: number;
  /** Standardised distance: |z| for z_score, |percentile − 50| / 50 for empirical. */
  distance: number;
  z?: number;
  percentile?: number;
  direction: "above" | "below" | "equal";
  source: string;
}

export function standardize(metric: Pick<Metric, "name" | "value" | "reliability">, ref: ReferenceDistribution): Distinctiveness | null {
  if (!ref.approved || ref.metric !== metric.name) return null;
  if (metric.reliability !== "reliable" || metric.value === null) return null;
  const v = metric.value;
  if (ref.method === "z_score") {
    if (!(Number.isFinite(ref.mean) && Number.isFinite(ref.sd) && ref.sd > 0)) return null;
    const z = (v - ref.mean) / ref.sd;
    return { metric: metric.name, method: ref.method, value: v, z, distance: Math.abs(z), direction: z > 0 ? "above" : z < 0 ? "below" : "equal", source: ref.source };
  }
  const vals = ref.values.filter(Number.isFinite);
  if (!vals.length) return null;
  const below = vals.filter((x) => x < v).length;
  const equal = vals.filter((x) => x === v).length;
  const percentile = ((below + equal / 2) / vals.length) * 100; // mid-rank
  return {
    metric: metric.name,
    method: ref.method,
    value: v,
    percentile,
    distance: Math.abs(percentile - 50) / 50,
    direction: percentile > 50 ? "above" : percentile < 50 ? "below" : "equal",
    source: ref.source,
  };
}

/**
 * Ranks the writing sample's reliable, headline-eligible metrics by distance
 * from the supplied approved references, most distinctive first. Ties break
 * by metric name so the order is deterministic.
 */
export function rankDistinctiveMarkers(
  sampleFingerprint: Fingerprint,
  references: readonly ReferenceDistribution[] = APPROVED_REFERENCE_DISTRIBUTIONS,
  opts: { minDistance?: number } = {},
): Distinctiveness[] {
  const byMetric = new Map(references.filter((r) => r.approved).map((r) => [r.metric, r]));
  const out: Distinctiveness[] = [];
  for (const m of sampleFingerprint.metrics) {
    if (!m.headlineEligible) continue;
    const ref = byMetric.get(m.name);
    if (!ref) continue;
    const d = standardize(m, ref);
    if (d && (opts.minDistance === undefined || d.distance > opts.minDistance)) out.push(d);
  }
  return out.sort((a, b) => b.distance - a.distance || a.metric.localeCompare(b.metric));
}

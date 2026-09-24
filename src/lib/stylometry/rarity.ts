/**
 * Voice Card rarity — how far a writing sample sits from an ordinary writer.
 * NOT how many Aplyer users got a card: there is no user-frequency input.
 *
 * Uses the SAME distinctiveness engine as the Demo scoreboard:
 *   writing sample -> computeFingerprint -> rankDistinctiveMarkers (approved
 *   references) -> aggregate distinctiveness -> standardize() against the
 *   approved reference distribution of that aggregate -> percentile.
 *
 * Aggregate distinctiveness = arithmetic mean of the per-metric standardised
 * distances returned by rankDistinctiveMarkers (no threshold). The reference
 * for it is an approved `empirical_percentile` entry with metric
 * AGGREGATE_METRIC whose values are ordinary writers' aggregates computed the
 * same way. No such approved entry => rarity unavailable. Nothing is invented.
 */
import { computeFingerprint, type Fingerprint } from "./fingerprint";
import { rankDistinctiveMarkers, standardize, type ReferenceDistribution } from "./distinctiveness";

export const AGGREGATE_METRIC = "aggregate_distinctiveness";

export type Rarity =
  | { status: "available"; percentile: number; text: string }
  | { status: "unavailable" };

export function aggregateDistinctiveness(fp: Fingerprint, references: readonly ReferenceDistribution[]): number | null {
  const ranked = rankDistinctiveMarkers(fp, references.filter((r) => r.metric !== AGGREGATE_METRIC));
  if (!ranked.length) return null;
  return ranked.reduce((a, d) => a + d.distance, 0) / ranked.length;
}

/** Candidate-facing wording. Floors the percentile so it never overstates. */
export function rarityText(percentile: number): string {
  return `More distinctive than roughly ${Math.floor(percentile)}% of writers.`;
}

export function computeRarity(writingSample: string | null | undefined, references: readonly ReferenceDistribution[] | null | undefined): Rarity {
  const refs = (references ?? []).filter((r) => r && r.approved === true);
  const aggRef = refs.find((r) => r.metric === AGGREGATE_METRIC && r.method === "empirical_percentile");
  if (!writingSample?.trim() || !aggRef) return { status: "unavailable" };
  const fp = computeFingerprint(writingSample);
  if (!fp.sufficient) return { status: "unavailable" };
  const agg = aggregateDistinctiveness(fp, refs);
  if (agg === null) return { status: "unavailable" };
  const d = standardize({ name: AGGREGATE_METRIC, value: agg, reliability: "reliable" }, aggRef);
  if (!d || d.percentile === undefined) return { status: "unavailable" };
  return { status: "available", percentile: d.percentile, text: rarityText(d.percentile) };
}

// @vitest-environment node
// Step 7B: Voice Card tagline, reads, rarity foundation.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROMPT_B_VOICE_CARD,
  VOICE_ARCHETYPES,
  VOICE_CARD_SOURCE_HASH_VERSION,
  parseArchetype,
  validateVoiceCard,
} from "@/lib/ai/prompts/prompt-b-voice-card";
import { MODEL_HAIKU } from "@/lib/ai/prompts/models";
import { computeFingerprint } from "../fingerprint";
import { rankDistinctiveMarkers, type ReferenceDistribution } from "../distinctiveness";
import { AGGREGATE_METRIC, aggregateDistinctiveness, computeRarity } from "../rarity";

const BASE = {
  archetype: "The One-Liner",
  archetype_description: "You say a lot in few words. Your sentences are short and land cleanly.",
  tagline: "You get to the point fast.",
  reads: "Reads like short, clipped notes with the point up front.",
  headline: "Tight and clear",
  tone: "direct",
  cadence: "short",
  formality: "neutral",
  vocabulary_bias: "plain",
  distinctive_traits: ["a"],
  hooks_and_transitions: ["b"],
  values_signals: ["c"],
  do_and_avoid: { do: ["x"], avoid: ["y"] },
};

describe("archetypes", () => {
  it("11–12. exactly the five names, unchanged", () => {
    expect([...VOICE_ARCHETYPES]).toEqual(["The One-Liner", "The Natural", "The Storyteller", "The Straight Shooter", "The Overthinker"]);
    for (const a of VOICE_ARCHETYPES) expect(parseArchetype(a)).toBe(a);
    expect(() => parseArchetype("The Poet")).toThrow();
  });
  it("15. classification rules and model unchanged", () => {
    expect(PROMPT_B_VOICE_CARD.model).toBe(MODEL_HAIKU);
    for (const line of [
      `"The One-Liner" — writes tight, minimal, high-signal sentences; says a lot in very few words.`,
      `"The Natural" — conversational and warm; reads like a smart person talking, contractions and easy rhythm.`,
      `"The Storyteller" — builds narrative context before the point; scenes, arcs, and vivid specifics.`,
      `"The Straight Shooter" — blunt, structured, results-first; no hedging, no flourish.`,
      `"The Overthinker" — thorough and reflective; nuance, caveats, and second-order reasoning.`,
    ]) expect(PROMPT_B_VOICE_CARD.system).toContain(line);
    expect(PROMPT_B_VOICE_CARD.version).toBe("3.1.0");
    expect(VOICE_CARD_SOURCE_HASH_VERSION).toBe("3.0.0"); // existing cards are not invalidated
  });
});

describe("tagline + reads", () => {
  it("13–14. both required in new output and in the contract", () => {
    expect(PROMPT_B_VOICE_CARD.system).toMatch(/"tagline": string/);
    expect(PROMPT_B_VOICE_CARD.system).toMatch(/"reads": string/);
    const v = validateVoiceCard(BASE);
    expect(v.tagline).toBe(BASE.tagline);
    expect(v.reads).toBe(BASE.reads);
    expect(() => validateVoiceCard({ ...BASE, tagline: "" })).toThrow(/tagline/);
    expect(() => validateVoiceCard({ ...BASE, reads: undefined })).toThrow(/reads/);
  });
  it("tagline: one line, concise, no stats, no AI mention; reads: no personal traits", () => {
    expect(() => validateVoiceCard({ ...BASE, tagline: "You get to\nthe point." })).toThrow();
    expect(() => validateVoiceCard({ ...BASE, tagline: "You write better than 90% of people." })).toThrow();
    expect(() => validateVoiceCard({ ...BASE, tagline: "Your AI twin gets to the point." })).toThrow();
    expect(() => validateVoiceCard({ ...BASE, tagline: "One two three four five six seven eight nine ten eleven twelve thirteen." })).toThrow();
    expect(() => validateVoiceCard({ ...BASE, reads: "Reads like an anxious person wrote it." })).toThrow();
    expect(() => validateVoiceCard({ ...BASE, reads: "Reads like a genius." })).toThrow();
  });
  it("16. old cards without the new fields still render safely", () => {
    const src = readFileSync(join(process.cwd(), "src/components/extension/screens/VoiceCard.tsx"), "utf8");
    expect(src).toContain("tagline?: string");
    expect(src).toContain("reads?: string");
    expect(src).toMatch(/card\.tagline &&/);
    expect(src).toMatch(/card\.reads &&/);
  });
  it("22. no extra AI call: same single Prompt B call, rarity is local", () => {
    const route = readFileSync(join(process.cwd(), "src/routes/api/public/extension.voicecard.ts"), "utf8");
    expect(route.match(/runPromptValidated\(/g)?.length).toBe(1);
    const rarity = readFileSync(join(process.cwd(), "src/lib/stylometry/rarity.ts"), "utf8");
    expect(rarity).not.toMatch(/fetch\(|anthropic|openai|runPrompt|supabase/i);
  });
});

// ---- rarity -------------------------------------------------------------------
const CASUAL =
  "I've spent six years building data tools, and I don't think I've ever enjoyed a problem more than this one. We shipped a pipeline in 2021; it cut latency by 38% and I'm proud of it. But it wasn't perfect. I didn't know why the nightly job failed, so I read the logs and I fixed it.";
const SAMPLE = Array(8).fill(CASUAL).join("\n\n");
const fp = computeFingerprint(SAMPLE);
const val = (n: string) => fp.metrics.find((m) => m.name === n)!.value!;
const metricRefs: ReferenceDistribution[] = [
  { metric: "contraction_rate", method: "z_score", mean: val("contraction_rate") - 3, sd: 1, source: "test", approved: true },
  { metric: "first_person_rate", method: "z_score", mean: val("first_person_rate") - 1, sd: 1, source: "test", approved: true },
];
const aggRef = (values: number[], approved = true): ReferenceDistribution => ({ metric: AGGREGATE_METRIC, method: "empirical_percentile", values, source: "test", approved });

describe("rarity", () => {
  it("17. uses the same distinctiveness engine as the scoreboard", () => {
    const ranked = rankDistinctiveMarkers(fp, metricRefs);
    expect(aggregateDistinctiveness(fp, metricRefs)).toBeCloseTo(ranked.reduce((a, d) => a + d.distance, 0) / ranked.length, 9);
    expect(aggregateDistinctiveness(fp, metricRefs)).toBeCloseTo(2, 9);
  });
  it("18. no baseline / unapproved / short sample → unavailable, never a number", () => {
    expect(computeRarity(SAMPLE, [])).toEqual({ status: "unavailable" });
    expect(computeRarity(SAMPLE, metricRefs)).toEqual({ status: "unavailable" }); // no aggregate reference
    expect(computeRarity(SAMPLE, [...metricRefs, aggRef([0, 1, 3], false)])).toEqual({ status: "unavailable" });
    expect(computeRarity(CASUAL, [...metricRefs, aggRef([0, 1, 3])])).toEqual({ status: "unavailable" });
    expect(computeRarity(null, [...metricRefs, aggRef([0, 1, 3])])).toEqual({ status: "unavailable" });
  });
  it("19. approved baseline → percentile from the reference, floored wording", () => {
    // aggregate = 2; reference values: 17 below, 3 above → mid-rank 85%.
    const values = [...Array(17).fill(1), ...Array(3).fill(3)];
    const r = computeRarity(SAMPLE, [...metricRefs, aggRef(values)]);
    expect(r).toEqual({ status: "available", percentile: 85, text: "More distinctive than roughly 85% of writers." });
  });
  it("20. no user-card frequency input exists", () => {
    expect(computeRarity.length).toBe(2);
    const src = readFileSync(join(process.cwd(), "src/lib/stylometry/rarity.ts"), "utf8");
    expect(src).not.toMatch(/profiles|voice_card_data|count\(/);
  });
  it("21. rarity never feeds archetype selection (Prompt B input unchanged)", () => {
    const route = readFileSync(join(process.cwd(), "src/routes/api/public/extension.voicecard.ts"), "utf8");
    const gen = route.slice(route.indexOf("async function startVoiceCardGeneration"), route.indexOf("async function generateAbDemo"));
    expect(gen).not.toMatch(/rarity/i);
    const fnSrc = readFileSync(join(process.cwd(), "src/lib/ai/prompts/prompt-b-voice-card.ts"), "utf8");
    expect(fnSrc).not.toMatch(/rarity/i);
  });
});

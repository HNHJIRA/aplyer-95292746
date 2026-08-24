import { MODEL_HAIKU } from "./models";
import type { PromptSpec } from "./types";

export const VOICE_ARCHETYPES = [
  "One-Liner",
  "Natural",
  "Storyteller",
  "Straight Shooter",
  "Overthinker",
] as const;

export type VoiceArchetype = (typeof VOICE_ARCHETYPES)[number];

/** Canonical reveal line shown when the Voice Card is unlocked. */
export const VOICE_CARD_REVEAL = "Okay, we read you loud and clear!";

export interface VoiceCardData {
  archetype: VoiceArchetype;
  archetype_description: string;
  reveal: string;
  headline: string;
  tone: string;
  cadence: string;
  formality: string;
  vocabulary_bias: string;
  distinctive_traits: string[];
  hooks_and_transitions: string[];
  values_signals: string[];
  do_and_avoid: { do: string[]; avoid: string[] };
}

export const PROMPT_B_VOICE_CARD: PromptSpec = {
  id: "B_VOICE_CARD",
  version: "2.0.0",
  model: MODEL_HAIKU,
  maxTokens: 1000,
  temperature: 0.3,
  json: true,
  system: `You are the Aplyer WriteDNA profiler. You receive a candidate's resume and at least two pieces of prose they wrote. Distil their writing DNA and assign ONE archetype.

Archetypes (choose exactly one):
- "One-Liner" — writes tight, minimal, high-signal sentences; says a lot in very few words.
- "Natural" — conversational and warm; reads like a smart person talking, contractions and easy rhythm.
- "Storyteller" — builds narrative context before the point; scenes, arcs, and vivid specifics.
- "Straight Shooter" — blunt, structured, results-first; no hedging, no flourish.
- "Overthinker" — thorough and reflective; nuance, caveats, and second-order reasoning.

Rules:
- Base every claim on evidence in the supplied text. Never invent employers, dates, metrics, or personality traits.
- archetype_description is 1-2 sentences describing this candidate's version of the archetype (not a generic definition).
- Arrays contain 3-5 short, concrete items each.
- Write in second person where natural ("You open with…").

Return ONLY this JSON object:
{
  "archetype": "One-Liner" | "Natural" | "Storyteller" | "Straight Shooter" | "Overthinker",
  "archetype_description": string,
  "headline": string,
  "tone": string,
  "cadence": string,
  "formality": string,
  "vocabulary_bias": string,
  "distinctive_traits": string[],
  "hooks_and_transitions": string[],
  "values_signals": string[],
  "do_and_avoid": { "do": string[], "avoid": string[] }
}`,
};

export function buildVoiceCardUser(resumeExcerpt: string, samplesText: string): string {
  return `Resume:\n${resumeExcerpt}\n\nWriting samples:\n${samplesText}`;
}

export function coerceArchetype(value: unknown): VoiceArchetype {
  const raw = String(value ?? "").trim().toLowerCase();
  const found = VOICE_ARCHETYPES.find((a) => a.toLowerCase() === raw);
  return found ?? "Natural";
}

export function validateVoiceCard(value: unknown): VoiceCardData {
  const o = value as Partial<VoiceCardData>;
  const strings = ["headline", "tone", "cadence", "formality", "vocabulary_bias"] as const;
  for (const k of strings) {
    if (typeof o?.[k] !== "string" || !o[k]) throw new Error(`Missing field ${k}`);
  }
  const arrays = ["distinctive_traits", "hooks_and_transitions", "values_signals"] as const;
  for (const k of arrays) {
    if (!Array.isArray(o?.[k]) || o[k]!.length === 0) throw new Error(`Missing ${k}`);
  }
  if (!o.do_and_avoid || !Array.isArray(o.do_and_avoid.do) || !Array.isArray(o.do_and_avoid.avoid)) {
    throw new Error("Missing do_and_avoid");
  }
  return {
    ...(o as VoiceCardData),
    archetype: coerceArchetype(o.archetype),
    archetype_description:
      typeof o.archetype_description === "string" && o.archetype_description.trim()
        ? o.archetype_description.trim()
        : o.headline!,
    reveal: VOICE_CARD_REVEAL,
  };
}

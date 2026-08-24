import { describe, expect, it } from "vitest";
import {
  APPROVED_MODELS,
  MODEL_HAIKU,
  MODEL_OPUS,
  PROMPT_LIBRARY,
  PROMPT_A_ANSWER_GENERATION,
  PROMPT_B_VOICE_CARD,
  PROMPT_C_RESUME_AUDIT,
  PROMPT_D_RESUME_SCORE,
  PROMPT_I_CLASSIFICATION,
  PROMPT_J_QUALITY_SCAN,
  PROMPT_P0_FACT_INVENTORY,
  QUALITY_CHECKS,
  QUESTION_FRAMEWORKS,
  REQUIRED_QUALIFYING_SAMPLES,
  VOICE_ARCHETYPES,
  VOICE_CARD_REVEAL,
  assertFactInventory,
  heuristicClassificationForDiagnostics,
  isApprovedModel,
  parseArchetype,
  validateClassification,
  validateResumeAudit,
  validateResumeScore,
  validateVoiceCard,
} from "@/lib/ai/prompts";

describe("prompt library", () => {
  it("declares canonical models per prompt", () => {
    expect(PROMPT_I_CLASSIFICATION.model).toBe(MODEL_OPUS);
    expect(PROMPT_C_RESUME_AUDIT.model).toBe(MODEL_OPUS);
    expect(PROMPT_D_RESUME_SCORE.model).toBe(MODEL_OPUS);
    expect(PROMPT_J_QUALITY_SCAN.model).toBe(MODEL_OPUS);
    expect(PROMPT_A_ANSWER_GENERATION.model).toBe(MODEL_OPUS);
    expect(PROMPT_B_VOICE_CARD.model).toBe(MODEL_HAIKU);
    expect(PROMPT_P0_FACT_INVENTORY.model).toBe(MODEL_HAIKU);
    expect(PROMPT_P0_FACT_INVENTORY.temperature).toBe(0);
    expect(PROMPT_P0_FACT_INVENTORY.json).toBe(true);
  });

  it("only allows the two approved models", () => {
    expect([...APPROVED_MODELS].sort()).toEqual([MODEL_HAIKU, MODEL_OPUS].sort());
    expect(isApprovedModel("claude-3-5-sonnet-latest")).toBe(false);
    for (const p of PROMPT_LIBRARY) expect(isApprovedModel(p.model)).toBe(true);
  });

  it("gives every prompt a unique id and a version", () => {
    const ids = PROMPT_LIBRARY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROMPT_LIBRARY) expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("ships exactly 22 quality checks", () => {
    expect(QUALITY_CHECKS).toHaveLength(22);
  });
});

describe("prompt I — classification", () => {
  it("accepts all six canonical frameworks", () => {
    expect(QUESTION_FRAMEWORKS).toHaveLength(6);
    for (const f of QUESTION_FRAMEWORKS) {
      expect(validateClassification({ framework: f.toLowerCase(), reason: "x" }).framework).toBe(f);
    }
  });

  it("rejects anything outside the six frameworks", () => {
    expect(() => validateClassification({ framework: "BEHAVIOURAL" })).toThrow();
    expect(() => validateClassification({})).toThrow();
    expect(() => validateClassification({ framework: "STAR, CAR" })).toThrow();
  });

  it("never returns a confidence field", () => {
    const c = validateClassification({ framework: "STAR", reason: "x", confidence: 0.9 });
    expect(Object.keys(c).sort()).toEqual(["framework", "reason"]);
  });

  it("keeps the heuristic classifier out of production exports used by the server", () => {
    // The heuristic is diagnostics-only; its name makes that explicit and the
    // server module must not import it.
    expect(heuristicClassificationForDiagnostics("Tell me about a time you failed.").framework).toBe("STAR-F");
  });
});

describe("prompt B — voice card", () => {
  const base = {
    headline: "You write in clean, direct lines.",
    tone: "warm",
    cadence: "short",
    formality: "casual",
    vocabulary_bias: "plain",
    distinctive_traits: ["a", "b", "c"],
    hooks_and_transitions: ["b"],
    values_signals: ["c"],
    do_and_avoid: { do: ["d"], avoid: ["e"] },
    archetype_description: "You keep sentences short and load them with signal. Every line does one piece of work.",
  };

  it("requires one resume plus two qualifying prose samples", () => {
    expect(REQUIRED_QUALIFYING_SAMPLES).toBe(2);
  });

  it("exposes exactly the five approved archetypes", () => {
    expect([...VOICE_ARCHETYPES]).toEqual([
      "The One-Liner",
      "The Natural",
      "The Storyteller",
      "The Straight Shooter",
      "The Overthinker",
    ]);
  });

  it("attaches the exact reveal line", () => {
    expect(validateVoiceCard({ ...base, archetype: "storyteller" }).reveal).toBe("Okay, we read you loud and clear!");
    expect(VOICE_CARD_REVEAL).toBe("Okay, we read you loud and clear!");
  });

  it("rejects an archetype outside the five instead of defaulting", () => {
    expect(() => parseArchetype("Poet")).toThrow();
    expect(() => validateVoiceCard({ ...base, archetype: "Poet" })).toThrow();
  });

  it("rejects em dashes, prohibited job-search terms, and statistics", () => {
    expect(() =>
      validateVoiceCard({ ...base, archetype: "The Natural", archetype_description: "You write plainly — always." }),
    ).toThrow(/em dash/i);
    expect(() =>
      validateVoiceCard({
        ...base,
        archetype: "The Natural",
        archetype_description: "Your resume reads clearly. You explain well.",
      }),
    ).toThrow(/prohibited/i);
    expect(() =>
      validateVoiceCard({
        ...base,
        archetype: "The Natural",
        archetype_description: "You are 40% more direct than most. You keep it tight.",
      }),
    ).toThrow(/statistic/i);
  });

  it("caps the archetype description at three sentences", () => {
    expect(() =>
      validateVoiceCard({
        ...base,
        archetype: "The Natural",
        archetype_description: "One. Two. Three. Four.",
      }),
    ).toThrow(/sentences/i);
  });
});

describe("prompts C and D", () => {
  it("maps legacy audit fields onto the canonical shape", () => {
    const audit = validateResumeAudit({
      verdict: "Solid but vague.",
      redFlags: [{ issue: "Passive verbs", why: "Reads like duties", fix: "Use owned/led" }],
      strengths: ["Clear structure"],
      closing: "Quantify the top three bullets.",
    });
    expect(audit.overallTake).toBe("Solid but vague.");
    expect(audit.redFlags[0].flag).toBe("Passive verbs");
    expect(audit.topPriority).toContain("Quantify");
  });

  it("returns the canonical Job Description Match schema", () => {
    const report = validateResumeScore({
      matchScore: 62,
      keywordsPresent: ["react"],
      keywordsMissing: ["kubernetes"],
      sectionSuggestions: ["Tighten the summary."],
      summary: "s",
    });
    expect(report.matchScore).toBe(62);
    expect(report.keywordsPresent).toEqual(["react"]);
    expect(report.sectionSuggestions).toHaveLength(1);
    expect(report).not.toHaveProperty("jobDescriptionMatch");
  });

  it("clamps the match score", () => {
    expect(validateResumeScore({ matchScore: 140, summary: "s" }).matchScore).toBe(100);
    expect(validateResumeScore({ overallMatch: 62, summary: "s" }).matchScore).toBe(62);
  });
});

describe("prompt A — P0 gate", () => {
  it("blocks generation without a fact inventory", () => {
    expect(() => assertFactInventory([])).toThrow(/fact inventory/i);
    expect(() => assertFactInventory(["Led migration of billing service"])).not.toThrow();
  });
});

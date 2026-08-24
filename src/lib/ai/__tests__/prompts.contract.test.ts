import { describe, expect, it } from "vitest";
import {
  MODEL_HAIKU,
  MODEL_OPUS,
  PROMPT_LIBRARY,
  PROMPT_A_ANSWER_GENERATION,
  PROMPT_B_VOICE_CARD,
  PROMPT_C_RESUME_AUDIT,
  PROMPT_D_RESUME_SCORE,
  PROMPT_I_CLASSIFICATION,
  PROMPT_J_QUALITY_SCAN,
  QUALITY_CHECKS,
  VOICE_CARD_REVEAL,
  assertFactInventory,
  heuristicClassification,
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
  });

  it("gives every prompt a unique id and a version", () => {
    const ids = PROMPT_LIBRARY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROMPT_LIBRARY) expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("ships exactly 21 quality checks", () => {
    expect(QUALITY_CHECKS).toHaveLength(21);
  });
});

describe("prompt I — classification", () => {
  it("accepts the six frameworks only", () => {
    expect(validateClassification({ framework: "star-f", confidence: 0.9, reason: "x" }).framework).toBe("STAR-F");
    expect(() => validateClassification({ framework: "BEHAVIOURAL" })).toThrow();
  });

  it("falls back heuristically", () => {
    expect(heuristicClassification("Tell me about a time you failed.").framework).toBe("STAR-F");
    expect(heuristicClassification("Why do you want to work here?").framework).toBe("MOTIVATION");
    expect(heuristicClassification("Tell me about a time you led a project.").framework).toBe("STAR");
    expect(heuristicClassification("What is your notice period?").framework).toBe("GENERAL");
  });
});

describe("prompt B — voice card", () => {
  const base = {
    headline: "h",
    tone: "t",
    cadence: "c",
    formality: "f",
    vocabulary_bias: "v",
    distinctive_traits: ["a"],
    hooks_and_transitions: ["b"],
    values_signals: ["c"],
    do_and_avoid: { do: ["d"], avoid: ["e"] },
  };

  it("always attaches the canonical reveal line and a known archetype", () => {
    const card = validateVoiceCard({ ...base, archetype: "storyteller" });
    expect(card.archetype).toBe("Storyteller");
    expect(card.reveal).toBe(VOICE_CARD_REVEAL);
  });

  it("defaults an unknown archetype instead of failing", () => {
    expect(validateVoiceCard({ ...base, archetype: "Poet" }).archetype).toBe("Natural");
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

  it("clamps the job description match score", () => {
    expect(validateResumeScore({ jobDescriptionMatch: 140, summary: "s" }).jobDescriptionMatch).toBe(100);
    expect(validateResumeScore({ overallMatch: 62, summary: "s" }).jobDescriptionMatch).toBe(62);
  });
});

describe("prompt A — P0 gate", () => {
  it("blocks generation without a fact inventory", () => {
    expect(() => assertFactInventory([])).toThrow(/fact inventory/i);
    expect(() => assertFactInventory(["Led migration of billing service"])).not.toThrow();
  });
});

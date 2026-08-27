// Regression suite for the A -> guards -> J -> repair -> guards -> J flow.
//
// The provider is mocked: these tests assert the orchestration contract, not
// model quality. Prompt A output, Prompt J verdicts and Prompt J repairs are
// scripted per test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flattenInventory } from "../answer-facts";
import { HARD_BANNED_TERMS, ANSWER_MIN_WORDS } from "../prompts/prompt-a-answer-generation";
import { QUALITY_CHECKS } from "../prompts/prompt-j-quality-scan";
import type { ResumeFactInventory } from "../prompts/prompt-p0-fact-inventory";

const runPromptValidated = vi.fn();
vi.mock("../run-prompt.server", () => ({
  PromptError: class PromptError extends Error {},
  runPromptValidated: (...args: unknown[]) => runPromptValidated(...args),
}));

const { generateValidatedVariant } = await import("../answer-pipeline.server");

const fact = (id: string, value: string) => ({
  id,
  value,
  evidence: value,
  sourceSection: "experience",
  confidence: "explicit" as const,
});

const INVENTORY: ResumeFactInventory = {
  schemaVersion: "1.0.0",
  sourceResumeId: "resume-1",
  identity: { name: "Sam Rivera", location: "Austin, TX" },
  contact: { email: null, phone: null, linkedin: null, portfolio: null },
  professionalSummaryFacts: [],
  experience: [
    {
      id: "e1",
      company: "Northwind",
      role: "Senior Engineer",
      location: null,
      startDate: "2021",
      endDate: "2024",
      isCurrent: false,
      facts: [fact("f1", "Reduced checkout latency by 38 percent")],
      technologies: [fact("f2", "Postgres")],
      achievements: [fact("f3", "Cut deploy time from 40 minutes to 9 minutes")],
    },
  ],
  education: [],
  skills: [],
  certifications: [],
  projects: [],
  achievements: [],
  otherFacts: [],
};

const flat = flattenInventory(INVENTORY);

const FILLER =
  "The work involved steady collaboration with the wider team and careful attention to how each change landed for the people who relied on it, so the outcome held up over time and the team could keep building on it without surprises later.";

function pad(core: string, min = ANSWER_MIN_WORDS): string {
  let out = core;
  while (out.split(/\s+/).length < min) out = `${out} ${FILLER}`;
  return out;
}

function words(text: string, n: number): string {
  const src = pad(text, n + 40).split(/\s+/);
  return src.slice(0, n).join(" ");
}

const CLEAN = pad("Checkout latency at Northwind dropped by 38 percent after reworking the slowest paths.");

function scanResult(opts: {
  failed?: number[];
  revisedAnswer?: string | null;
}) {
  const failed = new Set(opts.failed ?? []);
  return {
    passed: failed.size === 0,
    checks: QUALITY_CHECKS.map((name, i) => ({
      id: i + 1,
      name,
      passed: !failed.has(i + 1),
      note: "",
    })),
    blocking: [...failed].map((id) => QUALITY_CHECKS[id - 1]!),
    blockingCodes: [...failed].map((id) => `check_${id}`),
    revisedAnswer: opts.revisedAnswer ?? null,
  };
}

/** Scripts the provider: first the Prompt A draft, then each Prompt J scan. */
function script(draft: string, scans: ReturnType<typeof scanResult>[]) {
  let scanIndex = 0;
  runPromptValidated.mockImplementation(async (spec: { id: string }) => {
    if (spec.id === "A_ANSWER_GENERATION") {
      return {
        value: { answer: draft, factIdsUsed: ["f1"], wordCount: draft.split(/\s+/).length },
        attempts: 1,
      };
    }
    const next = scans[Math.min(scanIndex, scans.length - 1)]!;
    scanIndex += 1;
    return { value: next, attempts: 1 };
  });
  return () => scanIndex;
}

const input = () => ({
  question: "Walk us through a recent piece of code you built and deployed.",
  framework: "STAR" as const,
  flat,
  voiceCard: null,
  jobContext: null,
  budget: { logicalScans: 0, providerCalls: 0, repairs: 0 },
});

beforeEach(() => {
  runPromptValidated.mockReset();
});

describe("answer repair pipeline", () => {
  it("ships a clean draft that passes both the guards and the scan", async () => {
    script(CLEAN, [scanResult({})]);
    const out = await generateValidatedVariant(input());
    expect(out.answer).toBe(CLEAN);
    expect(out.revisionCount).toBe(0);
  });

  it("ships a deterministically clean draft that only fails soft advisory checks", async () => {
    script(CLEAN, [scanResult({ failed: [4, 15, 16, 21] })]);
    const out = await generateValidatedVariant(input());
    expect(out.answer).toBe(CLEAN);
    expect(out.blockingCodes).toEqual(["check_4", "check_15", "check_16", "check_21"]);
  });

  it("blocks a draft containing a hard-banned term when no repair is offered", async () => {
    const dirty = pad("Checkout latency at Northwind dropped by 38 percent, a testament to disciplined work.");
    script(dirty, [scanResult({ failed: [1], revisedAnswer: null })]);
    await expect(generateValidatedVariant(input())).rejects.toMatchObject({
      code: "quality_failed",
      reasonCodes: expect.arrayContaining(["banned_vocabulary"]),
    });
  });

  it("rejects a repair that reintroduces a hard-banned term", async () => {
    const dirty = pad("Checkout latency at Northwind dropped by 38 percent under a wholly new pipeline.");
    const badRepair = pad("Checkout latency at Northwind dropped by 38 percent, a testament to the rework.");
    script(dirty, [scanResult({ failed: [2], revisedAnswer: badRepair }), scanResult({ failed: [2], revisedAnswer: badRepair })]);
    await expect(generateValidatedVariant(input())).rejects.toMatchObject({
      reasonCodes: expect.arrayContaining(["banned_vocabulary"]),
    });
  });

  it("accepts a repair that removes the banned term", async () => {
    const dirty = pad("Checkout latency at Northwind dropped by 38 percent, a testament to the rework.");
    script(dirty, [scanResult({ failed: [1], revisedAnswer: CLEAN }), scanResult({})]);
    const out = await generateValidatedVariant(input());
    expect(out.answer).toBe(CLEAN);
    expect(out.revisionCount).toBeGreaterThanOrEqual(1);
  });

  const badRepairs: Array<[string, string, string]> = [
    ["an unsupported metric", pad("Checkout latency at Northwind dropped by 91 percent after the rework."), "unsupported_number"],
    ["an unsupported tool", pad("Checkout latency at Northwind dropped by 38 percent after moving to mongodb."), "unsupported_tool"],
    ["an I opening", `I ${pad("reduced checkout latency at Northwind by 38 percent after the rework.")}`, "opens_with_i"],
    ["an 89 word answer", words("Checkout latency at Northwind dropped by 38 percent after the rework.", 89), "word_count_out_of_range"],
    ["a 171 word answer", words("Checkout latency at Northwind dropped by 38 percent after the rework.", 171), "word_count_out_of_range"],
  ];

  for (const [label, repair, code] of badRepairs) {
    it(`rejects a repair that introduces ${label}`, async () => {
      const dirty = pad("Checkout latency at Northwind dropped by 38 percent under a wholly new pipeline.");
      script(dirty, [
        scanResult({ failed: [2], revisedAnswer: repair }),
        scanResult({ failed: [2], revisedAnswer: repair }),
      ]);
      await expect(generateValidatedVariant(input())).rejects.toMatchObject({
        reasonCodes: expect.arrayContaining([code]),
      });
    });
  }

  it("uses the single correction opportunity and then stops — no unbounded loop", async () => {
    const dirty = pad("Checkout latency at Northwind dropped by 38 percent under a wholly new pipeline.");
    const bad = pad("Checkout latency at Northwind dropped by 91 percent after the rework.");
    const scans = script(dirty, [
      scanResult({ failed: [2], revisedAnswer: bad }),
      scanResult({ failed: [2], revisedAnswer: bad }),
      scanResult({ failed: [2], revisedAnswer: bad }),
    ]);
    await expect(generateValidatedVariant(input())).rejects.toBeTruthy();
    expect(scans()).toBeLessThanOrEqual(3);
  });

  it("does not fail deterministically across five repeated clean generations", async () => {
    for (let i = 0; i < 5; i += 1) {
      runPromptValidated.mockReset();
      script(CLEAN, [scanResult({ failed: i % 2 === 0 ? [] : [16] })]);
      const out = await generateValidatedVariant(input());
      expect(out.answer).toBe(CLEAN);
    }
  });
});

describe("canonical banned vocabulary", () => {
  it("is the single source shared by Prompt A, Prompt J and the deterministic guard", async () => {
    const [{ PROMPT_A_ANSWER_GENERATION }, { PROMPT_J_QUALITY_SCAN }] = await Promise.all([
      import("../prompts/prompt-a-answer-generation"),
      import("../prompts/prompt-j-quality-scan"),
    ]);
    const guardSource = await import("../answer-guards");
    expect(typeof guardSource.runAnswerGuards).toBe("function");
    for (const term of HARD_BANNED_TERMS) {
      expect(PROMPT_A_ANSWER_GENERATION.system.toLowerCase()).toContain(term.toLowerCase());
      expect(PROMPT_J_QUALITY_SCAN.system.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  it("flags every canonical banned term deterministically", async () => {
    const { runAnswerGuards } = await import("../answer-guards");
    for (const term of HARD_BANNED_TERMS) {
      const answer = pad(`Checkout latency at Northwind dropped by 38 percent and that is ${term} in practice.`);
      const r = runAnswerGuards(answer, flat);
      expect(r.violations.some((v) => v.code === "banned_vocabulary" && v.detail === term)).toBe(true);
    }
  });
});

describe("prompt J compact output contract", () => {
  it("treats unlisted checks as passed and listed ones as failed", async () => {
    const { validateQualityScan } = await import("../prompts/prompt-j-quality-scan");
    const ok = validateQualityScan({ failed: [], revisedAnswer: null });
    expect(ok.passed).toBe(true);
    expect(ok.checks).toHaveLength(22);

    const bad = validateQualityScan({ failed: [{ id: 1, note: "invented metric" }], revisedAnswer: "fixed" });
    expect(bad.passed).toBe(false);
    expect(bad.blockingCodes).toEqual(["check_1"]);
    expect(bad.revisedAnswer).toBe("fixed");
  });

  it("rejects an out-of-range failed check id", async () => {
    const { validateQualityScan } = await import("../prompts/prompt-j-quality-scan");
    expect(() => validateQualityScan({ failed: [{ id: 99 }] })).toThrow();
  });
});

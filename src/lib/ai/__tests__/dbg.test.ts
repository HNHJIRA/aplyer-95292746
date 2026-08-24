import { describe, expect, it, vi } from "vitest";
const runPromptValidated = vi.fn();
vi.mock("/dev-server/src/lib/ai/run-prompt.server.ts", () => ({
  PromptError: class extends Error {},
  runPromptValidated: (...a: unknown[]) => runPromptValidated(...a),
}));
describe("dbg", () => {
  it("logs args", async () => {
    const m = await import("/dev-server/src/lib/ai/answer-pipeline.server");
    runPromptValidated.mockImplementation(async (...a: any[]) => { console.log("ARGS", a.length, a[0]); throw new Error("stop"); });
    await expect(m.generateValidatedVariant({ question: "q?", framework: "STAR", flat: {} as any, voiceCard: null, jobContext: null, budget: { logicalScans:0, providerCalls:0, repairs:0 } } as any)).rejects.toBeTruthy();
  });
});

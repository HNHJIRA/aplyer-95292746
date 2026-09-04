import { describe, it, expect } from "vitest";
import { computeWriteDna, computeWriteDnaProgress, countQualifyingSamples, isQualifyingProse } from "@/lib/writedna";
import type { WritingSample } from "@/lib/storage/types";

const qualifying = (
  "I led the migration of our billing platform over two quarters, working closely with " +
  "support and finance to keep every invoice reconciled while we moved customers across in " +
  "small batches and documented each decision for the wider engineering team to follow."
);
const nonQualifying = "Too short to count.";

function sample(content: string): WritingSample {
  return { id: crypto.randomUUID(), type: "free_text", title: "t", content, wordCount: 0, createdAt: "" } as unknown as WritingSample;
}

describe("WriteDNA milestone progress", () => {
  it("1. no resume + 0 samples = 0%", () => {
    const s = computeWriteDna({ resumeUploaded: false, qualifyingProseCount: 0 });
    expect(s.voiceConfidence).toBe(0);
    expect(s.stage).toBe("idle");
    expect(s.voiceCardStatus).toBe("locked");
  });

  it("2. resume + 0 samples = 33%", () => {
    const s = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 0 });
    expect(s.voiceConfidence).toBe(33);
    expect(s.stage).toBe("building");
  });

  it("3. resume + 1 non-qualifying sample = 33%", () => {
    const count = countQualifyingSamples([sample(nonQualifying)]);
    expect(count).toBe(0);
    expect(computeWriteDna({ resumeUploaded: true, qualifyingProseCount: count, writingSampleCount: 1 }).voiceConfidence).toBe(33);
  });

  it("4. resume + 1 qualifying sample = 67%", () => {
    const count = countQualifyingSamples([sample(qualifying)]);
    expect(count).toBe(1);
    expect(computeWriteDna({ resumeUploaded: true, qualifyingProseCount: count }).voiceConfidence).toBe(67);
  });

  it("5. resume + 2 qualifying samples = 100%", () => {
    expect(computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 2 }).voiceConfidence).toBe(100);
  });

  it("6. resume + 3 qualifying samples = 100%", () => {
    expect(computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 3 }).voiceConfidence).toBe(100);
  });

  it("7. no resume + 2 samples = 0% and not eligible for a locked lifecycle", () => {
    const s = computeWriteDna({ resumeUploaded: false, qualifyingProseCount: 2, voiceCardStatus: "locked" });
    expect(s.voiceConfidence).toBe(0);
    expect(s.voiceCardStatus).toBe("locked");
  });

  it("8. resume deleted -> progress recalculates to 0%", () => {
    expect(computeWriteDna({ resumeUploaded: false, qualifyingProseCount: 1 }).voiceConfidence).toBe(0);
  });

  it("9. qualifying sample deleted -> progress decreases", () => {
    const before = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 2 }).voiceConfidence;
    const after = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 1 }).voiceConfidence;
    expect(before).toBe(100);
    expect(after).toBe(67);
  });

  it("10. non-qualifying sample never increases progress", () => {
    expect(isQualifyingProse(nonQualifying, "free_text")).toBe(false);
    const base = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 1 }).voiceConfidence;
    const withJunk = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: countQualifyingSamples([sample(qualifying), sample(nonQualifying)]) }).voiceConfidence;
    expect(withJunk).toBe(base);
  });

  it("11. Voice Card locked at 33%", () => {
    const s = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 0 });
    expect(s.voiceConfidence).toBe(33);
    expect(s.voiceCardStatus).toBe("locked");
  });

  it("12. Voice Card locked (collecting) at 67%", () => {
    const s = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 1 });
    expect(s.voiceConfidence).toBe(67);
    expect(s.voiceCardStatus).toBe("collecting_samples");
    expect(s.voiceCardStatus).not.toBe("eligible");
  });

  it("13. Voice Card eligible at 100%", () => {
    const s = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 2 });
    expect(s.voiceConfidence).toBe(100);
    expect(s.voiceCardStatus).toBe("eligible");
  });

  it("14. existing resume-only user with stored 0% recalculates to 33%", () => {
    expect(computeWriteDnaProgress(true, 0)).toBe(33);
  });

  it("15. existing user with resume + 1 sample recalculates to 67%", () => {
    expect(computeWriteDnaProgress(true, 1)).toBe(67);
  });

  it("16. existing fully qualified user remains 100%", () => {
    const s = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 2, voiceCardStatus: "generated" });
    expect(s.voiceConfidence).toBe(100);
    expect(s.voiceCardStatus).toBe("generated");
  });

  it("17. celebration flag is not replayed by recalculation", () => {
    expect(computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 2, celebratedStrong: true }).celebratedStrong).toBe(true);
    expect(computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 2 }).celebratedStrong).toBe(false);
  });

  it("18. frontend matrix matches the database formula", () => {
    const matrix: Array<[boolean, number, number]> = [
      [false, 0, 0], [false, 5, 0],
      [true, 0, 33], [true, 1, 67], [true, 2, 100], [true, 9, 100],
    ];
    for (const [resume, samples, expected] of matrix) {
      expect(computeWriteDnaProgress(resume, samples)).toBe(expected);
      expect(computeWriteDna({ resumeUploaded: resume, qualifyingProseCount: samples }).voiceConfidence).toBe(expected);
    }
  });

  it("stale status keeps eligible-tier progress", () => {
    const s = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 2, voiceCardStatus: "stale" });
    expect(s.voiceConfidence).toBe(100);
    expect(s.stage).toBe("strong");
  });
});

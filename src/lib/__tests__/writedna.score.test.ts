import { describe, it, expect } from "vitest";
import { computeWriteDna } from "@/lib/writedna";

describe("WriteDNA score matrix", () => {
  it("no resume, no samples -> idle / 0 / locked", () => {
    const s = computeWriteDna({ resumeUploaded: false, qualifyingProseCount: 0 });
    expect(s.stage).toBe("idle");
    expect(s.voiceConfidence).toBe(0);
    expect(s.voiceCardStatus).toBe("locked");
  });

  it("resume, no samples -> building / 0 / locked", () => {
    const s = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 0 });
    expect(s.stage).toBe("building");
    expect(s.voiceConfidence).toBe(0);
    expect(s.voiceCardStatus).toBe("locked");
  });

  it("resume + 1 sample -> good / 50 / collecting_samples", () => {
    const s = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 1 });
    expect(s.stage).toBe("good");
    expect(s.voiceConfidence).toBe(50);
    expect(s.voiceCardStatus).toBe("collecting_samples");
  });

  it("resume + 2 samples -> strong / 90 / eligible", () => {
    const s = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 2 });
    expect(s.stage).toBe("strong");
    expect(s.voiceConfidence).toBe(90);
    expect(s.voiceCardStatus).toBe("eligible");
  });

  it("generated -> strong / 100 / generated", () => {
    const s = computeWriteDna({
      resumeUploaded: true,
      qualifyingProseCount: 2,
      voiceCardStatus: "generated",
    });
    expect(s.stage).toBe("strong");
    expect(s.voiceConfidence).toBe(100);
    expect(s.voiceCardStatus).toBe("generated");
  });

  it("source mutation (stale status carries) -> 90 / stale", () => {
    const s = computeWriteDna({
      resumeUploaded: true,
      qualifyingProseCount: 2,
      voiceCardStatus: "stale",
    });
    expect(s.stage).toBe("strong");
    expect(s.voiceConfidence).toBe(90);
    expect(s.voiceCardStatus).toBe("stale");
  });

  it("delete one of two samples -> good / 50 / collecting_samples", () => {
    const s = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 1 });
    expect(s.stage).toBe("good");
    expect(s.voiceConfidence).toBe(50);
    expect(s.voiceCardStatus).toBe("collecting_samples");
  });

  it("delete all samples with resume -> building / 0 / locked", () => {
    const s = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 0 });
    expect(s.stage).toBe("building");
    expect(s.voiceConfidence).toBe(0);
    expect(s.voiceCardStatus).toBe("locked");
  });

  it("resume does NOT contribute to score (0 samples always 0%)", () => {
    const s = computeWriteDna({ resumeUploaded: true, qualifyingProseCount: 0 });
    expect(s.voiceConfidence).toBe(0);
  });
});

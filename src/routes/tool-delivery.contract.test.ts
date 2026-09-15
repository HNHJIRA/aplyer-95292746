/**
 * Delivery-contract tests for the three tools.
 *
 * /demo streams (covered in src/legacy/demo-stream.test.ts).
 * /resume-audit and /resume-match opt into the backend stream through the
 * shared helper (covered in src/lib/tool-stream.test.ts) and fall back to the
 * existing JSON response. These tests lock in the endpoints, the payloads and
 * the absence of any simulated typing effect.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const audit = read("src/routes/resume-audit.tsx");
const match = read("src/routes/resume-match.tsx");
const demo = read("src/legacy/demo-stream.js");

describe("/resume-audit delivery contract", () => {
  it("uses the existing audit endpoint and payload", () => {
    expect(audit).toContain('apiUrl("/api/resume-audit")');
    expect(audit).toContain("body: { resume: text }");
  });

  it("requests progressive delivery through the shared helper", () => {
    expect(audit).toContain("requestToolResult<Audit>");
    expect(audit).toContain("setPreview(p)");
  });

  it("only sets the audit from the final result", () => {
    expect(audit).toContain("mergeStreamedOverallTake(data, streamed)");
    expect(audit).not.toContain("setAudit(preview");
  });

  it("guards against a duplicate run creating a second request", () => {
    expect(audit).toContain("if (runningRef.current) return;");
  });

  it("keeps a safe error path and always stops loading", () => {
    expect(audit).toContain('setError("Network error. Please try again.")');
    expect(audit).toContain("setLoading(false)");
  });
});

describe("/resume-match delivery contract", () => {
  it("uses the existing match endpoint and payload", () => {
    expect(match).toContain('apiUrl("/api/resume-match")');
    expect(match).toContain("body: { resume: text, jobDescription: jd.trim() }");
  });

  it("requests progressive delivery through the shared helper", () => {
    expect(match).toContain("requestToolResult<MatchReport>");
    expect(match).toContain("onPreview: setPreview");
  });

  it("only sets the report from the final result", () => {
    expect(match).toContain("setReport(data)");
    expect(match).not.toContain("setReport(preview");
  });
});

describe("no simulated streaming anywhere", () => {
  it("has no character-by-character typing timers in the tools", () => {
    // The only timers allowed are the rotating loading captions, which existed
    // before this change and are not tied to generated text.
    for (const src of [audit, match]) {
      const timers = src.match(/set(Interval|Timeout)\(/g) ?? [];
      expect(timers.length).toBeLessThanOrEqual(1);
    }
    expect(demo).not.toMatch(/set(Interval|Timeout)\(/);
  });

  it("demo renders preview text only from received chunks", () => {
    expect(demo).toContain("onDelta(preview)");
    expect(demo).toContain("if (!final)");
  });
});

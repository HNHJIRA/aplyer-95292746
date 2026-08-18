import { describe, it, expect, beforeEach, vi } from "vitest";
import { runFraudScan, clearFraudScanCache, type FraudAiScanner } from "@/lib/fraud/scan";

function makeScanner(): FraudAiScanner & { calls: number } {
  const fn = vi.fn(async ({ hostname }: { url: string; hostname: string }) => ({
    status: "needs_scan" as const,
    genuineScore: null,
    label: "Unverified",
    reason: "requires analysis",
    provider: null,
    scanMethod: "ai_fraud_scan" as const,
    aiScanUsed: true,
    trustedAts: false,
    action: "run_fraud_scan" as const,
    hostname,
  }));
  return Object.assign(fn, { get calls() { return fn.mock.calls.length; } }) as never;
}

describe("runFraudScan", () => {
  beforeEach(() => clearFraudScanCache());

  it("short-circuits trusted ATS urls with Safe / 100 and no AI call", async () => {
    const ai = makeScanner();
    for (const url of [
      "https://boards.greenhouse.io/acme/jobs/1",
      "https://jobs.lever.co/acme/abc",
      "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1",
    ]) {
      const r = await runFraudScan(url, { aiScanner: ai });
      expect(r.status).toBe("safe");
      expect(r.genuineScore).toBe(100);
      expect(r.label).toBe("Safe");
      expect(r.aiScanUsed).toBe(false);
      expect(r.scanMethod).toBe("trusted_ats_allowlist");
    }
    expect(ai.calls).toBe(0); // critical AI-bypass acceptance test
  });

  it("routes unknown domains into the fraud pipeline", async () => {
    const ai = makeScanner();
    const r = await runFraudScan("https://unknown-careers.example/jobs/1", { aiScanner: ai });
    expect(ai.calls).toBe(1);
    expect(r.status).toBe("needs_scan");
    expect(r.trustedAts).toBe(false);
    expect(r.action).toBe("run_fraud_scan");
  });

  it("never classifies an unknown domain as a scam", async () => {
    const r = await runFraudScan("https://some-startup.example/careers/1");
    expect(r.status).toBe("needs_scan");
    expect(r.genuineScore).toBeNull();
  });

  it("fails validation safely and never bypasses the scan", async () => {
    const ai = makeScanner();
    for (const bad of ["", "javascript:alert(1)", "file:///etc/passwd", "nope", "https://x.example/" + "a".repeat(3000)]) {
      const r = await runFraudScan(bad, { aiScanner: ai });
      expect(r.status).toBe("invalid");
      expect(r.trustedAts).toBe(false);
      expect(r.genuineScore).toBeNull();
    }
    expect(ai.calls).toBe(0);
  });

  it("caches per normalized url without leaking across jobs", async () => {
    const ai = makeScanner();
    await runFraudScan("https://unknown.example/job/1", { aiScanner: ai });
    await runFraudScan("https://unknown.example/job/1?utm=x", { aiScanner: ai });
    expect(ai.calls).toBe(1);
    await runFraudScan("https://unknown.example/job/2", { aiScanner: ai });
    expect(ai.calls).toBe(2);
  });
});

import { describe, it, expect } from "vitest";
import { isTrustedAtsUrl, getTrustedAtsProvider, parseJobUrl } from "@/lib/fraud/trusted-ats";

describe("trusted ATS allowlist", () => {
  it("trusts root and true subdomains", () => {
    const trusted = [
      "https://greenhouse.io/company/jobs/123",
      "https://boards.greenhouse.io/company/jobs/123",
      "https://job-boards.greenhouse.io/company/jobs/123",
      "https://jobs.lever.co/company/abc",
      "https://lever.co/company/abc",
      "https://company.wd5.myworkdayjobs.com/en-US/careers/job/123",
      "https://BOARDS.GREENHOUSE.IO/x",
      "https://boards.greenhouse.io./x",
    ];
    for (const url of trusted) expect(isTrustedAtsUrl(url), url).toBe(true);
  });

  it("resolves the provider", () => {
    expect(getTrustedAtsProvider("https://boards.greenhouse.io/x")).toBe("greenhouse");
    expect(getTrustedAtsProvider("https://jobs.lever.co/x")).toBe("lever");
    expect(getTrustedAtsProvider("https://c.wd5.myworkdayjobs.com/x")).toBe("workday");
  });

  it("rejects lookalike hostnames", () => {
    const bad = [
      "https://greenhouse.io.fake.com/x",
      "https://fakegreenhouse.io/x",
      "https://greenhouse-login.com/x",
      "https://lever.co.attacker.com/x",
      "https://myworkdayjobs.com.bad-site.net/x",
      "https://notlever.co.evil.io/x",
    ];
    for (const url of bad) expect(isTrustedAtsUrl(url), url).toBe(false);
  });

  it("does not trust ATS domains hidden in query/path/fragment", () => {
    expect(isTrustedAtsUrl("https://malicious.example/?url=https://greenhouse.io/job")).toBe(false);
    expect(isTrustedAtsUrl("https://fake-site.com/?redirect=greenhouse.io")).toBe(false);
    expect(isTrustedAtsUrl("https://fake-site.com/jobs.lever.co/abc")).toBe(false);
    expect(isTrustedAtsUrl("https://fake-site.com/x#boards.greenhouse.io")).toBe(false);
  });

  it("handles invalid input without throwing", () => {
    for (const url of ["", "   ", "not a url", "javascript:alert(1)", "file:///etc/passwd", "ftp://greenhouse.io/x"]) {
      expect(isTrustedAtsUrl(url), url).toBe(false);
    }
    expect(parseJobUrl("https://greenhouse.io/" + "a".repeat(3000)).ok).toBe(false);
    // @ts-expect-error runtime guard for non-string input
    expect(isTrustedAtsUrl(null)).toBe(false);
  });
});

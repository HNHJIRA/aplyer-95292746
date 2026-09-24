/**
 * Step 8 — client UI fixes, Postmark, legal pages.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import AuditResult from "@/components/audit/AuditResult";
import { partialAuditFromJson } from "@/components/audit/types";
import { requestToolResult } from "@/lib/tool-stream";
import { splitSentences, toReadableParagraphs } from "@/lib/text/paragraphs";
import { sendPostmarkEmail, POSTMARK_ENDPOINT } from "@/lib/email/postmark.server";

afterEach(cleanup);
const src = (p: string) => readFileSync(resolve(__dirname, "../../..", p), "utf8");

function sse(chunks: string[]): Response {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream" },
    body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true, value: undefined }), cancel: async () => {} }) },
  } as unknown as Response;
}

describe("9. Resume Audit stream stays visible in the result layout", () => {
  it("delivers structured partial audits before the final result", async () => {
    const partials: unknown[] = [];
    const final = { overallTakePoints: ["Strong."], redFlags: [], strengths: [], topPriority: "Do X." };
    const got = await requestToolResult({
      url: "/api/resume-audit",
      body: {},
      fetchImpl: (async () =>
        sse([
          `event: partial\ndata: ${JSON.stringify({ audit: { overallTakePoints: ["Stro"] } })}\n\n`,
          `event: partial\ndata: ${JSON.stringify({ audit: { overallTakePoints: ["Strong."], redFlags: [{ flag: "Gap" }] } })}\n\n`,
          `event: final\ndata: ${JSON.stringify(final)}\n\n`,
        ])) as never,
      onPartial: (p) => partials.push(p),
    });
    expect(partials).toHaveLength(2);
    expect(got).toEqual(final);
  });

  it("normalises partial JSON into the rendered audit shape", () => {
    const a = partialAuditFromJson({ overallTakePoints: ["One", ""], redFlags: [{ flag: "Gap", whyPoints: ["w"] }, {}], strengths: [{ point: "S" }] });
    expect(a).toEqual({
      overallTakePoints: ["One"],
      redFlags: [{ flag: "Gap", whyPoints: ["w"], fixPoints: [], employer: null }],
      strengths: [{ point: "S" }],
    });
    expect(partialAuditFromJson({})).toBeNull();
  });

  it("the page renders streamed sections with AuditResult and no standalone preview paragraph", () => {
    const page = src("src/routes/resume-audit.tsx");
    expect(page).not.toMatch(/audit-preview/);
    expect(page).toMatch(/onPartial/);
    expect(page).toMatch(/<AuditResult audit=\{shown\} \/>/);
    expect(src("src/routes/api/resume-audit.ts")).toMatch(/send\("partial"/);
  });
});

describe("10. duplicate Top Priority box removed", () => {
  it("renders Top Priority once and no grey closing box", () => {
    render(<AuditResult audit={{ topPriority: "Break up the tenure.", closing: "Break up the tenure." }} />);
    expect(screen.getAllByText("Break up the tenure.")).toHaveLength(1);
    expect(screen.queryByTestId("closing")).toBeNull();
    expect(screen.getByTestId("top-priority")).toBeTruthy();
  });
  it("a legacy payload with only `closing` still shows it in Top Priority", () => {
    render(<AuditResult audit={{ closing: "Legacy priority." }} />);
    expect(screen.getByTestId("top-priority").textContent).toContain("Legacy priority.");
  });
});

describe("11. Resume Match paragraph splitting", () => {
  const summary =
    "Sarah Chen's resume is an exceptionally strong match for this Director of Operations role. She currently holds the same title at W.W. Grainger, managing teams of 45 across Chicago and Detroit. Her 12 years of experience exceeds the 8-year minimum. She holds a Lean Six Sigma Black Belt and an MBA. Her hands-on experience with SAP directly aligns with the JD. The only minor gaps are procurement and location. To strengthen the application, she should reference procurement oversight.";

  it("splits after about three sentences, preserving every word", () => {
    const paras = toReadableParagraphs(summary);
    expect(paras.length).toBeGreaterThan(1);
    expect(paras.join(" ")).toBe(summary);
    for (const p of paras) expect(splitSentences(p).length).toBeLessThanOrEqual(4);
  });
  it("does not split on initials like W.W. or abbreviations", () => {
    expect(splitSentences("She works at W.W. Grainger today. Dr. Smith agreed.")).toEqual([
      "She works at W.W. Grainger today.",
      "Dr. Smith agreed.",
    ]);
  });
  it("keeps short text whole and preserves existing paragraph breaks", () => {
    expect(toReadableParagraphs("One. Two. Three.")).toEqual(["One. Two. Three."]);
    expect(toReadableParagraphs("A one. A two.\n\nB one.")).toEqual(["A one. A two.", "B one."]);
  });
  it("never leaves a one-sentence tail paragraph", () => {
    const paras = toReadableParagraphs("Aa one. Bb two. Cc three. Dd four. Ee five. Ff six. Gg seven.");
    expect(paras.map((p) => splitSentences(p).length)).toEqual([3, 4]);
  });
});

describe("12-15. demo resume display is plain text", () => {
  const html = src("src/legacy/demo.html");
  it("routes PDFs by content (renamed PDFs included) and other files through the safe reader", () => {
    expect(html).toMatch(/bytes\[0\] === 0x25 && bytes\[1\] === 0x50/);
    expect(html).toMatch(/extractResumeFromBytes\(bytes\)/);
  });
  it("writes resume text into a textarea value, never innerHTML", () => {
    expect(html).toMatch(/getElementById\('resumeText'\)\.value = text/);
    expect(html).not.toMatch(/resumeText'\)\.innerHTML/);
  });
  it("unreadable files show a clear message and ask for pasted text (no alert)", () => {
    expect(html).toMatch(/Please paste your resume text into the box instead/);
    expect(html).not.toMatch(/alert\('Could not read/);
  });
});

describe("16-17. Postmark", () => {
  const saved = process.env.POSTMARK_SERVER_TOKEN;
  beforeEach(() => {
    delete process.env.POSTMARK_SERVER_TOKEN;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.POSTMARK_SERVER_TOKEN;
    else process.env.POSTMARK_SERVER_TOKEN = saved;
  });
  const msg = { from: "Aplyer <dustin@aplyer.ai>", to: "a@b.co", subject: "s", html: "<p>h</p>", text: "h" };

  it("missing token: no request, reported as skipped, never as sent", async () => {
    const f = vi.fn();
    const r = await sendPostmarkEmail(msg, f as never);
    expect(f).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, status: "skipped", errorCode: "missing_postmark_token" });
  });

  it("uses the documented endpoint and header; token stays in the header only", async () => {
    process.env.POSTMARK_SERVER_TOKEN = "test-token";
    const f = vi.fn(async () => new Response(JSON.stringify({ ErrorCode: 0, MessageID: "m1" }), { status: 200 }));
    const r = await sendPostmarkEmail(msg, f as never);
    expect(r).toMatchObject({ ok: true, status: "sent", messageId: "m1" });
    const [url, init] = (f.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe(POSTMARK_ENDPOINT);
    expect((init.headers as Record<string, string>)["X-Postmark-Server-Token"]).toBe("test-token");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ From: msg.from, To: msg.to, MessageStream: "outbound" });
    expect(JSON.stringify(body)).not.toContain("test-token");
    expect(body.TrackOpens).toBeUndefined();
  });

  it("a Postmark error is a failure, not a delivery", async () => {
    process.env.POSTMARK_SERVER_TOKEN = "t";
    const f = vi.fn(async () => new Response(JSON.stringify({ ErrorCode: 300 }), { status: 422 }));
    expect(await sendPostmarkEmail(msg, f as never)).toMatchObject({ ok: false, status: "failed", errorCode: "postmark_300" });
  });

  it("the token is only read in server-only modules", () => {
    expect(src("src/lib/email/postmark.server.ts")).toMatch(/process\.env\[POSTMARK_TOKEN_ENV\]/);
    expect(src("src/legacy/demo.html")).not.toMatch(/POSTMARK/);
  });
});

describe("18-19. legal pages", () => {
  it("serve the client's documents verbatim at /privacy and /terms", async () => {
    for (const name of ["privacy", "terms"]) {
      const supplied = src(`src/legacy/${name}.html`);
      const route = src(`src/routes/${name}.ts`);
      expect(route).toMatch(new RegExp(`createFileRoute\\("/${name}"\\)`));
      expect(route).toMatch(new RegExp(`@/legacy/${name}\\.html\\?raw`));
      expect(src(`src/routes/${name}[.]html.ts`)).toMatch(new RegExp(`"/${name}\\.html"`));
      expect(supplied.length).toBeGreaterThan(5000);
    }
    expect(src("src/legacy/privacy.html")).toMatch(/<title>Privacy Policy \| Aplyer\.ai<\/title>/);
  });
  it("footers and sign-in link to both pages", () => {
    for (const p of ["src/routes/resume-audit.tsx", "src/routes/resume-match.tsx", "src/legacy/index.html", "src/legacy/demo.html", "src/routes/auth.tsx"]) {
      const s = src(p);
      expect(s).toMatch(/href="\/privacy"/);
      expect(s).toMatch(/href="\/terms"/);
    }
  });
});

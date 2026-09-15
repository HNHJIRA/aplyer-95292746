// Backend streaming tests for the two Tools endpoints:
//   POST /api/resume-audit
//   POST /api/resume-match
// Both keep their existing JSON contract and add opt-in SSE delivery.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleResumeAudit } from "@/routes/api/resume-audit";
import { handleResumeMatch } from "@/routes/api/resume-match";
import { wantsStream } from "@/lib/ai/anthropic-stream.server";

const RESUME = "Jane Doe, Senior Engineer. ".repeat(10) + "Led payments platform at Acme from 2019 to 2023.";
const JD = "We are hiring a senior backend engineer with payments and Go experience. ".repeat(2);

const AUDIT_JSON = {
  overallTakePoints: ["Strong payments background.", "Impact is under-quantified."],
  redFlags: [
    { flag: "No metrics", whyPoints: ["Scope is unclear."], fixPoints: ["Add numbers."], employer: "Acme" },
    { flag: "Dense bullets", whyPoints: ["Hard to scan."], fixPoints: ["Split them."], employer: null },
    { flag: "Generic summary", whyPoints: ["Says little."], fixPoints: ["Name the domain."], employer: null },
  ],
  strengths: [{ point: "Owned a payments platform" }, { point: "Long tenure at one employer" }, { point: "Clear titles" }],
  topPriority: "Quantify the payments work with revenue or volume numbers.",
};

const MATCH_JSON = {
  matchScore: 72,
  keywordsPresent: ["payments", "backend"],
  keywordsMissing: ["Go", "Kubernetes"],
  sectionSuggestions: ["Add a Go project to the skills section.", "Lead with payments scale."],
  summary: "The resume covers payments depth. It misses Go. Overall a close fit. Add the missing stack. Then reapply.",
};

/** Splits a JSON document into small Anthropic text deltas. */
function sseFromJson(obj: unknown, chunkSize = 24): string {
  const text = JSON.stringify(obj);
  const frames: string[] = [`event: message_start\ndata: {"type":"message_start"}\n\n`];
  for (let i = 0; i < text.length; i += chunkSize) {
    frames.push(
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: text.slice(i, i + chunkSize) },
      })}\n\n`,
    );
  }
  frames.push(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
  return frames.join("");
}

function streamBody(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const part of text.match(/[\s\S]{1,40}/g) ?? []) c.enqueue(enc.encode(part));
      c.close();
    },
  });
}

let bodies: Array<Record<string, unknown>> = [];

function mockProvider(makeResponse: (body: Record<string, unknown>) => Response) {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    return makeResponse(body);
  });
}

function okProvider(json: unknown) {
  mockProvider((body) =>
    body.stream === true
      ? new Response(streamBody(sseFromJson(json)), { status: 200 })
      : new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(json) }] }), { status: 200 }),
  );
}

async function readSse(res: Response): Promise<Array<{ event: string; data: any }>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((b) => b.trim())
    .map((block) => {
      const event = /event: (.*)/.exec(block)?.[1]?.trim() ?? "message";
      const data = JSON.parse(/data: (.*)/.exec(block)?.[1] ?? "null");
      return { event, data };
    });
}

const auditReq = (qs = "", headers: Record<string, string> = {}) =>
  new Request(`https://x.dev/api/resume-audit${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ resume: RESUME }),
  });

const matchReq = (qs = "", headers: Record<string, string> = {}) =>
  new Request(`https://x.dev/api/resume-match${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ resume: RESUME, jobDescription: JD }),
  });

beforeEach(() => {
  bodies = [];
  process.env.ANTHROPIC_API_KEY = "test-key";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("opt-in detection", () => {
  it("only streams when explicitly requested", () => {
    expect(wantsStream(new Request("https://x.dev/api/resume-audit", { method: "POST" }))).toBe(false);
    expect(wantsStream(new Request("https://x.dev/api/resume-audit?stream=1", { method: "POST" }))).toBe(true);
    expect(
      wantsStream(
        new Request("https://x.dev/api/resume-match", { method: "POST", headers: { accept: "text/event-stream" } }),
      ),
    ).toBe(true);
  });
});

describe("resume audit streaming", () => {
  it("asks the provider to stream and returns SSE headers", async () => {
    okProvider(AUDIT_JSON);
    const res = await handleResumeAudit(auditReq("?stream=1"));
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    await res.text();
    expect(bodies[0]!.stream).toBe(true);
  });

  it("emits open, ordered drafts, a validated final and done", async () => {
    okProvider(AUDIT_JSON);
    const events = await readSse(await handleResumeAudit(auditReq("?stream=1")));
    expect(events[0]!.event).toBe("open");
    expect(events[events.length - 1]!.event).toBe("done");

    const draftEvents = events.filter((e) => e.event === "draft");
    expect(draftEvents.length).toBeGreaterThan(1);
    // Replays exactly how the client builds the preview: chunks append, a
    // `replace` frame resets it to the validated text.
    let preview = "";
    for (const e of draftEvents) {
      preview = e.data.replace ? String(e.data.text) : preview + String(e.data.text);
    }
    expect(preview.startsWith("Strong payments background.")).toBe(true);
    // The last frame must equal the overall take of the final result.
    expect(draftEvents[draftEvents.length - 1]!.data.replace).toBe(true);

    const final = events.find((e) => e.event === "final")!;
    expect(final.data.topPriority).toContain("Quantify");
    expect(final.data.redFlags).toHaveLength(3);
    expect(final.data.strengths).toHaveLength(3);
    // the final event arrives after every draft
    expect(events.indexOf(final)).toBeGreaterThan(events.findIndex((e) => e.event === "draft"));
  });

  it("never leaks prompts, models, resume text or provider metadata", async () => {
    okProvider(AUDIT_JSON);
    const raw = await (await handleResumeAudit(auditReq("?stream=1"))).text();
    expect(raw).not.toContain("claude");
    expect(raw).not.toContain("C_RESUME_AUDIT");
    expect(raw).not.toContain("Jane Doe, Senior Engineer.");
    expect(raw).not.toContain("message_stop");
    expect(raw).not.toContain("anthropic");
  });

  it("sends a safe error and no final when the provider fails", async () => {
    mockProvider(() => new Response("rate limited", { status: 429 }));
    const events = await readSse(await handleResumeAudit(auditReq("?stream=1")));
    expect(events.some((e) => e.event === "final")).toBe(false);
    const err = events.find((e) => e.event === "error")!;
    expect(err.data.error).toBe("We could not complete the audit. Please try again.");
    expect(JSON.stringify(err.data)).not.toContain("rate limited");
    expect(events[events.length - 1]!.event).toBe("done");
  });

  it("sends a safe error when the stream is malformed or empty", async () => {
    mockProvider((body) =>
      body.stream === true
        ? new Response(streamBody(`data: {broken\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`), {
            status: 200,
          })
        : new Response(JSON.stringify({ content: [] }), { status: 200 }),
    );
    const events = await readSse(await handleResumeAudit(auditReq("?stream=1")));
    expect(events.some((e) => e.event === "final")).toBe(false);
    expect(events.some((e) => e.event === "error")).toBe(true);
  });

  it("still enforces validation: invalid model output never becomes a final", async () => {
    okProvider({ overallTakePoints: [], redFlags: [] });
    const events = await readSse(await handleResumeAudit(auditReq("?stream=1")));
    expect(events.some((e) => e.event === "final")).toBe(false);
    expect(events.find((e) => e.event === "error")!.data.code).toBe("invalid_output");
    // one strict correction retry, exactly as before
    expect(bodies).toHaveLength(2);
  });

  it("keeps the plain JSON response unchanged", async () => {
    okProvider(AUDIT_JSON);
    const res = await handleResumeAudit(auditReq());
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const json = (await res.json()) as any;
    expect(json.topPriority).toContain("Quantify");
    expect(json.overallTake).toContain("Strong payments background.");
    expect(json.redFlags[0].issue).toBe(json.redFlags[0].flag); // legacy alias
    expect(bodies[0]!.stream).toBeUndefined();
  });

  it("rejects a too-short resume before calling the provider", async () => {
    okProvider(AUDIT_JSON);
    const res = await handleResumeAudit(
      new Request("https://x.dev/api/resume-audit?stream=1", { method: "POST", body: JSON.stringify({ resume: "hi" }) }),
    );
    expect(res.status).toBe(400);
    expect(bodies).toHaveLength(0);
  });
});

describe("resume match streaming", () => {
  it("asks the provider to stream and returns SSE headers", async () => {
    okProvider(MATCH_JSON);
    const res = await handleResumeMatch(matchReq("", { accept: "text/event-stream" }));
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    await res.text();
    expect(bodies[0]!.stream).toBe(true);
  });

  it("emits open, ordered summary drafts, a validated final and done", async () => {
    okProvider(MATCH_JSON);
    const events = await readSse(await handleResumeMatch(matchReq("?stream=1")));
    expect(events[0]!.event).toBe("open");
    expect(events[events.length - 1]!.event).toBe("done");

    const drafts = events.filter((e) => e.event === "draft").map((e) => e.data.text);
    expect(drafts.length).toBeGreaterThan(1);
    const preview = drafts.join("");
    expect(MATCH_JSON.summary.startsWith(preview)).toBe(true);
    // envelope fields are never previewed
    expect(preview).not.toContain("matchScore");
    expect(preview).not.toContain("keywordsMissing");

    const final = events.find((e) => e.event === "final")!;
    expect(final.data.matchScore).toBe(72);
    expect(final.data.keywordsMissing).toEqual(["Go", "Kubernetes"]);
    expect(final.data.priorityImprovements).toHaveLength(2); // legacy alias preserved
  });

  it("sends a safe error and no final when the provider fails", async () => {
    mockProvider(() => new Response("overloaded", { status: 529 }));
    const events = await readSse(await handleResumeMatch(matchReq("?stream=1")));
    expect(events.some((e) => e.event === "final")).toBe(false);
    expect(events.find((e) => e.event === "error")!.data.error).toBe(
      "We could not score this resume. Please try again.",
    );
  });

  it("sends a safe error when the stream is malformed", async () => {
    mockProvider(() => new Response(streamBody(`data: {broken\n\n`), { status: 200 }));
    const events = await readSse(await handleResumeMatch(matchReq("?stream=1")));
    expect(events.some((e) => e.event === "final")).toBe(false);
    expect(events.some((e) => e.event === "error")).toBe(true);
  });

  it("still enforces validation: non-JSON output never becomes a final", async () => {
    mockProvider(() =>
      new Response(
        streamBody(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            delta: { type: "text_delta", text: "sorry, no JSON here" },
          })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`,
        ),
        { status: 200 },
      ),
    );
    const events = await readSse(await handleResumeMatch(matchReq("?stream=1")));
    expect(events.some((e) => e.event === "final")).toBe(false);
    expect(["invalid_output", "provider_error"]).toContain(events.find((e) => e.event === "error")!.data.code);
  });

  it("keeps the plain JSON response unchanged", async () => {
    okProvider(MATCH_JSON);
    const res = await handleResumeMatch(matchReq());
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const json = (await res.json()) as any;
    expect(json.matchScore).toBe(72);
    expect(json.jobDescriptionMatch).toBe(72);
    expect(json.suggestions).toEqual(MATCH_JSON.sectionSuggestions);
    expect(bodies[0]!.stream).toBeUndefined();
  });

  it("rejects a too-short job description before calling the provider", async () => {
    okProvider(MATCH_JSON);
    const res = await handleResumeMatch(
      new Request("https://x.dev/api/resume-match?stream=1", {
        method: "POST",
        body: JSON.stringify({ resume: RESUME, jobDescription: "no" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(bodies).toHaveLength(0);
  });

  it("survives a client disconnect without throwing", async () => {
    okProvider(MATCH_JSON);
    const res = await handleResumeMatch(matchReq("?stream=1"));
    await res.body!.cancel();
    await new Promise((r) => setTimeout(r, 20));
  });
});

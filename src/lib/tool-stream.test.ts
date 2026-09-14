import { describe, it, expect, vi } from "vitest";
import { requestToolResult, ToolRequestError, GENERIC_TOOL_ERROR, parseFrame } from "./tool-stream";

function sseResponse(chunks: string[], ok = true): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = {
    getReader() {
      return {
        read: async () =>
          i < chunks.length
            ? { done: false, value: encoder.encode(chunks[i++]) }
            : { done: true, value: undefined },
      };
    },
  };
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: () => "text/event-stream" },
    body,
  } as unknown as Response;
}

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: () => "application/json" },
    body: null,
    json: async () => data,
  } as unknown as Response;
}

const AUDIT_FINAL = {
  overallTake: "Solid core story.",
  overallTakePoints: ["Solid core story."],
  redFlags: [{ flag: "No structured sections", whyPoints: ["ATS"], fixPoints: ["Add sections"] }],
  strengths: [{ point: "Clear progression" }],
};

const MATCH_FINAL = {
  matchScore: 82,
  overallMatch: 82,
  keywordsPresent: ["React"],
  keywordsMissing: ["Kubernetes"],
  sectionSuggestions: ["Add Kubernetes"],
};

const auditStream = (final: unknown = AUDIT_FINAL) => [
  "event: open\ndata: {}\n\n",
  'event: draft\ndata: {"text":"You have "}\n\n',
  'event: draft\ndata: {"text":"a solid core story."}\n\n',
  `event: final\ndata: ${JSON.stringify(final)}\n\n`,
  "event: done\ndata: {}\n\n",
];

const matchStream = () => [
  "event: open\ndata: {}\n\n",
  'event: draft\ndata: {"summary":"Strong overlap "}\n\n',
  'event: draft\ndata: {"summary":"with this role."}\n\n',
  `event: final\ndata: ${JSON.stringify(MATCH_FINAL)}\n\n`,
  "event: done\ndata: {}\n\n",
];

describe.each([
  { name: "resume-audit", url: "https://api.test/api/resume-audit", chunks: auditStream(), final: AUDIT_FINAL, previews: ["You have ", "You have a solid core story."] },
  { name: "resume-match", url: "https://api.test/api/resume-match", chunks: matchStream(), final: MATCH_FINAL, previews: ["Strong overlap ", "Strong overlap with this role."] },
])("$name streaming", ({ url, chunks, final, previews }) => {
  it("opts into streaming on the existing endpoint", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse(chunks));
    await requestToolResult({ url, body: { resume: "x" }, fetchImpl: f as unknown as typeof fetch });
    const [calledUrl, init] = f.mock.calls[0];
    expect(calledUrl).toBe(`${url}?stream=1`);
    expect((init.headers as Record<string, string>).Accept).toBe("text/event-stream");
    expect(init.method).toBe("POST");
  });

  it("handles the open event and shows drafts progressively without duplication", async () => {
    const seen: string[] = [];
    const f = vi.fn().mockResolvedValue(sseResponse(chunks));
    await requestToolResult({ url, body: {}, onPreview: (p) => seen.push(p), fetchImpl: f as unknown as typeof fetch });
    expect(seen).toEqual(previews);
  });

  it("produces the complete final payload", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse(chunks));
    const result = await requestToolResult({ url, body: {}, fetchImpl: f as unknown as typeof fetch });
    expect(result).toEqual(final);
  });

  it("never treats a draft as the final result", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse(chunks.slice(0, 3)));
    await expect(
      requestToolResult({ url, body: {}, fetchImpl: f as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(ToolRequestError);
  });

  it("handles an interrupted stream", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "text/event-stream" },
      body: {
        getReader: () => ({
          read: async () => {
            throw new Error("network");
          },
        }),
      },
    } as unknown as Response);
    await expect(
      requestToolResult({ url, body: {}, fetchImpl: f as unknown as typeof fetch }),
    ).rejects.toThrow(GENERIC_TOOL_ERROR);
  });

  it("handles an error event with a safe message", async () => {
    const f = vi.fn().mockResolvedValue(
      sseResponse(["event: open\ndata: {}\n\n", 'event: error\ndata: {"error":"We could not complete this. Please try again."}\n\n']),
    );
    await expect(
      requestToolResult({ url, body: {}, fetchImpl: f as unknown as typeof fetch }),
    ).rejects.toThrow("We could not complete this. Please try again.");
  });

  it("falls back to the plain JSON response, once", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse(final));
    const result = await requestToolResult({ url, body: {}, fetchImpl: f as unknown as typeof fetch });
    expect(result).toEqual(final);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("falls back once when the streaming request itself fails", async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(jsonResponse(final));
    const result = await requestToolResult({ url, body: {}, fetchImpl: f as unknown as typeof fetch });
    expect(result).toEqual(final);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[1][0]).toBe(url);
  });

  it("keeps the existing result structure untouched", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse(chunks));
    const result = (await requestToolResult({ url, body: {}, fetchImpl: f as unknown as typeof fetch })) as Record<string, unknown>;
    for (const key of Object.keys(final)) expect(result[key]).toEqual((final as Record<string, unknown>)[key]);
  });
});

describe("SSE parsing robustness", () => {
  it("buffers SSE frames split across network chunks", async () => {
    const seen: string[] = [];
    const f = vi.fn().mockResolvedValue(
      sseResponse([
        "event: dra",
        'ft\ndata: {"text":"Hel',
        'lo "}\n\nevent: draft\ndata: {"text":"world"}\n',
        `\nevent: final\ndata: ${JSON.stringify(AUDIT_FINAL)}\n\n`,
      ]),
    );
    const result = await requestToolResult({
      url: "https://api.test/api/resume-audit",
      body: {},
      onPreview: (p) => seen.push(p),
      fetchImpl: f as unknown as typeof fetch,
    });
    expect(seen).toEqual(["Hello ", "Hello world"]);
    expect(result).toEqual(AUDIT_FINAL);
  });

  it("ignores comments, unknown events and malformed frames", async () => {
    const seen: string[] = [];
    const f = vi.fn().mockResolvedValue(
      sseResponse([
        ": keep-alive\n\n",
        "event: ping\ndata: {}\n\n",
        "event: draft\ndata: {broken json\n\n",
        'event: draft\ndata: {"text":"ok"}\n\n',
        `event: final\ndata: ${JSON.stringify(AUDIT_FINAL)}\n\n`,
      ]),
    );
    const result = await requestToolResult({
      url: "https://api.test/api/resume-audit",
      body: {},
      onPreview: (p) => seen.push(p),
      fetchImpl: f as unknown as typeof fetch,
    });
    expect(seen).toEqual(["ok"]);
    expect(result).toEqual(AUDIT_FINAL);
  });

  it("rejects an empty final payload instead of loading forever", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse(auditStream({})));
    await expect(
      requestToolResult({ url: "https://api.test/api/resume-audit", body: {}, fetchImpl: f as unknown as typeof fetch }),
    ).rejects.toThrow(GENERIC_TOOL_ERROR);
  });

  it("clears the preview when the stream fails", async () => {
    const seen: string[] = [];
    const f = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      requestToolResult({
        url: "https://api.test/api/resume-audit",
        body: {},
        onPreview: (p) => seen.push(p),
        fetchImpl: f as unknown as typeof fetch,
      }),
    ).rejects.toBeTruthy();
    expect(seen[seen.length - 1]).toBe("");
  });

  it("surfaces a safe message for non-ok JSON responses", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ error: "Please try again." }, false));
    await expect(
      requestToolResult({ url: "https://api.test/api/resume-match", body: {}, fetchImpl: f as unknown as typeof fetch }),
    ).rejects.toThrow("Please try again.");
  });

  it("parses frame fields", () => {
    expect(parseFrame("event: draft\ndata: hi")).toEqual({ event: "draft", data: "hi" });
  });
});

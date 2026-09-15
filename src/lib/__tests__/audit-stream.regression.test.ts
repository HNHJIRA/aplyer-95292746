import { describe, it, expect, vi } from "vitest";
import { requestToolResult, ToolRequestError } from "../tool-stream";
import { mergeStreamedOverallTake, overallTakeList } from "@/components/audit/types";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream" },
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: encoder.encode(chunks[i++]) }
            : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    body: null,
    json: async () => data,
  } as unknown as Response;
}

const FINAL = {
  overallTake: "You have a solid core story.",
  overallTakePoints: ["You have a solid core story."],
  redFlags: [{ flag: "Passive verbs", whyPoints: ["Hides ownership"], fixPoints: ["Rewrite"] }],
  strengths: [{ point: "Clear progression" }],
  topPriority: "Quantify your impact.",
};

const stream = (extra: string[] = []) => [
  "event: open\ndata: {}\n\n",
  'event: draft\ndata: {"text":"You have "}\n\n',
  'event: draft\ndata: {"text":"a solid core story."}\n\n',
  ...extra,
  `event: final\ndata: ${JSON.stringify(FINAL)}\n\n`,
  "event: done\ndata: {}\n\n",
];

describe("resume audit streaming regression", () => {
  it("starts exactly one stream for one run", async () => {
    const fetchImpl = vi.fn(async () => sseResponse(stream()));
    await requestToolResult({ url: "/api/resume-audit", body: {}, fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls as unknown as unknown[][])[0]![0])).toContain("stream=1");
  });

  it("appends draft chunks in order without duplication", async () => {
    const seen: string[] = [];
    await requestToolResult({
      url: "/api/resume-audit",
      body: {},
      onPreview: (p) => seen.push(p),
      fetchImpl: (async () => sseResponse(stream())) as never,
    });
    expect(seen).toEqual(["You have ", "You have a solid core story."]);
  });

  it("text shown during streaming also appears in the final result", async () => {
    let shown = "";
    const audit = await requestToolResult<typeof FINAL>({
      url: "/api/resume-audit",
      body: {},
      onPreview: (p) => (shown = p),
      fetchImpl: (async () => sseResponse(stream())) as never,
    });
    const merged = mergeStreamedOverallTake(audit, shown);
    expect(overallTakeList(merged).points).toEqual(["You have a solid core story."]);
    expect(merged.overallTake).toBe(shown);
  });

  it("a replace draft resets the preview to the corrected text", async () => {
    let shown = "";
    await requestToolResult({
      url: "/api/resume-audit",
      body: {},
      onPreview: (p) => (shown = p),
      fetchImpl: (async () =>
        sseResponse(
          stream(['event: draft\ndata: {"text":"You have a solid core story.","replace":true}\n\n']),
        )) as never,
    });
    expect(shown).toBe("You have a solid core story.");
  });

  it("keeps the final result when done arrives afterwards", async () => {
    const audit = await requestToolResult<typeof FINAL>({
      url: "/api/resume-audit",
      body: {},
      fetchImpl: (async () => sseResponse(stream())) as never,
    });
    expect(audit.redFlags).toHaveLength(1);
    expect(audit.topPriority).toBe("Quantify your impact.");
  });

  it("discards the draft when the stream fails before final", async () => {
    await expect(
      requestToolResult({
        url: "/api/resume-audit",
        body: {},
        fetchImpl: (async () =>
          sseResponse([
            'event: draft\ndata: {"text":"partial"}\n\n',
            'event: error\ndata: {"error":"We could not complete the audit. Please try again."}\n\n',
            "event: done\ndata: {}\n\n",
          ])) as never,
      }),
    ).rejects.toBeInstanceOf(ToolRequestError);
  });

  it("falls back to JSON when the backend does not stream", async () => {
    const audit = await requestToolResult<typeof FINAL>({
      url: "/api/resume-audit",
      body: {},
      fetchImpl: (async () => jsonResponse(FINAL)) as never,
    });
    expect(audit.overallTake).toBe(FINAL.overallTake);
  });

  it("never overwrites a final overall take with streamed text", () => {
    const merged = mergeStreamedOverallTake(FINAL, "stale preview");
    expect(merged.overallTake).toBe(FINAL.overallTake);
  });
});

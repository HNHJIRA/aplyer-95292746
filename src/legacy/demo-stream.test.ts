import { describe, it, expect, vi, beforeEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import api from "./demo-stream.js";

const { getAnswer, streamAnswer, GENERIC_ERROR } = api as any;

const BASE = "https://aplyer.devssh.xyz";

function sseResponse(frames: string[], opts: { fail?: boolean } = {}) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    headers: { get: () => "text/event-stream" },
    body: {
      getReader: () => ({
        read: async () => {
          if (i < frames.length) {
            return { done: false, value: encoder.encode(frames[i++]) };
          }
          if (opts.fail) throw new Error("network");
          return { done: true, value: undefined };
        },
      }),
    },
  };
}

function jsonResponse(body: any, ok = true) {
  return {
    ok,
    headers: { get: () => "application/json" },
    json: async () => body,
  };
}

const input = { resume: "r", jobDescription: "j", question: "q" };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
});

describe("demo answer streaming", () => {
  it("requests the streaming endpoint with ?stream=1", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(["event: final\ndata: {\"answer\":\"A\"}\n\n"]),
    );
    await getAnswer({ ...input, fetch: fetchMock });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE}/api/public/generate-answer?stream=1`,
    );
  });

  it("sends the event-stream Accept header", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(["event: final\ndata: {\"answer\":\"A\"}\n\n"]),
    );
    await getAnswer({ ...input, fetch: fetchMock });
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });

  it("handles the open event without rendering anything", async () => {
    const onDelta = vi.fn();
    fetchMock.mockResolvedValue(
      sseResponse([
        "event: open\ndata: {}\n\n",
        "event: final\ndata: {\"answer\":\"A\"}\n\n",
      ]),
    );
    await getAnswer({ ...input, fetch: fetchMock, onDelta });
    expect(onDelta).not.toHaveBeenCalled();
  });

  it("renders the first delta", async () => {
    const onDelta = vi.fn();
    fetchMock.mockResolvedValue(
      sseResponse([
        "event: delta\ndata: {\"text\":\"Led a migration \"}\n\n",
        "event: final\ndata: {\"answer\":\"A\"}\n\n",
      ]),
    );
    await getAnswer({ ...input, fetch: fetchMock, onDelta });
    expect(onDelta.mock.calls[0][0]).toBe("Led a migration ");
  });

  it("appends multiple deltas in order without duplication", async () => {
    const onDelta = vi.fn();
    fetchMock.mockResolvedValue(
      sseResponse([
        "event: draft\ndata: {\"text\":\"Led a migration \"}\n\nevent: delta\ndata: {\"text\":\"from AWS \"}\n\n",
        "event: delta\ndata: {\"text\":\"to GCP.\"}\n\nevent: final\ndata: {\"answer\":\"Led a migration from AWS to GCP.\"}\n\nevent: done\ndata: {}\n\n",
      ]),
    );
    const answer = await getAnswer({ ...input, fetch: fetchMock, onDelta });
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual([
      "Led a migration ",
      "Led a migration from AWS ",
      "Led a migration from AWS to GCP.",
    ]);
    expect(answer).toBe("Led a migration from AWS to GCP.");
  });

  it("final event supersedes the preview", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        "event: delta\ndata: {\"text\":\"draft text\"}\n\n",
        "event: final\ndata: {\"answer\":\"validated text\"}\n\n",
      ]),
    );
    expect(await getAnswer({ ...input, fetch: fetchMock })).toBe("validated text");
  });

  it("does not resolve when the stream ends before final", async () => {
    const onDelta = vi.fn();
    fetchMock.mockResolvedValue(
      sseResponse(["event: delta\ndata: {\"text\":\"partial\"}\n\n"]),
    );
    await expect(
      getAnswer({ ...input, fetch: fetchMock, onDelta }),
    ).rejects.toThrow(GENERIC_ERROR);
    expect(onDelta).toHaveBeenCalledWith("partial");
  });

  it("treats an empty final answer as incomplete", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(["event: final\ndata: {\"answer\":\"   \"}\n\n"]),
    );
    await expect(getAnswer({ ...input, fetch: fetchMock })).rejects.toThrow(
      GENERIC_ERROR,
    );
  });

  it("handles a stream error event with a safe message", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        "event: delta\ndata: {\"text\":\"x\"}\n\n",
        "event: error\ndata: {\"code\":\"invalid_output\",\"model\":\"secret\"}\n\n",
      ]),
    );
    await expect(getAnswer({ ...input, fetch: fetchMock })).rejects.toThrow(
      GENERIC_ERROR,
    );
  });

  it("propagates network interruptions", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(["event: delta\ndata: {\"text\":\"x\"}\n\n"], { fail: true }),
    );
    await expect(getAnswer({ ...input, fetch: fetchMock })).rejects.toThrow();
  });

  it("ignores malformed events safely", async () => {
    const onDelta = vi.fn();
    fetchMock.mockResolvedValue(
      sseResponse([
        "event: delta\ndata: {not json\n\n",
        ": comment only\n\n",
        "event: delta\ndata: {\"text\":\"ok\"}\n\n",
        "event: final\ndata: {\"answer\":\"ok\"}\n\n",
      ]),
    );
    expect(await getAnswer({ ...input, fetch: fetchMock, onDelta })).toBe("ok");
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual(["ok"]);
  });

  it("falls back to the existing JSON request once when streaming is unavailable", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "nope" }, false))
      .mockResolvedValueOnce(jsonResponse({ answer: "json answer" }));
    const answer = await getAnswer({ ...input, fetch: fetchMock });
    expect(answer).toBe("json answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/api/public/demo`);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(input);
  });

  it("keeps existing JSON error behaviour", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({ error: "Rate limited" }, false));
    await expect(getAnswer({ ...input, fetch: fetchMock })).rejects.toThrow(
      "Rate limited",
    );
  });

  it("streamAnswer flags an unavailable stream instead of falling back itself", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ answer: "x" }));
    await expect(
      streamAnswer({ ...input, fetch: fetchMock }),
    ).rejects.toMatchObject({ streamUnavailable: true });
  });
});

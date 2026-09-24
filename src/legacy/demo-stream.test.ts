import { describe, it, expect, vi, beforeEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import api from "./demo-stream.js";

const { getAnswer, streamAnswer, GENERIC_ERROR } = api as any;

const BASE = "";

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
      `${BASE}/api/public/demo?stream=1`,
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

  it("falls back to the JSON request once when the stream has no body", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, headers: { get: () => "text/html" } })
      .mockResolvedValueOnce(jsonResponse({ answer: "json answer" }));
    const answer = await getAnswer({ ...input, email: "a@b.co", idempotencyKey: "k".repeat(20), fetch: fetchMock });
    expect(answer).toBe("json answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/api/public/demo`);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      ...input,
      email: "a@b.co",
      idempotencyKey: "k".repeat(20),
    });
  });

  it("a JSON reply from the demo endpoint is handled without a second request", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Rate limited" }, false));
    await expect(getAnswer({ ...input, fetch: fetchMock })).rejects.toThrow("Rate limited");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a queued notice instead of an answer", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "queued", message: "received" }));
    await expect(getAnswer({ ...input, fetch: fetchMock })).resolves.toEqual({
      status: "queued",
      message: "received",
    });
  });

  it("sends email and idempotency key with the stream request", async () => {
    fetchMock.mockResolvedValue(sseResponse(["event: final\ndata: {\"answer\":\"A\"}\n\n"]));
    await getAnswer({ ...input, email: "a@b.co", idempotencyKey: "abcdefghijklmnop", fetch: fetchMock });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.email).toBe("a@b.co");
    expect(body.idempotencyKey).toBe("abcdefghijklmnop");
  });
});

describe("demo request body (writing sample)", () => {
  it("includes the exact writing sample", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse(['event: final\ndata: {"answer":"A"}\n\n']));
    await getAnswer({ ...input, writingSample: " My words.\n", fetch: f });
    expect(JSON.parse(f.mock.calls[0][1].body).writingSample).toBe(" My words.\n");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("sends null when the sample is empty", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse(['event: final\ndata: {"answer":"A"}\n\n']));
    await getAnswer({ ...input, writingSample: "  ", fetch: f });
    expect(JSON.parse(f.mock.calls[0][1].body).writingSample).toBeNull();
  });
});

describe("demo resume file reading", () => {
  const { extractResumeFromBytes, docxXmlToText } = api as any;
  const enc = (s: string) => new TextEncoder().encode(s);
  const XML =
    '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Jane Doe</w:t></w:r></w:p><w:p><w:r><w:t>Engineer &amp; Lead</w:t></w:r></w:p></w:body></w:document>';

  it("reads a (renamed) .docx as readable text, not XML", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const zip = zipSync({ "word/document.xml": strToU8(XML), "[Content_Types].xml": strToU8("<x/>") });
    const text = await extractResumeFromBytes(zip);
    expect(text).toBe("Jane Doe\nEngineer & Lead");
    expect(text).not.toMatch(/<w:|<\?xml/);
  });

  it("uses the same DOCX transform as the app's resume reader", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const { extractResumeText } = await import("@/lib/resume/extract");
    const zip = zipSync({ "word/document.xml": strToU8(XML) });
    expect(await extractResumeFromBytes(zip)).toBe(await extractResumeText(zip, "cv.docx"));
    expect(docxXmlToText("<w:p>a</w:p>")).toBe("a\n");
  });

  it("refuses raw XML/HTML markup instead of showing code", async () => {
    expect(await extractResumeFromBytes(enc(XML))).toBeNull();
    expect(await extractResumeFromBytes(enc("<html><body><p>x</p></body></html>"))).toBeNull();
  });

  it("refuses binary content", async () => {
    expect(await extractResumeFromBytes(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 1, 2, 3, 0, 0]))).toBeNull();
  });

  it("keeps a normal plain-text resume unchanged", async () => {
    const t = "Jane Doe\nSenior Engineer at Acme (2019-2024)\n- Led a team of 5 <3 people";
    expect(await extractResumeFromBytes(enc(t))).toBe(t);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeAnthropicStream,
  extractPartialJsonString,
  feedSse,
  parseSseBlock,
  sseFrame,
  sseHeaders,
} from "@/lib/ai/anthropic-stream.server";
import { PromptError, runPromptText } from "@/lib/ai/run-prompt.server";
import { PROMPT_I_CLASSIFICATION } from "@/lib/ai/prompts";
import { wantsStream } from "@/routes/api/public/demo";

function sse(events: Array<[string, unknown]>): string {
  return events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

function bodyOf(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(text));
      c.close();
    },
  });
}

const DELTA = (text: string) =>
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }] as [
    string,
    unknown,
  ];

describe("Anthropic SSE parsing", () => {
  it("extracts text from content_block_delta", () => {
    expect(parseSseBlock(`event: x\ndata: ${JSON.stringify(DELTA("Hi")[1])}`)).toEqual({ text: "Hi" });
  });

  it("flags message_stop as the end of the stream", () => {
    expect(parseSseBlock(`data: {"type":"message_stop"}`)).toEqual({ stop: true });
  });

  it("ignores non-text events", () => {
    for (const t of ["ping", "message_start", "content_block_start", "content_block_stop", "message_delta"]) {
      expect(parseSseBlock(`data: {"type":"${t}"}`)).toBeNull();
    }
  });

  it("ignores malformed events without throwing", () => {
    expect(parseSseBlock("data: {not json")).toBeNull();
    expect(parseSseBlock("data: [DONE]")).toBeNull();
    expect(parseSseBlock("")).toBeNull();
    expect(parseSseBlock(`data: {"type":"content_block_delta","delta":{}}`)).toBeNull();
  });

  it("buffers partial frames across chunks", () => {
    const first = feedSse("", 'data: {"type":"content_block_de');
    expect(first.events).toHaveLength(0);
    const second = feedSse(first.buffer, 'lta","delta":{"text":"ok"}}\n\n');
    expect(second.events).toEqual([{ text: "ok" }]);
  });
});

describe("consumeAnthropicStream", () => {
  it("forwards multiple chunks in order and stops at message_stop", async () => {
    const seen: string[] = [];
    const result = await consumeAnthropicStream(
      bodyOf(
        sse([
          ["message_start", { type: "message_start", message: { id: "msg_x", model: "secret" } }],
          DELTA("Hello "),
          DELTA("world"),
          DELTA("!"),
          ["message_stop", { type: "message_stop" }],
        ]),
      ),
      (t) => seen.push(t),
    );
    expect(seen).toEqual(["Hello ", "world", "!"]);
    expect(result.text).toBe("Hello world!");
    expect(result.sawStop).toBe(true);
    expect(result.sawError).toBe(false);
    expect(seen.join("")).not.toContain("msg_x");
    expect(seen.join("")).not.toContain("secret");
  });

  it("surfaces provider stream errors without leaking details", async () => {
    const result = await consumeAnthropicStream(
      bodyOf(sse([["error", { type: "error", error: { type: "overloaded_error", message: "internal" } }]])),
    );
    expect(result.sawError).toBe(true);
    expect(result.text).toBe("");
  });

  it("survives malformed events mid-stream", async () => {
    const result = await consumeAnthropicStream(
      bodyOf(`data: {broken\n\n${sse([DELTA("ok"), ["message_stop", { type: "message_stop" }]])}`),
    );
    expect(result.text).toBe("ok");
  });
});

describe("prompt runner streaming", () => {
  let lastBody: Record<string, unknown> = {};

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      lastBody = JSON.parse(String(init.body));
      if (lastBody.stream === true) {
        return new Response(bodyOf(sse([DELTA('{"a":'), DELTA('1}'), ["message_stop", { type: "message_stop" }]])), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ content: [{ type: "text", text: '{"a":1}' }] }), { status: 200 });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("sends stream: true only when a delta consumer is attached", async () => {
    const chunks: string[] = [];
    const streamed = await runPromptText(PROMPT_I_CLASSIFICATION, "q", { onDelta: (t) => chunks.push(t) });
    expect(lastBody.stream).toBe(true);
    expect(lastBody.model).toBe(PROMPT_I_CLASSIFICATION.model);
    expect(chunks).toEqual(['{"a":', "1}"]);
    expect(streamed).toBe('{"a":1}');

    const buffered = await runPromptText(PROMPT_I_CLASSIFICATION, "q");
    expect(lastBody.stream).toBeUndefined();
    expect(buffered).toBe('{"a":1}');
  });

  it("maps provider errors to a safe PromptError", async () => {
    vi.stubGlobal("fetch", async () => new Response("rate limited", { status: 429 }));
    await expect(runPromptText(PROMPT_I_CLASSIFICATION, "q", { onDelta: () => {} })).rejects.toBeInstanceOf(
      PromptError,
    );
  });
});

describe("draft preview extraction", () => {
  it("returns only the answer field of a partial JSON document", () => {
    expect(extractPartialJsonString('{"factIdsUsed":["f1"],"answer":"I led a', "answer")).toBe("I led a");
    expect(extractPartialJsonString('{"answer":"line\\none"', "answer")).toBe("line\none");
    expect(extractPartialJsonString('{"factIdsUsed":["f1"]', "answer")).toBe("");
    expect(extractPartialJsonString('{"answer":"done"}', "answer")).toBe("done");
  });

  it("never exposes fact ids or other envelope fields", () => {
    const preview = extractPartialJsonString('{"answer":"text","factIdsUsed":["exp_1"],"wordCount":9}', "answer");
    expect(preview).toBe("text");
    expect(preview).not.toContain("exp_1");
  });
});

describe("SSE delivery contract", () => {
  it("frames events as text/event-stream with no buffering", () => {
    expect(sseFrame("draft", { text: "hi" })).toBe('event: draft\ndata: {"text":"hi"}\n\n');
    const h = sseHeaders({ "Access-Control-Allow-Origin": "*" });
    expect(h["Content-Type"]).toContain("text/event-stream");
    expect(h["Cache-Control"]).toContain("no-cache");
    expect(h["X-Accel-Buffering"]).toBe("no");
    expect(h["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("keeps streaming opt-in so existing JSON clients are unchanged", () => {
    expect(wantsStream(new Request("https://x.dev/api/public/demo", { method: "POST" }))).toBe(false);
    expect(wantsStream(new Request("https://x.dev/api/public/demo?stream=1", { method: "POST" }))).toBe(true);
    expect(
      wantsStream(
        new Request("https://x.dev/api/public/demo", {
          method: "POST",
          headers: { accept: "text/event-stream" },
        }),
      ),
    ).toBe(true);
  });
});

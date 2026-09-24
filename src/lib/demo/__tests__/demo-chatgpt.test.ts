// @vitest-environment node
// Step 4: ChatGPT side of the Demo (exact client prompt, same canonical input).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleDemoRequest } from "../handler.server";
import { drainDemoQueue } from "../queue.server";
import { buildChatgptPrompt, DEMO_CHATGPT_PROMPT_TEMPLATE, generateChatgptDemoAnswer, type ChatgptGenerator } from "../openai.server";
import { DemoGenerationError, type DemoGenerator, type DemoInput } from "../generate.server";
import type { AdmitInput, CostEventInput, DemoRequestRow, DemoStore } from "../store";
import type { DemoSettings } from "../policy";

const OPEN: DemoSettings = {
  max_runs_per_email: 5,
  session_limit: 10,
  session_window_seconds: 3600,
  ip_limit: 10,
  ip_window_seconds: 3600,
  daily_cap_usd: 10,
  reset_timezone: "UTC",
  reserve_per_demo_usd: 0.5,
};

type Row = DemoRequestRow & Record<string, unknown>;
function makeStore(settings: DemoSettings | null = OPEN, priced = true) {
  const rows: Row[] = [];
  const costs: CostEventInput[] = [];
  const snap = () => ({
    spent_today_usd: 0,
    unpriced_today: 0,
    inflight: rows.filter((r) => ["admitting", "running", "processing"].includes(r.status)).length,
    next_reset: "2099-01-01T00:00:00Z",
  });
  const store: DemoStore = {
    async admit(i: AdmitInput) {
      const dup = rows.find((r) => r.idempotency_key === i.idempotencyKey || (r.email === i.email && r.content_hash === i.contentHash));
      if (dup) return { duplicate: true, request: dup };
      const row: Row = {
        id: `r${rows.length + 1}`,
        email: i.email,
        status: "admitting",
        answer: null,
        payload: i.payload,
        attempts: 0,
        max_attempts: 3,
        idempotency_key: i.idempotencyKey,
        content_hash: i.contentHash,
      };
      rows.push(row);
      return { duplicate: false, request: row, counts: { email_total: 0, session_recent: 0, ip_recent: 0 }, settings, spend: snap() };
    },
    async update(id, patch) {
      Object.assign(rows.find((r) => r.id === id)!, patch);
    },
    async recordCost(e) {
      costs.push(e);
    },
    async getPricing(provider) {
      return priced || provider !== "openai" ? { input_usd_per_mtok: 1, output_usd_per_mtok: 2 } : null;
    },
    async spendSnapshot() {
      return { settings, spend: snap() };
    },
    async claimQueued(limit) {
      const due = rows.filter((r) => r.status === "queued").slice(0, limit);
      for (const r of due) {
        r.status = "processing";
        r.attempts += 1;
      }
      return due;
    },
    async requeueStale() {},
  };
  return { store, rows, costs };
}

const INPUT = {
  email: "a@b.co",
  resume: "Sam Rivera\nNorthwind, Senior Engineer — 2021–2024\n  • Cut latency 38%",
  jobDescription: "Staff Engineer\n\nWe want: Postgres, Go.",
  question: "Why this role?  (be honest)",
};

let generate: ReturnType<typeof vi.fn>;
let chatgpt: ReturnType<typeof vi.fn>;
beforeEach(() => {
  generate = vi.fn(async () => ({
    text: "Aplyer answer.",
    side: "aplyer",
    calls: [{ provider: "anthropic", model: "claude-opus-4-6", operation: "prompt_a_answer", usage: { inputTokens: 10, outputTokens: 5 } }],
  }));
  chatgpt = vi.fn(async (input: DemoInput, hooks?: { onDelta?: (t: string) => void }) => {
    hooks?.onDelta?.("Chat");
    hooks?.onDelta?.("GPT answer.");
    return {
      text: "ChatGPT answer.",
      prompt: buildChatgptPrompt(input),
      calls: [{ provider: "openai", model: "cfg-model", operation: "chatgpt_answer", usage: { inputTokens: 200, outputTokens: 80 } }],
      model: "cfg-model-served",
    };
  });
});

function req(body: Record<string, unknown>, stream = false) {
  return new Request(`https://x.dev/api/public/demo${stream ? "?stream=1" : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1" },
    body: JSON.stringify(body),
  });
}
const deps = (store: DemoStore) => ({
  store,
  generate: generate as unknown as DemoGenerator,
  generateChatgpt: chatgpt as unknown as ChatgptGenerator,
  salt: "salt",
});
async function sse(res: Response) {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((f) => {
      const ev = /event: (.*)/.exec(f)?.[1];
      const data = /data: (.*)/.exec(f)?.[1];
      return { ev, data: data ? JSON.parse(data) : null };
    });
}

describe("exact ChatGPT prompt (September 23 spec, Part D)", () => {
  const input = { ...INPUT, writingSample: null };
  it("matches the approved template with all four inputs, writing sample last", () => {
    const ws = "  Hi team —\n\nI'd rather ship small.  ";
    expect(buildChatgptPrompt({ ...input, writingSample: ws })).toBe(
      "Here is a job I am applying to and my resume.\n" +
        "Write my answer to this question:\n" +
        `${INPUT.question}\n` +
        `${INPUT.jobDescription}\n` +
        `${INPUT.resume}\n` +
        ws,
    );
  });
  it("matches the approved template without a writing sample", () => {
    expect(buildChatgptPrompt(input)).toBe(
      "Here is a job I am applying to and my resume.\n" +
        "Write my answer to this question:\n" +
        `${INPUT.question}\n` +
        `${INPUT.jobDescription}\n` +
        `${INPUT.resume}`,
    );
  });
  it("puts the question on its own line, not on the instruction line", () => {
    const p = buildChatgptPrompt({ question: "Q", jobDescription: "J", resume: "R", writingSample: null });
    const lines = p.split("\n");
    expect(lines).toContain("Write my answer to this question:");
    expect(lines[lines.indexOf("Write my answer to this question:") + 1]).toBe("Q");
    expect(p).not.toContain(`Write my answer to this question: Q`);
  });
  it("is built from the single exported template constant", () => {
    expect(DEMO_CHATGPT_PROMPT_TEMPLATE).toBe(
      "Here is a job I am applying to and my resume.\n" +
        "Write my answer to this question:\n" +
        "[question]\n" +
        "[job description]\n" +
        "[resume]\n" +
        "[writing sample, when provided]",
    );
  });
  it("omits the writing-sample line entirely when empty/null, with no placeholder text", () => {
    for (const ws of [null, "", "   "]) {
      const p = buildChatgptPrompt({ ...input, writingSample: ws as string | null });
      expect(p.endsWith(INPUT.resume)).toBe(true);
      expect(p).not.toMatch(/null|undefined|writing sample, when provided/i);
    }
  });
  it("inserts candidate text literally, even when it contains $ patterns", () => {
    const p = buildChatgptPrompt({
      question: "Q $& $`",
      jobDescription: "J $$",
      resume: "R $1",
      writingSample: "S $'",
    });
    expect(p).toContain("Q $& $`\nJ $$\nR $1\nS $'");
  });
  it("contains no hidden instructions or Aplyer rules", () => {
    const p = buildChatgptPrompt({ question: "Q", jobDescription: "J", resume: "R", writingSample: null });
    expect(p).toBe("Here is a job I am applying to and my resume.\nWrite my answer to this question:\nQ\nJ\nR");
  });
});

describe("OpenAI provider (server-side)", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });
  const input: DemoInput = { resume: "R", jobDescription: "J", question: "Q", writingSample: "W", writingSampleWordCount: 1 };

  it("fails closed without model + key and makes no provider call", async () => {
    delete process.env.DEMO_OPENAI_MODEL;
    process.env.OPENAI_API_KEY = "k";
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(generateChatgptDemoAnswer(input)).rejects.toMatchObject({ code: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });

  const okBody = (o: Record<string, unknown> = {}) =>
    new Response(
      JSON.stringify({
        model: "served-model-2026",
        output: [{ type: "message", content: [{ type: "output_text", text: "Hello." }] }],
        usage: { input_tokens: 42, output_tokens: 7 },
        ...o,
      }),
      { status: 200, headers: { "x-request-id": "req_abc" } },
    );
  const errBody = (status: number, code = "", headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error: { code, message: "secret detail" } }), { status, headers: { "x-request-id": "req_err", ...headers } });
  const setEnv = () => {
    process.env.DEMO_OPENAI_MODEL = "configured-model";
    process.env.OPENAI_API_KEY = "sk-test";
  };

  it("uses the Responses API with exactly model, input and max_output_tokens 500", async () => {
    setEnv();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const f = vi.fn(async () => okBody());
    vi.stubGlobal("fetch", f);
    const r = await generateChatgptDemoAnswer(input);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ model: "configured-model", input: buildChatgptPrompt(input), max_output_tokens: 500 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(r.text).toBe("Hello.");
    expect(r.prompt).toBe(body.input);
    expect(r.model).toBe("served-model-2026");
    expect(r.calls).toEqual([
      { provider: "openai", model: "configured-model", operation: "chatgpt_answer", usage: { inputTokens: 42, outputTokens: 7 } },
    ]);
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain("request_id=req_abc");
    expect(logged).not.toContain("sk-test");
    expect(logged).not.toContain("Bearer");
    expect(logged).not.toContain(body.input);
    expect(JSON.stringify(r)).not.toContain("sk-test");
    expect(JSON.stringify(r)).not.toContain("req_abc");
  });

  it("logs the model OpenAI actually returned, per attempt", async () => {
    setEnv();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => okBody({ model: "example-model-version" })));
    await generateChatgptDemoAnswer(input);
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain("returned_model=example-model-version");
    // The configured id is never substituted for what OpenAI actually served.
    expect(logged).not.toContain("returned_model=configured-model");
  });

  it("logs a different identifier when OpenAI serves a different model", async () => {
    setEnv();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => okBody({ model: "another-model-2026-03-01" })));
    await generateChatgptDemoAnswer(input);
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain("returned_model=another-model-2026-03-01");
    expect(logged).not.toContain("example-model-version");
  });

  it("logs returned_model=unavailable (never a fabricated value) when OpenAI omits the model", async () => {
    setEnv();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => okBody({ model: undefined })));
    await generateChatgptDemoAnswer(input);
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain("returned_model=unavailable");
    expect(logged).not.toContain("returned_model=configured-model");
  });

  it("the returned-model log carries no candidate data or secrets", async () => {
    setEnv();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => okBody({ model: "example-model-version" })));
    await generateChatgptDemoAnswer(input);
    const logged = log.mock.calls.flat().join(" ");
    for (const banned of [
      "sk-test",
      "Bearer",
      "Authorization",
      buildChatgptPrompt(input),
      input.question,
      input.resume,
      input.jobDescription,
      "Hello.",
      "a@b.co",
    ]) {
      expect(logged).not.toContain(banned);
    }
  });

  it("falls back to the configured model and follows configuration changes", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DEMO_OPENAI_MODEL = "model-a";
    vi.stubGlobal("fetch", vi.fn(async () => okBody({ model: undefined })));
    expect((await generateChatgptDemoAnswer(input)).model).toBe("model-a");
    process.env.DEMO_OPENAI_MODEL = "model-b";
    vi.stubGlobal("fetch", vi.fn(async () => okBody({ model: "model-b-2026-02-02" })));
    expect((await generateChatgptDemoAnswer(input)).model).toBe("model-b-2026-02-02");
  });

  it("retries a server error exactly once and returns the retry's answer", async () => {
    setEnv();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const f = vi.fn().mockResolvedValueOnce(errBody(500)).mockResolvedValueOnce(okBody());
    vi.stubGlobal("fetch", f);
    const r = await generateChatgptDemoAnswer(input);
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.text).toBe("Hello.");
    expect(r.calls).toHaveLength(1);
  });

  it("stops after two failed attempts (never three)", async () => {
    setEnv();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const f = vi.fn(async () => errBody(503));
    vi.stubGlobal("fetch", f);
    await expect(generateChatgptDemoAnswer(input)).rejects.toMatchObject({ code: "provider_error", busy: true });
    expect(f).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.flat().join(" ")).toContain("request_id=req_err");
  });

  it("rate limit retries once honouring retry-after", async () => {
    setEnv();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers();
    const f = vi.fn().mockResolvedValueOnce(errBody(429, "rate_limit_exceeded", { "retry-after": "2" })).mockResolvedValueOnce(okBody());
    vi.stubGlobal("fetch", f);
    const p = generateChatgptDemoAnswer(input);
    await vi.advanceTimersByTimeAsync(1900);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect((await p).text).toBe("Hello.");
    expect(f).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not retry quota exhaustion, input too long, or other 4xx", async () => {
    setEnv();
    vi.spyOn(console, "info").mockImplementation(() => {});
    for (const [status, code] of [[429, "insufficient_quota"], [400, "context_length_exceeded"], [401, ""]] as const) {
      const f = vi.fn(async () => errBody(status, code));
      vi.stubGlobal("fetch", f);
      await expect(generateChatgptDemoAnswer(input)).rejects.toMatchObject({ code: "provider_error", busy: false });
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("times out at 25 seconds, does not retry, and records the possibly-billed attempt", async () => {
    setEnv();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers();
    const f = vi.fn((_u: string, init: RequestInit) =>
      new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
    );
    vi.stubGlobal("fetch", f);
    const p = generateChatgptDemoAnswer(input);
    const assertion = expect(p).rejects.toMatchObject({ code: "provider_error", calls: [{ usage: {} }] });
    await vi.advanceTimersByTimeAsync(24_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(f).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("clears the timeout after a successful response", async () => {
    setEnv();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => okBody()));
    await generateChatgptDemoAnswer(input);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("treats an empty answer as a safe failure but still accounts for the paid call", async () => {
    setEnv();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => okBody({ output: [] })));
    await expect(generateChatgptDemoAnswer(input)).rejects.toMatchObject({
      code: "empty_output",
      calls: [{ usage: { inputTokens: 42, outputTokens: 7 } }],
    });
  });
});

describe("two-sided demo request", () => {
  it("goes through admission and both sides get the identical canonical input object", async () => {
    const { store, rows } = makeStore();
    const res = await handleDemoRequest(req({ ...INPUT, writingSample: "My sample." }), deps(store));
    expect(res.status).toBe(200);
    const aIn = generate.mock.calls[0][0];
    const cIn = chatgpt.mock.calls[0][0];
    expect(aIn).toBe(cIn); // same object, not a copy
    expect(cIn).toMatchObject({ resume: INPUT.resume, jobDescription: INPUT.jobDescription, question: INPUT.question, writingSample: "My sample." });
    expect(rows).toHaveLength(1);
  });

  it("does not run either side when admission queues or rejects", async () => {
    const { store } = makeStore(null); // unconfigured -> queue
    const res = await handleDemoRequest(req(INPUT), deps(store));
    expect(res.status).toBe(202);
    expect(chatgpt).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("records a separate openai cost event on the same request, with tokens", async () => {
    const { store, costs, rows } = makeStore();
    await handleDemoRequest(req(INPUT), deps(store));
    const oa = costs.filter((c) => c.side === "openai");
    expect(oa).toEqual([
      expect.objectContaining({ demoRequestId: rows[0].id, provider: "openai", model: "cfg-model", operation: "chatgpt_answer", inputTokens: 200, outputTokens: 80 }),
    ]);
    expect(costs.some((c) => c.side === "aplyer")).toBe(true);
    expect(rows[0].cost_status).toBe("priced");
  });

  it("marks OpenAI cost unpriced when no pricing is configured (never guessed)", async () => {
    const { store, costs, rows } = makeStore(OPEN, false);
    await handleDemoRequest(req(INPUT), deps(store));
    expect(costs.find((c) => c.side === "openai")!.estimatedCostUsd).toBeNull();
    expect(rows[0].cost_status).toBe("unpriced");
  });

  it("stores the ChatGPT answer and the exact sent prompt; clears inputs", async () => {
    const { store, rows } = makeStore();
    const res = await handleDemoRequest(req(INPUT), deps(store));
    const body = await res.json();
    expect(rows[0]).toMatchObject({ chatgpt_answer: "ChatGPT answer.", chatgpt_status: "completed", status: "completed", payload: null });
    expect(body.chatgpt.prompt).toBe(chatgpt.mock.results[0].value ? rows[0].chatgpt_prompt : "");
    expect(body.chatgpt.prompt).toBe(buildChatgptPrompt({ ...INPUT, writingSample: null }));
  });

  it("streams both sides; the revealed prompt equals the string the generator sent", async () => {
    const { store } = makeStore();
    const res = await handleDemoRequest(req(INPUT, true), deps(store));
    const frames = await sse(res);
    const evs = frames.map((f) => f.ev);
    expect(evs).toContain("chatgpt_delta");
    const fin = frames.find((f) => f.ev === "chatgpt_final")!.data;
    const sent = (await chatgpt.mock.results[0].value).prompt;
    expect(fin.prompt).toBe(sent);
    expect(fin.model).toBe("cfg-model-served");
    expect(Object.keys(fin).sort()).toEqual(["answer", "model", "prompt"]);
    expect(frames.find((f) => f.ev === "final")!.data.answer).toBe("Aplyer answer.");
  });

  it("ChatGPT failure: Aplyer still returned, safe copy only, no fabricated answer", async () => {
    chatgpt.mockRejectedValueOnce(new DemoGenerationError("provider_error", true, [
      { provider: "openai", model: "cfg-model", operation: "chatgpt_answer", usage: { inputTokens: 5 } },
    ]));
    const { store, rows, costs } = makeStore();
    const res = await handleDemoRequest(req(INPUT), deps(store));
    const body = await res.json();
    expect(body.answer).toBe("Aplyer answer.");
    expect(body.chatgpt).toEqual({ status: "failed", error: "The ChatGPT answer could not be generated this time." });
    expect(JSON.stringify(body)).not.toMatch(/provider_error|cfg-model|openai\.com/);
    expect(rows[0].chatgpt_answer ?? null).toBeNull();
    expect(costs.some((c) => c.side === "openai")).toBe(true); // billed partial call still recorded
  });

  it("Aplyer failure: ChatGPT answer still shown, no fabricated Aplyer answer", async () => {
    generate.mockRejectedValueOnce(new DemoGenerationError("invalid_output"));
    const { store, rows } = makeStore();
    const res = await handleDemoRequest(req(INPUT, true), deps(store));
    const frames = await sse(res);
    expect(frames.find((f) => f.ev === "chatgpt_final")!.data.answer).toBe("ChatGPT answer.");
    expect(frames.some((f) => f.ev === "final")).toBe(false);
    expect(frames.find((f) => f.ev === "error")!.data.error).not.toMatch(/invalid_output/);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].answer).toBeNull();
  });

  it("not configured: reported neutrally, no call billed", async () => {
    chatgpt.mockRejectedValueOnce(new DemoGenerationError("not_configured"));
    const { store, costs } = makeStore();
    const body = await (await handleDemoRequest(req(INPUT), deps(store))).json();
    expect(body.chatgpt.status).toBe("not_configured");
    expect(costs.some((c) => c.side === "openai")).toBe(false);
  });

  it("duplicate submission returns the stored result without another OpenAI call", async () => {
    const { store } = makeStore();
    await handleDemoRequest(req({ ...INPUT, idempotencyKey: "key-abcdefgh-1234" }), deps(store));
    const dup = await handleDemoRequest(req({ ...INPUT, idempotencyKey: "key-abcdefgh-1234" }), deps(store));
    const body = await dup.json();
    expect(chatgpt).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(body.chatgpt).toMatchObject({ status: "completed", answer: "ChatGPT answer." });
  });
});

describe("queued two-sided demo", () => {
  it("runs both sides from the same stored input, saves before email, never regenerates on email retry", async () => {
    const { store, rows } = makeStore(null);
    await handleDemoRequest(req({ ...INPUT, writingSample: "Sample text." }), deps(store));
    expect(rows[0].status).toBe("queued");
    const settingsStore = { ...store, spendSnapshot: async () => ({ settings: OPEN, spend: { spent_today_usd: 0, unpriced_today: 0, inflight: 1, next_reset: "2099-01-01T00:00:00Z", day_start: null } }) };
    const sendResult = vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; errorCode?: string }> => ({ ok: false, errorCode: "x" }));
    const q = { store: settingsStore, generate: generate as unknown as DemoGenerator, generateChatgpt: chatgpt as unknown as ChatgptGenerator, sendResult };
    const t1 = await drainDemoQueue(q);
    expect(t1.deferred).toBe(0);
    expect(generate.mock.calls[0][0]).toEqual(chatgpt.mock.calls[0][0]);
    expect(chatgpt.mock.calls[0][0].writingSample).toBe("Sample text.");
    expect(rows[0]).toMatchObject({ answer: "Aplyer answer.", chatgpt_answer: "ChatGPT answer." });
    // email failed -> retry: no new AI calls
    sendResult.mockResolvedValueOnce({ ok: true });
    await drainDemoQueue(q);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(chatgpt).toHaveBeenCalledTimes(1);
    expect(sendResult).toHaveBeenLastCalledWith("a@b.co", expect.any(Object), "Aplyer answer.", expect.objectContaining({ answer: "ChatGPT answer." }));
    expect(rows[0].status).toBe("completed");
  });
});

describe("static safety", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("API key and prompt assembly never reach browser code", () => {
    for (const f of ["src/legacy/demo.html", "src/legacy/demo-stream.js"]) {
      const s = read(f);
      expect(s).not.toMatch(/OPENAI_API_KEY|api\.openai\.com|Here is a job I am applying to/);
    }
  });
  it("OpenAI module logs only attempt, status, request id and returned model", () => {
    const logs = read("src/lib/demo/openai.server.ts").match(/console\.[a-z]+\([^;]*;/g) ?? [];
    expect(logs).toEqual([
      `console.info(\n    \`[demo-openai] attempt=\${attempt} status=\${status} request_id=\${requestId ?? "none"} returned_model=\${returnedModel || "unavailable"}\`,\n  );`,
    ]);
  });
  it("Aplyer pipeline is unchanged and the old direct Claude demo path is not reintroduced", () => {
    const g = read("src/lib/demo/generate.server.ts");
    expect(g).toContain("generateStatelessValidatedAnswer");
    expect(g).not.toMatch(/api\.anthropic\.com|claude-sonnet-4-5/);
    expect(read("src/lib/demo/openai.server.ts")).not.toMatch(/anthropic/i);
  });
});

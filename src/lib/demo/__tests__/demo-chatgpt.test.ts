// @vitest-environment node
// Step 4: ChatGPT side of the Demo (exact client prompt, same canonical input).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleDemoRequest } from "../handler.server";
import { drainDemoQueue } from "../queue.server";
import { buildChatgptPrompt, generateChatgptDemoAnswer, type ChatgptGenerator } from "../openai.server";
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

describe("exact ChatGPT prompt", () => {
  const input = { ...INPUT, writingSample: null };
  it("uses the spec template verbatim with only the four substitutions", () => {
    expect(buildChatgptPrompt(input)).toBe(
      `Here is a job I am applying to and my resume.\nWrite my answer to this question: ${INPUT.question}\n${INPUT.jobDescription}\n${INPUT.resume}`,
    );
  });
  it("inserts question, job description and resume unchanged, in spec order", () => {
    const p = buildChatgptPrompt(input);
    const iq = p.indexOf(INPUT.question), ij = p.indexOf(INPUT.jobDescription), ir = p.indexOf(INPUT.resume);
    expect([iq, ij, ir].every((i) => i > 0)).toBe(true);
    expect(iq < ij && ij < ir).toBe(true);
  });
  it("appends the writing sample exactly when supplied", () => {
    const ws = "  Hi team —\n\nI'd rather ship small.  ";
    expect(buildChatgptPrompt({ ...input, writingSample: ws }).endsWith(`\n${INPUT.resume}\n${ws}`)).toBe(true);
  });
  it("omits the writing-sample line entirely when empty/null", () => {
    for (const ws of [null, "", "   "]) {
      expect(buildChatgptPrompt({ ...input, writingSample: ws as string | null }).endsWith(INPUT.resume)).toBe(true);
    }
  });
  it("contains no hidden instructions or Aplyer rules", () => {
    const p = buildChatgptPrompt({ question: "Q", jobDescription: "J", resume: "R", writingSample: null });
    expect(p).toBe("Here is a job I am applying to and my resume.\nWrite my answer to this question: Q\nJ\nR");
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

  it("sends the configured model and the exact prompt as the only message, streams, and records usage", async () => {
    process.env.DEMO_OPENAI_MODEL = "configured-model";
    process.env.OPENAI_API_KEY = "sk-test";
    const frames = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo."}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":42,"completion_tokens":7}}',
      "data: [DONE]",
    ].join("\n\n");
    const f = vi.fn(async () => new Response(frames + "\n\n", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const deltas: string[] = [];
    const r = await generateChatgptDemoAnswer(input, { onDelta: (t) => deltas.push(t) });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("configured-model");
    expect(body.messages).toEqual([{ role: "user", content: buildChatgptPrompt(input) }]);
    expect(body.stream).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(r.text).toBe("Hello.");
    expect(r.prompt).toBe(body.messages[0].content);
    expect(deltas.join("")).toBe("Hello.");
    expect(r.calls).toEqual([
      { provider: "openai", model: "configured-model", operation: "chatgpt_answer", usage: { inputTokens: 42, outputTokens: 7 } },
    ]);
  });

  it("maps provider errors and empty output to safe codes", async () => {
    process.env.DEMO_OPENAI_MODEL = "m";
    process.env.OPENAI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"secret detail"}}', { status: 500 })));
    await expect(generateChatgptDemoAnswer(input)).rejects.toMatchObject({ code: "provider_error", busy: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("data: [DONE]\n\n", { status: 200 })));
    await expect(generateChatgptDemoAnswer(input)).rejects.toMatchObject({ code: "empty_output" });
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
    const settingsStore = { ...store, spendSnapshot: async () => ({ settings: OPEN, spend: { spent_today_usd: 0, unpriced_today: 0, inflight: 1, next_reset: null, day_start: null } }) };
    const sendResult = vi.fn(async () => ({ ok: false, errorCode: "x" }));
    const q = { store: settingsStore, generate: generate as unknown as DemoGenerator, generateChatgpt: chatgpt as unknown as ChatgptGenerator, sendResult };
    const t1 = await drainDemoQueue(q);
    console.log('T1', JSON.stringify(t1), JSON.stringify(rows[0]));
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
  it("OpenAI module logs no prompt/answer/input content", () => {
    expect(read("src/lib/demo/openai.server.ts")).not.toMatch(/console\./);
  });
  it("Aplyer pipeline is unchanged and the old direct Claude demo path is not reintroduced", () => {
    const g = read("src/lib/demo/generate.server.ts");
    expect(g).toContain("generateStatelessValidatedAnswer");
    expect(g).not.toMatch(/api\.anthropic\.com|claude-sonnet-4-5/);
    expect(read("src/lib/demo/openai.server.ts")).not.toMatch(/anthropic/i);
  });
});

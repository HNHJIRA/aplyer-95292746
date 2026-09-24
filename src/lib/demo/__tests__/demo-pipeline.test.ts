// @vitest-environment node
// Step 3: the Demo's Aplyer side runs the REAL answer pipeline
// (Prompt I -> P0 -> Prompt A -> guards -> Prompt J -> repair -> post-guard).
// Only the provider boundary (`runPromptValidated`) and the DB are mocked;
// P0 grounding, flattening, guards and the A/J orchestration are real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANSWER_MIN_WORDS } from "@/lib/ai/prompts/prompt-a-answer-generation";
import { QUALITY_CHECKS } from "@/lib/ai/prompts/prompt-j-quality-scan";
import type { ResumeFactInventory } from "@/lib/ai/prompts/prompt-p0-fact-inventory";
import type { AdmitInput, CostEventInput, DemoRequestRow, DemoStore } from "../store";
import type { DemoSettings } from "../policy";

type Sink = ((e: Record<string, unknown>) => void) | undefined;
let sink: Sink;
const runPromptValidated = vi.fn();
vi.mock("@/lib/ai/run-prompt.server", () => {
  class PromptError extends Error {
    code: string;
    status?: number;
    constructor(a: { code: string; message: string; status?: number }) {
      super(a.message);
      this.code = a.code;
      this.status = a.status;
    }
  }
  return {
    PromptError,
    withPromptUsage: async (cb: Sink, fn: () => Promise<unknown>) => {
      sink = cb;
      try {
        return await fn();
      } finally {
        sink = undefined;
      }
    },
    runPromptValidated: async (...args: unknown[]) => {
      const spec = args[0] as { id: string; model: string };
      const out = await runPromptValidated(...args); // failed calls are not billed
      sink?.({
        provider: "anthropic",
        model: spec.model,
        promptId: spec.id,
        inputTokens: 100,
        outputTokens: 50,
      });
      return out;
    },
  };
});
vi.mock("@/integrations/supabase/client.server", () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => ({ data: null });
  chain.upsert = async () => ({});
  return { supabaseAdmin: { from: () => chain } };
});

const { generateAplyerDemoAnswer } = await import("../generate.server");
const { __resetClassificationMemoryCache } = await import("@/lib/ai/classify-question.server");
const { handleDemoRequest } = await import("../handler.server");
const { drainDemoQueue } = await import("../queue.server");

/* ---------------- fixtures ---------------- */
const fact = (id: string, value: string) => ({
  id,
  value,
  evidence: value,
  sourceSection: "experience",
  confidence: "explicit" as const,
});
const RESUME = [
  "Sam Rivera, Austin, TX",
  "Northwind, Senior Engineer, 2021 to 2024",
  "Reduced checkout latency by 38 percent",
  "Cut deploy time from 40 minutes to 9 minutes",
  "Postgres",
].join("\n");
const P0_DRAFT: ResumeFactInventory = {
  schemaVersion: "1.0.0",
  sourceResumeId: "x",
  identity: { name: "Sam Rivera", location: "Austin, TX" },
  contact: { email: null, phone: null, linkedin: null, portfolio: null },
  professionalSummaryFacts: [],
  experience: [
    {
      id: "e1",
      company: "Northwind",
      role: "Senior Engineer",
      location: null,
      startDate: "2021",
      endDate: "2024",
      isCurrent: false,
      facts: [fact("f1", "Reduced checkout latency by 38 percent")],
      technologies: [fact("f2", "Postgres")],
      achievements: [fact("f3", "Cut deploy time from 40 minutes to 9 minutes")],
    },
  ],
  education: [],
  skills: [],
  certifications: [],
  projects: [],
  achievements: [],
  otherFacts: [],
};
const FILLER =
  "The work involved steady collaboration with the wider team and careful attention to how each change landed for the people who relied on it, so the outcome held up over time and the team could keep building on it without surprises later.";
function pad(core: string): string {
  let out = core;
  while (out.split(/\s+/).length < ANSWER_MIN_WORDS) out = `${out} ${FILLER}`;
  return out;
}
const CLEAN = pad(
  "Checkout latency at Northwind dropped by 38 percent after reworking the slowest paths.",
);
const REPAIRED = pad(
  "At Northwind, checkout latency dropped by 38 percent once the slowest paths were reworked.",
);
const scan = (failed: number[] = [], revisedAnswer: string | null = null) => ({
  passed: failed.length === 0,
  checks: QUALITY_CHECKS.map((name, i) => ({
    id: i + 1,
    name,
    passed: !failed.includes(i + 1),
    note: "",
  })),
  blocking: failed.map((id) => QUALITY_CHECKS[id - 1]!),
  blockingCodes: failed.map((id) => `check_${id}`),
  revisedAnswer,
});

const QUESTION = "Walk us through a recent piece of code you built and deployed.";
const JD = "We need an engineer who can make checkout fast.";
const SAMPLE = "  My own words, exactly.\n\nKept as typed.  ";

/** Scripts I, P0, A (streaming JSON) and J. */
function script(opts: { draft?: string; scans?: ReturnType<typeof scan>[]; failAt?: string } = {}) {
  const scans = opts.scans ?? [scan()];
  let j = 0;
  runPromptValidated.mockImplementation(
    async (
      spec: { id: string },
      _user: string,
      _v: unknown,
      _r: unknown,
      o?: { onDelta?: (t: string) => void },
    ) => {
      if (opts.failAt === spec.id) throw new Error("provider down");
      if (spec.id === "I_QUESTION_CLASSIFICATION")
        return { value: { framework: "STAR", reason: "r" }, attempts: 1 };
      if (spec.id === "P0_FACT_INVENTORY") return { value: structuredClone(P0_DRAFT), attempts: 1 };
      if (spec.id === "A_ANSWER_GENERATION") {
        const draft = opts.draft ?? CLEAN;
        const json = JSON.stringify({
          answer: draft,
          factIdsUsed: ["f1"],
          wordCount: draft.split(/\s+/).length,
        });
        if (o?.onDelta) for (let i = 0; i < json.length; i += 40) o.onDelta(json.slice(i, i + 40));
        return {
          value: { answer: draft, factIdsUsed: ["f1"], wordCount: draft.split(/\s+/).length },
          attempts: 1,
        };
      }
      const next = scans[Math.min(j, scans.length - 1)]!;
      j += 1;
      return { value: next, attempts: 1 };
    },
  );
}
const idsCalled = () => runPromptValidated.mock.calls.map((c) => (c[0] as { id: string }).id);
const userFor = (id: string) =>
  runPromptValidated.mock.calls
    .filter((c) => (c[0] as { id: string }).id === id)
    .map((c) => String(c[1]));

const INPUT = {
  resume: RESUME,
  jobDescription: JD,
  question: QUESTION,
  writingSample: SAMPLE,
  writingSampleWordCount: 5,
};

beforeEach(() => {
  runPromptValidated.mockReset();
  __resetClassificationMemoryCache();
});

/* ---------------- pipeline ---------------- */
describe("Demo -> real Aplyer pipeline", () => {
  it("invokes P0, Prompt A and Prompt J in order and returns the validated answer", async () => {
    script();
    const r = await generateAplyerDemoAnswer(INPUT);
    expect(idsCalled()).toEqual([
      "I_QUESTION_CLASSIFICATION",
      "P0_FACT_INVENTORY",
      "A_ANSWER_GENERATION",
      "J_QUALITY_SCAN",
    ]);
    expect(r.text).toBe(CLEAN);
    expect(r.side).toBe("aplyer");
  });

  it("P0 receives the exact resume text; its grounded facts reach Prompt A and Prompt J", async () => {
    script();
    await generateAplyerDemoAnswer(INPUT);
    expect(userFor("P0_FACT_INVENTORY")[0]).toContain("Reduced checkout latency by 38 percent");
    for (const id of ["A_ANSWER_GENERATION", "J_QUALITY_SCAN"]) {
      const u = userFor(id)[0]!;
      expect(u).toContain("Reduced checkout latency by 38 percent");
      expect(u).toContain("Cut deploy time from 40 minutes to 9 minutes");
    }
    expect(userFor("A_ANSWER_GENERATION")[0]).toContain(QUESTION);
    expect(userFor("A_ANSWER_GENERATION")[0]).toContain("make checkout fast");
  });

  it("writing sample is preserved on the request and never sent to any AI stage", async () => {
    script();
    const input = { ...INPUT };
    await generateAplyerDemoAnswer(input);
    expect(input.writingSample).toBe(SAMPLE);
    for (const c of runPromptValidated.mock.calls)
      expect(String(c[1])).not.toContain("My own words, exactly.");
  });

  it("empty writing sample remains optional", async () => {
    script();
    const r = await generateAplyerDemoAnswer({
      ...INPUT,
      writingSample: null,
      writingSampleWordCount: 0,
    });
    expect(r.text).toBe(CLEAN);
  });

  it("existing deterministic guards + repair run when required", async () => {
    // Draft fails a hard J check -> J revision -> guards -> final J re-scan.
    script({ scans: [scan([1], REPAIRED), scan()] });
    const r = await generateAplyerDemoAnswer(INPUT);
    expect(r.text).toBe(REPAIRED);
    expect(idsCalled().filter((x) => x === "J_QUALITY_SCAN")).toHaveLength(2);
  });

  it("an invalid final answer is never returned (fails closed)", async () => {
    // Guards reject the draft (em dash + fabricated number), J never repairs it.
    const bad = pad("Latency dropped by 97 percent \u2014 a huge win.");
    script({ draft: bad, scans: [scan([1], null)] });
    await expect(generateAplyerDemoAnswer(INPUT)).rejects.toMatchObject({
      code: expect.any(String),
    });
  });

  it("P0 / Prompt A / Prompt J provider failures fail closed with no answer", async () => {
    for (const failAt of ["P0_FACT_INVENTORY", "A_ANSWER_GENERATION", "J_QUALITY_SCAN"]) {
      runPromptValidated.mockReset();
      script({ failAt });
      await expect(generateAplyerDemoAnswer(INPUT)).rejects.toBeInstanceOf(Error);
    }
  });

  it("reports one cost call per actual AI operation, numbering retries/repairs", async () => {
    script({ scans: [scan([1], REPAIRED), scan()] });
    const r = await generateAplyerDemoAnswer(INPUT);
    expect(r.calls.map((c) => c.operation)).toEqual([
      "prompt_i_classification",
      "p0_fact_inventory",
      "prompt_a_answer",
      "prompt_j_quality_scan",
      "prompt_j_quality_scan_2",
    ]);
    expect(r.calls[1]).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-4-6",
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    expect(r.calls[2]!.model).toBe("claude-opus-4-6");
  });

  it("draft preview forwards only candidate-facing answer text, never the JSON envelope or fact ids", async () => {
    script();
    let preview = "";
    await generateAplyerDemoAnswer(INPUT, { onDelta: (t) => (preview += t) });
    expect(preview).toBe(CLEAN);
    expect(preview).not.toContain("factIdsUsed");
  });
});

/* ---------------- handler + queue integration ---------------- */
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
function makeStore(settings: DemoSettings) {
  const rows: (DemoRequestRow & Record<string, unknown>)[] = [];
  const costs: CostEventInput[] = [];
  let s = settings;
  const spend = () => ({
    spent_today_usd: 0,
    unpriced_today: 0,
    inflight: 0,
    next_reset: "2099-01-01T00:00:00Z",
  });
  const store: DemoStore = {
    async admit(i: AdmitInput) {
      const dup = rows.find(
        (r) => r.idempotency_key === i.idempotencyKey || r.content_hash === i.contentHash,
      );
      if (dup) return { duplicate: true, request: dup };
      const row: DemoRequestRow & Record<string, unknown> = {
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
      return {
        duplicate: false,
        request: row,
        counts: { email_total: 0, session_recent: 0, ip_recent: 0 },
        settings: s,
        spend: spend(),
      };
    },
    async update(id, patch) {
      Object.assign(rows.find((r) => r.id === id)!, patch);
    },
    async recordCost(e) {
      costs.push(e);
    },
    async getPricing() {
      return null;
    },
    async spendSnapshot() {
      return { settings: s, spend: spend() };
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
  return { store, rows, costs, set: (n: Partial<DemoSettings>) => (s = { ...s, ...n }) };
}
const body = (over: Record<string, unknown> = {}) => ({
  email: "v@b.co",
  resume: RESUME,
  jobDescription: JD,
  question: QUESTION,
  writingSample: SAMPLE,
  ...over,
});
const post = (store: DemoStore, b: Record<string, unknown>, stream = false) =>
  handleDemoRequest(
    new Request(`https://x.dev/api/public/demo${stream ? "?stream=1" : ""}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1" },
      body: JSON.stringify(b),
    }),
    { store, generate: generateAplyerDemoAnswer, salt: "salt" },
  );

describe("Demo handler with the real pipeline", () => {
  it("streams safe progress + draft, then emits the validated final; no internals leak", async () => {
    script({ scans: [scan([1], REPAIRED), scan()] });
    const { store, rows } = makeStore(OPEN);
    const res = await post(store, body(), true);
    const sse = await res.text();
    expect(sse).toContain("event: progress");
    expect(sse).toContain(`event: final\ndata: ${JSON.stringify({ answer: REPAIRED })}`);
    for (const leak of [
      "factIdsUsed",
      "claude-",
      "P0_FACT",
      "J_QUALITY",
      "sourceSection",
      "evidence",
      "check_1",
      "Prompt",
    ]) {
      expect(sse).not.toContain(leak);
    }
    expect(rows[0]).toMatchObject({
      status: "completed",
      answer: REPAIRED,
      payload: null,
      cost_status: "unpriced",
    });
  });

  it("records a cost event per AI call with side=aplyer and no invented price", async () => {
    script();
    const { store, costs } = makeStore(OPEN);
    await post(store, body());
    expect(costs.map((c) => c.operation)).toEqual([
      "prompt_i_classification",
      "p0_fact_inventory",
      "prompt_a_answer",
      "prompt_j_quality_scan",
    ]);
    for (const c of costs)
      expect(c).toMatchObject({
        demoRequestId: "r1",
        side: "aplyer",
        estimatedCostUsd: null,
        inputTokens: 100,
        outputTokens: 50,
      });
  });

  it("capped / queued requests never invoke P0, A or J", async () => {
    script();
    const { store, rows } = makeStore({ ...OPEN, daily_cap_usd: 0 });
    const res = await post(store, body());
    expect((await res.json()).status).toBe("queued");
    expect(runPromptValidated).not.toHaveBeenCalled();
    expect((rows[0].payload as { writingSample: string }).writingSample).toBe(SAMPLE);
  });

  it("queued requests later run the same pipeline; answer saved before email", async () => {
    script();
    const { store, rows, set } = makeStore({ ...OPEN, daily_cap_usd: 0 });
    await post(store, body());
    set({ daily_cap_usd: 10 });
    const order: string[] = [];
    const sendResult = vi.fn(async (_to: string, _i: unknown, answer: string) => {
      order.push(`email:${rows[0].answer === answer}`);
      return { ok: true };
    });
    await drainDemoQueue({ store, generate: generateAplyerDemoAnswer, sendResult });
    expect(idsCalled()).toEqual([
      "I_QUESTION_CLASSIFICATION",
      "P0_FACT_INVENTORY",
      "A_ANSWER_GENERATION",
      "J_QUALITY_SCAN",
    ]);
    expect(order).toEqual(["email:true"]);
    expect(rows[0]).toMatchObject({ status: "completed", answer: CLEAN });
  });

  it("duplicate submissions do not start another generation", async () => {
    script();
    const { store } = makeStore(OPEN);
    await post(store, body());
    const n = runPromptValidated.mock.calls.length;
    await post(store, body());
    expect(runPromptValidated.mock.calls.length).toBe(n);
  });

  it("pipeline failure: request marked failed, safe error, no answer, billed calls recorded", async () => {
    script({ failAt: "A_ANSWER_GENERATION" });
    const { store, rows, costs } = makeStore(OPEN);
    const res = await post(store, body(), true);
    const sse = await res.text();
    expect(sse).toContain("event: error");
    expect(sse).not.toContain("event: final");
    expect(sse).not.toContain("provider down");
    expect(rows[0]).toMatchObject({ status: "failed", answer: null, payload: null });
    expect(costs.map((c) => c.operation)).toEqual(["prompt_i_classification", "p0_fact_inventory"]);
  });
});

/* ---------------- regression: old direct Claude demo path is gone ---------------- */
describe("old simple Claude Demo generation removed", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("no direct provider call or legacy prompt remains in demo code", () => {
    const gen = src("src/lib/demo/generate.server.ts");
    expect(gen).not.toContain("api.anthropic.com");
    expect(gen).not.toContain("claude-sonnet-4-5");
    expect(gen).not.toContain("You are an expert job-application writer");
    expect(gen).not.toContain("generateLegacyDemoAnswer");
  });
  it("both Demo entry points use the real-pipeline generator", () => {
    for (const p of ["src/routes/api/public/demo.ts", "src/routes/api/public/waitlist-drain.ts"]) {
      expect(src(p)).toContain("generateAplyerDemoAnswer");
      expect(src(p)).not.toContain("generateLegacyDemoAnswer");
    }
  });
  it("the production signed-in pipeline still uses the persisted P0 gate", () => {
    const p = src("src/lib/ai/answer-pipeline.server.ts");
    expect(p).toContain(
      "gate = await ensureReadyFactInventory(supabase, userId, { writeDb: write });",
    );
  });
});

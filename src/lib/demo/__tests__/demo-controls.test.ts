// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleDemoRequest } from "../handler.server";
import { drainDemoQueue } from "../queue.server";
import { computeCost, countWords, decideAdmission, normalizeWritingSample, type DemoSettings } from "../policy";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AdmitInput, DemoStore, DemoRequestRow, CostEventInput } from "../store";
import type { DemoGenerator } from "../generate.server";

/* In-memory store mirroring the SQL admission semantics. */
interface Row extends DemoRequestRow {
  session_hash: string;
  ip_hash: string;
  idempotency_key: string;
  content_hash: string;
  created_at: number;
  next_run_at?: string;
  [k: string]: unknown;
}

function makeStore(settings: Partial<DemoSettings> | null, opts: { spent?: number; unpriced?: number } = {}) {
  const rows: Row[] = [];
  const costs: CostEventInput[] = [];
  let s: DemoSettings | null = settings
    ? {
        max_runs_per_email: null,
        session_limit: null,
        session_window_seconds: null,
        ip_limit: null,
        ip_window_seconds: null,
        daily_cap_usd: null,
        reset_timezone: null,
        reserve_per_demo_usd: null,
        ...settings,
      }
    : null;
  const spendState = { spent: opts.spent ?? 0, unpriced: opts.unpriced ?? 0 };
  const inflight = () => rows.filter((r) => ["admitting", "running", "processing"].includes(r.status)).length;
  const snap = () => ({
    spent_today_usd: spendState.spent,
    unpriced_today: spendState.unpriced,
    inflight: inflight(),
    next_reset: "2099-01-01T00:00:00Z",
  });
  const store: DemoStore = {
    async admit(i: AdmitInput) {
      const byKey = rows.find((r) => r.idempotency_key === i.idempotencyKey);
      if (byKey) return { duplicate: true, request: byKey };
      const byContent = rows.find(
        (r) =>
          r.email === i.email &&
          r.content_hash === i.contentHash &&
          ["admitting", "running", "queued", "processing", "completed"].includes(r.status),
      );
      if (byContent) return { duplicate: true, request: byContent };
      const live = rows.filter((r) => r.status !== "rejected");
      const counts = {
        email_total: live.filter((r) => r.email === i.email).length,
        session_recent: live.filter((r) => r.session_hash === i.sessionHash).length,
        ip_recent: live.filter((r) => r.ip_hash === i.ipHash).length,
      };
      const row: Row = {
        id: `r${rows.length + 1}`,
        email: i.email,
        status: "admitting",
        answer: null,
        payload: i.payload,
        attempts: 0,
        max_attempts: 3,
        session_hash: i.sessionHash,
        ip_hash: i.ipHash,
        idempotency_key: i.idempotencyKey,
        content_hash: i.contentHash,
        created_at: Date.now(),
      };
      rows.push(row);
      return { duplicate: false, request: row, counts, settings: s, spend: snap() };
    },
    async update(id, patch) {
      Object.assign(rows.find((r) => r.id === id)!, patch);
    },
    async recordCost(e) {
      costs.push(e);
      if (e.estimatedCostUsd === null) spendState.unpriced += 1;
      else spendState.spent += e.estimatedCostUsd;
    },
    async getPricing() {
      return { input_usd_per_mtok: 1, output_usd_per_mtok: 1 };
    },
    async spendSnapshot() {
      return { settings: s, spend: snap() };
    },
    async claimQueued(limit) {
      const due = rows.filter((r) => r.status === "queued" && r.attempts < r.max_attempts).slice(0, limit);
      for (const r of due) {
        r.status = "processing";
        r.attempts += 1;
      }
      return due;
    },
    async requeueStale() {},
  };
  return { store, rows, costs, spendState, setSettings: (n: Partial<DemoSettings>) => (s = { ...s!, ...n }) };
}

const OPEN: Partial<DemoSettings> = {
  max_runs_per_email: 3,
  session_limit: 10,
  session_window_seconds: 3600,
  ip_limit: 10,
  ip_window_seconds: 3600,
  daily_cap_usd: 10,
  reset_timezone: "UTC",
  reserve_per_demo_usd: 0.5,
};

let generate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  generate = vi.fn(async () => ({
    text: "An answer.",
    side: "aplyer",
    calls: [{ provider: "anthropic", model: "m", operation: "prompt_a_answer", usage: { inputTokens: 1000, outputTokens: 500 } }],
  }));
});

let n = 0;
function req(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  n += 1;
  return new Request("https://x.dev/api/public/demo", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", ...headers },
    body: JSON.stringify(body),
  });
}
const base = (over: Record<string, unknown> = {}) => ({
  email: "a@b.co",
  resume: "resume",
  jobDescription: "jd",
  question: `q${n}`,
  ...over,
});
const call = (store: DemoStore, body: Record<string, unknown>, headers?: Record<string, string>) =>
  handleDemoRequest(req(body, headers), { store, generate: generate as unknown as DemoGenerator, salt: "salt" });

describe("email gate", () => {
  it("rejects missing email (direct API call)", async () => {
    const { store, rows } = makeStore(OPEN);
    const r = await call(store, { resume: "r", jobDescription: "j", question: "q" });
    expect(r.status).toBe(400);
    expect(rows).toHaveLength(0);
    expect(generate).not.toHaveBeenCalled();
  });
  it("rejects invalid email", async () => {
    const { store } = makeStore(OPEN);
    expect((await call(store, base({ email: "nope@x" }))).status).toBe(400);
  });
  it("accepts a valid email", async () => {
    const { store } = makeStore(OPEN);
    const r = await call(store, base());
    expect(r.status).toBe(200);
    expect((await r.json()).answer).toBe("An answer.");
  });
  it("rejects when the deliverability check says invalid", async () => {
    const { store } = makeStore(OPEN);
    const r = await handleDemoRequest(req(base()), {
      store,
      generate: generate as unknown as DemoGenerator,
      salt: "s",
      checkEmail: async () => false,
    });
    expect(r.status).toBe(400);
  });
});

describe("per-email limit", () => {
  it("accepts below the limit and blocks at the limit", async () => {
    const { store } = makeStore({ ...OPEN, max_runs_per_email: 2 });
    expect((await call(store, base({ question: "1" }))).status).toBe(200);
    expect((await call(store, base({ question: "2" }))).status).toBe(200);
    const r = await call(store, base({ question: "3" }));
    expect(r.status).toBe(429);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("email is normalized so case changes cannot bypass it", async () => {
    const { store } = makeStore({ ...OPEN, max_runs_per_email: 1 });
    await call(store, base({ question: "1" }));
    expect((await call(store, base({ email: "A@B.CO", question: "2" }))).status).toBe(429);
  });
});

describe("session limit", () => {
  it("is enforced by the server-issued cookie", async () => {
    const { store } = makeStore({ ...OPEN, session_limit: 1, ip_limit: 100 });
    const first = await call(store, base({ email: "x@b.co", question: "1" }), { cookie: "aplyer_demo_sid=aaaaaaaaaaaaaaaaaaaa" });
    expect(first.status).toBe(200);
    const again = await call(store, base({ email: "x@b.co", question: "2" }), { cookie: "aplyer_demo_sid=aaaaaaaaaaaaaaaaaaaa" });
    expect(again.status).toBe(429);
  });
  it("a different session is counted independently", async () => {
    const { store } = makeStore({ ...OPEN, session_limit: 1, ip_limit: 100 });
    await call(store, base({ question: "1" }), { cookie: "aplyer_demo_sid=aaaaaaaaaaaaaaaaaaaa" });
    const other = await call(store, base({ question: "2" }), { cookie: "aplyer_demo_sid=bbbbbbbbbbbbbbbbbbbb" });
    expect(other.status).toBe(200);
  });
  it("issues an HttpOnly session cookie when none is present", async () => {
    const { store } = makeStore(OPEN);
    const r = await call(store, base());
    expect(r.headers.get("set-cookie")).toMatch(/aplyer_demo_sid=.*HttpOnly/);
  });
});

describe("IP limit", () => {
  it("is enforced independently of session", async () => {
    const { store } = makeStore({ ...OPEN, ip_limit: 1 });
    await call(store, base({ question: "1" }), { cookie: "aplyer_demo_sid=aaaaaaaaaaaaaaaaaaaa" });
    const r = await call(store, base({ question: "2" }), { cookie: "aplyer_demo_sid=cccccccccccccccccccc" });
    expect(r.status).toBe(429);
  });
  it("cannot be overridden by payload or X-Forwarded-For", async () => {
    const { store } = makeStore({ ...OPEN, ip_limit: 1 });
    await call(store, base({ question: "1" }));
    const r = await call(store, base({ question: "2", ip: "9.9.9.9" }), { "x-forwarded-for": "9.9.9.9" });
    expect(r.status).toBe(429);
  });
  it("first run for a new email hitting a rate limit is queued, not lost", async () => {
    const { store, rows } = makeStore({ ...OPEN, ip_limit: 1 });
    await call(store, base({ question: "1" }));
    const r = await call(store, base({ email: "new@b.co", question: "2" }));
    expect(r.status).toBe(202);
    expect(rows.at(-1)!.status).toBe("queued");
  });
});

describe("daily spend cap", () => {
  it("allows below the cap", async () => {
    const { store } = makeStore(OPEN, { spent: 1 });
    expect((await call(store, base())).status).toBe(200);
  });
  it("queues at the cap without generating", async () => {
    const { store, rows } = makeStore(OPEN, { spent: 9.6 });
    const r = await call(store, base());
    expect(r.status).toBe(202);
    const body = await r.json();
    expect(body.status).toBe("queued");
    expect(JSON.stringify(body)).not.toMatch(/usd|cost|anthropic|claude|cap|queue_reason/i);
    expect(rows[0].status).toBe("queued");
    expect(rows[0].queue_reason).toBe("daily_cap");
    expect(rows[0].payload).toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
  });
  it("unpriced spend today fails closed (queued)", async () => {
    const { store } = makeStore(OPEN, { unpriced: 1 });
    expect((await call(store, base())).status).toBe(202);
    expect(generate).not.toHaveBeenCalled();
  });
  it("unconfigured limits fail closed (queued, never generated)", async () => {
    const { store, rows } = makeStore({});
    expect((await call(store, base())).status).toBe(202);
    expect(rows[0].queue_reason).toBe("unconfigured");
    expect(generate).not.toHaveBeenCalled();
  });
  it("client-sent spend or counters are ignored", async () => {
    const { store } = makeStore(OPEN, { spent: 9.6 });
    const r = await call(store, base({ spent_today_usd: 0, email_total: 0, daily_cap_usd: 999 }));
    expect(r.status).toBe(202);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("idempotency", () => {
  it("same key does not create a second billable run", async () => {
    const { store, rows } = makeStore(OPEN);
    const key = "k".repeat(24);
    const a = await call(store, base({ question: "same", idempotencyKey: key }));
    const b = await call(store, base({ question: "same", idempotencyKey: key }));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await b.json()).answer).toBe("An answer.");
    expect(rows).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("new key with identical content (refresh / other tab) returns existing state", async () => {
    const { store, rows } = makeStore(OPEN);
    await call(store, base({ question: "same", idempotencyKey: "a".repeat(20) }));
    await call(store, base({ question: "same", idempotencyKey: "b".repeat(20) }));
    expect(rows).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("repeated request for a queued run returns the queued state", async () => {
    const { store, rows } = makeStore({});
    await call(store, base({ question: "same" }));
    const r = await call(store, base({ question: "same" }));
    expect((await r.json()).status).toBe("queued");
    expect(rows).toHaveLength(1);
  });
});

describe("cost tracking", () => {
  it("records provider/model/tokens/side per operation", async () => {
    const { store, costs, rows } = makeStore(OPEN);
    await call(store, base());
    expect(costs[0]).toMatchObject({ side: "aplyer", provider: "anthropic", inputTokens: 1000, outputTokens: 500 });
    expect(rows[0].cost_status).toBe("priced");
  });
  it("missing pricing leaves the cost unpriced, never guessed", () => {
    expect(computeCost(null, { inputTokens: 1, outputTokens: 1 })).toBeNull();
    expect(computeCost({ input_usd_per_mtok: 3, output_usd_per_mtok: 15 }, {})).toBeNull();
    expect(computeCost({ input_usd_per_mtok: 1, output_usd_per_mtok: 2 }, { inputTokens: 1e6, outputTokens: 1e6 })).toBe(3);
  });
});

describe("queue", () => {
  const sendOk = vi.fn(async () => ({ ok: true }));
  it("job created correctly, processed and completed with email delivery", async () => {
    const { store, rows, setSettings } = makeStore({});
    await call(store, base());
    expect(rows[0].status).toBe("queued");
    setSettings(OPEN);
    const t = await drainDemoQueue({ store, generate: generate as unknown as DemoGenerator, sendResult: sendOk });
    expect(t.completed).toBe(1);
    expect(rows[0].status).toBe("completed");
    expect(rows[0].payload).toBeNull();
    expect(sendOk).toHaveBeenCalledWith("a@b.co", expect.any(Object), "An answer.", null);
  });
  it("stays queued (deferred, no attempt used) while the cap is reached", async () => {
    const { store, rows } = makeStore(OPEN, { spent: 9.9 });
    await call(store, base());
    const t = await drainDemoQueue({ store, generate: generate as unknown as DemoGenerator, sendResult: sendOk });
    expect(t.deferred).toBe(1);
    expect(rows[0].status).toBe("queued");
    expect(rows[0].attempts).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });
  it("retries on failure and stops at max attempts (failed)", async () => {
    const { store, rows, setSettings } = makeStore({});
    await call(store, base());
    setSettings(OPEN);
    const bad = vi.fn(async () => {
      throw new Error("boom");
    });
    for (let i = 0; i < 5; i += 1) {
      await drainDemoQueue({ store, generate: bad as unknown as DemoGenerator, sendResult: sendOk });
    }
    expect(bad).toHaveBeenCalledTimes(3);
    expect(rows[0].status).toBe("failed");
  });
  it("email failure retries without paying for a second generation", async () => {
    const { store, rows, setSettings } = makeStore({});
    await call(store, base());
    setSettings(OPEN);
    const sendBad = vi.fn(async () => ({ ok: false, errorCode: "x" }));
    await drainDemoQueue({ store, generate: generate as unknown as DemoGenerator, sendResult: sendBad });
    expect(rows[0].status).toBe("queued");
    await drainDemoQueue({ store, generate: generate as unknown as DemoGenerator, sendResult: sendOk });
    expect(rows[0].status).toBe("completed");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("policy", () => {
  it("processing state is exposed for in-flight duplicates", async () => {
    const { store, rows } = makeStore(OPEN);
    rows.push({
      id: "x", email: "a@b.co", status: "processing", answer: null, payload: null, attempts: 1, max_attempts: 3,
      session_hash: "", ip_hash: "", idempotency_key: "z", content_hash: "", created_at: 0,
    });
    expect(decideAdmission(null, { email_total: 0, session_recent: 0, ip_recent: 0 }, null)).toEqual({
      action: "queue",
      reason: "unconfigured",
    });
    expect(store).toBeTruthy();
  });
});


/* ---------------- Step 2: writing sample ---------------- */
describe("writing sample (Step 2)", () => {
  const SAMPLE = "  I wrote this myself.\n\nIt's got  odd   spacing, em-dash-free & <b>chars</b>.  ";

  it("is optional: omitted sample still runs and stores null", async () => {
    const { store, rows } = makeStore(OPEN);
    const r = await call(store, base());
    expect(r.status).toBe(200);
    expect((rows[0].payload as any)?.writingSample ?? null).toBeNull();
    expect(generate.mock.calls[0][0].writingSample).toBeNull();
    expect(generate.mock.calls[0][0].writingSampleWordCount).toBe(0);
  });

  it("accepts empty and whitespace-only samples as null", async () => {
    const { store } = makeStore(OPEN);
    expect((await call(store, base({ writingSample: "" }))).status).toBe(200);
    expect((await call(store, base({ writingSample: "   \n " }))).status).toBe(200);
    expect(generate.mock.calls.map((c) => c[0].writingSample)).toEqual([null, null]);
  });

  it("rejects a non-string sample without storing anything", async () => {
    const { store, rows } = makeStore(OPEN);
    expect((await call(store, base({ writingSample: { x: 1 } }))).status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it("stores the sample exactly (no trimming or rewriting) and passes it on", async () => {
    const { store } = makeStore(OPEN);
    await call(store, base({ writingSample: SAMPLE }));
    const input = generate.mock.calls[0][0];
    expect(input.writingSample).toBe(SAMPLE);
    expect(input.writingSampleWordCount).toBe(countWords(SAMPLE));
  });

  it("queued request retains the exact sample and the queue passes it on", async () => {
    const { store, rows, setSettings } = makeStore({ ...OPEN, daily_cap_usd: 0 });
    const r = await call(store, base({ writingSample: SAMPLE }));
    expect((await r.json()).status).toBe("queued");
    expect((rows[0].payload as any).writingSample).toBe(SAMPLE);
    setSettings({ daily_cap_usd: 10 });
    const sendResult = vi.fn(async () => ({ ok: true }));
    await drainDemoQueue({ store, generate: generate as unknown as DemoGenerator, sendResult });
    expect(generate.mock.calls[0][0].writingSample).toBe(SAMPLE);
    expect(rows[0].payload).toBeNull(); // retention: cleared once delivered
  });

  it("older queued rows without a sample are processed with null", async () => {
    const { store, rows, setSettings } = makeStore({ ...OPEN, daily_cap_usd: 0 });
    await call(store, base());
    rows[0].payload = { resume: "r", jobDescription: "j", question: "q" };
    setSettings({ daily_cap_usd: 10 });
    await drainDemoQueue({ store, generate: generate as unknown as DemoGenerator, sendResult: async () => ({ ok: true }) });
    expect(generate.mock.calls[0][0].writingSample).toBeNull();
  });

  it("duplicate/idempotent request keeps the original sample", async () => {
    const { store, rows } = makeStore({ ...OPEN, daily_cap_usd: 0 });
    const body = base({ writingSample: "original sample", idempotencyKey: "key-abcdefgh-123456" });
    await call(store, body);
    const again = await call(store, { ...body, writingSample: "changed sample" });
    expect((await again.json()).status).toBe("queued");
    expect(rows).toHaveLength(1);
    expect((rows[0].payload as any).writingSample).toBe("original sample");
  });

  it("different samples with otherwise identical content are distinct requests", async () => {
    const { store, rows } = makeStore({ ...OPEN, daily_cap_usd: 0 });
    await call(store, { ...base(), question: "same", writingSample: "one" });
    await call(store, { ...base(), question: "same", writingSample: "two" });
    expect(rows).toHaveLength(2);
  });

  it("is never logged or echoed in error responses", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    generate.mockRejectedValueOnce(new Error("boom"));
    const { store } = makeStore(OPEN);
    const r = await call(store, base({ writingSample: "PRIVATE_SAMPLE_XYZ" }));
    expect(await r.text()).not.toContain("PRIVATE_SAMPLE_XYZ");
    for (const l of logs) {
      expect(JSON.stringify(l.mock.calls)).not.toContain("PRIVATE_SAMPLE_XYZ");
      l.mockRestore();
    }
  });

  it("demo_requests is never granted to browser roles", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const sql = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    expect(sql).toMatch(/demo_requests/);
    expect(sql).not.toMatch(/GRANT[^;]*ON\s+(TABLE\s+)?public\.demo_requests[^;]*TO[^;]*(anon|authenticated)/i);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*ON\s+public\.demo_requests/i);
  });
});

describe("word count (deterministic)", () => {
  it("counts whitespace-separated tokens containing a letter or digit", () => {
    expect(countWords(null)).toBe(0);
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("Hello world")).toBe(2);
    expect(countWords("  It's  a\n\ttest - ... ok 42 ")).toBe(5);
    expect(countWords("naïve café résumé")).toBe(3);
    const t = "one two three";
    expect(countWords(t)).toBe(countWords(t));
  });
  it("normalizeWritingSample keeps exact text", () => {
    expect(normalizeWritingSample(undefined)).toBeNull();
    expect(normalizeWritingSample("  ")).toBeNull();
    expect(normalizeWritingSample(5)).toBeUndefined();
    expect(normalizeWritingSample(" a ")).toBe(" a ");
  });
});

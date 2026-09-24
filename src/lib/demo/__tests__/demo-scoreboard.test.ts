// @vitest-environment node
// Step 6: measured scoreboard (fixed markers from the writing sample only).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeFingerprint } from "@/lib/stylometry/fingerprint";
import type { ReferenceDistribution } from "@/lib/stylometry/distinctiveness";
import {
  compareAnswers,
  MAX_APLYER_ATTEMPTS,
  resolveScoreboard,
  selectMarkers,
  type ScoreboardConfig,
} from "../scoreboard";
import { handleDemoRequest } from "../handler.server";
import { drainDemoQueue } from "../queue.server";
import type { DemoGenerator, DemoInput } from "../generate.server";
import type { ChatgptGenerator } from "../openai.server";
import type { AdmitInput, CostEventInput, DemoRequestRow, DemoStore } from "../store";
import type { DemoSettings } from "../policy";
import answerModule from "@/legacy/demo-stream.js";

// ---- fixtures ---------------------------------------------------------------
const CASUAL =
  "I've spent six years building data tools, and I don't think I've ever enjoyed a problem more than this one. We shipped a pipeline in 2021; it cut latency by 38% and I'm proud of it. But it wasn't perfect. I didn't know why the nightly job failed, so I read the logs and I fixed it.";
const SAMPLE = Array(8).fill(CASUAL).join("\n\n"); // > 300 words
const FORMAL =
  "The candidate possesses extensive experience developing sophisticated data infrastructure. Throughout their tenure, the organisation delivered a comprehensive pipeline which substantially reduced latency. Furthermore, the engineer demonstrated exceptional analytical capability when investigating recurring operational failures.";
const fp = computeFingerprint(SAMPLE);
const val = (n: string) => fp.metrics.find((m) => m.name === n)!.value!;

/** Test references placed so the sample sits a known number of SDs away. */
function refs(dist: Record<string, number>, approved = true): ReferenceDistribution[] {
  return Object.entries(dist).map(([metric, z]) => ({ metric, method: "z_score", mean: val(metric) - z, sd: 1, source: "test", approved }));
}
const CFG: ScoreboardConfig = {
  threshold: 1,
  references: refs({ contraction_rate: 5, first_person_rate: 4, long_word_rate: -3, comma_rate: 2, article_rate: 0.5, sentence_length_sd: 9 }),
};

// ---- selection ---------------------------------------------------------------
describe("marker selection", () => {
  it("no baseline / unapproved / no threshold / short sample → suppressed", () => {
    expect(selectMarkers(SAMPLE, null)).toBeNull();
    expect(selectMarkers(SAMPLE, { threshold: 1, references: [] })).toBeNull();
    expect(selectMarkers(SAMPLE, { threshold: 1, references: refs({ contraction_rate: 5 }, false) })).toBeNull();
    expect(selectMarkers(SAMPLE, { threshold: null, references: CFG.references })).toBeNull();
    expect(selectMarkers(CASUAL, CFG)).toBeNull(); // < 300 words
    expect(selectMarkers(null, CFG)).toBeNull();
    expect(selectMarkers(SAMPLE, { threshold: 100, references: CFG.references })).toBeNull(); // nothing clears
  });
  it("ranks eligible reliable metrics, top 4, above threshold, excluded metrics never chosen", () => {
    const s = selectMarkers(SAMPLE, CFG)!;
    expect(s.markers.map((m) => m.metric)).toEqual(["contraction_rate", "first_person_rate", "long_word_rate", "comma_rate"]);
    expect(s.markers.some((m) => m.metric === "sentence_length_sd")).toBe(false); // not headline-eligible despite z=9
    expect(s.markers.some((m) => m.metric === "article_rate")).toBe(false); // below threshold
    expect(s.markers[0].candidateValue).toBe(val("contraction_rate"));
  });
  it("selection takes the writing sample only (no answer parameter) and is deterministic", () => {
    expect(selectMarkers.length).toBe(2);
    expect(selectMarkers(SAMPLE, CFG)).toEqual(selectMarkers(SAMPLE, CFG));
  });
});

// ---- comparison --------------------------------------------------------------
describe("comparison", () => {
  const sel = selectMarkers(SAMPLE, CFG)!;
  it("same markers for both answers; distances are |answer − candidate|; aggregate = mean of scaled distances", () => {
    const c = compareAnswers(sel, CASUAL, FORMAL)!;
    const a = computeFingerprint(CASUAL), g = computeFingerprint(FORMAL);
    expect(c.view.markers.map((m) => m.metric)).toEqual(sel.markers.map((m) => m.metric));
    let sa = 0, sg = 0;
    for (const m of c.view.markers) {
      const av = a.metrics.find((x) => x.name === m.metric)!.observed!;
      const gv = g.metrics.find((x) => x.name === m.metric)!.observed!;
      expect(m.aplyerDistance).toBeCloseTo(Math.abs(av - m.candidateValue), 3);
      expect(m.chatgptDistance).toBeCloseTo(Math.abs(gv - m.candidateValue), 3);
      sa += Math.abs(av - m.candidateValue); // sd = 1 in test refs
      sg += Math.abs(gv - m.candidateValue);
    }
    expect(c.view.aggregate.aplyerDistance).toBeCloseTo(sa / 4, 3);
    expect(c.view.aggregate.chatgptDistance).toBeCloseTo(sg / 4, 3);
    expect(c.view.aggregate.closer).toBe("aplyer");
    expect(compareAnswers(sel, CASUAL, FORMAL)).toEqual(c);
  });
  it("reports the fact either way (swapped inputs → chatgpt closer), no quality judgement", () => {
    expect(compareAnswers(sel, FORMAL, CASUAL)!.view.aggregate.closer).toBe("chatgpt");
    expect(compareAnswers(sel, CASUAL, CASUAL)!.view.aggregate.closer).toBe("equal");
  });
  it("empty answers cannot be measured → null", () => {
    expect(compareAnswers(sel, "", FORMAL)).toBeNull();
  });
  it("candidate-facing view carries no reference internals", () => {
    const s = JSON.stringify(compareAnswers(sel, CASUAL, FORMAL)!.view);
    expect(s).not.toMatch(/scale|mean|"sd"|source|reference|threshold/);
  });
});

// ---- regeneration -------------------------------------------------------------
describe("regeneration", () => {
  const sel = selectMarkers(SAMPLE, CFG)!;
  it("not triggered when Aplyer is closer", async () => {
    const regen = vi.fn();
    const r = await resolveScoreboard({ selection: sel, aplyerText: CASUAL, chatgptText: FORMAL, regenerate: regen });
    expect(regen).not.toHaveBeenCalled();
    expect(r.scoreboard?.aggregate.closer).toBe("aplyer");
    expect(r.attempts).toBe(1);
  });
  it("triggered when Aplyer is further; success → scoreboard with same fixed markers", async () => {
    const regen = vi.fn(async (note: string) => {
      expect(note).not.toContain("six years"); // no sample text in the note
      return CASUAL;
    });
    const r = await resolveScoreboard({ selection: sel, aplyerText: FORMAL, chatgptText: FORMAL + " Additionally, it was fine.", regenerate: regen });
    expect(regen).toHaveBeenCalledTimes(1);
    expect(r.aplyerText).toBe(CASUAL);
    expect(r.scoreboard!.markers.map((m) => m.metric)).toEqual(sel.markers.map((m) => m.metric));
  });
  it("max two Aplyer attempts; still further → scoreboard suppressed, answer kept", async () => {
    const regen = vi.fn(async () => FORMAL);
    const r = await resolveScoreboard({ selection: sel, aplyerText: FORMAL, chatgptText: CASUAL, regenerate: regen });
    expect(MAX_APLYER_ATTEMPTS).toBe(2);
    expect(regen).toHaveBeenCalledTimes(1);
    expect(r.attempts).toBe(2);
    expect(r.scoreboard).toBeNull();
    expect(r.suppressedReason).toBe("aplyer_further");
    expect(r.failingMarkers.length).toBeGreaterThan(0);
  });
  it("no selection → never regenerates", async () => {
    const regen = vi.fn();
    const r = await resolveScoreboard({ selection: null, aplyerText: FORMAL, chatgptText: CASUAL, regenerate: regen });
    expect(regen).not.toHaveBeenCalled();
    expect(r.scoreboard).toBeNull();
  });
});

// ---- handler integration --------------------------------------------------------
const OPEN: DemoSettings = { max_runs_per_email: 5, session_limit: 10, session_window_seconds: 3600, ip_limit: 10, ip_window_seconds: 3600, daily_cap_usd: 10, reset_timezone: "UTC", reserve_per_demo_usd: 0.5 };
type Row = DemoRequestRow & Record<string, unknown>;
function makeStore(cfg: ScoreboardConfig | null, settings: DemoSettings | null = OPEN) {
  const rows: Row[] = [];
  const costs: CostEventInput[] = [];
  const snap = () => ({ spent_today_usd: 0, unpriced_today: 0, inflight: 1, next_reset: "2099-01-01T00:00:00Z", day_start: null });
  const store: DemoStore = {
    async admit(i: AdmitInput) {
      const dup = rows.find((r) => r.idempotency_key === i.idempotencyKey);
      if (dup) return { duplicate: true, request: dup };
      const row: Row = { id: `r${rows.length + 1}`, email: i.email, status: "admitting", answer: null, payload: i.payload, attempts: 0, max_attempts: 3, idempotency_key: i.idempotencyKey };
      rows.push(row);
      return { duplicate: false, request: row, counts: { email_total: 0, session_recent: 0, ip_recent: 0 }, settings, spend: snap() };
    },
    async update(id, patch) { Object.assign(rows.find((r) => r.id === id)!, patch); },
    async recordCost(e) { costs.push(e); },
    async getPricing() { return { input_usd_per_mtok: 1, output_usd_per_mtok: 2 }; },
    async spendSnapshot() { return { settings, spend: snap() }; },
    async claimQueued(limit) {
      const due = rows.filter((r) => r.status === "queued").slice(0, limit);
      for (const r of due) { r.status = "processing"; r.attempts += 1; }
      return due;
    },
    async requeueStale() {},
    getScoreboardConfig: async () => cfg,
  };
  return { store, rows, costs };
}
const INPUT = { email: "a@b.co", resume: "Sam Rivera\nNorthwind, Senior Engineer 2021-2024\nCut latency 38%", jobDescription: "Staff Engineer, Postgres", question: "Why this role?", writingSample: SAMPLE };
const call = (usage = 10) => [{ provider: "anthropic", model: "m", operation: "prompt_a_answer", usage: { inputTokens: usage, outputTokens: 5 } }];
let generate: ReturnType<typeof vi.fn>;
let chatgpt: ReturnType<typeof vi.fn>;
function setup(aplyerTexts: string[], gptText: string) {
  let i = 0;
  generate = vi.fn(async () => ({ text: aplyerTexts[Math.min(i++, aplyerTexts.length - 1)], side: "aplyer", calls: call() }));
  chatgpt = vi.fn(async (input: DemoInput) => ({ text: gptText, prompt: "P:" + input.question, calls: [{ provider: "openai", model: "g", operation: "chatgpt_answer", usage: { inputTokens: 1 } }] }));
}
const deps = (store: DemoStore) => ({ store, generate: generate as unknown as DemoGenerator, generateChatgpt: chatgpt as unknown as ChatgptGenerator, salt: "s" });
const req = (stream = false, extra: Record<string, unknown> = {}) =>
  new Request(`https://x.dev/api/public/demo${stream ? "?stream=1" : ""}`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1" }, body: JSON.stringify({ ...INPUT, ...extra }) });
async function frames(res: Response) {
  return (await res.text()).split("\n\n").filter(Boolean).map((f) => ({ ev: /event: (.*)/.exec(f)?.[1], data: JSON.parse(/data: (.*)/.exec(f)?.[1] ?? "null") }));
}

describe("demo request with scoreboard", () => {
  beforeEach(() => setup([CASUAL], FORMAL));

  it("baseline missing → both answers returned, no scoreboard, no regeneration", async () => {
    const { store, rows } = makeStore(null);
    const body = await (await handleDemoRequest(req(), deps(store))).json();
    expect(body.answer).toBe(CASUAL);
    expect(body.chatgpt.answer).toBe(FORMAL);
    expect(body.scoreboard).toBeUndefined();
    expect(rows[0].scoreboard_status).toBe("suppressed");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("baseline configured → scoreboard sent once after final, never during streaming", async () => {
    const { store, rows } = makeStore(CFG);
    const f = await frames(await handleDemoRequest(req(true), deps(store)));
    const evs = f.map((x) => x.ev);
    expect(evs.filter((e) => e === "scoreboard")).toHaveLength(1);
    expect(evs.indexOf("scoreboard")).toBeGreaterThan(evs.indexOf("final"));
    expect(evs.indexOf("scoreboard")).toBeGreaterThan(evs.indexOf("chatgpt_final"));
    const sb = f.find((x) => x.ev === "scoreboard")!.data;
    expect(sb.status).toBe("shown");
    expect(sb.markers).toHaveLength(4);
    expect(rows[0]).toMatchObject({ scoreboard_status: "shown", payload: null });
  });

  it("Aplyer further → regenerates once (cost recorded), markers unchanged; duplicate returns stored scoreboard", async () => {
    setup([FORMAL, CASUAL], FORMAL + " Additionally, it was fine.");
    const { store, costs } = makeStore(CFG);
    const body = await (await handleDemoRequest(req(false, { idempotencyKey: "key-abcdefgh-1234" }), deps(store))).json();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][1]).toMatchObject({ styleNote: expect.stringContaining("Match the candidate") });
    expect(chatgpt).toHaveBeenCalledTimes(1); // ChatGPT never regenerated
    expect(body.answer).toBe(CASUAL);
    expect(body.scoreboard.markers.map((m: { metric: string }) => m.metric)).toEqual(selectMarkers(SAMPLE, CFG)!.markers.map((m) => m.metric));
    expect(costs.filter((c) => c.side === "aplyer")).toHaveLength(2);
    const dup = await (await handleDemoRequest(req(false, { idempotencyKey: "key-abcdefgh-1234" }), deps(store))).json();
    expect(dup.scoreboard).toEqual(body.scoreboard);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("still further after two attempts → answers shown, scoreboard suppressed, reason not exposed", async () => {
    setup([FORMAL, FORMAL, FORMAL], CASUAL);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store } = makeStore(CFG);
    const res = await handleDemoRequest(req(), deps(store));
    const text = await res.text();
    expect(generate).toHaveBeenCalledTimes(MAX_APLYER_ATTEMPTS);
    const body = JSON.parse(text);
    expect(body.answer).toBe(FORMAL);
    expect(body.chatgpt.answer).toBe(CASUAL);
    expect(body.scoreboard).toBeUndefined();
    expect(text).not.toMatch(/aplyer_further|suppress/);
    const log = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("demo_scoreboard_suppressed"))!;
    expect(log).toContain("aplyer_further");
    expect(log).not.toContain("six years");
    warn.mockRestore();
  });

  it("ChatGPT failure → Aplyer shown, no scoreboard, no regeneration", async () => {
    chatgpt.mockRejectedValueOnce(new Error("x"));
    const { store } = makeStore(CFG);
    const body = await (await handleDemoRequest(req(), deps(store))).json();
    expect(body.answer).toBe(CASUAL);
    expect(body.scoreboard).toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("no writing sample → no scoreboard, demo still works", async () => {
    const { store } = makeStore(CFG);
    const body = await (await handleDemoRequest(req(false, { writingSample: "" }), deps(store))).json();
    expect(body.answer).toBe(CASUAL);
    expect(body.scoreboard).toBeUndefined();
  });

  it("marker choice is unaffected by the answers (config read before generation)", async () => {
    const order: string[] = [];
    const { store } = makeStore(CFG);
    const orig = store.getScoreboardConfig!;
    store.getScoreboardConfig = async () => { order.push("config"); return orig(); };
    generate.mockImplementation(async () => { order.push("aplyer"); return { text: CASUAL, side: "aplyer", calls: call() }; });
    await handleDemoRequest(req(), deps(store));
    expect(order[0]).toBe("config");
  });

  it("queued request: scoreboard/regeneration run once; email retry does not regenerate", async () => {
    setup([FORMAL, CASUAL], FORMAL + " Additionally, it was fine.");
    const { store, rows } = makeStore(CFG, null);
    await handleDemoRequest(req(), deps(store));
    expect(rows[0].status).toBe("queued");
    const qs = { ...store, spendSnapshot: async () => ({ settings: OPEN, spend: { spent_today_usd: 0, unpriced_today: 0, inflight: 1, next_reset: "2099-01-01T00:00:00Z", day_start: null } }) };
    const sendResult = vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; errorCode?: string }> => ({ ok: false, errorCode: "x" }));
    const q = { store: qs, generate: generate as unknown as DemoGenerator, generateChatgpt: chatgpt as unknown as ChatgptGenerator, sendResult };
    await drainDemoQueue(q);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(rows[0]).toMatchObject({ answer: CASUAL, scoreboard_status: "shown" });
    sendResult.mockResolvedValueOnce({ ok: true });
    await drainDemoQueue(q);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(sendResult).toHaveBeenLastCalledWith("a@b.co", expect.any(Object), CASUAL, expect.anything());
  });
});

// ---- client parser + static checks --------------------------------------------
describe("client + static", () => {
  it("stream parser passes a complete scoreboard to onScoreboard; JSON fallback too", async () => {
    const A = answerModule as { streamAnswer: (o: unknown) => Promise<string>; handleJson?: unknown };
    const sb = { status: "shown", markers: [{ metric: "x" }], aggregate: { aplyerDistance: 1, chatgptDistance: 2, closer: "aplyer" } };
    const body = `event: final\ndata: {"answer":"A"}\n\nevent: scoreboard\ndata: ${JSON.stringify(sb)}\n\nevent: done\ndata: {"ok":true}\n\n`;
    const got: unknown[] = [];
    const fetch = async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    const ans = await A.streamAnswer({ fetch, baseUrl: "", email: "a@b.co", resume: "r", jobDescription: "j", question: "q", onScoreboard: (x: unknown) => got.push(x) });
    expect(ans).toBe("A");
    expect(got).toEqual([sb]);
  });
  it("no winner-style language, no AI in scoring, engine stays local", () => {
    const html = readFileSync(join(process.cwd(), "src/legacy/demo.html"), "utf8");
    const i = html.indexOf('id="sbWrap"');
    const panel = html.slice(i, i + 3000) + html.slice(html.indexOf("function onScoreboard"), html.indexOf("function onScoreboard") + 2500);
    expect(panel).not.toMatch(/\b(winner|loser|better answer|worse answer|smarter|more human)\b/i);
    const src = readFileSync(join(process.cwd(), "src/lib/demo/scoreboard.ts"), "utf8");
    expect(src).not.toMatch(/fetch\(|anthropic|openai|supabase|process\.env/i);
  });
});

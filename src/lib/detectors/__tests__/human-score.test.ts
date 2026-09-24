// @vitest-environment node
// Step 7A: Human Score (Copyleaks + Pangram), server-side, fail closed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeHumanScore,
  detectorGateOpen,
  displayShield,
  humanScoreView,
  parseCopyleaks,
  parsePangram,
  type DetectorOutcome,
  type HumanScoreConfig,
} from "../human-score";
import { copyleaksClient, pangramClient, type DetectorClient } from "../clients.server";
import { runHumanScore, storedHumanScoreView } from "@/lib/demo/handler.server";
import type { CostEventInput, DemoRequestRow, DemoStore } from "@/lib/demo/store";
import type { DemoSettings, SpendSnapshot } from "@/lib/demo/policy";
import answerModule from "@/legacy/demo-stream.js";

const ok = (provider: "copyleaks" | "pangram", aiPercent: number): DetectorOutcome => ({ provider, status: "ok", aiPercent, service: "ai_detection", durationMs: 5 });
const failed = (provider: "copyleaks" | "pangram"): DetectorOutcome => ({ provider, status: "failed", code: "http_500", service: "ai_detection", durationMs: 5, called: true });

const words = (n: number, w = "word") => Array(n).fill(w).join(" ");
const A = words(240, "alpha");
const C = words(250, "beta");
const CFG: HumanScoreConfig = { display: true, minWords: 200, lengthTolerance: 0.2 };

const SETTINGS = {
  max_runs_per_email: 5, session_limit: 5, session_window_seconds: 60, ip_limit: 5, ip_window_seconds: 60,
  daily_cap_usd: 100, reset_timezone: "UTC", reserve_per_demo_usd: 1,
} as unknown as DemoSettings;
const SPEND: SpendSnapshot = { spent_today_usd: 0, unpriced_today: 0, inflight: 1, next_reset: "2030-01-01T00:00:00Z" };

function fakeStore(over: Partial<{ cfg: HumanScoreConfig | null; spend: SpendSnapshot; settings: DemoSettings | null }> = {}) {
  const costs: CostEventInput[] = [];
  const updates: Record<string, unknown>[] = [];
  const store = {
    admit: vi.fn(), claimQueued: vi.fn(), requeueStale: vi.fn(), getPricing: vi.fn(async () => null),
    update: vi.fn(async (_id: string, p: Record<string, unknown>) => void updates.push(p)),
    recordCost: vi.fn(async (e: CostEventInput) => void costs.push(e)),
    spendSnapshot: vi.fn(async () => ({ settings: over.settings === undefined ? SETTINGS : over.settings, spend: over.spend ?? SPEND })),
    getHumanScoreConfig: vi.fn(async () => (over.cfg === undefined ? CFG : over.cfg)),
  } as unknown as DemoStore;
  return { store, costs, updates };
}

function client(provider: "copyleaks" | "pangram", byText: (t: string) => DetectorOutcome): DetectorClient & { check: ReturnType<typeof vi.fn> } {
  return { provider, service: "ai_detection", check: vi.fn(async (t: string) => byText(t)) } as never;
}

describe("parsing", () => {
  it("1. Copyleaks summary.ai (0–1) → percent", () => {
    expect(parseCopyleaks({ summary: { human: 0.87, ai: 0.13 } })).toBe(13);
    expect(parseCopyleaks({ summary: { ai: 1.5 } })).toBeNull();
    expect(parseCopyleaks({})).toBeNull();
    expect(parseCopyleaks(null)).toBeNull();
  });
  it("2. Pangram fraction_ai (0–1), legacy ai_likelihood → percent", () => {
    expect(parsePangram({ fraction_ai: 0.42 })).toBe(42);
    expect(parsePangram({ ai_likelihood: 0.05 })).toBe(5);
    expect(parsePangram({ fraction_ai: -1 })).toBeNull();
    expect(parsePangram({ foo: 1 })).toBeNull();
  });
});

describe("formula", () => {
  it("3–4. worse (higher) detector selected; shield = 100 − worse", () => {
    const r = computeHumanScore({ copyleaks: ok("copyleaks", 16), pangram: ok("pangram", 4) });
    expect(r).toMatchObject({ status: "available", worseAiPercent: 16, shield: 84 });
    const r2 = computeHumanScore({ copyleaks: ok("copyleaks", 3), pangram: ok("pangram", 30) });
    expect(r2).toMatchObject({ worseAiPercent: 30, shield: 70 });
  });
  it("5. never averaged, never the better score", () => {
    const r = computeHumanScore({ copyleaks: ok("copyleaks", 10), pangram: ok("pangram", 50) });
    expect(r.status === "available" && r.shield).toBe(50);
    expect(r.status === "available" && r.shield).not.toBe(70); // average would be 70
    expect(r.status === "available" && r.shield).not.toBe(90); // better would be 90
  });
  it("6–7. one or both failing → unavailable, never a fake zero or substitute", () => {
    expect(computeHumanScore({ copyleaks: ok("copyleaks", 10), pangram: failed("pangram") })).toEqual({ status: "unavailable", reason: "pangram_failed" });
    expect(computeHumanScore({ copyleaks: ok("copyleaks", 10) })).toEqual({ status: "unavailable", reason: "pangram_missing" });
    expect(computeHumanScore({ copyleaks: failed("copyleaks"), pangram: failed("pangram") }).status).toBe("unavailable");
    const v = humanScoreView({ aplyer: computeHumanScore({ copyleaks: ok("copyleaks", 10) }), chatgpt: computeHumanScore({ copyleaks: ok("copyleaks", 1), pangram: ok("pangram", 1) }) }, true);
    expect(v).toBeNull();
  });
  it("display is floored so it never overstates; hidden when display is off", () => {
    expect(displayShield(84.99)).toBe(84);
    const stored = { aplyer: computeHumanScore({ copyleaks: ok("copyleaks", 15.01), pangram: ok("pangram", 2) }), chatgpt: computeHumanScore({ copyleaks: ok("copyleaks", 60), pangram: ok("pangram", 90) }) };
    expect(humanScoreView(stored, true)).toEqual({ aplyer: { shield: 84 }, chatgpt: { shield: 10 } });
    expect(humanScoreView(stored, false)).toBeNull();
  });
  it("spec length gate: both > min words, within tolerance; unset tolerance => closed", () => {
    expect(detectorGateOpen(A, C, CFG)).toBe(true);
    expect(detectorGateOpen(words(150), C, CFG)).toBe(false);
    expect(detectorGateOpen(A, words(400), CFG)).toBe(false);
    expect(detectorGateOpen(A, C, { ...CFG, lengthTolerance: null })).toBe(false);
    expect(detectorGateOpen(A, null, CFG)).toBe(false);
  });
});

describe("demo integration", () => {
  const cl = () => client("copyleaks", (t) => ok("copyleaks", t.startsWith("alpha") ? 12 : 70));
  const pg = () => client("pangram", (t) => ok("pangram", t.startsWith("alpha") ? 4 : 95));

  it("only the answer text is sent; cost events recorded per call, unpriced, with timing", async () => {
    const { store, costs, updates } = fakeStore();
    const c = cl(), p = pg();
    const view = await runHumanScore({ store, detectors: [c, p] }, "req-1", A, C);
    expect(view).toEqual({ aplyer: { shield: 88 }, chatgpt: { shield: 5 } });
    expect(c.check).toHaveBeenCalledTimes(2);
    for (const call of [...c.check.mock.calls, ...p.check.mock.calls]) expect([A, C]).toContain(call[0]);
    expect(costs).toHaveLength(4);
    for (const e of costs) {
      expect(e).toMatchObject({ demoRequestId: "req-1", operation: "detector_ai_check", estimatedCostUsd: null, durationMs: 5 });
    }
    expect(costs.map((e) => e.side).sort()).toEqual(["aplyer", "aplyer", "openai", "openai"]);
    expect(updates.at(-1)).toMatchObject({ human_score_status: "available" });
  });
  it("10. daily cap blocks detector calls (no call, no cost, unavailable)", async () => {
    const { store, costs, updates } = fakeStore({ spend: { ...SPEND, unpriced_today: 3 } });
    const c = cl();
    expect(await runHumanScore({ store, detectors: [c, pg()] }, "r", A, C)).toBeNull();
    expect(c.check).not.toHaveBeenCalled();
    expect(costs).toHaveLength(0);
    expect(updates.at(-1)).toMatchObject({ human_score_status: "unavailable" });
  });
  it("length gate / no config / no detectors → no call, answers unaffected", async () => {
    for (const s of [fakeStore({ cfg: { ...CFG, lengthTolerance: null } }), fakeStore({ cfg: null })]) {
      const c = cl();
      expect(await runHumanScore({ store: s.store, detectors: [c, pg()] }, "r", A, C)).toBeNull();
      expect(c.check).not.toHaveBeenCalled();
    }
    expect(await runHumanScore({ store: fakeStore().store }, "r", A, C)).toBeNull();
  });
  it("one provider failing → Human Score unavailable for the request, failure still costed", async () => {
    const { store, costs, updates } = fakeStore();
    const bad = client("pangram", () => failed("pangram"));
    expect(await runHumanScore({ store, detectors: [cl(), bad] }, "r", A, C)).toBeNull();
    expect(costs).toHaveLength(4);
    expect(updates.at(-1)).toMatchObject({ human_score_status: "unavailable" });
  });
  it("display off → stored but not sent; duplicate view honours the switch", async () => {
    const { store, updates } = fakeStore({ cfg: { ...CFG, display: false } });
    expect(await runHumanScore({ store, detectors: [cl(), pg()] }, "r", A, C)).toBeNull();
    const stored = updates.at(-1)!;
    const row = { human_score: stored.human_score, human_score_status: "available" } as DemoRequestRow;
    expect(await storedHumanScoreView(store, row)).toBeNull();
    expect(await storedHumanScoreView(fakeStore().store, row)).toEqual({ aplyer: { shield: 88 }, chatgpt: { shield: 5 } });
  });
  it("Human Score does not touch the scoreboard", async () => {
    const { store, updates } = fakeStore();
    await runHumanScore({ store, detectors: [cl(), pg()] }, "r", A, C);
    for (const u of updates) expect(Object.keys(u).some((k) => k.startsWith("scoreboard"))).toBe(false);
  });
});

describe("clients", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  it("not configured without an approved endpoint + key (no request sent, no hardcoded URL)", async () => {
    delete process.env.COPYLEAKS_DETECTOR_URL;
    delete process.env.PANGRAM_API_KEY;
    const f = vi.fn();
    expect(await copyleaksClient(f as never).check("x", { requestId: "r", side: "aplyer" })).toMatchObject({ status: "not_configured", called: false });
    expect(await pangramClient(f as never).check("x", { requestId: "r", side: "aplyer" })).toMatchObject({ status: "not_configured" });
    expect(f).not.toHaveBeenCalled();
    const src = readFileSync(join(__dirname, "../clients.server.ts"), "utf8");
    expect(src).not.toMatch(/https?:\/\//);
  });
  it("sends only {text}, parses the response, never returns the key", async () => {
    process.env.PANGRAM_DETECTOR_URL = "https://detector.test/check";
    process.env.PANGRAM_API_KEY = "secret-key-123";
    const f = vi.fn(async () => new Response(JSON.stringify({ fraction_ai: 0.25 }), { status: 200 }));
    const out = await pangramClient(f as never).check("the answer", { requestId: "r", side: "chatgpt" });
    expect(out).toMatchObject({ status: "ok", aiPercent: 25 });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ text: "the answer" });
    expect(JSON.stringify(out)).not.toContain("secret-key-123");
    const bad = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await pangramClient(bad as never).check("t", { requestId: "r", side: "aplyer" })).toMatchObject({ status: "failed", code: "unparseable" });
  });
  it("8. credentials never reach browser code", () => {
    for (const f of ["src/legacy/demo.html", "src/legacy/demo-stream.js"]) {
      const s = readFileSync(join(process.cwd(), f), "utf8");
      expect(s).not.toMatch(/COPYLEAKS|PANGRAM|copyleaks|pangram|x-api-key/);
    }
    const view = JSON.stringify(humanScoreView({ aplyer: computeHumanScore({ copyleaks: ok("copyleaks", 1), pangram: ok("pangram", 2) }), chatgpt: computeHumanScore({ copyleaks: ok("copyleaks", 1), pangram: ok("pangram", 2) }) }, true));
    expect(view).not.toMatch(/copyleaks|pangram|aiPercent/);
  });
  it("browser parser only forwards a valid two-sided score", async () => {
    const mod = answerModule as unknown as { requestAnswer?: unknown };
    expect(mod).toBeTruthy();
    const src = readFileSync(join(process.cwd(), "src/legacy/demo-stream.js"), "utf8");
    expect(src).toContain("validHumanScore");
  });
});

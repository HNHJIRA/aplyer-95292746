/**
 * Demo request handler with server-side cost controls — SERVER ONLY.
 *
 * Order: email gate -> inputs -> trusted identifiers -> atomic admission
 * (idempotency + limits + daily cap) -> generate or queue.
 * Nothing the browser sends can change counters, spend, IP or limits.
 */
import { corsHeaders } from "@/lib/cors";
import { sseFrame, sseHeaders } from "@/lib/ai/anthropic-stream.server";
import {
  DEMO_COPY,
  computeCost,
  countWords,
  normalizeWritingSample,
  decideAdmission,
  isValidEmail,
  isValidIdempotencyKey,
  normalizeEmail,
} from "./policy";
import type { DemoStore, DemoRequestRow } from "./store";
import type { DemoAiCall, DemoGenerator, DemoInput } from "./generate.server";
import { DemoGenerationError } from "./generate.server";
import type { ChatgptGenerator } from "./openai.server";
import { spendAllows } from "./policy";
import {
  computeHumanScore,
  detectorGateOpen,
  humanScoreView,
  type DetectorOutcome,
  type HumanScoreView,
  type StoredHumanScore,
} from "@/lib/detectors/human-score";
import type { DetectorClient } from "@/lib/detectors/clients.server";
import { resolveScoreboard, selectMarkers, type MarkerSelection, type ScoreboardView } from "./scoreboard";

export const DEMO_SESSION_COOKIE = "aplyer_demo_sid";

export interface DemoDeps {
  store: DemoStore;
  generate: DemoGenerator;
  /** ChatGPT side (exact client prompt). Omitted = single-sided (tests/legacy). */
  generateChatgpt?: ChatgptGenerator;
  /** Server secret used to hash session/IP identifiers and scope idempotency keys. */
  salt: string | undefined;
  /** Optional deliverability check (existing ZeroBounce rule). false = reject. */
  checkEmail?: (email: string) => Promise<boolean>;
  /** AI-detector clients (Copyleaks + Pangram). Omitted => Human Score unavailable. */
  detectors?: DetectorClient[];
  /** Detector calls are refused until approved detector pricing exists. */
  detectorPricingConfigured?: () => boolean;
}

async function sha256(v: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function wantsStream(request: Request): boolean {
  try {
    if (new URL(request.url).searchParams.get("stream") === "1") return true;
  } catch {
    /* relative URLs in tests */
  }
  return (request.headers.get("accept") ?? "").includes("text/event-stream");
}

/**
 * Trusted client IP: only the edge-set `cf-connecting-ip` header is used.
 * Body fields and X-Forwarded-For are ignored. Unknown callers share one bucket.
 */
export function trustedIp(request: Request): string {
  return (request.headers.get("cf-connecting-ip") ?? "").trim() || "unknown";
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=") || null;
  }
  return null;
}

const SID_RE = /^[A-Za-z0-9-]{16,64}$/;

function respond(
  request: Request,
  body: unknown,
  status: number,
  setCookie: string | null,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...corsHeaders(request),
  };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

function duplicateResponse(req: DemoRequestRow): { body: Record<string, unknown>; status: number } {
  switch (req.status) {
    case "completed":
      return {
        body: {
          status: "completed",
          answer: req.answer ?? "",
          ...(chatgptView(req) ? { chatgpt: chatgptView(req) } : {}),
          ...(req.scoreboard_status === "shown" && req.scoreboard ? { scoreboard: req.scoreboard } : {}),
        },
        status: 200,
      };
    case "queued":
      return { body: { status: "queued", message: DEMO_COPY.queued }, status: 202 };
    case "admitting":
    case "running":
    case "processing":
      return { body: { status: "processing", message: DEMO_COPY.processing }, status: 202 };
    case "rejected":
      return { body: { error: DEMO_COPY.rateLimited }, status: 429 };
    default:
      return { body: { error: DEMO_COPY.retry }, status: 409 };
  }
}

/** Records one AI operation's cost. Unknown pricing => unpriced, never guessed. */
/**
 * Records every actual AI call of one Demo side as its own cost event.
 * Returns the summed estimated cost, or null when any call is unpriced
 * (a price is never guessed).
 */
export async function recordGenerationCost(
  store: DemoStore,
  demoRequestId: string,
  side: "openai" | "aplyer",
  calls: DemoAiCall[],
): Promise<{ cost: number | null }> {
  let total: number | null = calls.length ? 0 : null;
  for (const c of calls) {
    const pricing = await store.getPricing(c.provider, c.model).catch(() => null);
    const cost = computeCost(pricing, c.usage);
    await store.recordCost({
      demoRequestId,
      side,
      provider: c.provider,
      model: c.model,
      operation: c.operation,
      inputTokens: c.usage.inputTokens ?? null,
      outputTokens: c.usage.outputTokens ?? null,
      estimatedCostUsd: cost,
    });
    total = cost === null || total === null ? null : Math.round((total + cost) * 1e6) / 1e6;
  }
  return { cost: total };
}

/** Records the calls billed before a failure. Never throws. */
export async function recordFailedCalls(
  store: DemoStore,
  demoRequestId: string,
  e: unknown,
  side: "openai" | "aplyer" = "aplyer",
): Promise<{ cost: number | null } | null> {
  if (!(e instanceof DemoGenerationError) || e.calls.length === 0) return null;
  try {
    return await recordGenerationCost(store, demoRequestId, side, e.calls);
  } catch (err) {
    console.error("[demo] cost record failed", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Candidate-facing ChatGPT result. Never carries provider diagnostics. */
export interface ChatgptView {
  status: "completed" | "failed" | "not_configured";
  answer?: string;
  /** Exact string that was sent to OpenAI (only when completed). */
  prompt?: string;
  error?: string;
}

export const CHATGPT_COPY = {
  failed: "The ChatGPT answer could not be generated this time.",
  notConfigured: "The ChatGPT comparison is not available yet.",
};

export function chatgptView(row: DemoRequestRow): ChatgptView | null {
  if (row.chatgpt_status === "completed" && row.chatgpt_answer) {
    return { status: "completed", answer: row.chatgpt_answer, prompt: row.chatgpt_prompt ?? undefined };
  }
  if (row.chatgpt_status === "failed") return { status: "failed", error: CHATGPT_COPY.failed };
  if (row.chatgpt_status === "not_configured") return { status: "not_configured", error: CHATGPT_COPY.notConfigured };
  return null;
}

function sumCost(a: number | null | undefined, b: number | null | undefined, anyCalls: boolean): number | null {
  if (!anyCalls) return null;
  if (a === null || b === null) return null;
  return Math.round(((a ?? 0) + (b ?? 0)) * 1e6) / 1e6;
}

type Send = ((event: string, data: unknown) => void) | null;

export interface SideOutcome {
  ok: boolean;
  text: string;
  error: string;
  cost: number | null | undefined;
  calls: number;
}

/** Aplyer side: the unchanged Step 3 pipeline. Never throws. */
async function runAplyerSide(
  deps: DemoDeps,
  id: string,
  input: DemoInput,
  send: Send,
  styleNote: string | null = null,
): Promise<SideOutcome> {
  try {
    const result = await deps.generate(
      input,
      send
        ? { onDelta: (text) => send("delta", { text }), onProgress: (stage) => send("progress", { stage }) }
        : styleNote
          ? { styleNote }
          : undefined,
    );
    let cost: number | null = null;
    try {
      cost = (await recordGenerationCost(deps.store, id, result.side, result.calls)).cost;
    } catch (e) {
      console.error(`[demo] cost record failed request=${id}`, e instanceof Error ? e.name : "unknown");
    }
    await deps.store.update(id, { answer: result.text });
    return { ok: true, text: result.text, error: "", cost, calls: result.calls.length };
  } catch (e) {
    const rec = await recordFailedCalls(deps.store, id, e, "aplyer");
    const code = e instanceof DemoGenerationError ? e.code : e instanceof Error ? e.name : "unknown";
    await deps.store.update(id, { last_error: code.slice(0, 200) }).catch(() => undefined);
    return {
      ok: false,
      text: "",
      error: e instanceof DemoGenerationError && e.busy ? "The demo is busy. Please try again in a moment." : DEMO_COPY.generic,
      cost: rec?.cost,
      calls: e instanceof DemoGenerationError ? e.calls.length : 0,
    };
  }
}

/** ChatGPT side: exact client prompt, persisted before returning. Never throws. */
export async function runChatgptSide(
  gen: ChatgptGenerator,
  store: DemoStore,
  id: string,
  input: DemoInput,
  send: Send,
): Promise<{ view: ChatgptView; cost: number | null | undefined; calls: number }> {
  try {
    const r = await gen(input, send ? { onDelta: (text) => send("chatgpt_delta", { text }) } : undefined);
    let cost: number | null = null;
    try {
      cost = (await recordGenerationCost(store, id, "openai", r.calls)).cost;
    } catch (e) {
      console.error(`[demo] openai cost record failed request=${id}`, e instanceof Error ? e.name : "unknown");
    }
    await store.update(id, { chatgpt_answer: r.text, chatgpt_prompt: r.prompt, chatgpt_status: "completed" });
    const view: ChatgptView = { status: "completed", answer: r.text, prompt: r.prompt };
    send?.("chatgpt_final", { answer: r.text, prompt: r.prompt });
    return { view, cost, calls: r.calls.length };
  } catch (e) {
    const notConfigured = e instanceof DemoGenerationError && e.code === "not_configured";
    const rec = await recordFailedCalls(store, id, e, "openai");
    const code = e instanceof DemoGenerationError ? e.code : "unknown";
    console.warn(`[demo] chatgpt side failed request=${id} code=${code.slice(0, 40)}`);
    await store.update(id, { chatgpt_status: notConfigured ? "not_configured" : "failed" }).catch(() => undefined);
    const view: ChatgptView = notConfigured
      ? { status: "not_configured", error: CHATGPT_COPY.notConfigured }
      : { status: "failed", error: CHATGPT_COPY.failed };
    send?.("chatgpt_error", { status: view.status, error: view.error });
    return { view, cost: rec?.cost, calls: e instanceof DemoGenerationError ? e.calls.length : 0 };
  }
}

/** Loads scoreboard config; any failure => null (scoreboard suppressed). */
export async function loadScoreboardSelection(store: DemoStore, writingSample: string | null): Promise<MarkerSelection | null> {
  if (!writingSample || !store.getScoreboardConfig) return null;
  try {
    return selectMarkers(writingSample, await store.getScoreboardConfig());
  } catch {
    return null;
  }
}

/**
 * Scoreboard step after both answers are complete. Markers were fixed from
 * the writing sample BEFORE generation. Regeneration uses the unchanged Aplyer
 * side (its cost is recorded like any Aplyer generation). Never throws.
 */
export async function scoreAndMaybeRegenerate(
  deps: Pick<DemoDeps, "store" | "generate">,
  id: string,
  input: DemoInput,
  selection: MarkerSelection | null,
  aplyerText: string,
  chatgptText: string | null,
): Promise<{ aplyerText: string; scoreboard: ScoreboardView | null; extraCost: number | null; extraCalls: number }> {
  let extraCost: number | null = 0;
  let extraCalls = 0;
  const outcome = await resolveScoreboard({
    selection,
    aplyerText,
    chatgptText,
    regenerate: async (note) => {
      const r = await runAplyerSide(deps as DemoDeps, id, input, null, note);
      extraCalls += r.calls;
      extraCost = extraCost === null || r.cost === null || r.cost === undefined ? (r.calls ? null : extraCost) : extraCost + r.cost;
      return r.ok ? r.text : null;
    },
  }).catch(() => null);
  if (!outcome) {
    await deps.store.update(id, { scoreboard: null, scoreboard_status: "suppressed" }).catch(() => undefined);
    return { aplyerText, scoreboard: null, extraCost, extraCalls };
  }
  if (outcome.suppressedReason && selection) {
    // Spec: log every suppression with the failing markers. Ids and metric names only.
    console.warn(
      JSON.stringify({ evt: "demo_scoreboard_suppressed", request: id, reason: outcome.suppressedReason, markers: outcome.failingMarkers, attempts: outcome.attempts }),
    );
  }
  if (outcome.aplyerText !== aplyerText) await deps.store.update(id, { answer: outcome.aplyerText }).catch(() => undefined);
  await deps.store
    .update(id, { scoreboard: outcome.scoreboard, scoreboard_status: outcome.scoreboard ? "shown" : "suppressed" })
    .catch(() => undefined);
  return { aplyerText: outcome.aplyerText, scoreboard: outcome.scoreboard, extraCost, extraCalls };
}

/**
 * Human Score step — runs AFTER the scoreboard and independently of it (it
 * neither reads nor changes the scoreboard). Only the two final answer texts
 * are sent to the detectors. Order of gates, all before any paid call:
 * configuration present -> spec length gate -> daily cap still allows spend.
 * Every provider call is recorded as a cost event (unpriced: no approved
 * detector pricing exists). Results are stored once, so retries never re-bill.
 * Returns the candidate-facing view, or null (hidden). Never throws.
 */
export async function runHumanScore(
  deps: Pick<DemoDeps, "store" | "detectors"> & { detectorPricingConfigured?: () => boolean },
  id: string,
  aplyerText: string | null,
  chatgptText: string | null,
): Promise<HumanScoreView | null> {
  const { store } = deps;
  const unavailable = async (reason: string) => {
    console.log(JSON.stringify({ evt: "demo_human_score_unavailable", request: id, reason }));
    await store.update(id, { human_score: null, human_score_status: "unavailable" }).catch(() => undefined);
    return null;
  };
  try {
    if (!deps.detectors?.length || !store.getHumanScoreConfig) return await unavailable("not_configured");
    if (deps.detectorPricingConfigured && !deps.detectorPricingConfigured()) return await unavailable("pricing_missing");
    const cfg = await store.getHumanScoreConfig().catch(() => null);
    if (!cfg) return await unavailable("no_config");
    if (!detectorGateOpen(aplyerText, chatgptText, cfg)) return await unavailable("length_gate");
    const { settings, spend } = await store.spendSnapshot();
    if (!settings || !spendAllows(settings, spend)) return await unavailable("daily_cap");

    const sides = [
      { side: "aplyer" as const, costSide: "aplyer" as const, text: aplyerText! },
      { side: "chatgpt" as const, costSide: "openai" as const, text: chatgptText! },
    ];
    const runs = await Promise.all(
      sides.flatMap((s) =>
        deps.detectors!.map(async (client) => {
          const out: DetectorOutcome = await client
            .check(s.text, { requestId: id, side: s.side })
            .catch(() => ({ provider: client.provider, status: "failed" as const, code: "client_error", service: client.service, durationMs: 0, called: true }));
          if (out.status === "ok" || out.called) {
            await store
              .recordCost({
                demoRequestId: id,
                side: s.costSide,
                provider: client.provider,
                model: client.service,
                operation: "detector_ai_check",
                inputTokens: null,
                outputTokens: null,
                estimatedCostUsd: null, // no approved detector pricing => unpriced, never guessed
                durationMs: out.durationMs,
              })
              .catch((e) => console.error(`[demo] detector cost record failed request=${id}`, e instanceof Error ? e.message : "unknown"));
          }
          return { side: s.side, out };
        }),
      ),
    );
    const pick = (side: "aplyer" | "chatgpt") =>
      computeHumanScore(Object.fromEntries(runs.filter((r) => r.side === side).map((r) => [r.out.provider, r.out])));
    const stored: StoredHumanScore = { aplyer: pick("aplyer"), chatgpt: pick("chatgpt") };
    const ok = stored.aplyer.status === "available" && stored.chatgpt.status === "available";
    if (!ok) {
      const reasons = [stored.aplyer, stored.chatgpt].map((r) => (r.status === "unavailable" ? r.reason : "ok"));
      console.log(JSON.stringify({ evt: "demo_human_score_unavailable", request: id, reason: reasons.join(",") }));
    }
    await store.update(id, { human_score: stored, human_score_status: ok ? "available" : "unavailable" }).catch(() => undefined);
    return humanScoreView(stored, cfg.display);
  } catch (e) {
    return await unavailable(e instanceof Error ? e.name : "unknown");
  }
}

/** Reads the display switch for an already-stored result (duplicates). */
export async function storedHumanScoreView(store: DemoStore, row: DemoRequestRow): Promise<HumanScoreView | null> {
  if (row.human_score_status !== "available" || !store.getHumanScoreConfig) return null;
  const cfg = await store.getHumanScoreConfig().catch(() => null);
  return humanScoreView(row.human_score, cfg?.display === true);
}

/**
 * Runs both sides concurrently from one canonical input inside one admitted
 * request, then (non-streamed) the scoreboard, then writes the terminal row
 * state once (payload cleared).
 */
async function runBothSides(deps: DemoDeps, id: string, input: DemoInput, send: Send) {
  // Markers are chosen from the writing sample only, before either answer exists.
  const selection = await loadScoreboardSelection(deps.store, input.writingSample);
  const [aplyer, gpt] = await Promise.all([
    runAplyerSide(deps, id, input, send),
    deps.generateChatgpt ? runChatgptSide(deps.generateChatgpt, deps.store, id, input, send) : Promise.resolve(null),
  ]);
  let scoreboard: ScoreboardView | null = null;
  let aplyerCost = aplyer.cost;
  let aplyerCalls = aplyer.calls;
  if (aplyer.ok) {
    const gptText = gpt?.view.status === "completed" ? gpt.view.answer ?? null : null;
    const sb = await scoreAndMaybeRegenerate(deps, id, input, selection, aplyer.text, gptText);
    aplyer.text = sb.aplyerText;
    scoreboard = sb.scoreboard;
    aplyerCalls += sb.extraCalls;
    aplyerCost = sb.extraCalls ? (aplyerCost === null || aplyerCost === undefined || sb.extraCost === null ? null : aplyerCost + sb.extraCost) : aplyerCost;
  }
  const gptFinal = gpt?.view.status === "completed" ? gpt.view.answer ?? null : null;
  const humanScore = aplyer.ok ? await runHumanScore(deps, id, aplyer.text, gptFinal) : null;
  const cost = sumCost(aplyerCost, gpt ? gpt.cost : 0, aplyerCalls + (gpt?.calls ?? 0) > 0);
  await deps.store
    .update(id, {
      status: aplyer.ok ? "completed" : "failed",
      payload: null,
      estimated_cost_usd: cost,
      cost_status: cost === null ? "unpriced" : "priced",
      completed_at: aplyer.ok ? new Date().toISOString() : null,
    })
    .catch(() => undefined);
  return { aplyer, chatgpt: gpt?.view ?? null, scoreboard, humanScore };
}

export async function handleDemoRequest(request: Request, deps: DemoDeps): Promise<Response> {
  let setCookie: string | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // 1. Email gate (server-enforced).
    const email = normalizeEmail(body.email);
    if (!email) return respond(request, { error: DEMO_COPY.emailRequired }, 400, null);
    if (!isValidEmail(email)) return respond(request, { error: DEMO_COPY.emailInvalid }, 400, null);

    const writingSample = normalizeWritingSample(body.writingSample);
    if (writingSample === undefined) {
      return respond(request, { error: DEMO_COPY.fieldsRequired }, 400, null);
    }
    const input: DemoInput = {
      resume: str(body.resume),
      jobDescription: str(body.jobDescription),
      question: str(body.question),
      writingSample,
      writingSampleWordCount: countWords(writingSample),
    };
    if (!input.resume || !input.jobDescription || !input.question) {
      return respond(request, { error: DEMO_COPY.fieldsRequired }, 400, null);
    }

    if (deps.checkEmail && !(await deps.checkEmail(email).catch(() => true))) {
      return respond(request, { error: DEMO_COPY.emailInvalid }, 400, null);
    }

    if (!deps.salt) {
      console.error("[demo] missing DEMO_HASH_SALT");
      return respond(request, { error: DEMO_COPY.unavailable }, 503, null);
    }

    // 2. Trusted identifiers. Session = server-issued HttpOnly cookie.
    let sid = readCookie(request, DEMO_SESSION_COOKIE);
    if (!sid || !SID_RE.test(sid)) {
      sid = crypto.randomUUID();
      setCookie = `${DEMO_SESSION_COOKIE}=${sid}; Path=/api/public; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
    }
    const sessionHash = await sha256(`${deps.salt}|sid|${sid}`);
    const ipHash = await sha256(`${deps.salt}|ip|${trustedIp(request)}`);

    // 3. Idempotency: client key is validated and scoped to this email on the
    // server; without one, the request content itself is the key.
    const contentHash = await sha256(
      `${input.resume}\u0000${input.jobDescription}\u0000${input.question}\u0000${input.writingSample ?? ""}`,
    );
    const rawKey =
      request.headers.get("idempotency-key") ?? (typeof body.idempotencyKey === "string" ? body.idempotencyKey : "");
    const keySource = isValidIdempotencyKey(rawKey) ? `k:${rawKey}` : `c:${contentHash}`;
    const idempotencyKey = await sha256(`${deps.salt}|idem|${email}|${keySource}`);

    // 4. Atomic admission.
    const admitted = await deps.store.admit({
      email,
      sessionHash,
      ipHash,
      idempotencyKey,
      contentHash,
      payload: input,
    });

    if (admitted.duplicate) {
      const d = duplicateResponse(admitted.request);
      if (admitted.request.status === "completed") {
        const hs = await storedHumanScoreView(deps.store, admitted.request);
        if (hs) d.body.humanScore = hs;
      }
      return respond(request, d.body, d.status, setCookie);
    }

    const row = admitted.request;
    const decision = decideAdmission(admitted.settings, admitted.counts, admitted.spend);

    if (decision.action === "reject") {
      await deps.store.update(row.id, { status: "rejected", reject_reason: decision.reason, payload: null });
      const msg = decision.reason === "email_limit" ? DEMO_COPY.emailLimit : DEMO_COPY.rateLimited;
      return respond(request, { error: msg }, 429, setCookie);
    }

    if (decision.action === "queue") {
      await deps.store.update(row.id, {
        status: "queued",
        queue_reason: decision.reason,
        next_run_at: new Date().toISOString(),
      });
      console.log(`[demo] queued request=${row.id} reason=${decision.reason}`);
      return respond(request, { status: "queued", message: DEMO_COPY.queued }, 202, setCookie);
    }

    // 5. Run now. The original inputs stay in the secure request row until
    // processing ends (completed or failed), then are cleared.
    await deps.store.update(row.id, { status: "running" });

    // 5. Run now. Both sides consume the SAME canonical `input` object and run
    // concurrently inside this one admitted request (one reservation).
    if (wantsStream(request)) {
      const encoder = new TextEncoder();
      const out = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false;
          const send = (event: string, data: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(sseFrame(event, data)));
            } catch {
              closed = true;
            }
          };
          void (async () => {
            try {
              send("open", { ok: true });
              const r = await runBothSides(deps, row.id, input, send);
              if (r.aplyer.ok) {
                send("final", { answer: r.aplyer.text });
                // Only a complete, valid scoreboard is ever sent (never streamed).
                if (r.scoreboard) send("scoreboard", r.scoreboard);
                // Only valid, displayable scores for BOTH answers are ever sent.
                if (r.humanScore) send("human_score", r.humanScore);
              }
              else send("error", { error: r.aplyer.error });
            } catch (e) {
              console.error(`[demo] stream failed request=${row.id}`, e instanceof Error ? e.name : "unknown");
              send("error", { error: DEMO_COPY.generic });
            } finally {
              send("done", { ok: true });
              closed = true;
              try {
                controller.close();
              } catch {
                /* client gone */
              }
            }
          })();
        },
      });
      const headers = sseHeaders(corsHeaders(request));
      if (setCookie) headers["Set-Cookie"] = setCookie;
      return new Response(out, { status: 200, headers });
    }

    const r = await runBothSides(deps, row.id, input, null);
    const out: Record<string, unknown> = r.aplyer.ok ? { answer: r.aplyer.text } : { error: r.aplyer.error };
    if (r.chatgpt) out.chatgpt = r.chatgpt;
    if (r.aplyer.ok && r.scoreboard) out.scoreboard = r.scoreboard;
    if (r.aplyer.ok && r.humanScore) out.humanScore = r.humanScore;
    return respond(request, out, r.aplyer.ok ? 200 : 500, setCookie);
  } catch (err) {
    console.error("[demo]", err instanceof Error ? err.message : err);
    return respond(request, { error: DEMO_COPY.generic }, 500, setCookie);
  }
}

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
import type { DemoGenerationResult, DemoGenerator, DemoInput } from "./generate.server";
import { DemoGenerationError } from "./generate.server";

export const DEMO_SESSION_COOKIE = "aplyer_demo_sid";

export interface DemoDeps {
  store: DemoStore;
  generate: DemoGenerator;
  /** Server secret used to hash session/IP identifiers and scope idempotency keys. */
  salt: string | undefined;
  /** Optional deliverability check (existing ZeroBounce rule). false = reject. */
  checkEmail?: (email: string) => Promise<boolean>;
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
      return { body: { status: "completed", answer: req.answer ?? "" }, status: 200 };
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
export async function recordGenerationCost(
  store: DemoStore,
  demoRequestId: string,
  r: DemoGenerationResult,
): Promise<{ cost: number | null }> {
  const pricing = await store.getPricing(r.provider, r.model).catch(() => null);
  const cost = computeCost(pricing, r.usage);
  await store.recordCost({
    demoRequestId,
    side: r.side,
    provider: r.provider,
    model: r.model,
    operation: r.operation,
    inputTokens: r.usage.inputTokens ?? null,
    outputTokens: r.usage.outputTokens ?? null,
    estimatedCostUsd: cost,
  });
  return { cost };
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

    // 5. Run now. The payload is not kept once generation starts.
    await deps.store.update(row.id, { status: "running", payload: null });

    const finish = async (result: DemoGenerationResult) => {
      let cost: number | null = null;
      try {
        cost = (await recordGenerationCost(deps.store, row.id, result)).cost;
      } catch (e) {
        console.error("[demo] cost record failed", e instanceof Error ? e.message : e);
      }
      await deps.store.update(row.id, {
        status: "completed",
        answer: result.text,
        estimated_cost_usd: cost,
        cost_status: cost === null ? "unpriced" : "priced",
        completed_at: new Date().toISOString(),
      });
    };
    const fail = async (e: unknown) => {
      const code = e instanceof DemoGenerationError ? e.code : e instanceof Error ? e.name : "unknown";
      await deps.store
        .update(row.id, { status: "failed", last_error: code.slice(0, 200) })
        .catch(() => undefined);
      return e instanceof DemoGenerationError && e.busy
        ? "The demo is busy. Please try again in a moment."
        : DEMO_COPY.generic;
    };

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
              const result = await deps.generate(input, (text) => send("delta", { text }));
              await finish(result);
              send("final", { answer: result.text });
            } catch (e) {
              console.error("[demo] stream failed", e instanceof Error ? e.message : e);
              send("error", { error: await fail(e) });
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

    try {
      const result = await deps.generate(input);
      await finish(result);
      return respond(request, { answer: result.text }, 200, setCookie);
    } catch (e) {
      const msg = await fail(e);
      return respond(request, { error: msg }, 500, setCookie);
    }
  } catch (err) {
    console.error("[demo]", err instanceof Error ? err.message : err);
    return respond(request, { error: DEMO_COPY.generic }, 500, setCookie);
  }
}

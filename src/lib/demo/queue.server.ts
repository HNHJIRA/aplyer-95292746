/**
 * Durable demo queue runner — SERVER ONLY.
 *
 * Mirrors the waitlist queue: atomic FOR UPDATE SKIP LOCKED claim, stale-lock
 * recovery, bounded exponential retries (max_attempts), terminal 'failed'.
 * A claimed request is only generated when the hard daily cap allows it;
 * otherwise it goes back to 'queued' until the next reset without using up
 * a retry attempt.
 */
import { countWords, missingSettings, spendAllows } from "./policy";
import type { DemoStore, DemoRequestRow } from "./store";
import type { DemoGenerator, DemoInput } from "./generate.server";
import { DemoGenerationError } from "./generate.server";
import {
  loadScoreboardSelection,
  recordFailedCalls,
  recordGenerationCost,
  runChatgptSide,
  scoreAndMaybeRegenerate,
  type ChatgptView,
} from "./handler.server";
import type { ChatgptGenerator } from "./openai.server";

const BACKOFF_MINUTES = [5, 15, 60, 180, 720];

export interface DemoQueueDeps {
  store: DemoStore;
  generate: DemoGenerator;
  /** ChatGPT side; omitted = single-sided. */
  generateChatgpt?: ChatgptGenerator;
  sendResult: (
    to: string,
    input: DemoInput,
    answer: string,
    chatgpt?: ChatgptView | null,
  ) => Promise<{ ok: boolean; errorCode?: string }>;
  now?: () => number;
}

function toInput(p: unknown): DemoInput | null {
  const o = p as Record<string, unknown> | null;
  if (!o || typeof o.resume !== "string" || typeof o.jobDescription !== "string" || typeof o.question !== "string") {
    return null;
  }
  const ws = typeof o.writingSample === "string" && o.writingSample.trim() ? o.writingSample : null;
  return {
    resume: o.resume,
    jobDescription: o.jobDescription,
    question: o.question,
    writingSample: ws,
    writingSampleWordCount: countWords(ws),
  };
}

export async function drainDemoQueue(
  deps: DemoQueueDeps,
  limit = 5,
): Promise<{ processed: number; completed: number; deferred: number; failed: number }> {
  const now = deps.now ?? Date.now;
  const tally = { processed: 0, completed: 0, deferred: 0, failed: 0 };
  try {
    await deps.store.requeueStale();
    const jobs = await deps.store.claimQueued(limit);
    for (const job of jobs) {
      tally.processed += 1;
      await runOne(deps, job, now, tally);
    }
  } catch (e) {
    console.warn(`[demo-queue] drain error ${e instanceof Error ? e.message : "unknown"}`);
  }
  return tally;
}

async function runOne(
  deps: DemoQueueDeps,
  job: DemoRequestRow,
  now: () => number,
  tally: { completed: number; deferred: number; failed: number },
) {
  const { store } = deps;

  // Cap / configuration gate — checked with this job counted as in flight.
  const { settings, spend } = await store.spendSnapshot();
  const configured = !!settings && missingSettings(settings).length === 0;
  if (!configured || !spendAllows(settings!, spend)) {
    const next =
      configured && spend?.next_reset
        ? spend.next_reset
        : new Date(now() + 60 * 60_000).toISOString();
    await store.update(job.id, {
      status: "queued",
      locked_at: null,
      attempts: Math.max(0, job.attempts - 1), // deferral is not a failed attempt
      next_run_at: next,
    });
    tally.deferred += 1;
    return;
  }

  const input = toInput(job.payload);
  if (!input) {
    await store.update(job.id, { status: "failed", locked_at: null, last_error: "missing_payload" });
    tally.failed += 1;
    return;
  }

  try {
    // Each side runs at most once per successful result: an answer already
    // persisted (e.g. an earlier attempt whose email failed) is never regenerated.
    // Markers fixed from the writing sample before any generation in this run.
    const selection = job.scoreboard_status ? null : await loadScoreboardSelection(store, input.writingSample);
    let answer = job.answer;
    let total: number | null | undefined = undefined;
    let chatgpt: ChatgptView | null =
      job.chatgpt_status === "completed" && job.chatgpt_answer
        ? { status: "completed", answer: job.chatgpt_answer, prompt: job.chatgpt_prompt ?? undefined }
        : null;
    const needGpt = !!deps.generateChatgpt && !chatgpt;
    const [aplyerRes, gptRes] = await Promise.all([
      answer
        ? Promise.resolve(null)
        : deps.generate(input).then(
            (r) => ({ ok: true as const, r }),
            (e: unknown) => ({ ok: false as const, e }),
          ),
      needGpt ? runChatgptSide(deps.generateChatgpt!, store, job.id, input, null) : Promise.resolve(null),
    ]);
    if (gptRes) chatgpt = gptRes.view;
    if (aplyerRes) {
      if (!aplyerRes.ok) throw aplyerRes.e;
      const result = aplyerRes.r;
      const { cost } = await recordGenerationCost(store, job.id, result.side, result.calls);
      answer = result.text;
      total = cost === null || gptRes?.cost === null ? null : Math.round((cost + (gptRes?.cost ?? 0)) * 1e6) / 1e6;
      // Persist before emailing so a send retry never pays for a second generation.
      await store.update(job.id, {
        answer,
        estimated_cost_usd: total,
        cost_status: total === null ? "unpriced" : "priced",
      });
    }
    // Scoreboard (and at most one Aplyer regeneration) runs once; a stored
    // status means an earlier attempt already did it, so an email retry never regenerates.
    if (!job.scoreboard_status && answer) {
      const gptText = chatgpt?.status === "completed" ? chatgpt.answer ?? null : null;
      const sb = await scoreAndMaybeRegenerate(deps, job.id, input, selection, answer, gptText);
      answer = sb.aplyerText;
      if (sb.extraCalls) {
        const known = total !== undefined ? total : (job as { estimated_cost_usd?: number | null }).estimated_cost_usd ?? null;
        const next = known === null || sb.extraCost === null ? null : Math.round((known + sb.extraCost) * 1e6) / 1e6;
        await store.update(job.id, { estimated_cost_usd: next, cost_status: next === null ? "unpriced" : "priced" });
      }
    }
    const sent = await deps.sendResult(job.email, input, answer!, chatgpt);
    if (!sent.ok) throw new DemoGenerationError(`email_${sent.errorCode ?? "failed"}`);
    await store.update(job.id, {
      status: "completed",
      locked_at: null,
      last_error: null,
      payload: null,
      delivered_at: new Date(now()).toISOString(),
      completed_at: new Date(now()).toISOString(),
    });
    tally.completed += 1;
  } catch (e) {
    await recordFailedCalls(store, job.id, e);
    const code = e instanceof DemoGenerationError ? e.code : e instanceof Error ? e.name : "unknown";
    const exhausted = job.attempts >= job.max_attempts;
    const delay = BACKOFF_MINUTES[Math.min(job.attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 60;
    await store.update(job.id, {
      status: exhausted ? "failed" : "queued",
      locked_at: null,
      last_error: code.slice(0, 200),
      next_run_at: new Date(now() + delay * 60_000).toISOString(),
    });
    tally.failed += 1;
  }
}

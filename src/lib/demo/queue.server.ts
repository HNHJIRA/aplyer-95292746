/**
 * Durable demo queue runner — SERVER ONLY.
 *
 * Mirrors the waitlist queue: atomic FOR UPDATE SKIP LOCKED claim, stale-lock
 * recovery, bounded exponential retries (max_attempts), terminal 'failed'.
 * A claimed request is only generated when the hard daily cap allows it;
 * otherwise it goes back to 'queued' until the next reset without using up
 * a retry attempt.
 */
import { missingSettings, spendAllows } from "./policy";
import type { DemoStore, DemoRequestRow } from "./store";
import type { DemoGenerator, DemoInput } from "./generate.server";
import { DemoGenerationError } from "./generate.server";
import { recordGenerationCost } from "./handler.server";

const BACKOFF_MINUTES = [5, 15, 60, 180, 720];

export interface DemoQueueDeps {
  store: DemoStore;
  generate: DemoGenerator;
  sendResult: (to: string, input: DemoInput, answer: string) => Promise<{ ok: boolean; errorCode?: string }>;
  now?: () => number;
}

function isInput(p: unknown): p is DemoInput {
  const o = p as Record<string, unknown> | null;
  return !!o && typeof o.resume === "string" && typeof o.jobDescription === "string" && typeof o.question === "string";
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

  if (!isInput(job.payload)) {
    await store.update(job.id, { status: "failed", locked_at: null, last_error: "missing_payload" });
    tally.failed += 1;
    return;
  }
  const input = job.payload;

  try {
    let answer = job.answer;
    if (!answer) {
      const result = await deps.generate(input);
      const { cost } = await recordGenerationCost(store, job.id, result);
      answer = result.text;
      // Persist before emailing so a send retry never pays for a second generation.
      await store.update(job.id, {
        answer,
        estimated_cost_usd: cost,
        cost_status: cost === null ? "unpriced" : "priced",
      });
    }
    const sent = await deps.sendResult(job.email, input, answer);
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

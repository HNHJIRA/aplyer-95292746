/**
 * Durable waitlist follow-up queue — SERVER ONLY.
 *
 * Signup confirmation must not wait on Brevo. Secondary work is persisted in
 * `public.waitlist_jobs` (durable, retryable, unique per kind+email) and then
 * attempted immediately in the background via the runtime's `waitUntil`.
 * Anything that fails or is orphaned by a worker crash is retried with
 * exponential backoff by the drain that runs alongside later requests.
 *
 * Idempotency lives in two places and both are preserved:
 *   - the unique (kind, email) constraint stops duplicate jobs, and
 *   - each handler is itself idempotent (`sendWelcomeEmailOnce` ledger,
 *     Brevo contact upsert).
 */
import { syncBrevoContact } from "@/lib/email/brevo-contact.server";
import { sendWelcomeEmailOnce } from "@/lib/email/brevo.server";

export type WaitlistJobKind = "brevo_contact" | "welcome_email";

const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60, 180];

export interface WaitlistJobPayload {
  firstName?: string | null;
  source?: string | null;
}

interface ClaimedJob {
  id: string;
  kind: string;
  email: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Persist the follow-up work for one signup. Never throws — a queue write
 * failure must not turn a stored signup into an error response.
 */
export async function enqueueWaitlistJobs(input: {
  email: string;
  firstName?: string | null;
  source?: string | null;
  kinds?: WaitlistJobKind[];
}): Promise<{ ok: boolean; enqueued: number }> {
  const email = input.email.toLowerCase();
  const kinds = input.kinds ?? (["brevo_contact", "welcome_email"] as WaitlistJobKind[]);
  const payload: WaitlistJobPayload = {
    firstName: input.firstName ?? null,
    source: input.source ?? null,
  };

  try {
    const db = await admin();
    const { error } = await db.from("waitlist_jobs").upsert(
      kinds.map((kind) => ({
        kind,
        email,
        payload: payload as never,
        status: "pending",
        next_run_at: new Date().toISOString(),
      })),
      // A job already queued or in flight for this address stays as-is: re-submitting
      // the same email must never produce a second contact sync or email.
      { onConflict: "kind,email", ignoreDuplicates: true },
    );
    if (error) {
      console.warn(`[waitlist-jobs] enqueue failed code=${error.code ?? "unknown"}`);
      return { ok: false, enqueued: 0 };
    }
    return { ok: true, enqueued: kinds.length };
  } catch (e) {
    console.warn(`[waitlist-jobs] enqueue error code=${e instanceof Error ? e.name : "unknown"}`);
    return { ok: false, enqueued: 0 };
  }
}

async function runJob(job: ClaimedJob): Promise<{ ok: boolean; errorCode?: string }> {
  const payload = (job.payload ?? {}) as WaitlistJobPayload;

  if (job.kind === "brevo_contact") {
    const r = await syncBrevoContact({
      email: job.email,
      firstName: payload.firstName ?? null,
      source: payload.source ?? null,
    });
    // A missing API key is a configuration state, not a retryable failure.
    if (r.status === "skipped") return { ok: true };
    return { ok: r.ok, errorCode: r.errorCode };
  }

  if (job.kind === "welcome_email") {
    const r = await sendWelcomeEmailOnce({
      email: job.email,
      firstName: payload.firstName ?? null,
      source: payload.source ?? null,
    });
    if (r.status === "skipped") return { ok: true };
    return { ok: r.ok, errorCode: r.errorCode };
  }

  return { ok: false, errorCode: "unknown_kind" };
}

/**
 * Claim and execute due jobs. Safe to call concurrently: claiming happens in a
 * single `FOR UPDATE SKIP LOCKED` statement inside the database.
 */
export async function drainWaitlistJobs(limit = 10): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    const db = await admin();
    await db.rpc("requeue_stale_waitlist_jobs");

    const { data, error } = await db.rpc("claim_waitlist_jobs", { _limit: limit });
    if (error) {
      console.warn(`[waitlist-jobs] claim failed code=${error.code ?? "unknown"}`);
      return { processed, succeeded, failed };
    }

    const jobs = (data ?? []) as unknown as ClaimedJob[];
    for (const job of jobs) {
      processed += 1;
      const startedAt = Date.now();
      const result = await runJob(job);
      const durationMs = Date.now() - startedAt;

      if (result.ok) {
        succeeded += 1;
        await db
          .from("waitlist_jobs")
          .update({ status: "done", locked_at: null, last_error: null })
          .eq("id", job.id);
      } else {
        failed += 1;
        const attempts = job.attempts;
        const exhausted = attempts >= (job.max_attempts ?? MAX_ATTEMPTS);
        const delayMin = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 60;
        await db
          .from("waitlist_jobs")
          .update({
            status: exhausted ? "failed" : "pending",
            locked_at: null,
            last_error: (result.errorCode ?? "unknown").slice(0, 200),
            next_run_at: new Date(Date.now() + delayMin * 60_000).toISOString(),
          })
          .eq("id", job.id);
      }

      console.log(
        `[waitlist-jobs] kind=${job.kind} job=${job.id} attempt=${job.attempts} ok=${result.ok} ms=${durationMs}`,
      );
    }
  } catch (e) {
    console.warn(`[waitlist-jobs] drain error code=${e instanceof Error ? e.name : "unknown"}`);
  }

  return { processed, succeeded, failed };
}

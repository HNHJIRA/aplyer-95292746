import { describe, expect, it, vi, beforeEach } from "vitest";

const syncBrevoContact = vi.fn();
const sendWelcomeEmailOnce = vi.fn();

vi.mock("@/lib/email/brevo-contact.server", () => ({
  syncBrevoContact: (...args: unknown[]) => syncBrevoContact(...args),
}));
vi.mock("@/lib/email/brevo.server", () => ({
  sendWelcomeEmailOnce: (...args: unknown[]) => sendWelcomeEmailOnce(...args),
}));

interface UpdateCall {
  values: Record<string, unknown>;
  id: string;
}

const state = {
  upserts: [] as Array<{ rows: unknown; options: unknown }>,
  upsertError: null as { code: string } | null,
  claimed: [] as unknown[],
  claimError: null as { code: string } | null,
  updates: [] as UpdateCall[],
};

const supabaseAdmin = {
  from: (_table: string) => ({
    upsert: (rows: unknown, options: unknown) => {
      state.upserts.push({ rows, options });
      return Promise.resolve({ error: state.upsertError });
    },
    update: (values: Record<string, unknown>) => ({
      eq: (_col: string, id: string) => {
        state.updates.push({ values, id });
        return Promise.resolve({ error: null });
      },
    }),
  }),
  rpc: (name: string) => {
    if (name === "claim_waitlist_jobs") {
      return Promise.resolve({ data: state.claimed, error: state.claimError });
    }
    return Promise.resolve({ data: 0, error: null });
  },
};

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

import { drainWaitlistJobs, enqueueWaitlistJobs } from "../jobs.server";

beforeEach(() => {
  state.upserts = [];
  state.upsertError = null;
  state.claimed = [];
  state.claimError = null;
  state.updates = [];
  syncBrevoContact.mockReset();
  sendWelcomeEmailOnce.mockReset();
});

describe("enqueueWaitlistJobs", () => {
  it("queues both follow-up jobs, lowercased and deduplicated", async () => {
    const result = await enqueueWaitlistJobs({ email: "Person@Example.com", source: "hero" });

    expect(result).toEqual({ ok: true, enqueued: 2 });
    const [call] = state.upserts;
    expect(call.options).toEqual({ onConflict: "kind,email", ignoreDuplicates: true });
    const rows = call.rows as Array<{ kind: string; email: string }>;
    expect(rows.map((r) => r.kind).sort()).toEqual(["brevo_contact", "welcome_email"]);
    expect(rows.every((r) => r.email === "person@example.com")).toBe(true);
  });

  it("never throws when the queue write fails", async () => {
    state.upsertError = { code: "23505" };
    await expect(enqueueWaitlistJobs({ email: "a@b.com" })).resolves.toEqual({
      ok: false,
      enqueued: 0,
    });
  });
});

describe("drainWaitlistJobs", () => {
  it("marks succeeded jobs done", async () => {
    state.claimed = [
      { id: "j1", kind: "brevo_contact", email: "a@b.com", payload: {}, attempts: 1, max_attempts: 5 },
    ];
    syncBrevoContact.mockResolvedValue({ ok: true, status: "synced" });

    const result = await drainWaitlistJobs();

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(state.updates[0].values.status).toBe("done");
  });

  it("reschedules a failed job with backoff instead of dropping it", async () => {
    state.claimed = [
      { id: "j2", kind: "welcome_email", email: "a@b.com", payload: {}, attempts: 1, max_attempts: 5 },
    ];
    sendWelcomeEmailOnce.mockResolvedValue({ ok: false, status: "failed", errorCode: "http_500" });

    const result = await drainWaitlistJobs();

    expect(result.failed).toBe(1);
    expect(state.updates[0].values.status).toBe("pending");
    expect(state.updates[0].values.last_error).toBe("http_500");
    expect(new Date(state.updates[0].values.next_run_at as string).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("gives up after the attempt budget is exhausted", async () => {
    state.claimed = [
      { id: "j3", kind: "welcome_email", email: "a@b.com", payload: {}, attempts: 5, max_attempts: 5 },
    ];
    sendWelcomeEmailOnce.mockResolvedValue({ ok: false, status: "failed", errorCode: "http_500" });

    await drainWaitlistJobs();

    expect(state.updates[0].values.status).toBe("failed");
  });

  it("treats a skipped provider (no key / already sent) as success", async () => {
    state.claimed = [
      { id: "j4", kind: "welcome_email", email: "a@b.com", payload: {}, attempts: 1, max_attempts: 5 },
    ];
    sendWelcomeEmailOnce.mockResolvedValue({ ok: true, status: "skipped", errorCode: "already_sent" });

    const result = await drainWaitlistJobs();

    expect(result.succeeded).toBe(1);
    expect(state.updates[0].values.status).toBe("done");
  });

  it("does not log email addresses", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    state.claimed = [
      { id: "j5", kind: "brevo_contact", email: "secret@example.com", payload: {}, attempts: 1, max_attempts: 5 },
    ];
    syncBrevoContact.mockResolvedValue({ ok: true, status: "synced" });

    await drainWaitlistJobs();
    spy.mockRestore();

    expect(logs.join("\n")).not.toContain("secret@example.com");
  });

  it("survives a claim failure without throwing", async () => {
    state.claimError = { code: "42501" };
    await expect(drainWaitlistJobs()).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0 });
  });
});

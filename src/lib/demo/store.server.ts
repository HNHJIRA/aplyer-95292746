/** Database-backed DemoStore (service role) — SERVER ONLY. */
import type { DemoSettings, SpendSnapshot } from "./policy";
import type { AdmitResult, DemoRequestRow, DemoStore } from "./store";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The demo tables are service-role only; loosen typing for RPC/table names.
  return supabaseAdmin as unknown as {
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
    from: (t: string) => any;
  };
}

function splitSnapshot(raw: unknown): { settings: DemoSettings | null; spend: SpendSnapshot | null } {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    settings: (s.settings as DemoSettings) ?? null,
    spend: {
      spent_today_usd: (s.spent_today_usd as number) ?? 0,
      unpriced_today: Number(s.unpriced_today ?? 0),
      inflight: Number(s.inflight ?? 0),
      next_reset: (s.next_reset as string) ?? null,
      day_start: (s.day_start as string) ?? null,
    },
  };
}

export const dbDemoStore: DemoStore = {
  async admit(input) {
    const db = await admin();
    const { data, error } = await db.rpc("demo_admit", {
      _email: input.email,
      _session_hash: input.sessionHash,
      _ip_hash: input.ipHash,
      _idempotency_key: input.idempotencyKey,
      _content_hash: input.contentHash,
      _payload: input.payload,
    });
    if (error) throw new Error(`demo_admit_failed:${error.code ?? "unknown"}`);
    const r = data as Record<string, unknown>;
    if (r.duplicate) return { duplicate: true, request: r.request as DemoRequestRow };
    const snap = splitSnapshot(r.spend);
    return {
      duplicate: false,
      request: r.request as DemoRequestRow,
      counts: r.counts as AdmitResult extends { counts: infer C } ? C : never,
      settings: snap.settings,
      spend: snap.spend,
    } as AdmitResult;
  },
  async update(id, patch) {
    const db = await admin();
    const { error } = await db.from("demo_requests").update(patch).eq("id", id);
    if (error) throw new Error(`demo_update_failed:${error.code ?? "unknown"}`);
  },
  async recordCost(e) {
    const db = await admin();
    const { error } = await db.from("demo_cost_events").insert({
      demo_request_id: e.demoRequestId,
      side: e.side,
      provider: e.provider,
      model: e.model,
      operation: e.operation,
      input_tokens: e.inputTokens,
      output_tokens: e.outputTokens,
      estimated_cost_usd: e.estimatedCostUsd,
      priced: e.estimatedCostUsd !== null,
    });
    if (error) throw new Error(`demo_cost_failed:${error.code ?? "unknown"}`);
  },
  async getPricing(provider, model) {
    const db = await admin();
    const { data } = await db
      .from("demo_model_pricing")
      .select("input_usd_per_mtok, output_usd_per_mtok")
      .eq("provider", provider)
      .eq("model", model)
      .maybeSingle();
    return data ?? null;
  },
  async spendSnapshot() {
    const db = await admin();
    const { data, error } = await db.rpc("demo_spend_snapshot");
    if (error) return { settings: null, spend: null };
    return splitSnapshot(data);
  },
  async claimQueued(limit) {
    const db = await admin();
    const { data, error } = await db.rpc("claim_demo_requests", { _limit: limit });
    if (error) return [];
    return (data ?? []) as DemoRequestRow[];
  },
  async requeueStale() {
    const db = await admin();
    await db.rpc("requeue_stale_demo_requests");
  },
};

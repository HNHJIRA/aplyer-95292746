/** Storage contract for demo cost controls (implemented server-side; faked in tests). */
import type { AdmissionCounts, DemoSettings, ModelPricing, SpendSnapshot } from "./policy";

export type DemoStatus =
  | "admitting"
  | "running"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "rejected";

export interface DemoRequestRow {
  id: string;
  email: string;
  status: DemoStatus;
  answer: string | null;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  queue_reason?: string | null;
}

export interface AdmitInput {
  email: string;
  sessionHash: string;
  ipHash: string;
  idempotencyKey: string;
  contentHash: string;
  payload: unknown;
}

export type AdmitResult =
  | { duplicate: true; request: DemoRequestRow }
  | {
      duplicate: false;
      request: DemoRequestRow;
      counts: AdmissionCounts;
      settings: DemoSettings | null;
      spend: SpendSnapshot | null;
    };

export interface CostEventInput {
  demoRequestId: string;
  side: "openai" | "aplyer";
  provider: string;
  model: string;
  operation: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}

export interface DemoStore {
  admit(input: AdmitInput): Promise<AdmitResult>;
  update(id: string, patch: Record<string, unknown>): Promise<void>;
  recordCost(event: CostEventInput): Promise<void>;
  getPricing(provider: string, model: string): Promise<ModelPricing | null>;
  spendSnapshot(): Promise<{ settings: DemoSettings | null; spend: SpendSnapshot | null }>;
  claimQueued(limit: number): Promise<DemoRequestRow[]>;
  requeueStale(): Promise<void>;
}

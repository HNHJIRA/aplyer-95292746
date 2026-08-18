/**
 * Deterministic fraud-scan middleware.
 *
 * Flow: parse/normalize URL -> trusted ATS allowlist -> short-circuit "safe".
 * Only unknown domains fall through to the (expensive) AI fraud pipeline.
 */

import { parseJobUrl, getTrustedAtsProvider, type TrustedAtsProvider } from "./trusted-ats";

export type ScanStatus = "safe" | "needs_scan" | "invalid";

export interface FraudScanResult {
  status: ScanStatus;
  genuineScore: number | null;
  label: string;
  reason: string;
  provider: TrustedAtsProvider | null;
  scanMethod: "trusted_ats_allowlist" | "ai_fraud_scan" | "validation_failed";
  aiScanUsed: boolean;
  trustedAts: boolean;
  action?: "run_fraud_scan";
  hostname?: string;
}

/** Downstream AI fraud analyzer (Prompt K / Claude). Injectable for testing. */
export type FraudAiScanner = (input: { url: string; hostname: string }) => Promise<FraudScanResult>;

/**
 * Default downstream pipeline. The AI fraud analyzer is not built yet, so we
 * return `needs_scan` rather than guessing — an unknown domain is never a scam
 * by default.
 */
export const defaultAiScanner: FraudAiScanner = async ({ hostname }) => ({
  status: "needs_scan",
  genuineScore: null,
  label: "Unverified",
  reason: "Not hosted on a recognized applicant tracking platform — deeper analysis required",
  provider: null,
  scanMethod: "ai_fraud_scan",
  aiScanUsed: false,
  trustedAts: false,
  action: "run_fraud_scan",
  hostname,
});

// ---------------------------------------------------------------- TTL cache
const TRUSTED_TTL_MS = 24 * 60 * 60 * 1000; // deterministic → long TTL
const UNKNOWN_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  result: FraudScanResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearFraudScanCache(): void {
  cache.clear();
}

function cacheGet(key: string): FraudScanResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.result;
}

function cacheSet(key: string, result: FraudScanResult, ttl: number) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { result, expiresAt: Date.now() + ttl });
}

// ------------------------------------------------------------- the middleware
export interface RunFraudScanOptions {
  aiScanner?: FraudAiScanner;
  requestId?: string;
}

export async function runFraudScan(
  url: unknown,
  options: RunFraudScanOptions = {},
): Promise<FraudScanResult> {
  const startedAt = Date.now();
  const parsed = parseJobUrl(url);

  if (!parsed.ok || !parsed.hostname || !parsed.normalizedUrl) {
    return {
      status: "invalid",
      genuineScore: null,
      label: "Unverified",
      reason: parsed.reason ?? "url is invalid",
      provider: null,
      scanMethod: "validation_failed",
      aiScanUsed: false,
      trustedAts: false,
    };
  }

  const { hostname, normalizedUrl } = parsed;

  const cached = cacheGet(normalizedUrl);
  if (cached) return cached;

  // Server-side determination only — never trust a client-supplied provider.
  const provider = getTrustedAtsProvider(normalizedUrl);

  if (provider) {
    const result: FraudScanResult = {
      status: "safe",
      genuineScore: 100,
      label: "Safe",
      reason: "Recognized trusted applicant tracking system",
      provider,
      scanMethod: "trusted_ats_allowlist",
      aiScanUsed: false,
      trustedAts: true,
      hostname,
    };
    cacheSet(normalizedUrl, result, TRUSTED_TTL_MS);
    log({ hostname, provider, trusted: true, scanMethod: result.scanMethod, startedAt, requestId: options.requestId });
    return result;
  }

  const scanner = options.aiScanner ?? defaultAiScanner;
  const result = await scanner({ url: normalizedUrl, hostname });
  cacheSet(normalizedUrl, result, UNKNOWN_TTL_MS);
  log({ hostname, provider: null, trusted: false, scanMethod: result.scanMethod, startedAt, requestId: options.requestId });
  return result;
}

/** Structured, PII-free log line. */
function log(fields: {
  hostname: string;
  provider: string | null;
  trusted: boolean;
  scanMethod: string;
  startedAt: number;
  requestId?: string;
}) {
  console.log(
    JSON.stringify({
      evt: "fraud_scan",
      hostname: fields.hostname,
      provider: fields.provider,
      trusted: fields.trusted,
      scanMethod: fields.scanMethod,
      latencyMs: Date.now() - fields.startedAt,
      requestId: fields.requestId ?? null,
    }),
  );
}

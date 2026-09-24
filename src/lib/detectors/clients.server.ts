/**
 * Server-only AI-detector clients. No endpoint, key or price is hardcoded:
 * each provider is `not_configured` until the approved endpoint and key are
 * supplied as server secrets. Only the generated answer text is sent. The
 * text, the key and the raw provider response are never logged or returned.
 *
 *   COPYLEAKS_DETECTOR_URL   approved endpoint; `{scanId}` is replaced with a
 *                            deterministic id (request + side) for idempotency
 *   COPYLEAKS_ACCESS_TOKEN   bearer token
 *   PANGRAM_DETECTOR_URL     approved endpoint
 *   PANGRAM_API_KEY          sent as `x-api-key`
 */
import { parseCopyleaks, parsePangram, type DetectorOutcome, type DetectorProvider } from "./human-score";

export interface DetectorCallContext {
  requestId: string;
  side: "aplyer" | "chatgpt";
}

export interface DetectorClient {
  provider: DetectorProvider;
  /** Service label recorded on cost events. */
  service: string;
  check(text: string, ctx: DetectorCallContext): Promise<DetectorOutcome>;
}

const TIMEOUT_MS = 20_000;

type Fetch = typeof fetch;

function makeClient(opts: {
  provider: DetectorProvider;
  service: string;
  url: () => string | undefined;
  key: () => string | undefined;
  headers: (key: string) => Record<string, string>;
  parse: (json: unknown) => number | null;
  fetchImpl?: Fetch;
}): DetectorClient {
  return {
    provider: opts.provider,
    service: opts.service,
    async check(text, ctx) {
      const started = Date.now();
      const url = opts.url();
      const key = opts.key();
      const base = { provider: opts.provider, service: opts.service };
      if (!url || !key) return { ...base, status: "not_configured", code: "not_configured", durationMs: 0, called: false };
      const scanId = `demo-${ctx.requestId}-${ctx.side}`.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 36);
      let res: Response;
      try {
        res = await (opts.fetchImpl ?? fetch)(url.replace("{scanId}", encodeURIComponent(scanId)), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...opts.headers(key) },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        const code = e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network";
        return { ...base, status: "failed", code, durationMs: Date.now() - started, called: true };
      }
      const durationMs = Date.now() - started;
      if (!res.ok) return { ...base, status: "failed", code: `http_${res.status}`, durationMs, called: true };
      const json = await res.json().catch(() => null);
      const ai = opts.parse(json);
      if (ai === null) return { ...base, status: "failed", code: "unparseable", durationMs, called: true };
      return { ...base, status: "ok", aiPercent: ai, durationMs };
    },
  };
}

export function copyleaksClient(fetchImpl?: Fetch): DetectorClient {
  return makeClient({
    provider: "copyleaks",
    service: "ai_detection",
    url: () => process.env["COPYLEAKS_DETECTOR_URL"],
    key: () => process.env["COPYLEAKS_ACCESS_TOKEN"],
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    parse: parseCopyleaks,
    fetchImpl,
  });
}

export function pangramClient(fetchImpl?: Fetch): DetectorClient {
  return makeClient({
    provider: "pangram",
    service: "ai_detection",
    url: () => process.env["PANGRAM_DETECTOR_URL"],
    key: () => process.env["PANGRAM_API_KEY"],
    headers: (k) => ({ "x-api-key": k }),
    parse: parsePangram,
    fetchImpl,
  });
}

export function demoDetectorClients(): DetectorClient[] {
  return [copyleaksClient(), pangramClient()];
}

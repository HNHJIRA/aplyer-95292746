/**
 * Streaming answer delivery in the background service worker.
 *
 * The worker is a plain MV3 script, so it is evaluated in a VM sandbox with a
 * stubbed `chrome` + `fetch`, exactly like the auth contract test.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const SRC = readFileSync(resolve(process.cwd(), "extension/background.js"), "utf8");

type Ctx = Record<string, any>;

function makeChrome(store: Record<string, unknown>) {
  const listener = { addListener: vi.fn(), removeListener: vi.fn() };
  const wrap =
    (fn: (...a: any[]) => any) =>
    (...args: any[]) => {
      const cb = typeof args[args.length - 1] === "function" ? args.pop() : null;
      const result = fn(...args);
      if (cb) {
        cb(result);
        return undefined;
      }
      return Promise.resolve(result);
    };
  return {
    runtime: {
      id: "abc",
      onMessage: listener,
      onMessageExternal: listener,
      onInstalled: listener,
      getManifest: () => ({ version: "test" }),
      lastError: null,
    },
    tabs: { onRemoved: listener, onUpdated: listener, create: vi.fn(), query: async () => [] },
    sidePanel: { setPanelBehavior: vi.fn() },
    storage: {
      onChanged: listener,
      local: {
        get: wrap((keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        }),
        set: wrap((obj: Record<string, unknown>) => {
          Object.assign(store, obj);
          return undefined;
        }),
        remove: wrap((k: string) => {
          delete store[k];
          return undefined;
        }),
        clear: wrap(() => {
          for (const k of Object.keys(store)) delete store[k];
          return undefined;
        }),
      },
    },
  };
}

function load(store: Record<string, unknown>, fetchImpl: any): Ctx {
  const ctx: Ctx = {
    chrome: makeChrome(store),
    fetch: fetchImpl,
    console,
    setTimeout,
    clearTimeout,
    URL,
    Date,
    TextDecoder,
    TextEncoder,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

const SESSION_KEY = "aplyer.session.v1";
const future = () => Math.floor(Date.now() / 1000) + 3600;

function sseResponse(chunks: string[], opts: { status?: number; fail?: boolean } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: (opts.status ?? 200) < 300,
    status: opts.status ?? 200,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null) },
    json: async () => ({}),
    body: {
      getReader: () => ({
        read: async () => {
          if (i >= chunks.length) {
            if (opts.fail) throw new Error("network dropped");
            return { done: true, value: undefined };
          }
          return { done: false, value: enc.encode(chunks[i++]!) };
        },
      }),
    },
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
  };
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("extension background streaming", () => {
  let store: Record<string, any>;
  beforeEach(() => {
    store = {};
    store[SESSION_KEY] = { access_token: "tok-a", refresh_token: "r", expires_at: future(), user: { id: "u1" } };
  });

  it("requests stream=1 with the SSE accept header and bearer token", async () => {
    const seen: any[] = [];
    const ctx = load(store, async (url: string, init: any) => {
      seen.push({ url, headers: init.headers, body: init.body });
      return sseResponse([frame("open", { ok: true }), frame("final", { ok: true, answer: "done" })]);
    });
    await ctx.requestStreamingAnswer({ question: "q" }, () => {});
    expect(seen[0].url).toContain("/api/public/generate-answer?stream=1");
    expect(seen[0].headers.Accept).toBe("text/event-stream");
    expect(seen[0].headers.Authorization).toBe("Bearer tok-a");
    expect(JSON.parse(seen[0].body)).toEqual({ question: "q" });
  });

  it("renders deltas in order without duplication and returns only the final answer", async () => {
    const ctx = load(
      store,
      async () =>
        sseResponse([
          frame("open", { ok: true }),
          frame("draft", { text: "Led a migration " }),
          frame("draft", { text: "from AWS " }),
          frame("draft", { text: "to GCP." }),
          frame("final", { ok: true, answer: "Led a migration from AWS to GCP.", wordCount: 7 }),
          frame("done", { ok: true }),
        ]),
    );
    const parts: string[] = [];
    const out = await ctx.requestStreamingAnswer({ question: "q" }, (t: string) => parts.push(t));
    expect(parts).toEqual(["Led a migration ", "from AWS ", "to GCP."]);
    expect(parts.join("")).toBe("Led a migration from AWS to GCP.");
    expect(out.ok).toBe(true);
    expect(out.answer).toBe("Led a migration from AWS to GCP.");
  });

  it("handles deltas split across network chunks", async () => {
    const full = frame("draft", { text: "Hello world" }) + frame("final", { ok: true, answer: "Hello world" });
    const mid = Math.floor(full.length / 2);
    const ctx = load(store, async () => sseResponse([full.slice(0, mid), full.slice(mid)]));
    const parts: string[] = [];
    const out = await ctx.requestStreamingAnswer({ question: "q" }, (t: string) => parts.push(t));
    expect(parts.join("")).toBe("Hello world");
    expect(out.answer).toBe("Hello world");
  });

  it("ignores malformed and unknown events", async () => {
    const ctx = load(
      store,
      async () =>
        sseResponse([
          "event: ping\ndata: {not json\n\n",
          "event: mystery\ndata: {\"x\":1}\n\n",
          frame("draft", { text: "ok" }),
          frame("final", { ok: true, answer: "ok" }),
        ]),
    );
    const parts: string[] = [];
    const out = await ctx.requestStreamingAnswer({ question: "q" }, (t: string) => parts.push(t));
    expect(parts).toEqual(["ok"]);
    expect(out.answer).toBe("ok");
  });

  it("maps a stream error event to the safe error envelope", async () => {
    const ctx = load(
      store,
      async () =>
        sseResponse([
          frame("draft", { text: "partial" }),
          frame("error", { ok: false, code: "pipeline_failed", error: "We couldn't produce an answer you can trust. Try again." }),
        ]),
    );
    const out = await ctx.requestStreamingAnswer({ question: "q" }, () => {});
    expect(out.ok).toBe(false);
    expect(out.code).toBe("pipeline_failed");
    expect(out.answer).toBeUndefined();
  });

  it("never returns a draft when the stream is interrupted before final", async () => {
    const ctx = load(store, async () => sseResponse([frame("draft", { text: "half an answer" })], { fail: true }));
    const out = await ctx.requestStreamingAnswer({ question: "q" }, () => {});
    expect(out.unsupported).toBe(true);
    expect(out.answer).toBeUndefined();
  });

  it("falls back when the server answers with JSON instead of a stream", async () => {
    const ctx = load(store, async () => jsonResponse(200, { ok: true, answer: "json answer" }));
    const out = await ctx.requestStreamingAnswer({ question: "q" }, () => {});
    expect(out.unsupported).toBe(true);
  });

  it("requires a session before streaming", async () => {
    delete store[SESSION_KEY];
    const fetchImpl = vi.fn();
    const ctx = load(store, fetchImpl);
    const out = await ctx.requestStreamingAnswer({ question: "q" }, () => {});
    expect(out.signInRequired).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the non-streaming JSON path unchanged", async () => {
    const seen: any[] = [];
    const ctx = load(store, async (url: string, init: any) => {
      seen.push({ url, accept: init.headers.Accept });
      return jsonResponse(200, { ok: true, answer: "hi" });
    });
    const out = await ctx.requestValidatedAnswer({ question: "q" });
    expect(out.ok).toBe(true);
    expect(seen[0].url).not.toContain("stream=1");
    expect(seen[0].accept).toBeUndefined();
  });
});

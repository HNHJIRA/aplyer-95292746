/**
 * Canonical extension auth contract for the background service worker.
 *
 * The worker is a plain MV3 script, so we evaluate it in a VM sandbox with a
 * stubbed `chrome` + `fetch` and then exercise the exported-by-scope helpers.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const SRC = readFileSync(resolve(process.cwd(), "extension/background.js"), "utf8");

type Ctx = Record<string, any>;

function makeChrome(store: Record<string, unknown>) {
  const listener = { addListener: vi.fn(), removeListener: vi.fn() };
  const wrap = (fn: (...a: any[]) => any) =>
    (...args: any[]) => {
      const cb = typeof args[args.length - 1] === "function" ? args.pop() : null;
      const result = fn(...args);
      if (cb) { cb(result); return undefined; }
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
        set: wrap((obj: Record<string, unknown>) => { Object.assign(store, obj); return undefined; }),
        remove: wrap((k: string) => { delete store[k]; return undefined; }),
        clear: wrap(() => { for (const k of Object.keys(store)) delete store[k]; return undefined; }),
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
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

const SESSION_KEY = "aplyer.session.v1";
const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 60;

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("extension background auth", () => {
  let store: Record<string, any>;
  beforeEach(() => { store = {}; });

  it("sends a valid bearer token and proceeds", async () => {
    store[SESSION_KEY] = { access_token: "tok-a", refresh_token: "r", expires_at: future(), user: { id: "user-a" } };
    const calls: any[] = [];
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      calls.push({ url, auth: init.headers.Authorization });
      return res(200, { ok: true, answer: "hi" });
    });
    const ctx = load(store, fetchImpl);
    const out = await ctx.requestValidatedAnswer({ question: "q" });
    expect(out.ok).toBe(true);
    expect(calls[0].url).toContain("/api/public/generate-answer");
    expect(calls[0].auth).toBe("Bearer tok-a");
  });

  it("returns sign-in-required when no session exists", async () => {
    const fetchImpl = vi.fn();
    const ctx = load(store, fetchImpl);
    const out = await ctx.requestValidatedAnswer({ question: "q" });
    expect(out.signInRequired).toBe(true);
    expect(out.code).toBe("auth_required");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes an expired token before the request", async () => {
    store[SESSION_KEY] = { access_token: "old", refresh_token: "r1", expires_at: past(), user: { id: "user-a" } };
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      if (url.includes("/auth/v1/token")) {
        return res(200, { access_token: "new", refresh_token: "r2", expires_in: 3600, user: { id: "user-a" } });
      }
      seen.push(init.headers.Authorization);
      return res(200, { ok: true, answer: "hi" });
    });
    const ctx = load(store, fetchImpl);
    const out = await ctx.requestValidatedAnswer({ question: "q" });
    expect(out.ok).toBe(true);
    expect(seen).toEqual(["Bearer new"]);
    expect(store[SESSION_KEY].access_token).toBe("new");
  });

  it("retries exactly once after a 401 and succeeds", async () => {
    store[SESSION_KEY] = { access_token: "stale", refresh_token: "r1", expires_at: future(), user: { id: "user-a" } };
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      if (url.includes("/auth/v1/token")) return res(200, { access_token: "fresh", expires_in: 3600 });
      seen.push(init.headers.Authorization);
      return seen.length === 1 ? res(401, { error: "Unauthorized" }) : res(200, { ok: true, answer: "hi" });
    });
    const ctx = load(store, fetchImpl);
    const out = await ctx.requestValidatedAnswer({ question: "q" });
    expect(out.ok).toBe(true);
    expect(seen).toEqual(["Bearer stale", "Bearer fresh"]);
  });

  it("clears auth state and asks for sign-in when refresh fails", async () => {
    store[SESSION_KEY] = { access_token: "stale", refresh_token: "bad", expires_at: future(), user: { id: "user-a" } };
    let apiCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/auth/v1/token")) return res(400, { error: "invalid_grant" });
      apiCalls += 1;
      return res(401, { error: "Unauthorized" });
    });
    const ctx = load(store, fetchImpl);
    const out = await ctx.requestValidatedAnswer({ question: "q" });
    expect(out.signInRequired).toBe(true);
    expect(out.error).toBe("Your session expired. Please sign in again.");
    expect(apiCalls).toBe(1); // no retry loop
    expect(store[SESSION_KEY]).toBeUndefined();
  });

  it("uses the same auth helper for classification, profile context and answers", async () => {
    store[SESSION_KEY] = { access_token: "tok-a", refresh_token: "r", expires_at: future(), user: { id: "user-a" } };
    const auths: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      auths.push(init.headers.Authorization);
      return res(200, { ok: true, status: "ready", framework: "STAR", promptVersion: "1", model: "m" });
    });
    const ctx = load(store, fetchImpl);
    await ctx.ensureFactInventory({ ensure: true });
    await ctx.classifyQuestionForTab(1, { questionText: "Tell me about a project you shipped" });
    await ctx.requestValidatedAnswer({ question: "q" });
    expect(auths).toEqual(["Bearer tok-a", "Bearer tok-a", "Bearer tok-a"]);
  });

  it("never reuses user A's token after user B signs in", async () => {
    store[SESSION_KEY] = { access_token: "tok-a", refresh_token: "ra", expires_at: future(), user: { id: "user-a" } };
    const auths: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      auths.push(init.headers.Authorization);
      return res(200, { ok: true });
    });
    const ctx = load(store, fetchImpl);
    await ctx.requestValidatedAnswer({ question: "q" });
    delete store[SESSION_KEY];
    store[SESSION_KEY] = { access_token: "tok-b", refresh_token: "rb", expires_at: future(), user: { id: "user-b" } };
    await ctx.requestValidatedAnswer({ question: "q" });
    expect(auths).toEqual(["Bearer tok-a", "Bearer tok-b"]);
  });

  it("sends no cookies and targets the configured backend origin", async () => {
    store[SESSION_KEY] = { access_token: "tok-a", refresh_token: "r", expires_at: future(), user: { id: "user-a" } };
    let init: any = null;
    let url = "";
    const ctx = load(store, async (u: string, i: any) => { url = u; init = i; return res(200, { ok: true }); });
    await ctx.requestValidatedAnswer({ question: "q" });
    expect(url.startsWith("https://aplyer.devssh.xyz/")).toBe(true);
    expect(init.credentials).toBeUndefined();
  });

  it("exposes only safe auth diagnostics", async () => {
    store[SESSION_KEY] = { access_token: "secret-token", refresh_token: "r", expires_at: 123, user: { id: "user-abcdef-1234" } };
    const ctx = load(store, async () => res(200, { ok: true }));
    const diag = ctx.authDiagnostics(store[SESSION_KEY]);
    expect(diag).toEqual({
      token_present: true,
      token_length: "secret-token".length,
      token_expiry: 123,
      user_id_prefix: "user-abc",
      backend_origin: "https://aplyer.devssh.xyz",
    });
    expect(JSON.stringify(diag)).not.toContain("secret-token");
  });
});

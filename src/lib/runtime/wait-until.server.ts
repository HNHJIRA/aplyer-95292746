/**
 * Post-response background execution — SERVER ONLY.
 *
 * The app runs on a serverless Worker runtime. A bare `void promise()` after
 * returning a Response is NOT safe there: the isolate may be frozen or torn
 * down as soon as the response is flushed. The runtime's `ctx.waitUntil()` is
 * the only supported way to keep work alive after the response is sent, and it
 * is guaranteed to run to completion.
 *
 * `src/server.ts` publishes the per-request execution context here through an
 * AsyncLocalStorage so route handlers deeper in the stack can schedule work
 * without threading `ctx` through every call.
 *
 * Durability note: `waitUntil` covers the *immediate* attempt only. Anything
 * that must survive a worker crash is additionally persisted in
 * `public.waitlist_jobs` and retried on later requests.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface ExecutionContextLike {
  waitUntil?: (promise: Promise<unknown>) => void;
}

const storage = new AsyncLocalStorage<ExecutionContextLike | undefined>();

export function runWithExecutionContext<T>(ctx: unknown, fn: () => T): T {
  const candidate =
    ctx && typeof (ctx as ExecutionContextLike).waitUntil === "function"
      ? (ctx as ExecutionContextLike)
      : undefined;
  return storage.run(candidate, fn);
}

/**
 * Schedule background work. Returns the promise so callers/tests can await it.
 * Never rejects into the request path — failures are logged and swallowed.
 */
export function waitUntil(work: () => Promise<unknown>, label: string): Promise<void> {
  const promise = (async () => {
    try {
      await work();
    } catch (e) {
      console.warn(`[background] ${label} failed code=${e instanceof Error ? e.name : "unknown"}`);
    }
  })();

  const ctx = storage.getStore();
  if (ctx?.waitUntil) {
    ctx.waitUntil(promise);
  }
  return promise;
}

/** True when the runtime can keep work alive after the response is flushed. */
export function hasWaitUntil(): boolean {
  return typeof storage.getStore()?.waitUntil === "function";
}

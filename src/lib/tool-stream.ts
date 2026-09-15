/**
 * Shared progressive-result delivery for the Resume Audit and Resume Match tools.
 *
 * The request opts into the backend's server-sent stream. Preview text that
 * arrives while the result is being generated is unvalidated: it is only ever
 * shown, never stored, scored or promoted. Only the `final` payload becomes the
 * real result. When the backend answers with plain JSON (backward compatible),
 * that document is used directly — there is no retry loop and no simulated
 * typing.
 */

export const GENERIC_TOOL_ERROR = "Something went wrong. Please try again.";

export class ToolRequestError extends Error {}

type Json = Record<string, unknown>;

function parseData(raw: string): unknown {
  if (!raw) return null;
  const first = raw.charAt(0);
  if (first === "{" || first === "[") {
    try {
      return JSON.parse(raw);
    } catch {
      return null; // malformed frame: safely ignored
    }
  }
  return { text: raw };
}

/** Pulls preview text out of a draft payload, whatever shape it uses. */
export function draftText(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return "";
  const p = payload as Json;
  for (const key of ["text", "delta", "content", "overallTake", "summary", "preview"]) {
    const v = p[key];
    if (typeof v === "string") return v;
  }
  return "";
}

/** Parses one SSE frame ("event: x\ndata: y") into its event name and data. */
export function parseFrame(frame: string): { event: string; data: string } {
  const lines = frame.split("\n");
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.charAt(0) === ":") continue;
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    const value = idx === -1 ? "" : line.slice(idx + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  return { event, data: dataLines.join("\n") };
}

function safeMessage(data: unknown): string {
  const err = (data as Json | null)?.["error"];
  return typeof err === "string" && err.trim() && err.length < 200 ? err : GENERIC_TOOL_ERROR;
}

export interface ToolRequestOptions {
  /** Endpoint path, e.g. "/api/resume-audit" (already absolute via apiUrl). */
  url: string;
  body: unknown;
  /** Called with the full preview text so far. Preview only — never final. */
  onPreview?: (preview: string) => void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

async function readStream<T>(
  response: Response,
  onPreview: (preview: string) => void,
): Promise<T> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let preview = "";
  let final: T | null = null;
  let streamError: string | null = null;

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const { event, data } = parseFrame(part);
      if (event === "done") continue;
      if (!data) continue;
      const payload = parseData(data);
      if (event === "open") continue;
      if (event === "draft" || event === "delta") {
        const piece = draftText(payload);
        const replace =
          !!payload && typeof payload === "object" && (payload as Json)["replace"] === true;
        if (replace) {
          // Authoritative preview: the backend is correcting the shown text so
          // it matches the validated final result.
          preview = piece;
          onPreview(preview);
        } else if (piece) {
          preview += piece;
          onPreview(preview);
        }
      } else if (event === "final") {
        if (payload && typeof payload === "object" && Object.keys(payload as Json).length) {
          final = payload as T;
        }
      } else if (event === "error") {
        streamError = safeMessage(payload);
      }
    }
  }

  if (streamError) throw new ToolRequestError(streamError);
  // An interrupted or empty stream never promotes the preview to a result.
  if (!final) throw new ToolRequestError(GENERIC_TOOL_ERROR);
  return final;
}

async function readJson<T>(response: Response): Promise<T> {
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) throw new ToolRequestError(safeMessage(data));
  if (!data || typeof data !== "object" || !Object.keys(data as Json).length) {
    throw new ToolRequestError(GENERIC_TOOL_ERROR);
  }
  return data as T;
}

/**
 * Requests a tool result, showing progressive preview text when the backend
 * streams it and falling back once to the plain JSON response otherwise.
 */
export async function requestToolResult<T>(opts: ToolRequestOptions): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  const onPreview = opts.onPreview ?? (() => {});
  const payload = JSON.stringify(opts.body);

  let streamable = false;
  try {
    const response = await doFetch(`${opts.url}?stream=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: payload,
      signal: opts.signal,
    });

    const ctype = response.headers?.get?.("content-type") ?? "";
    streamable =
      response.ok &&
      ctype.includes("text/event-stream") &&
      !!response.body &&
      typeof response.body.getReader === "function";

    if (streamable) return await readStream<T>(response, onPreview);
    // Backend answered with the normal JSON document.
    return await readJson<T>(response);
  } catch (err) {
    onPreview("");
    if (err instanceof ToolRequestError) throw err;
    if (streamable) throw new ToolRequestError(GENERIC_TOOL_ERROR);
    // Streaming request itself failed: one plain retry, never a loop.
    const response = await doFetch(opts.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: opts.signal,
    });
    return await readJson<T>(response);
  }
}

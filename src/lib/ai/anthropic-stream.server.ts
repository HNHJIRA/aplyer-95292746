// Server-only helpers for consuming the Anthropic Messages SSE stream and for
// re-emitting safe SSE to a browser client.
//
// SAFETY: only generated answer text ever leaves these helpers. Anthropic
// metadata (message ids, usage, stop reasons, model names) is dropped.

export interface AnthropicSseEvent {
  /** Text delta from a `content_block_delta` event. */
  text?: string;
  /** True once `message_stop` has been seen. */
  stop?: boolean;
  /** True for an `error` event in the stream. */
  error?: boolean;
}

/**
 * Parses one raw SSE block (the text between blank lines) into a safe event.
 * Unknown, non-text, or malformed blocks yield `null` and are ignored.
 */
export function parseSseBlock(block: string): AnthropicSseEvent | null {
  const dataLines = block
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("");
  if (!raw || raw === "[DONE]") return null;

  let payload: { type?: unknown; delta?: { type?: unknown; text?: unknown } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return null; // malformed event: ignore, never throw
  }

  const type = typeof payload?.type === "string" ? payload.type : "";
  if (type === "content_block_delta") {
    const text = payload.delta?.text;
    return typeof text === "string" && text.length > 0 ? { text } : null;
  }
  if (type === "message_stop") return { stop: true };
  if (type === "error") return { error: true };
  return null; // ping, message_start, content_block_start/stop, message_delta...
}

/**
 * Feeds raw stream chunks through an incremental SSE parser.
 * Returns the events completed by this chunk and the leftover buffer.
 */
export function feedSse(buffer: string, chunk: string): { buffer: string; events: AnthropicSseEvent[] } {
  const merged = (buffer + chunk).replace(/\r\n/g, "\n");
  const parts = merged.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: AnthropicSseEvent[] = [];
  for (const part of parts) {
    const evt = parseSseBlock(part);
    if (evt) events.push(evt);
  }
  return { buffer: rest, events };
}

/**
 * Reads an Anthropic streaming response body, invoking `onText` for each text
 * delta, and resolves with the full concatenated text once the stream ends.
 */
export async function consumeAnthropicStream(
  body: ReadableStream<Uint8Array>,
  onText?: (text: string) => void,
): Promise<{ text: string; sawStop: boolean; sawError: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let sawStop = false;
  let sawError = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const fed = feedSse(buffer, decoder.decode(value, { stream: true }));
    buffer = fed.buffer;
    for (const evt of fed.events) {
      if (evt.error) sawError = true;
      if (evt.stop) sawStop = true;
      if (evt.text) {
        text += evt.text;
        try {
          onText?.(evt.text);
        } catch {
          /* a consumer failure must never break the provider stream */
        }
      }
    }
  }
  // Flush anything left without a trailing blank line.
  const tail = parseSseBlock(buffer);
  if (tail?.text) {
    text += tail.text;
    try {
      onText?.(tail.text);
    } catch {
      /* ignore */
    }
  }
  if (tail?.stop) sawStop = true;
  if (tail?.error) sawError = true;

  return { text, sawStop, sawError };
}

/* ------------------------------------------------------------------ */
/* Outbound SSE (browser-facing)                                       */
/* ------------------------------------------------------------------ */

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function sseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...extra,
  };
}

/**
 * Incrementally extracts the value of a top-level JSON string property from a
 * partially received JSON document. Used to preview only the `answer` field of
 * a structured model response — never the surrounding JSON envelope.
 * Returns the decoded text received so far, or "" when the key hasn't started.
 */
export function extractPartialJsonString(buffer: string, key: string): string {
  const marker = `"${key}"`;
  const at = buffer.indexOf(marker);
  if (at < 0) return "";
  let i = at + marker.length;
  while (i < buffer.length && /\s/.test(buffer[i]!)) i++;
  if (buffer[i] !== ":") return "";
  i++;
  while (i < buffer.length && /\s/.test(buffer[i]!)) i++;
  if (buffer[i] !== '"') return "";
  i++;

  let out = "";
  while (i < buffer.length) {
    const ch = buffer[i]!;
    if (ch === "\\") {
      const next = buffer[i + 1];
      if (next === undefined) break; // incomplete escape
      switch (next) {
        case "n":
          out += "\n";
          break;
        case "t":
          out += "\t";
          break;
        case "r":
          out += "\r";
          break;
        case "u": {
          const hex = buffer.slice(i + 2, i + 6);
          if (hex.length < 4) return out;
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        default:
          out += next;
      }
      i += 2;
      continue;
    }
    if (ch === '"') break; // string finished
    out += ch;
    i++;
  }
  return out;
}

/** Scans one JSON string literal starting at `start` ('"'). */
function scanJsonString(buf: string, start: number): { text: string; end: number; closed: boolean } | null {
  if (buf[start] !== '"') return null;
  let i = start + 1;
  let out = "";
  while (i < buf.length) {
    const ch = buf[i]!;
    if (ch === "\\") {
      const next = buf[i + 1];
      if (next === undefined) return { text: out, end: i, closed: false };
      switch (next) {
        case "n":
          out += "\n";
          break;
        case "t":
          out += "\t";
          break;
        case "r":
          out += "\r";
          break;
        case "u": {
          const hex = buf.slice(i + 2, i + 6);
          if (hex.length < 4) return { text: out, end: i, closed: false };
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        default:
          out += next;
      }
      i += 2;
      continue;
    }
    if (ch === '"') return { text: out, end: i + 1, closed: true };
    out += ch;
    i++;
  }
  return { text: out, end: i, closed: false };
}

/**
 * Incrementally extracts a top-level JSON array-of-strings property from a
 * partially received document, joined with a single space. Used to preview
 * only one human-readable field of a structured response.
 */
export function extractPartialJsonStringArray(buffer: string, key: string): string {
  const marker = `"${key}"`;
  const at = buffer.indexOf(marker);
  if (at < 0) return "";
  let i = at + marker.length;
  while (i < buffer.length && /\s/.test(buffer[i]!)) i++;
  if (buffer[i] !== ":") return "";
  i++;
  while (i < buffer.length && /\s/.test(buffer[i]!)) i++;
  if (buffer[i] !== "[") return "";
  i++;

  const parts: string[] = [];
  while (i < buffer.length) {
    const ch = buffer[i]!;
    if (/\s|,/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "]") break;
    if (ch !== '"') break;
    const scanned = scanJsonString(buffer, i);
    if (!scanned) break;
    parts.push(scanned.text);
    if (!scanned.closed) break;
    i = scanned.end;
  }
  return parts.join(" ");
}

/**
 * Builds a delta consumer that turns raw model output chunks into a safe,
 * incremental preview of ONE field of a structured JSON response. Nothing
 * else in the envelope is ever emitted.
 */
export function makeJsonFieldPreview(opts: {
  key: string;
  array?: boolean;
  onText: (delta: string) => void;
}): (chunk: string) => void {
  let buffer = "";
  let emitted = "";
  return (chunk: string) => {
    buffer += chunk;
    const full = opts.array
      ? extractPartialJsonStringArray(buffer, opts.key)
      : extractPartialJsonString(buffer, opts.key);
    if (full.length > emitted.length && full.startsWith(emitted)) {
      const delta = full.slice(emitted.length);
      emitted = full;
      if (delta) opts.onText(delta);
    }
  };
}

/** Streaming is opt-in; the default response of every endpoint stays JSON. */
export function wantsStream(request: Request): boolean {
  try {
    if (new URL(request.url).searchParams.get("stream") === "1") return true;
  } catch {
    /* relative URLs in tests */
  }
  return (request.headers.get("accept") ?? "").includes("text/event-stream");
}

export type SseSend = (event: string, data: unknown) => void;

/**
 * Shared SSE envelope: emits `open`, runs `run`, and always closes with
 * `done`. Unhandled failures become a safe `error` event — never a `final`.
 */
export function sseResponse(
  run: (send: SseSend) => Promise<void>,
  extraHeaders: Record<string, string> = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send: SseSend = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          closed = true; // client disconnected
        }
      };
      void (async () => {
        send("open", { ok: true });
        try {
          await run(send);
        } catch (err) {
          console.error("[sse]", err);
          send("error", { error: "Something went wrong. Please try again." });
        } finally {
          send("done", { ok: true });
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      })();
    },
  });
  return new Response(stream, { status: 200, headers: sseHeaders(extraHeaders) });
}

/* ------------------------------------------------------------------ */
/* Partial JSON preview                                                */
/* ------------------------------------------------------------------ */

/** Closes any open string/brackets in `raw` and parses it; undefined on failure. */
function closeAndParse(raw: string): unknown | undefined {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = raw;
  if (esc) out = out.slice(0, -1);
  if (inStr) out += '"';
  out = out.replace(/\s*,\s*$/, "");
  out = out.replace(/:\s*$/, ": null");
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
  try {
    return JSON.parse(out);
  } catch {
    return undefined;
  }
}

/**
 * Best-effort parse of a JSON object that is still being streamed. Returns the
 * largest prefix that parses once open strings/brackets are closed, or null.
 */
export function parsePartialJson(buffer: string): unknown {
  const start = buffer.indexOf("{");
  if (start < 0) return null;
  let s = buffer.slice(start);
  for (let attempt = 0; attempt < 8 && s.length > 1; attempt++) {
    const value = closeAndParse(s);
    if (value !== undefined) return value;
    const cut = s.lastIndexOf(",");
    if (cut <= 0) break;
    s = s.slice(0, cut);
  }
  return null;
}

/**
 * Builds a delta consumer that renders the partially received JSON document
 * into human-readable preview text and emits it whenever it changes. The full
 * text is emitted each time (the client replaces, never appends).
 */
export function makeJsonProgressPreview(opts: {
  render: (value: unknown) => string;
  onText: (fullText: string) => void;
}): (chunk: string) => void {
  let buffer = "";
  let emitted = "";
  return (chunk: string) => {
    buffer += chunk;
    let text = "";
    try {
      text = opts.render(parsePartialJson(buffer));
    } catch {
      return;
    }
    if (text && text !== emitted) {
      emitted = text;
      opts.onText(text);
    }
  };
}

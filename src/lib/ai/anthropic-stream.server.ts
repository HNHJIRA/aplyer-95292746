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

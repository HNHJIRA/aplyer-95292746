/* Aplyer demo answer delivery.
 * Streaming (SSE) with safe fallback to the existing JSON request.
 * Draft/delta text is an unvalidated preview: only the `final` event is
 * treated as the real answer. Shared by the demo page and the unit tests.
 */
(function (root) {
  var DEFAULT_BASE = '';
  var GENERIC_ERROR = 'The demo is busy. Please try again in a moment.';

  function parsePayload(raw) {
    var trimmed = raw;
    if (trimmed === '') return null;
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        return null; // malformed event: safely ignored
      }
    }
    return { text: trimmed };
  }

  function textOf(payload) {
    if (payload == null) return '';
    if (typeof payload === 'string') return payload;
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.delta === 'string') return payload.delta;
    if (typeof payload.content === 'string') return payload.content;
    if (typeof payload.answer === 'string') return payload.answer;
    return '';
  }

  // Parses one SSE frame ("event: x\ndata: y") into { event, data }.
  function parseFrame(frame) {
    var lines = frame.split('\n');
    var event = 'message';
    var dataLines = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || line.charAt(0) === ':') continue;
      var idx = line.indexOf(':');
      var field = idx === -1 ? line : line.slice(0, idx);
      var value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
    }
    return { event: event, data: dataLines.join('\n') };
  }

  /**
   * Streams an answer. Calls onDelta(fullPreviewText) as text arrives.
   * Resolves with the validated final answer, or rejects.
   */
  async function streamAnswer(opts) {
    var fetchImpl = opts.fetch || root.fetch;
    var base = opts.baseUrl || DEFAULT_BASE;
    var onDelta = opts.onDelta || function () {};
    var onChatgpt = opts.onChatgpt || function () {};
    var onChatgptDelta = opts.onChatgptDelta || function () {};
    var onScoreboard = opts.onScoreboard || function () {};
    var gptPreview = '';

    var response = await fetchImpl(base + '/api/public/demo?stream=1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      credentials: 'same-origin',
      body: requestBody(opts),
      signal: opts.signal,
    });

    var ctype = (response.headers && response.headers.get && response.headers.get('content-type')) || '';
    // Server-side controls (email gate, limits, queue, duplicates) answer in JSON.
    if (ctype.indexOf('application/json') !== -1 && response.json) {
      return handleJson(response, opts);
    }
    if (!response.ok || ctype.indexOf('text/event-stream') === -1 || !response.body || !response.body.getReader) {
      var err = new Error('stream-unavailable');
      err.streamUnavailable = true;
      throw err;
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var preview = '';
    var final = null;
    var streamError = null;

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var parts = buffer.split(/\n\n/);
      buffer = parts.pop();
      for (var i = 0; i < parts.length; i++) {
        var frame = parseFrame(parts[i]);
        if (!frame.data && frame.event !== 'done') continue;
        var payload = parsePayload(frame.data);

        if (frame.event === 'open') continue;
        if (frame.event === 'draft' || frame.event === 'delta') {
          var piece = textOf(payload);
          if (piece) {
            preview += piece;
            onDelta(preview);
          }
        } else if (frame.event === 'chatgpt_delta') {
          var gp = textOf(payload);
          if (gp) {
            gptPreview += gp;
            onChatgptDelta(gptPreview);
          }
        } else if (frame.event === 'chatgpt_final') {
          // The prompt comes from the server: the exact string sent to OpenAI.
          if (payload && typeof payload.answer === 'string' && payload.answer.trim()) {
            onChatgpt({ status: 'completed', answer: payload.answer, prompt: typeof payload.prompt === 'string' ? payload.prompt : '' });
          }
        } else if (frame.event === 'chatgpt_error') {
          onChatgpt({
            status: payload && payload.status === 'not_configured' ? 'not_configured' : 'failed',
            error: (payload && typeof payload.error === 'string' && payload.error) || 'The ChatGPT answer could not be generated this time.',
          });
        } else if (frame.event === 'scoreboard') {
          // Sent once, complete, after both answers. Never partial.
          if (payload && payload.status === 'shown' && Array.isArray(payload.markers) && payload.markers.length) onScoreboard(payload);
        } else if (frame.event === 'final') {
          var answer = textOf(payload);
          if (answer && answer.trim()) final = answer;
        } else if (frame.event === 'error') {
          streamError = new Error(GENERIC_ERROR);
        } else if (frame.event === 'done') {
          buffer = '';
        }
      }
    }

    if (streamError) throw streamError;
    if (!final) {
      // Incomplete stream: the draft is never promoted to a final answer.
      var incomplete = new Error(GENERIC_ERROR);
      incomplete.incomplete = true;
      throw incomplete;
    }
    return final;
  }

  function requestBody(opts) {
    return JSON.stringify({
      email: opts.email,
      idempotencyKey: opts.idempotencyKey,
      resume: opts.resume,
      jobDescription: opts.jobDescription,
      question: opts.question,
      // Optional; sent exactly as typed, null when empty.
      writingSample: typeof opts.writingSample === 'string' && opts.writingSample.trim() ? opts.writingSample : null,
    });
  }

  /**
   * Interprets a JSON reply. Returns the answer string, or a
   * { status: 'queued' | 'processing', message } notice. Throws on errors.
   */
  async function handleJson(response, opts) {
    var data = {};
    try {
      data = await response.json();
    } catch (e) {
      data = {};
    }
    if (data && data.chatgpt && typeof data.chatgpt === 'object' && opts && opts.onChatgpt) {
      opts.onChatgpt(data.chatgpt);
    }
    if (data && data.scoreboard && data.scoreboard.status === 'shown' && Array.isArray(data.scoreboard.markers) && opts && opts.onScoreboard) {
      opts.onScoreboard(data.scoreboard);
    }
    if (response.ok && data && data.answer) return String(data.answer);
    if (data && (data.status === 'queued' || data.status === 'processing') && data.message) {
      return { status: data.status, message: String(data.message) };
    }
    throw new Error((data && data.error) || GENERIC_ERROR);
  }

  /** Non-streaming JSON request. */
  async function fetchAnswerJson(opts) {
    var fetchImpl = opts.fetch || root.fetch;
    var base = opts.baseUrl || DEFAULT_BASE;
    var response = await fetchImpl(base + '/api/public/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: requestBody(opts),
    });
    return handleJson(response, opts);
  }

  /**
   * Streams when possible, otherwise falls back once to the JSON request.
   * Never retries in a loop.
   */
  async function getAnswer(opts) {
    try {
      return await streamAnswer(opts);
    } catch (err) {
      if (err && err.streamUnavailable) {
        if (opts.onDelta) opts.onDelta('');
        if (opts.onChatgptDelta) opts.onChatgptDelta('');
        return await fetchAnswerJson(opts);
      }
      throw err;
    }
  }

  /* ---------- Resume file reading (readable text only, never markup) ---------- */

  // Same DOCX -> text transform as src/lib/resume/extract.ts (extractDocx).
  function docxXmlToText(xml) {
    return String(xml)
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab[^>]*\/>/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  // Same cleanup as src/lib/resume/extract.ts.
  function cleanupText(text) {
    return String(text)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function isZip(b) { return b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4; }

  // Text that is really markup or a binary container, never shown as a resume.
  function looksLikeMarkupOrBinary(text) {
    var head = String(text || '').slice(0, 4000);
    if (!head.trim()) return true;
    if (/^\s*%PDF-/.test(head) || head.indexOf('PK\u0003\u0004') === 0) return true;
    if (/<\?xml|<w:document|<w:body|<\/w:p>|xmlns:w=/.test(head)) return true;
    if (/<(html|body|div|p|span|table)[\s>]/i.test(head) && /<\/(html|body|div|p|span|table)>/i.test(head)) return true;
    var bad = 0;
    for (var i = 0; i < head.length; i++) {
      var c = head.charCodeAt(i);
      if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) bad++;
    }
    return bad / head.length > 0.02;
  }

  async function inflateRaw(data) {
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Minimal ZIP reader (central directory) for word/document.xml.
  async function readZipEntry(bytes, name) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder();
    for (var n = 0; n < count && p + 46 <= bytes.length; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) return null;
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nlen = dv.getUint16(p + 28, true);
      var elen = dv.getUint16(p + 30, true);
      var clen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var fname = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      if (fname === name) {
        var start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
        var data = bytes.subarray(start, start + csize);
        if (method === 0) return dec.decode(data);
        if (method === 8) return dec.decode(await inflateRaw(data));
        return null;
      }
      p += 46 + nlen + elen + clen;
    }
    return null;
  }

  /**
   * Turns a non-PDF resume file's bytes into readable text.
   * DOCX (even when renamed) is unzipped and its text extracted; plain text is
   * decoded; anything that is still markup/binary is refused (null) so the
   * visitor never sees code in the resume box.
   */
  async function extractResumeFromBytes(bytes) {
    if (isZip(bytes)) {
      var xml = await readZipEntry(bytes, 'word/document.xml');
      if (xml == null) return null;
      var t = cleanupText(docxXmlToText(xml));
      return t && !looksLikeMarkupOrBinary(t) ? t : null;
    }
    var text = cleanupText(new TextDecoder().decode(bytes));
    return looksLikeMarkupOrBinary(text) ? null : text;
  }

  var api = {
    extractResumeFromBytes: extractResumeFromBytes,
    looksLikeMarkupOrBinary: looksLikeMarkupOrBinary,
    docxXmlToText: docxXmlToText,
    streamAnswer: streamAnswer,
    fetchAnswerJson: fetchAnswerJson,
    getAnswer: getAnswer,
    parseFrame: parseFrame,
    GENERIC_ERROR: GENERIC_ERROR,
  };

  root.AplyerAnswer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

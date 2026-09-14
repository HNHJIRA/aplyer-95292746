/* Aplyer demo answer delivery.
 * Streaming (SSE) with safe fallback to the existing JSON request.
 * Draft/delta text is an unvalidated preview: only the `final` event is
 * treated as the real answer. Shared by the demo page and the unit tests.
 */
(function (root) {
  var DEFAULT_BASE = 'https://aplyer.devssh.xyz';
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

    var response = await fetchImpl(base + '/api/public/generate-answer?stream=1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        resume: opts.resume,
        jobDescription: opts.jobDescription,
        question: opts.question,
      }),
      signal: opts.signal,
    });

    var ctype = (response.headers && response.headers.get && response.headers.get('content-type')) || '';
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

  /** Existing non-streaming JSON request — unchanged behaviour. */
  async function fetchAnswerJson(opts) {
    var fetchImpl = opts.fetch || root.fetch;
    var base = opts.baseUrl || DEFAULT_BASE;
    var response = await fetchImpl(base + '/api/public/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume: opts.resume,
        jobDescription: opts.jobDescription,
        question: opts.question,
      }),
    });
    var data = {};
    try {
      data = await response.json();
    } catch (e) {
      data = {};
    }
    if (!response.ok || !data.answer) {
      throw new Error(data.error || GENERIC_ERROR);
    }
    return String(data.answer);
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
        return await fetchAnswerJson(opts);
      }
      throw err;
    }
  }

  var api = {
    streamAnswer: streamAnswer,
    fetchAnswerJson: fetchAnswerJson,
    getAnswer: getAnswer,
    parseFrame: parseFrame,
    GENERIC_ERROR: GENERIC_ERROR,
  };

  root.AplyerAnswer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

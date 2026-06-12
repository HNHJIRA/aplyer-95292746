// Aplyer content-script orchestrator — hardened for production.
(function () {
  const log = window.AplyerLog;
  const ORCH_VERSION = "1.2.0";

  // Diagnostics record consumed by debug-overlay.js when ?aplyer_debug=1.
  const dbg = (window.__aplyerDebug = window.__aplyerDebug || {
    orchestratorVersion: ORCH_VERSION,
    apiVersion: window.AplyerAdapters?.API_VERSION,
    adapterName: null,
    adapterVersion: null,
    detectionSource: null,
    questionsCount: 0,
    injectionCount: 0,
    scanCount: 0,
    mutationCount: 0,
    lastScanAt: 0,
    stableIds: [],
    errors: [],
  });
  function note(level, scope, msg, extra) {
    try {
      dbg.errors.push({ level, scope, msg: typeof msg === "string" ? msg : JSON.stringify(msg), ts: Date.now() });
      if (dbg.errors.length > 50) dbg.errors.splice(0, dbg.errors.length - 50);
    } catch {}
    log[level === "err" ? "warn" : level]?.(scope, msg, extra);
  }

  log.info("boot", "Content script loaded", {
    url: location.href,
    orchestrator: ORCH_VERSION,
    adapterApi: window.AplyerAdapters?.API_VERSION,
  });

  let adapter;
  try { adapter = window.AplyerDetect(); }
  catch (e) { note("warn", "detector", "detect() threw: " + e); return; }
  if (!adapter) { dbg.detectionSource = "none"; return; }

  dbg.adapterName = adapter.name;
  dbg.adapterVersion = adapter.adapterVersion;
  dbg.detectionSource = adapter._detectionSource || "host";

  log.info("adapter", `Adapter loaded`, {
    name: adapter.name,
    label: adapter.platformLabel,
    adapterVersion: adapter.adapterVersion,
    apiVersion: adapter.apiVersion,
  });

  const knownIds = new Set();
  const questions = []; // canonical list
  let pill = null;
  let pendingScan = null;
  let lastScanAt = 0;
  let scansInFlight = 0;
  const MIN_SCAN_INTERVAL_MS = 600;       // throttle floor
  const SCAN_DEBOUNCE_MS = 350;           // debounce DOM bursts
  let totalInjections = 0;
  let totalScans = 0;

  function scan() {
    if (scansInFlight > 0) return;
    const now = Date.now();
    const since = now - lastScanAt;
    if (since < MIN_SCAN_INTERVAL_MS) {
      scheduleScan(MIN_SCAN_INTERVAL_MS - since);
      return;
    }
    scansInFlight++;
    totalScans++;
    let found = [];
    try { found = adapter.extractQuestions() || []; }
    catch (e) { note("warn", "scan", "extractQuestions threw: " + e); }
    finally { lastScanAt = Date.now(); scansInFlight--; }

    dbg.scanCount = totalScans;
    dbg.lastScanAt = lastScanAt;

    if (found.length === 0) { maybeBroadcast(); return; }

    const fresh = found.filter((q) => {
      if (knownIds.has(q.questionId)) return false;
      if (q.fieldReference?.dataset?.aplyerSeen === "1") return false;
      return true;
    });

    if (fresh.length === 0) { maybeBroadcast(); return; }

    log.info("scan", `Detected ${fresh.length} new question(s)`, {
      total: found.length,
      adapter: adapter.name,
      adapterVersion: adapter.adapterVersion,
      sample: fresh.slice(0, 3).map((q) => ({ id: q.questionId, type: q.questionType, text: q.questionText.slice(0, 80) })),
    });

    const { injected } = window.AplyerInjector.injectButtons(adapter, fresh, openSidePanel);
    totalInjections += injected;

    for (const q of fresh) {
      knownIds.add(q.questionId);
      questions.push(q);
      const sid = q.questionId.split("#")[0];
      if (!dbg.stableIds.includes(sid)) dbg.stableIds.push(sid);
    }
    dbg.questionsCount = questions.length;
    dbg.injectionCount = totalInjections;
    broadcast();
    renderPill();
  }

  function scheduleScan(delay = SCAN_DEBOUNCE_MS) {
    clearTimeout(pendingScan);
    pendingScan = setTimeout(scan, delay);
  }

  let lastBroadcast = "";
  function broadcast() {
    const payload = {
      platform: adapter.platformLabel,
      platformKey: adapter.name,
      adapterVersion: adapter.adapterVersion,
      apiVersion: adapter.apiVersion,
      orchestratorVersion: ORCH_VERSION,
      url: location.href,
      questionsCount: questions.length,
      injectionCount: totalInjections,
      scanCount: totalScans,
      questions: questions.map((q) => ({
        questionId: q.questionId,
        questionText: q.questionText,
        questionType: q.questionType,
      })),
      ts: Date.now(),
    };
    const sig = `${payload.questionsCount}|${payload.injectionCount}`;
    if (sig === lastBroadcast) return;
    lastBroadcast = sig;
    try {
      chrome.runtime.sendMessage({ type: "APLYER_ATS_STATUS", payload }).catch(() => {});
    } catch { /* ignore disconnected runtime */ }
  }
  function maybeBroadcast() {
    // Even with no new questions, ensure status is published once.
    if (!lastBroadcast) broadcast();
  }

  function renderPill() {
    // Only render the floating status pill in the top frame — otherwise
    // each iframe would render its own pill (Greenhouse embed forms run
    // inside an iframe, and we now inject into all frames).
    if (window.top !== window) return;
    if (!pill) {
      pill = document.createElement("div");
      pill.className = "aplyer-status-pill";
      pill.innerHTML = `
        <span class="dot"></span>
        <span class="lbl">${adapter.platformLabel} detected</span>
        <span class="count">${questions.length}</span>
      `;
      pill.title = "Open Aplyer side panel";
      pill.addEventListener("click", () => openSidePanel(null));
      try { document.documentElement.appendChild(pill); }
      catch (e) { log.warn("ui", "pill append failed", String(e)); pill = null; return; }
    } else {
      pill.querySelector(".count").textContent = String(questions.length);
    }
  }

  function openSidePanel(question) {
    log.info("ui", "Open side panel", { question: question?.questionId ?? "(pill)" });
    try {
      chrome.runtime.sendMessage({
        type: "APLYER_OPEN_SIDE_PANEL",
        payload: {
          platform: adapter.platformLabel,
          platformKey: adapter.name,
          adapterVersion: adapter.adapterVersion,
          question: question ? {
            questionId: question.questionId,
            questionText: question.questionText,
            questionType: question.questionType,
          } : null,
          questions: questions.map((q) => ({
            questionId: q.questionId,
            questionText: q.questionText,
            questionType: q.questionType,
          })),
          url: location.href,
        },
      }).catch((e) => log.warn("ui", "side panel open failed", String(e)));
    } catch (e) { log.warn("ui", "sendMessage threw", String(e)); }
  }

  // Initial pass + watch the DOM. Observe body only; restrict to childList
  // + subtree (no attribute churn) to keep CPU low on heavy SPAs.
  scheduleScan(120);
  let mo;
  try {
    mo = new MutationObserver((records) => { dbg.mutationCount += records.length; scheduleScan(); });
    mo.observe(document.body, { childList: true, subtree: true });
  } catch (e) { note("warn", "observer", "MutationObserver setup failed: " + e); }

  // Re-scan on SPA route transitions.
  window.addEventListener("popstate", () => scheduleScan(200));
  window.addEventListener("pageshow", () => scheduleScan(200));
  // Tear down on unload so the observer can be GC'd.
  window.addEventListener("pagehide", () => { try { mo?.disconnect(); } catch {} });
})();

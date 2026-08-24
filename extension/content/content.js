// Aplyer content-script orchestrator — hardened for production.
(function () {
  const log = window.AplyerLog;
  const ORCH_VERSION = "1.2.0";

  // Single-init guard: MV3 can inject the same content script more than once
  // (all_frames + SPA re-navigation + scripting.executeScript). A second copy
  // would double-register observers and listeners, causing duplicate buttons.
  if (window.__aplyerContentBooted) {
    log.info("boot", "Content script already active in this frame — skipping re-init");
    return;
  }
  window.__aplyerContentBooted = true;

  log.info("boot", "Content script loaded", {
    url: location.href,
    orchestrator: ORCH_VERSION,
    adapterApi: window.AplyerAdapters?.API_VERSION,
  });

  let adapter;
  try { adapter = window.AplyerDetect(); }
  catch (e) { log.warn("detector", "detect() threw", String(e)); return; }
  if (!adapter) return;

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
    catch (e) { log.warn("scan", "extractQuestions threw", String(e)); }
    finally { lastScanAt = Date.now(); scansInFlight--; }

    // Always render pill + broadcast as soon as the adapter is active — the
    // user must see the "ATS detected" status even before any questions are
    // discovered (Greenhouse/Workday render fields lazily).
    renderPill();
    maybeBroadcast();
    scheduleSafety();

    if (found.length === 0) return;

    const fresh = found.filter((q) => {
      if (knownIds.has(q.questionId)) return false;
      if (q.fieldReference?.dataset?.aplyerSeen === "1") return false;
      return true;
    });

    if (fresh.length === 0) return;

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
    }
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

  // --- Deterministic job-safety check (tab-scoped, top frame only) ---------
  let lastSafetyUrl = "";
  let safetyTimer = null;
  let safetyPoll = null;
  function checkSafety(force = false) {
    if (window.top !== window) return;
    const url = location.href;
    if (!force && url === lastSafetyUrl) return; // dedupe; URL change invalidates
    lastSafetyUrl = url;
    log.info("safety", "Requesting job-safety check", { url });
    try {
      const p = chrome.runtime.sendMessage({ type: "APLYER_JOB_SAFETY_CHECK", url });
      if (p?.then) {
        p.then((res) => log.info("safety", "Job-safety result", res?.entry?.result ?? null))
         .catch((e) => { lastSafetyUrl = ""; log.warn("safety", "check failed", String(e)); });
      }
    } catch (e) { lastSafetyUrl = ""; log.warn("safety", "sendMessage threw", String(e)); }
  }
  function scheduleSafety(delay = 400) {
    clearTimeout(safetyTimer);
    safetyTimer = setTimeout(() => checkSafety(false), delay);
  }
  // Fire immediately on boot — independent of question detection — and keep a
  // low-frequency watchdog so SPA URL changes always re-run the check.
  scheduleSafety(150);
  safetyPoll = setInterval(() => { if (location.href !== lastSafetyUrl) checkSafety(false); }, 3000);


  function renderPill() {
    // Only render the floating status pill in the top frame — otherwise
    // each iframe would render its own pill (Greenhouse embed forms run
    // inside an iframe, and we now inject into all frames).
    if (window.top !== window) return;
    if (!pill) {
      pill = document.createElement("div");
      pill.className = "aplyer-status-wrap";
      pill.innerHTML = `
        <div class="aplyer-status-pill" data-aplyer-pill>
          <span class="dot"></span>
          <span class="lbl">${adapter.platformLabel} detected</span>
          <span class="count">${questions.length}</span>
        </div>
        <button type="button" class="aplyer-autofill-btn" data-aplyer-autofill title="Autofill name, email, phone, location, links from your profile">
          <span class="aplyer-btn-dot"></span>
          <span>Autofill Basics</span>
        </button>
      `;
      try { document.documentElement.appendChild(pill); }
      catch (e) { log.warn("ui", "pill append failed", String(e)); pill = null; return; }
      pill.querySelector("[data-aplyer-pill]").addEventListener("click", () => openSidePanel(null));
      pill.querySelector("[data-aplyer-autofill]").addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        const btn = e.currentTarget;
        const orig = btn.innerHTML;
        btn.disabled = true;
        try {
          const res = await window.AplyerAutofill.autofill();
          if (res?.missing) {
            btn.innerHTML = `<span class="aplyer-btn-dot"></span><span>Sign in & save profile</span>`;
          } else if (res?.filled > 0) {
            btn.innerHTML = `<span class="aplyer-btn-dot"></span><span>Filled ${res.filled} field${res.filled === 1 ? "" : "s"}</span>`;
          } else {
            btn.innerHTML = `<span class="aplyer-btn-dot"></span><span>No basic fields found</span>`;
          }
        } catch (err) {
          log.warn("autofill", "autofill threw", String(err));
          btn.innerHTML = `<span class="aplyer-btn-dot"></span><span>Autofill failed</span>`;
        }
        setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1800);
      });
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
    mo = new MutationObserver(() => scheduleScan());
    mo.observe(document.body, { childList: true, subtree: true });
  } catch (e) { log.warn("observer", "MutationObserver setup failed", String(e)); }

  // Named handlers so every listener registered here can be removed again.
  const onPopState = () => { scheduleScan(200); scheduleSafety(200); };
  const onPageShow = () => scheduleScan(200);
  window.addEventListener("popstate", onPopState);
  window.addEventListener("pageshow", onPageShow);

  let tornDown = false;
  function teardown() {
    if (tornDown) return;
    tornDown = true;
    try { mo?.disconnect(); } catch {}
    clearTimeout(pendingScan);
    clearTimeout(safetyTimer);
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("pageshow", onPageShow);
    try { pill?.remove(); } catch {}
    pill = null;
    window.removeEventListener("pagehide", onPageHide);
    window.__aplyerContentBooted = false;
    log.info("boot", "Content script torn down", { scans: totalScans, injections: totalInjections });
  }

  // Tear down on real unload only. A bfcache "pagehide" (persisted === true)
  // must NOT tear down: the page can be restored without re-injecting the
  // content script, which previously left the extension permanently dead.
  const onPageHide = (e) => { if (!e.persisted) teardown(); };
  window.addEventListener("pagehide", onPageHide);
  // Restoring from bfcache: re-attach observers/listeners if we tore down.
  window.addEventListener("pageshow", (e) => { if (e.persisted && tornDown) reboot(); });
  function reboot() {
    if (!tornDown) return;
    tornDown = false;
    window.__aplyerContentBooted = true;
    try {
      mo = new MutationObserver(() => scheduleScan());
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) { log.warn("observer", "MutationObserver re-setup failed", String(e)); }
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide);
    knownIds.clear();
    questions.length = 0;
    lastBroadcast = "";
    lastSafetyUrl = "";
    scheduleScan(120);
    log.info("boot", "Content script rebooted from bfcache");
  }

  window.__aplyerTeardown = teardown;
})();

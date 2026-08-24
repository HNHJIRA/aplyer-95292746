// Aplyer.ai Background Service Worker (Manifest V3)
const SESSION_KEY = "aplyer.session.v1";
const STATUS_KEY = "aplyer.ats_status.v1";
const SELECTED_KEY = "aplyer.selected_question.v1";
const SAFETY_KEY = "aplyer.job_safety_by_tab.v1";

const API_BASE = "https://aplyer.devssh.xyz";
const SAFETY_TTL_MS = 10 * 60 * 1000;

/* --------------------------------------------------------------------
 * CANONICAL EXTENSION AUTH
 *
 * Every authenticated backend call in this worker goes through
 * `authedFetch`. It is the only place that reads the stored session,
 * refreshes an expired access token, and retries a 401 exactly once.
 * Do not add another bearer-token implementation.
 * ------------------------------------------------------------------ */
const SUPABASE_URL = "https://yiwsbasamuazvqxaigll.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlpd3NiYXNhbXVhenZxeGFpZ2xsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NTUzMTAsImV4cCI6MjA5NjMzMTMxMH0.xFj4wSx_o0z1rfC7F3Zt1xGO3PJclCL9oEih6BxVOs0";
/** Refresh this many seconds before the access token actually expires. */
const TOKEN_SKEW_SEC = 120;

const AUTH_REQUIRED = {
  ok: false,
  code: "auth_required",
  error: "Your session expired. Please sign in again.",
  signInRequired: true,
};

async function readStoredSession() {
  const res = await chrome.storage.local.get(SESSION_KEY);
  return res[SESSION_KEY] ?? null;
}

async function writeStoredSession(session) {
  if (session) await chrome.storage.local.set({ [SESSION_KEY]: session });
  else await chrome.storage.local.remove(SESSION_KEY);
}

function isTokenExpired(session, skewSec = TOKEN_SKEW_SEC) {
  const exp = Number(session?.expires_at || 0);
  if (!exp) return false; // unknown expiry -> let the backend decide
  return exp * 1000 - Date.now() <= skewSec * 1000;
}

/** Safe diagnostics only — never the token itself. */
function authDiagnostics(session) {
  return {
    token_present: !!session?.access_token,
    token_length: session?.access_token ? String(session.access_token).length : 0,
    token_expiry: session?.expires_at ?? null,
    user_id_prefix: session?.user?.id ? String(session.user.id).slice(0, 8) : null,
    backend_origin: API_BASE,
  };
}

/** Single-flight refresh so parallel calls never race two refreshes. */
let refreshInFlight = null;

async function refreshStoredSession() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const session = await readStoredSession();
    const refreshToken = session?.refresh_token;
    if (!refreshToken) {
      await writeStoredSession(null);
      return null;
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.access_token) {
        // Refresh genuinely failed -> clear auth state, require sign-in.
        await writeStoredSession(null);
        return null;
      }
      const next = {
        access_token: json.access_token,
        refresh_token: json.refresh_token || refreshToken,
        expires_at: json.expires_at ?? Math.floor(Date.now() / 1000) + (json.expires_in || 3600),
        user: json.user ? { id: json.user.id, email: json.user.email } : session?.user,
      };
      await writeStoredSession(next);
      return next;
    } catch (e) {
      console.warn("[Aplyer] session refresh failed", String(e));
      return null; // network problem: keep the session, caller surfaces an error
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Resolves a usable access token, refreshing proactively when near expiry. */
async function getAccessToken() {
  let session = await readStoredSession();
  if (!session?.access_token) return null;
  if (isTokenExpired(session)) {
    session = await refreshStoredSession();
    if (!session?.access_token) return null;
  }
  return session.access_token;
}

/**
 * The ONLY authenticated fetch in this worker. Returns
 * { ok, status, json } or an auth-required envelope.
 */
async function authedFetch(path, body) {
  let token = await getAccessToken();
  if (!token) return { authFailed: true };

  const call = async (bearer) =>
    fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body ?? {}),
    });

  let res = await call(token);
  if (res.status === 401 || res.status === 403) {
    // Exactly one refresh + retry. Never loop.
    const refreshed = await refreshStoredSession();
    if (!refreshed?.access_token) return { authFailed: true };
    res = await call(refreshed.access_token);
    if (res.status === 401 || res.status === 403) {
      await writeStoredSession(null);
      return { authFailed: true };
    }
  }
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}


// Tab-scoped fraud-scan state: fraudScanByTab[tabId] = { url, hostname, result, scannedAt }
async function readSafetyMap() {
  const res = await chrome.storage.local.get(SAFETY_KEY);
  return res[SAFETY_KEY] || {};
}
async function writeSafetyEntry(tabId, entry) {
  const map = await readSafetyMap();
  if (entry) map[String(tabId)] = entry;
  else delete map[String(tabId)];
  await chrome.storage.local.set({ [SAFETY_KEY]: map });
}

async function runJobSafetyCheck(tabId, url) {
  if (!tabId || typeof url !== "string" || !url) return null;
  let hostname = "";
  try { hostname = new URL(url).hostname; } catch { return null; }

  const map = await readSafetyMap();
  const prev = map[String(tabId)];
  // Invalidate whenever the URL changed (SPA navigation included).
  if (prev && prev.url === url && Date.now() - prev.scannedAt < SAFETY_TTL_MS) return prev;

  let result = null;
  try {
    const res = await fetch(`${API_BASE}/api/public/job-safety-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The server independently parses the URL; we never send trusted/provider.
      body: JSON.stringify({ url }),
    });
    const json = await res.json().catch(() => null);
    if (json?.ok && json.result) result = json.result;
  } catch (e) {
    console.warn("[Aplyer] job safety check failed", String(e));
  }

  const entry = { url, hostname, result, scannedAt: Date.now() };
  await writeSafetyEntry(tabId, entry);
  return entry;
}

chrome.tabs?.onRemoved?.addListener((tabId) => {
  writeSafetyEntry(tabId, null);
  writeFrameworkEntry(tabId, null);
  // Answer state is tab scoped — it must not survive the tab.
  try { writeAnswerState(tabId, null); } catch (e) { void e; }
});


// --- Question classification (Prompt I) --------------------------------
// The server is the only source of a trusted framework. This worker never
// derives, guesses, or accepts a client-supplied classification, and it only
// runs when the user explicitly asks to generate an answer.
//
// State is TAB SCOPED: frameworksByTab[tabId] = { questionId, questionHash,
// framework, promptVersion, model, at }. Entries are dropped when the tab
// closes so a classification can never leak into another tab.
const CLASSIFY_KEY = "aplyer.question_frameworks.v1";
const CLASSIFY_CACHE_KEY = "aplyer.question_framework_cache.v1";
const CLASSIFY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeQuestion(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ?]/g, "").trim();
}

async function readFrameworkMap() {
  const res = await chrome.storage.local.get(CLASSIFY_KEY);
  return res[CLASSIFY_KEY] || {};
}

async function writeFrameworkEntry(tabId, entry) {
  if (tabId == null) return;
  const map = await readFrameworkMap();
  if (entry) map[String(tabId)] = entry;
  else delete map[String(tabId)];
  await chrome.storage.local.set({ [CLASSIFY_KEY]: map });
}

/**
 * Classifies one question for one tab. Returns { ok, classification } or
 * { ok:false, error, code } — never a locally invented framework.
 */
async function classifyQuestionForTab(tabId, question) {
  const text = String(question?.questionText || "").trim();
  if (text.length < 5) return { ok: false, error: "No question text", code: "invalid_question" };

  const normalized = normalizeQuestion(text);
  const store = await chrome.storage.local.get([CLASSIFY_CACHE_KEY, SESSION_KEY]);
  const cache = store[CLASSIFY_CACHE_KEY] || {};

  // Identical normalized questions may reuse the cached server answer, but the
  // cached value must carry the prompt version + model it was produced with.
  const hit = cache[normalized];
  if (hit && hit.framework && hit.promptVersion && hit.model && Date.now() - (hit.at || 0) < CLASSIFY_TTL_MS) {
    await writeFrameworkEntry(tabId, { ...hit, questionId: question?.questionId ?? null, questionHash: normalized, cached: true });
    return { ok: true, classification: { ...hit, cached: true } };
  }

  const token = store[SESSION_KEY]?.access_token;
  if (!token) return { ok: false, error: "Please sign in to Aplyer first.", code: "unauthenticated" };

  try {
    const res = await fetch(`${API_BASE}/api/public/ai/classify-question`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ question: text, platform: question?.platformKey, fieldType: question?.questionType }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error || "Classification unavailable.", code: json?.code || `http_${res.status}` };
    }
    const value = {
      framework: json.framework,
      reason: json.reason,
      promptVersion: json.promptVersion,
      model: json.model,
      at: Date.now(),
    };
    cache[normalized] = value;
    const keys = Object.keys(cache);
    if (keys.length > 200) delete cache[keys[0]];
    await chrome.storage.local.set({ [CLASSIFY_CACHE_KEY]: cache });
    await writeFrameworkEntry(tabId, { ...value, questionId: question?.questionId ?? null, questionHash: normalized, cached: false });
    return { ok: true, classification: { ...value, cached: false } };
  } catch (e) {
    console.warn("[Aplyer] classify failed", String(e));
    return { ok: false, error: "Classification unavailable.", code: "network_error" };
  }
}

/**
 * P0 profile context (canonical resume fact inventory). The extension only
 * learns the STATE; inventory contents never leave the server.
 */
async function ensureFactInventory({ ensure = true } = {}) {
  const store = await chrome.storage.local.get([SESSION_KEY]);
  const token = store[SESSION_KEY]?.access_token;
  if (!token) return { ok: false, error: "Please sign in to Aplyer first.", code: "unauthenticated" };
  try {
    const res = await fetch(`${API_BASE}/api/public/fact-inventory`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ensure }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error || "We couldn't prepare your profile context.", code: json?.code || `http_${res.status}` };
    }
    return { ok: true, state: json };
  } catch (e) {
    console.warn("[Aplyer] fact inventory failed", String(e));
    return { ok: false, error: "We couldn't prepare your profile context.", code: "network_error" };
  }
}

/**
 * Validated answer request. The extension sends ONLY the question text and the
 * page's job context. Framework, facts, profile mode, models and prompt
 * versions are all decided server-side and never sent from here.
 */
async function requestValidatedAnswer(payload = {}) {
  const store = await chrome.storage.local.get([SESSION_KEY]);
  const token = store[SESSION_KEY]?.access_token;
  if (!token) return { ok: false, error: "Please sign in to Aplyer first.", code: "unauthenticated" };
  try {
    const res = await fetch(`${API_BASE}/api/public/generate-answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        error: json?.error || "We couldn't produce an answer you can trust. Try again.",
        code: json?.code || `http_${res.status}`,
      };
    }
    return json;
  } catch (e) {
    console.warn("[Aplyer] answer request failed", String(e));
    return { ok: false, error: "We couldn't reach Aplyer. Check your connection.", code: "network_error" };
  }
}

/* --------------------------------------------------------------------
 * Tab-scoped answer state + single-flight generation.
 *
 * The side panel is stateless: it renders whatever the background says the
 * state for the ACTIVE tab is. Closing and reopening the panel, a second
 * panel, or a rapid double-click all converge on the same in-flight run.
 * State is keyed by tabId + normalized question so Tab A's answer can never
 * surface in Tab B.
 * ------------------------------------------------------------------ */
const ANSWER_STATE_KEY = "aplyer.answer_state_by_tab.v1";
/** tabId:questionHash -> Promise (service-worker lifetime, single flight). */
const inflightAnswers = new Map();

async function readAnswerStateMap() {
  const res = await chrome.storage.local.get(ANSWER_STATE_KEY);
  return res[ANSWER_STATE_KEY] || {};
}

async function writeAnswerState(tabId, entry) {
  if (tabId == null) return entry;
  const map = await readAnswerStateMap();
  if (entry) map[String(tabId)] = entry;
  else delete map[String(tabId)];
  await chrome.storage.local.set({ [ANSWER_STATE_KEY]: map });
  return entry;
}

async function readAnswerState(tabId, questionHash) {
  if (tabId == null) return null;
  const map = await readAnswerStateMap();
  const entry = map[String(tabId)] || null;
  if (!entry) return null;
  if (questionHash && entry.questionHash !== questionHash) return null;
  return entry;
}

function phaseFor(step) {
  switch (step) {
    case "classify": return "Checking this question…";
    case "context": return "Preparing your profile context…";
    case "variants": return "Writing two options…";
    default: return "Writing your answer…";
  }
}

/**
 * Runs the full user-visible flow for one tab+question exactly once.
 * Returns the terminal state object (also persisted for panel recovery).
 */
async function runAnswerFlow(tabId, question, job, force) {
  const questionHash = normalizeQuestion(question?.questionText || question?.question || "");
  const flightKey = `${tabId}:${questionHash}:${force ? "force" : "cache"}`;
  const existing = inflightAnswers.get(flightKey);
  if (existing) return existing;

  const run = (async () => {
    const setPhase = (step) =>
      writeAnswerState(tabId, { questionHash, phase: "running", status: phaseFor(step), at: Date.now() });

    await setPhase("classify");
    const cls = await classifyQuestionForTab(tabId, question);
    if (!cls?.ok) {
      return writeAnswerState(tabId, { questionHash, phase: "error", error: cls?.error || "We could not analyze this question. Please try again.", at: Date.now() });
    }

    await setPhase("context");
    const inv = await ensureFactInventory({ ensure: true });
    if (!inv?.ok) {
      return writeAnswerState(tabId, { questionHash, phase: "error", error: inv?.error || "We couldn't prepare your profile context. Try again.", at: Date.now() });
    }
    const invStatus = inv.state?.status;
    if (invStatus !== "ready") {
      const pending = invStatus === "extracting" || invStatus === "pending";
      return writeAnswerState(tabId, {
        questionHash,
        phase: pending ? "pending" : "error",
        error: pending
          ? "Still preparing your profile context. Try again in a moment."
          : "We couldn't prepare your profile context. Try again.",
        at: Date.now(),
      });
    }

    await setPhase("answer");
    let out = await requestValidatedAnswer({
      question: String(question?.questionText || "").slice(0, 2000),
      job: job || null,
      force: force === true,
    });

    // The server holds one generation lock per snapshot. A concurrent caller
    // waits for that run instead of starting a second pipeline.
    let waits = 0;
    while (out && out.ok === false && out.code === "in_progress" && waits < 30) {
      waits += 1;
      await new Promise((r) => setTimeout(r, 3000));
      out = await requestValidatedAnswer({
        question: String(question?.questionText || "").slice(0, 2000),
        job: job || null,
        force: false,
      });
    }

    if (!out || out.ok === false) {
      return writeAnswerState(tabId, { questionHash, phase: "error", error: out?.error || "We couldn't produce an answer you can trust. Try again.", at: Date.now() });
    }

    return writeAnswerState(tabId, {
      questionHash,
      phase: out.needsChoice ? "choice" : "ready",
      answerId: out.answerId || null,
      answer: out.answer || null,
      wordCount: out.wordCount || null,
      options: Array.isArray(out.options) ? out.options : null,
      cached: out.cached === true,
      at: Date.now(),
    });
  })().finally(() => inflightAnswers.delete(flightKey));

  inflightAnswers.set(flightKey, run);
  return run;
}


// Proactive path: tab URL access is granted by host_permissions for supported
// ATS hosts, so the check runs even if the content script never messages us.
chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || (changeInfo.status === "complete" ? tab?.url : null);
  if (url && /^https?:/i.test(url)) runJobSafetyCheck(tabId, url);
});


chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") console.log("[Aplyer.ai] Extension installed.");
});

// Enable side panel to open on action click (popup will still open; we use action API for popup)
try {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
} catch (_) {}

// External messages from the web app (auth bridge)
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") { sendResponse({ ok: false, error: "Invalid payload" }); return true; }
  if (message.type === "APLYER_AUTH_SET" && message.session) {
    chrome.storage.local.set({ [SESSION_KEY]: message.session }, () => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "APLYER_AUTH_CLEAR") {
    chrome.storage.local.remove(SESSION_KEY, () => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "APLYER_PING") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return true;
  }
  sendResponse({ ok: false, error: "Unknown message type" });
  return true;
});

// Internal messages (popup + content scripts + sidepanel)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return false;

  if (message.type === "APLYER_GET_SESSION") {
    chrome.storage.local.get(SESSION_KEY, (res) => sendResponse({ session: res[SESSION_KEY] ?? null }));
    return true;
  }
  if (message.type === "APLYER_SIGN_OUT") {
    chrome.storage.local.clear(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "APLYER_CLEAR_ALL") {
    chrome.storage.local.clear(() => sendResponse({ ok: true }));
    return true;
  }


  // Content-script -> background: run the deterministic job-safety check
  if (message.type === "APLYER_JOB_SAFETY_CHECK") {
    const tabId = sender?.tab?.id;
    runJobSafetyCheck(tabId, message.url).then((entry) => sendResponse?.({ ok: true, entry }));
    return true;
  }

  // Side panel / popup -> background: read tab-scoped safety state.
  // Self-healing: when the panel has no entry for the active tab we run the
  // check here (the panel has no content-script context of its own).
  if (message.type === "APLYER_GET_JOB_SAFETY") {
    (async () => {
      let tabId = message.tabId;
      let url = message.url;
      if (tabId == null || !url) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) { tabId = tabId ?? tab.id; url = url || tab.url; }
        } catch (e) { console.warn("[Aplyer] tabs.query failed", String(e)); }
      }
      const map = await readSafetyMap();
      let entry = tabId != null ? map[String(tabId)] ?? null : null;
      if ((!entry || (url && entry.url !== url)) && url) {
        entry = await runJobSafetyCheck(tabId, url);
      }
      sendResponse?.({ entry });
    })();
    return true;
  }


  // Side panel / content-script -> background: classify on explicit user
  // action ("Generate Answer"). Any framework supplied by the caller is
  // ignored — only the server's classification is trusted.
  if (message.type === "APLYER_CLASSIFY_QUESTION") {
    (async () => {
      let tabId = sender?.tab?.id ?? message.tabId;
      if (tabId == null) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tab?.id ?? null;
        } catch (e) { console.warn("[Aplyer] tabs.query failed", String(e)); }
      }
      const question = { ...(message.question || {}) };
      delete question.framework;
      sendResponse?.(await classifyQuestionForTab(tabId, question));
    })();
    return true;
  }

  // Side panel -> background: prepare/read the user's profile context (P0).
  if (message.type === "APLYER_ENSURE_FACT_INVENTORY") {
    (async () => {
      sendResponse?.(await ensureFactInventory({ ensure: message.ensure !== false }));
    })();
    return true;
  }

  // Side panel -> background: run (or join) the validated answer flow.
  if (message.type === "APLYER_GENERATE_ANSWER") {
    (async () => {
      let tabId = sender?.tab?.id ?? message.tabId;
      if (tabId == null) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tab?.id ?? null;
        } catch (e) { console.warn("[Aplyer] tabs.query failed", String(e)); }
      }
      const job = message.job || null;
      const state = await runAnswerFlow(
        tabId,
        { ...(message.question || {}), questionText: String(message.question?.questionText || message.question || "") },
        job ? { title: job.title, company: job.company, description: job.description } : null,
        message.force === true,
      );
      sendResponse?.({ ok: true, state });
    })();
    return true;
  }

  // Side panel -> background: restore canonical state for the active tab.
  if (message.type === "APLYER_GET_ANSWER_STATE") {
    (async () => {
      let tabId = message.tabId;
      if (tabId == null) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tab?.id ?? null;
        } catch (e) { console.warn("[Aplyer] tabs.query failed", String(e)); }
      }
      sendResponse?.({ ok: true, state: await readAnswerState(tabId, message.questionHash || null) });
    })();
    return true;
  }

  // Side panel -> background: store the resume-only phrasing choice.
  if (message.type === "APLYER_CHOOSE_ANSWER_OPTION") {
    (async () => {
      const res = await requestValidatedAnswer({
        select: { answerId: message.answerId, variantId: message.variantId },
      });
      if (res?.ok) {
        let tabId = message.tabId;
        if (tabId == null) {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            tabId = tab?.id ?? null;
          } catch (e) { console.warn("[Aplyer] tabs.query failed", String(e)); }
        }
        const prev = await readAnswerState(tabId, null);
        if (prev) {
          await writeAnswerState(tabId, {
            ...prev,
            phase: "ready",
            answer: res.answer,
            options: null,
            at: Date.now(),
          });
        }
      }
      sendResponse?.(res);
    })();
    return true;
  }


  // Side panel -> background: read the framework for the active tab only.
  if (message.type === "APLYER_GET_FRAMEWORK") {
    (async () => {
      let tabId = message.tabId;
      if (tabId == null) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tab?.id ?? null;
        } catch (e) { console.warn("[Aplyer] tabs.query failed", String(e)); }
      }
      const map = await readFrameworkMap();
      sendResponse?.({ entry: tabId != null ? map[String(tabId)] ?? null : null });
    })();
    return true;
  }

  // Content-script -> background: ATS status update
  if (message.type === "APLYER_ATS_STATUS" && message.payload) {
    chrome.storage.local.set({ [STATUS_KEY]: message.payload }, () => sendResponse?.({ ok: true }));
    return true;
  }

  // Content-script -> background: open side panel for a question
  if (message.type === "APLYER_OPEN_SIDE_PANEL") {
    const tabId = sender?.tab?.id;
    const payload = message.payload || {};
    const writes = {
      [STATUS_KEY]: { platform: payload.platform, platformKey: payload.platformKey, questionsCount: payload.questions?.length || 0, questions: payload.questions || [], url: payload.url },
      [SELECTED_KEY]: payload.question || null,
    };
    chrome.storage.local.set(writes, () => {
      try {
        if (tabId && chrome.sidePanel?.open) {
          chrome.sidePanel.open({ tabId });
        }
      } catch (e) {
        console.warn("[Aplyer] sidePanel.open failed", e);
      }
      // Classification is NOT run here. It happens only when the user
      // explicitly chooses "Generate Answer" in the side panel.
      if (tabId != null) writeFrameworkEntry(tabId, null);
      sendResponse?.({ ok: true });
    });
    return true;
  }

  return false;
});

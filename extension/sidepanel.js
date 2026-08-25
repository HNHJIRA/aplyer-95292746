// Side panel — reads last ATS status + auth/resume/plan from chrome.storage.
// Resilient to: empty/missing keys, refresh, tab switches, partial payloads.
const KEY_STATUS = "aplyer.ats_status.v1";
const KEY_QUESTION = "aplyer.selected_question.v1";
const KEY_SESSION = "aplyer.session.v1";
const KEY_SAFETY = "aplyer.job_safety_by_tab.v1";
const KEY_FRAMEWORKS = "aplyer.question_frameworks.v1";
const KEY_DEBUG = "aplyer.debug_mode.v1";

// Normal users never see the framework tag or any confidence figure. The
// framework stays internal and is only surfaced in diagnostics mode.
let debugMode = false;
let currentTabId = null;
let currentFramework = null;

const $ = (id) => document.getElementById(id);

function safeText(v, fallback = "—") {
  if (v === null || v === undefined || v === "") return fallback;
  return String(v);
}

function renderSafety(entry) {
  const card = $("safety-card");
  const badge = $("safety-badge");
  const score = $("safety-score");
  const copy = $("safety-copy");
  const host = $("safety-host");
  if (!entry) { card.style.display = "none"; return; }
  card.style.display = "";
  const r = entry.result;
  host.textContent = [entry.hostname || "", r?.provider ? `Provider: ${r.provider}` : ""].filter(Boolean).join("  ·  ");
  badge.classList.remove("is-safe", "is-unknown");
  if (r && r.status === "safe") {
    badge.textContent = "Safe";
    badge.classList.add("is-safe");
    score.textContent = "100% Genuine";
    copy.textContent = "Hosted on a recognized applicant tracking platform. This confirms the hosting platform, not the employer or the individual listing.";
  } else if (r && r.status === "needs_scan") {
    badge.textContent = "Unverified";
    badge.classList.add("is-unknown");
    score.textContent = "";
    copy.textContent = "Not a recognized applicant tracking platform — a full safety scan is required before we can rate this listing.";
  } else {
    badge.textContent = "Checking…";
    score.textContent = "";
    copy.textContent = "Running the job safety check…";
  }
}


function render(state) {
  const { status, question, session } = state;
  const pill = $("platform-pill");
  if (status?.platform) {
    pill.textContent = `${status.platform} Detected`;
    pill.classList.add("pill-green");
  } else {
    pill.textContent = "No ATS";
    pill.classList.remove("pill-green");
  }
  $("s-platform").textContent = safeText(status?.platform, "Not detected");
  $("s-count").textContent = String(status?.questionsCount ?? 0);
  $("s-conn").textContent = session ? "Signed in" : "Not signed in";
  $("s-resume").textContent = session ? "Open dashboard" : "—";
  $("s-plan").textContent = session ? "Free" : "—";

  if (question && question.questionText) {
    $("question-card").style.display = "";
    $("q-text").textContent = question.questionText;
    const parts = [`type: ${question.questionType}`];
    if (debugMode && currentFramework?.framework) {
      parts.push(`framework: ${currentFramework.framework}`);
      parts.push(`prompt ${currentFramework.promptVersion} · ${currentFramework.model}`);
    }
    $("q-meta").textContent = parts.join("  ·  ");
  } else {
    $("question-card").style.display = "none";
  }

  const list = status?.questions || [];
  if (list.length) {
    $("questions-card").style.display = "";
    const ol = $("q-list");
    ol.innerHTML = "";
    for (const q of list) {
      const li = document.createElement("li");
      li.textContent = q.questionText || "(unlabeled question)";
      ol.appendChild(li);
    }
  } else {
    $("questions-card").style.display = "none";
  }
}

function askBackgroundSafety() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), 8000);
    try {
      chrome.runtime.sendMessage({ type: "APLYER_GET_JOB_SAFETY" }, (res) => {
        void chrome.runtime.lastError;
        finish(res?.entry ?? null);
      });
    } catch { finish(null); }
  });
}

async function load() {
  try {
    const data = await chrome.storage.local.get([KEY_STATUS, KEY_QUESTION, KEY_SESSION, KEY_SAFETY, KEY_FRAMEWORKS, KEY_DEBUG]);
    debugMode = data[KEY_DEBUG] === true || new URLSearchParams(location.search).get("debug") === "1";
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTabId = activeTab?.id ?? null;
    } catch { currentTabId = null; }
    // Frameworks are tab scoped — never read another tab's entry.
    currentFramework = currentTabId != null ? (data[KEY_FRAMEWORKS] || {})[String(currentTabId)] || null : null;
    render({
      status: data[KEY_STATUS] || null,
      question: data[KEY_QUESTION] || null,
      session: data[KEY_SESSION] || null,
    });
    // Fraud-scan state is strictly tab-scoped. The background resolves the
    // active tab and runs the check on demand when no entry exists yet.
    let safety = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const map = data[KEY_SAFETY] || {};
      if (tab?.id != null) safety = map[String(tab.id)] || null;
    } catch { /* no tabs access */ }
    if (safety) renderSafety(safety);
    // Canonical answer state comes from the background, never from this panel.
    try { await restoreAnswerState(); } catch (e) { console.warn("[Aplyer] restore failed", e); }
    const fresh = await askBackgroundSafety();
    if (fresh) renderSafety(fresh);
    else if (!safety) renderSafety(null);

  } catch (e) {
    // Fail safe — never throw user-visible errors in the panel.
    console.warn("[Aplyer] sidepanel load failed", e);
    render({ status: null, question: null, session: null });
  }
}

function setGenStatus(text, isError, signInRequired) {
  const el = $("q-generate-status");
  // Raw backend auth wording ("Unauthorized") must never reach the UI.
  const safe = /^unauthorized$/i.test(String(text || "").trim())
    ? "Your session expired. Please sign in again."
    : text || "";
  el.textContent = safe;
  el.classList.toggle("q-error", !!isError);
  let btn = $("q-signin");
  if (signInRequired) {
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "q-signin";
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.textContent = "Sign in";
      btn.addEventListener("click", () => send("APLYER_OPEN_SIGN_IN", {}, 5000));
      el.insertAdjacentElement("afterend", btn);
    }
    btn.style.display = "";
  } else if (btn) {
    btn.style.display = "none";
  }
}

function send(type, payload, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), timeoutMs);
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (r) => {
        void chrome.runtime.lastError;
        finish(r ?? null);
      });
    } catch { finish(null); }
  });
}

let lastAnswerId = null;

function normalizeQuestionText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ?]/g, "").trim();
}

function hideResults() {
  const undo = $("answer-undo");
  if (undo) undo.style.display = "none";
  const fs = $("fill-status");
  if (fs) fs.textContent = "";
  const rc = $("replace-confirm");
  if (rc) rc.style.display = "none";
  $("answer-card").style.display = "none";
  $("choice-card").style.display = "none";
}

function showAnswer(answer, wordCount) {
  $("choice-card").style.display = "none";
  $("answer-card").style.display = "";
  $("answer-text").textContent = answer;
  $("answer-meta").textContent = wordCount ? `${wordCount} words · quality checked` : "Quality checked";
}

function showChoice(options) {
  $("answer-card").style.display = "none";
  $("choice-card").style.display = "";
  const a = options.find((o) => o.id === "A") || options[0];
  const b = options.find((o) => o.id === "B") || options[1];
  $("opt-a-text").textContent = a?.answer || "";
  $("opt-b-text").textContent = b?.answer || "";
}

/** Renders whatever canonical state the background reports for this tab. */
function renderAnswerState(state) {
  const btn = $("q-generate");
  if (!state) {
    hideResults();
    setGenStatus("", false);
    if (btn) btn.disabled = false;
    return;
  }
  lastAnswerId = state.answerId || lastAnswerId;
  if (state.phase === "running") {
    hideResults();
    if (btn) btn.disabled = true;
    setGenStatus(state.status || "Writing your answer…", false);
    return;
  }
  if (btn) btn.disabled = false;
  if (state.phase === "choice" && Array.isArray(state.options)) {
    setGenStatus("Two wordings ready — pick the one that sounds like you.", false);
    showChoice(state.options);
    return;
  }
  if (state.phase === "ready" && state.answer) {
    setGenStatus("Ready.", false);
    showAnswer(state.answer, state.wordCount);
    return;
  }
  hideResults();
  setGenStatus(state.error || "", state.phase === "error", state.signInRequired === true);
}

/** Restores canonical state after a panel close/reopen — no new generation. */
async function restoreAnswerState() {
  const data = await chrome.storage.local.get(KEY_QUESTION);
  const questionHash = normalizeQuestionText(data[KEY_QUESTION]?.questionText || "");
  const res = await send("APLYER_GET_ANSWER_STATE", { tabId: currentTabId, questionHash }, 8000);
  renderAnswerState(res?.state ?? null);
  // A run started before the panel closed keeps going in the background.
  if (res?.state?.phase === "running") pollAnswerState(questionHash);
}

let polling = false;
async function pollAnswerState(questionHash) {
  if (polling) return;
  polling = true;
  try {
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await send("APLYER_GET_ANSWER_STATE", { tabId: currentTabId, questionHash }, 8000);
      const state = res?.state ?? null;
      renderAnswerState(state);
      if (!state || state.phase !== "running") return;
    }
  } finally {
    polling = false;
  }
}

async function onGenerateAnswer(force) {
  const btn = $("q-generate");
  const data = await chrome.storage.local.get(KEY_QUESTION);
  const question = data[KEY_QUESTION];
  if (!question?.questionText) return;
  if (btn?.disabled) return;

  hideResults();
  if (btn) btn.disabled = true;
  setGenStatus("Checking this question…", false);

  const questionHash = normalizeQuestionText(question.questionText);
  pollAnswerState(questionHash);

  // The background owns the whole flow (classification -> profile context ->
  // validated answer) so panel closure never aborts or duplicates a run.
  const res = await send(
    "APLYER_GENERATE_ANSWER",
    {
      tabId: currentTabId,
      question,
      job: {
        title: question.jobTitle || undefined,
        company: question.company || undefined,
        description: question.jobDescription || undefined,
      },
      force: force === true,
    },
    600000,
  );

  if (!res?.state) {
    await restoreAnswerState();
    return;
  }
  renderAnswerState(res.state);
}

/* ---------------------------------------------------------------
 * Autofill — the panel never touches page DOM. It asks the background
 * to write the answer into the exact field that started this run.
 * ------------------------------------------------------------- */
function setFillStatus(text, isError) {
  const el = $("fill-status");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("q-error", !!isError);
}

function showReplaceConfirm(show) {
  const el = $("replace-confirm");
  if (el) el.style.display = show ? "" : "none";
}

async function autofillAnswer(answer, force) {
  const data = await chrome.storage.local.get(KEY_QUESTION);
  const questionHash = normalizeQuestionText(data[KEY_QUESTION]?.questionText || "");
  showReplaceConfirm(false);
  setFillStatus("Adding your answer to the application…", false);
  const res = await send(
    "APLYER_AUTOFILL_ANSWER",
    { tabId: currentTabId, questionHash, answer, force: force === true },
    20000,
  );
  if (res?.ok) {
    setFillStatus("✓ Answer added", false);
    const undo = $("answer-undo");
    if (undo) undo.style.display = "";
    return true;
  }
  if (res?.code === "field_not_empty") {
    setFillStatus("", false);
    showReplaceConfirm(true);
    return false;
  }
  setFillStatus(res?.error || "We couldn't find the original answer field. Reopen the question and try again.", true);
  return false;
}

async function undoAutofill() {
  const data = await chrome.storage.local.get(KEY_QUESTION);
  const questionHash = normalizeQuestionText(data[KEY_QUESTION]?.questionText || "");
  const res = await send("APLYER_AUTOFILL_UNDO", { tabId: currentTabId, questionHash }, 20000);
  if (res?.ok) {
    setFillStatus("Undone — the field is back to what it was.", false);
    const undo = $("answer-undo");
    if (undo) undo.style.display = "none";
    return;
  }
  setFillStatus(res?.error || "We couldn't undo that.", true);
}

async function pickOption(variantId) {
  if (!lastAnswerId) return;
  setGenStatus("Saving your preference…", false);
  const r = await send("APLYER_CHOOSE_ANSWER_OPTION", { tabId: currentTabId, answerId: lastAnswerId, variantId }, 30000);
  if (!r?.ok) {
    setGenStatus(r?.error || "We couldn't save that choice. Try again.", true);
    return;
  }
  // Preference is saved even if the insert fails — never lose the choice.
  setGenStatus("Saved. Aplyer will keep this style from now on.", false);
  showAnswer(r.answer, null);
  await autofillAnswer(r.answer, false);
}

function bind() {
  $("q-generate")?.addEventListener("click", () => onGenerateAnswer(false));
  $("answer-regen")?.addEventListener("click", () => onGenerateAnswer(true));
  $("answer-use")?.addEventListener("click", () => autofillAnswer($("answer-text").textContent || "", false));
  $("answer-undo")?.addEventListener("click", () => undoAutofill());
  $("replace-yes")?.addEventListener("click", () => autofillAnswer($("answer-text").textContent || "", true));
  $("replace-no")?.addEventListener("click", () => { showReplaceConfirm(false); setFillStatus("Kept your existing text.", false); });
  $("opt-a-pick")?.addEventListener("click", () => pickOption("A"));
  $("opt-b-pick")?.addEventListener("click", () => pickOption("B"));
  $("answer-copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("answer-text").textContent || "");
      setGenStatus("Copied to your clipboard.", false);
    } catch {
      setGenStatus("Copy failed — select the text and copy manually.", true);
    }
  });
}


chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[KEY_STATUS] || changes[KEY_QUESTION] || changes[KEY_SESSION] || changes[KEY_SAFETY] || changes[KEY_FRAMEWORKS]) {
    load();
  }
});

document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

bind();
load();

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
    const fresh = await askBackgroundSafety();
    if (fresh) renderSafety(fresh);
    else if (!safety) renderSafety(null);
  } catch (e) {
    // Fail safe — never throw user-visible errors in the panel.
    console.warn("[Aplyer] sidepanel load failed", e);
    render({ status: null, question: null, session: null });
  }
}


function setGenStatus(text, isError) {
  const el = $("q-generate-status");
  el.textContent = text || "";
  el.classList.toggle("q-error", !!isError);
}

async function onGenerateAnswer() {
  const btn = $("q-generate");
  const data = await chrome.storage.local.get(KEY_QUESTION);
  const question = data[KEY_QUESTION];
  if (!question?.questionText) return;
  btn.disabled = true;
  setGenStatus("Analyzing this question…", false);
  const res = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), 20000);
    try {
      chrome.runtime.sendMessage(
        // No framework is sent: the client is not a trusted classifier.
        { type: "APLYER_CLASSIFY_QUESTION", tabId: currentTabId, question },
        (r) => { void chrome.runtime.lastError; finish(r ?? null); },
      );
    } catch { finish(null); }
  });
  btn.disabled = false;
  if (!res?.ok) {
    currentFramework = null;
    setGenStatus(res?.error || "We could not analyze this question. Please try again.", true);
    return;
  }
  currentFramework = res.classification;
  setGenStatus("Question analyzed. Answer generation unlocks in Milestone 4.", false);
  document.addEventListener("DOMContentLoaded", () => {
  $("q-generate").addEventListener("click", () => { onGenerateAnswer(); });
});

load();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[KEY_STATUS] || changes[KEY_QUESTION] || changes[KEY_SESSION] || changes[KEY_SAFETY] || changes[KEY_FRAMEWORKS]) document.addEventListener("DOMContentLoaded", () => {
  $("q-generate").addEventListener("click", () => { onGenerateAnswer(); });
});

load();
});

document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

document.addEventListener("DOMContentLoaded", () => {
  $("q-generate").addEventListener("click", () => { onGenerateAnswer(); });
});

load();

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

function hideResults() {
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

async function onGenerateAnswer(force) {
  const btn = $("q-generate");
  const data = await chrome.storage.local.get(KEY_QUESTION);
  const question = data[KEY_QUESTION];
  if (!question?.questionText) return;

  hideResults();
  btn.disabled = true;
  setGenStatus("Analyzing this question…", false);

  // 1. Server-side classification. No framework is sent from the client.
  const res = await send("APLYER_CLASSIFY_QUESTION", { tabId: currentTabId, question }, 30000);
  if (!res?.ok) {
    currentFramework = null;
    btn.disabled = false;
    setGenStatus(res?.error || "We could not analyze this question. Please try again.", true);
    return;
  }
  currentFramework = res.classification;

  // 2. Profile context (P0). Contents never leave the server.
  setGenStatus("Preparing your profile context…", false);
  const inv = await send("APLYER_ENSURE_FACT_INVENTORY", { ensure: true }, 60000);
  if (!inv?.ok) {
    btn.disabled = false;
    setGenStatus(inv?.error || "We couldn't prepare your profile context. Try again.", true);
    return;
  }
  const invStatus = inv.state?.status;
  if (invStatus !== "ready") {
    btn.disabled = false;
    setGenStatus(
      invStatus === "extracting" || invStatus === "pending"
        ? "Still preparing your profile context. Try again in a moment."
        : "We couldn't prepare your profile context. Try again.",
      invStatus !== "extracting" && invStatus !== "pending",
    );
    return;
  }

  // 3. Validated answer. Only the question and page job context are sent.
  setGenStatus("Writing your answer…", false);
  const job = {
    title: question.jobTitle || undefined,
    company: question.company || undefined,
    description: question.jobDescription || undefined,
  };
  const out = await send(
    "APLYER_GENERATE_ANSWER",
    { question: question.questionText, job, force: force === true },
    180000,
  );
  btn.disabled = false;

  if (!out) {
    setGenStatus("That took too long. Please try again.", true);
    return;
  }
  if (!out.ok) {
    setGenStatus(out.error || "We couldn't produce an answer you can trust. Try again.", true);
    return;
  }

  lastAnswerId = out.answerId || null;
  if (out.needsChoice && Array.isArray(out.options)) {
    setGenStatus("Two wordings ready — pick the one that sounds like you.", false);
    showChoice(out.options);
    return;
  }
  setGenStatus(out.cached ? "Ready." : "Answer ready.", false);
  showAnswer(out.answer, out.wordCount);
}

async function pickOption(variantId) {
  if (!lastAnswerId) return;
  setGenStatus("Saving your preference…", false);
  const r = await send("APLYER_CHOOSE_ANSWER_OPTION", { answerId: lastAnswerId, variantId }, 30000);
  if (!r?.ok) {
    setGenStatus(r?.error || "We couldn't save that choice. Try again.", true);
    return;
  }
  setGenStatus("Saved. Aplyer will keep this style from now on.", false);
  showAnswer(r.answer, null);
}

function bind() {
  $("q-generate")?.addEventListener("click", () => onGenerateAnswer(false));
  $("answer-regen")?.addEventListener("click", () => onGenerateAnswer(true));
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

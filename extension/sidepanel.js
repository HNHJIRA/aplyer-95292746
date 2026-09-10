// Side panel — reads last ATS status + auth/resume/plan from chrome.storage.
// Resilient to: empty/missing keys, refresh, tab switches, partial payloads.
const KEY_STATUS = "aplyer.ats_status.v1";
const KEY_QUESTION = "aplyer.selected_question.v1";
const KEY_SESSION = "aplyer.session.v1";
const KEY_SAFETY = "aplyer.job_safety_by_tab.v1";
const KEY_FRAMEWORKS = "aplyer.question_frameworks.v1";
const KEY_DEBUG = "aplyer.debug_mode.v1";
const KEY_CORRECTIONS = "aplyer.pending_corrections.v1";

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

/**
 * Live text shown while the answer is still being written. It is preview only:
 * no button is wired to it and it is cleared the moment the finished answer
 * (or an error) arrives, so it can never be copied or filled into a form.
 */
function showLiveAnswer(text) {
  const el = $("answer-live");
  if (!el) return;
  if (!text) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "";
  el.textContent = text;
  el.scrollTop = el.scrollHeight;
}

function hideResults() {
  showLiveAnswer("");
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
  showLiveAnswer("");
  $("choice-card").style.display = "none";
  $("answer-card").style.display = "";
  $("answer-text").textContent = answer;
  $("answer-meta").textContent = wordCount ? `${wordCount} words · quality checked` : "Quality checked";
}

function showChoice(options) {
  showLiveAnswer("");
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
    // Text written so far, if the answer is arriving progressively.
    showLiveAnswer(typeof state.draft === "string" ? state.draft : "");
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
    // Polls quickly so text appears as it is written, for up to 10 minutes.
    for (let i = 0; i < 1200; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
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

/* ------------------- Application details autofill ------------------- */

function setFieldsStatus(text, isError) {
  const el = $("fields-status");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("q-error", !!isError);
}

function renderAskFields(ask) {
  const wrap = $("fields-ask");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const f of ask) {
    const row = document.createElement("div");
    row.className = "q-meta";
    const label = document.createElement("div");
    label.textContent = f.questionText;
    row.appendChild(label);

    let input;
    if (Array.isArray(f.options) && f.options.length) {
      input = document.createElement("select");
      for (const o of f.options) {
        const opt = document.createElement("option");
        opt.textContent = o;
        input.appendChild(opt);
      }
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.maxLength = 500;
      input.placeholder = "Your answer";
    }
    const save = document.createElement("button");
    save.type = "button";
    save.className = "q-generate q-secondary";
    save.textContent = "Save & fill";
    save.addEventListener("click", async () => {
      const value = String(input.value || "").trim();
      if (!value) return;
      save.disabled = true;
      const res = await send(
        "APLYER_ANSWER_FIELD",
        {
          tabId: currentTabId,
          field: {
            fieldId: f.fieldId,
            questionText: f.questionText,
            fieldType: f.fieldType,
            options: f.options || [],
            answerValue: value,
          },
        },
        20000,
      );
      save.disabled = false;
      row.textContent = res?.ok
        ? `✓ ${f.questionText} — filled${res.remembered ? " and remembered" : ""}`
        : `We couldn't fill "${f.questionText}".`;
    });

    row.appendChild(input);
    row.appendChild(save);
    wrap.appendChild(row);
  }
}

async function autofillAllFields() {
  const btn = $("fields-autofill");
  if (btn) btn.disabled = true;
  setFieldsStatus("Reading this application form…", false);
  // Written answers go through the full validation pipeline, so this run can
  // take a while on forms with open-ended questions.
  const res = await send("APLYER_AUTOFILL_ALL", { tabId: currentTabId }, 300000);
  if (btn) btn.disabled = false;

  if (!res?.ok) {
    if (res?.code === "auth_required") {
      setFieldsStatus("Your session expired. Please sign in again.", true);
      return;
    }
    setFieldsStatus(res?.error || "We couldn't autofill this form.", true);
    return;
  }
  if (res.nothingToDo) {
    setFieldsStatus("Everything here is already filled in.", false);
    renderSummary(res);
    return;
  }

  const list = $("fields-filled");
  if (list) {
    list.innerHTML = "";
    for (const f of res.filled || []) {
      const li = document.createElement("li");
      li.textContent = `${f.questionText}: ${f.value}`;
      list.appendChild(li);
    }
    for (const g of res.generated || []) {
      const li = document.createElement("li");
      li.textContent = `${g.questionText}: answer written for you`;
      list.appendChild(li);
    }
  }
  renderAskFields(res.ask || []);
  renderSummary(res);
  setFieldsStatus("✓ Autofill complete.", false);
}

/** Plain-language completion summary. */
function renderSummary(res) {
  const el = $("fields-summary");
  if (!el) return;
  const filled = (res.filled || []).length;
  const generated = (res.generated || []).length;
  const review = (res.ask || []).length;
  const skipped = Number(res.skipped || 0);
  el.innerHTML = "";
  const rows = [
    ["Filled", `${filled} field${filled === 1 ? "" : "s"}`],
    ["Generated", `${generated} answer${generated === 1 ? "" : "s"}`],
    ["Needs review", `${review} field${review === 1 ? "" : "s"}`],
    ["Skipped", `${skipped} sensitive field${skipped === 1 ? "" : "s"}`],
  ];
  for (const [k, v] of rows) {
    const row = document.createElement("div");
    row.textContent = `${k}: ${v}`;
    el.appendChild(row);
  }
}

/* --------------------- correction confirmations --------------------- */

async function loadCorrections() {
  const wrap = $("fields-corrections");
  if (!wrap || currentTabId == null) return;
  const res = await send("APLYER_GET_CORRECTIONS", { tabId: currentTabId }, 8000);
  const items = res?.corrections || [];
  wrap.innerHTML = "";
  for (const c of items) {
    const row = document.createElement("div");
    row.className = "q-meta";
    const p = document.createElement("p");
    p.className = "safety-copy";
    p.textContent = `You changed "${c.questionText}" to "${c.answerValue}". Save this answer for future applications?`;
    const actions = document.createElement("div");
    actions.className = "answer-actions";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "q-generate";
    yes.textContent = "Save";
    const no = document.createElement("button");
    no.type = "button";
    no.className = "q-generate q-secondary";
    no.textContent = "Not now";
    const resolve = async (save) => {
      yes.disabled = true;
      no.disabled = true;
      const out = await send(
        "APLYER_RESOLVE_CORRECTION",
        { tabId: currentTabId, correctionId: c.id, save },
        15000,
      );
      row.textContent = save
        ? out?.saved
          ? "✓ Saved for next time."
          : "We couldn't save that answer."
        : "Okay, not saved.";
    };
    yes.addEventListener("click", () => resolve(true));
    no.addEventListener("click", () => resolve(false));
    actions.appendChild(yes);
    actions.appendChild(no);
    row.appendChild(p);
    row.appendChild(actions);
    wrap.appendChild(row);
  }
}

function bind() {
  $("fields-autofill")?.addEventListener("click", () => autofillAllFields());

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
  if (changes[KEY_CORRECTIONS]) loadCorrections();
  if (changes[KEY_STATUS] || changes[KEY_QUESTION] || changes[KEY_SESSION] || changes[KEY_SAFETY] || changes[KEY_FRAMEWORKS]) {
    load();
  }
});

document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

bind();
load().then(() => loadCorrections()).catch(() => {});

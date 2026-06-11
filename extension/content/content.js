// Aplyer content-script orchestrator.
(function () {
  const log = window.AplyerLog;
  log.info("boot", "Content script loaded", { url: location.href });

  const adapter = window.AplyerDetect();
  if (!adapter) return;
  log.info("adapter", `Adapter loaded: ${adapter.platformLabel}`);

  let questions = [];
  let pill = null;

  function scan() {
    const found = adapter.extractQuestions();
    if (found.length === 0) return;
    log.info("scan", `Detected ${found.length} question(s)`,
      found.map((q) => ({ id: q.questionId, type: q.questionType, text: q.questionText.slice(0, 80) })));

    const newOnes = found.filter((q) => q.fieldReference.dataset.aplyerSeen !== "1");
    window.AplyerInjector.injectButtons(adapter, newOnes, openSidePanel);
    questions = questions.concat(newOnes);

    // Notify background of latest status (for popup/sidepanel)
    chrome.runtime.sendMessage({
      type: "APLYER_ATS_STATUS",
      payload: {
        platform: adapter.platformLabel,
        platformKey: adapter.name,
        url: location.href,
        questionsCount: questions.length,
        questions: questions.map((q) => ({
          questionId: q.questionId,
          questionText: q.questionText,
          questionType: q.questionType,
        })),
      },
    }).catch(() => {});

    renderPill();
  }

  function renderPill() {
    if (pill) {
      pill.querySelector(".count").textContent = String(questions.length);
      return;
    }
    pill = document.createElement("div");
    pill.className = "aplyer-status-pill";
    pill.innerHTML = `
      <span class="dot"></span>
      <span>${adapter.platformLabel} detected</span>
      <span class="count">${questions.length}</span>
    `;
    pill.title = "Open Aplyer side panel";
    pill.addEventListener("click", () => openSidePanel(null));
    document.documentElement.appendChild(pill);
  }

  function openSidePanel(question) {
    log.info("ui", "Open side panel", { question: question?.questionId ?? "(pill)" });
    chrome.runtime.sendMessage({
      type: "APLYER_OPEN_SIDE_PANEL",
      payload: {
        platform: adapter.platformLabel,
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
    }).catch((e) => log.warn("ui", "side panel open failed", e));
  }

  // Initial pass + watch DOM (single-page apps, lazy-loaded forms).
  scan();
  const mo = new MutationObserver(() => {
    clearTimeout(window.__aplyerScanT);
    window.__aplyerScanT = setTimeout(scan, 350);
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();

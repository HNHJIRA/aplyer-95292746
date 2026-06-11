// Button injector — places branded Generate Answer buttons next to detected questions.
(function () {
  const log = window.AplyerLog;

  function injectButtons(adapter, questions, onClick) {
    let injected = 0;
    for (const q of questions) {
      try {
        if (q.fieldReference.dataset.aplyerSeen === "1") continue;
        q.fieldReference.dataset.aplyerSeen = "1";

        const anchor = adapter.anchorFor(q.fieldReference) || q.fieldReference.parentElement;
        if (!anchor) continue;

        const wrap = document.createElement("div");
        wrap.className = "aplyer-action";
        wrap.setAttribute("data-aplyer-qid", q.questionId);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "aplyer-btn";
        btn.innerHTML = `
          <span class="aplyer-btn-dot"></span>
          <span class="aplyer-btn-label">Generate Answer</span>
        `;
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick(q);
        });

        wrap.appendChild(btn);
        anchor.appendChild(wrap);
        injected++;
      } catch (e) {
        log.warn("injector", "Failed to inject for question", { q, err: String(e) });
      }
    }
    if (injected > 0) log.info("injector", `Injected ${injected} button(s)`);
    return injected;
  }

  window.AplyerInjector = { injectButtons };
})();

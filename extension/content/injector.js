// Button injector — hardened against duplicate injection from repeated
// MutationObserver passes. Uses a per-field dataset flag + an in-memory
// WeakSet so even if the dataset attribute is stripped by a re-render we
// don't double-inject for the same DOM node.
(function () {
  const log = window.AplyerLog;
  const seen = new WeakSet();

  function injectButtons(adapter, questions, onClick) {
    let injected = 0, skipped = 0;
    for (const q of questions) {
      try {
        const field = q.fieldReference;
        if (!field || !field.isConnected) { skipped++; continue; }
        if (seen.has(field) || field.dataset.aplyerSeen === "1") { skipped++; continue; }

        // Mark BEFORE DOM mutation so re-entrant observers can't race.
        seen.add(field);
        field.dataset.aplyerSeen = "1";

        const anchor = (adapter.anchorFor && adapter.anchorFor(field)) || field.parentElement;
        if (!anchor) { skipped++; continue; }

        // Defensive: if a button for this qid already exists in the DOM, bail.
        if (anchor.querySelector(`[data-aplyer-qid="${cssEscape(q.questionId)}"]`)) {
          skipped++; continue;
        }

        const wrap = document.createElement("div");
        wrap.className = "aplyer-action";
        wrap.setAttribute("data-aplyer-qid", q.questionId);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "aplyer-btn";
        btn.setAttribute("aria-label", `Aplyer · Generate answer for: ${q.questionText.slice(0, 90)}`);
        btn.innerHTML = `
          <span class="aplyer-btn-dot"></span>
          <span class="aplyer-btn-label">Generate Answer</span>
        `;
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          try { onClick(q); } catch (err) { log.warn("injector", "onClick handler threw", String(err)); }
        });

        wrap.appendChild(btn);
        anchor.appendChild(wrap);
        injected++;
      } catch (e) {
        log.warn("injector", "Failed to inject for question", { qid: q?.questionId, err: String(e) });
      }
    }
    if (injected > 0 || skipped > 0) {
      log.info("injector", `Injected ${injected} · skipped ${skipped}`);
    }
    return { injected, skipped };
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\\]]/g, "\\$&");
  }

  window.AplyerInjector = { injectButtons };
})();

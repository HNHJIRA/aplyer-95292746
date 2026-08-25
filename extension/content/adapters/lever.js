// Lever adapter — long-form additional-information questions on jobs.lever.co.
(function () {
  const Base = window.AplyerAdapters.Base;

  class LeverAdapter extends Base {
    constructor() {
      super("lever");
      this.platformLabel = "Lever";
      this.adapterVersion = "1.1.0";
    }

    matches(loc) {
      const h = loc.hostname;
      return /(^|\.)lever\.co$/.test(h) || h === "jobs.lever.co";
    }

    extractQuestions() {
      const out = [];
      let textareas;
      try { textareas = document.querySelectorAll("textarea"); }
      catch { return out; }

      textareas.forEach((ta, i) => {
        try {
          if (!ta || ta.dataset.aplyerSeen === "1") return;
          if (ta.disabled || ta.readOnly) return;
          if (!isVisible(ta)) return;
          const label = this._findLabel(ta);
          if (!label || label.length < 8) return;
          const id = ta.name || ta.id || `lever-${i}-${hash(label)}`;
          out.push({
            questionId: id,
            questionText: label,
            fieldReference: ta,
            questionType: "long_form",
          });
        } catch { /* per-field failure must not break the scan */ }
      });
      return out;
    }

    _findLabel(el) {
      try {
        if (el.id) {
          const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (lab) return clean(lab.textContent);
        }
        const al = el.getAttribute("aria-label");
        if (al) return clean(al);
        let p = el.parentElement;
        for (let i = 0; i < 6 && p; i++) {
          if (p.classList && (p.classList.contains("application-question") || p.classList.contains("application-additional"))) {
            const q = p.querySelector(".application-question-label, .question-label, label, .text");
            if (q) return clean(q.textContent);
          }
          p = p.parentElement;
        }
        const sibLab = el.closest("li, div, fieldset")?.querySelector("label");
        if (sibLab) return clean(sibLab.textContent);
      } catch { /* ignore */ }
      return null;
    }

    anchorFor(field) {
      let p = field.parentElement;
      for (let i = 0; i < 5 && p; i++) {
        if (p.classList && (p.classList.contains("application-question") || p.classList.contains("application-additional"))) return p;
        p = p.parentElement;
      }
      return field.parentElement || field;
    }

    // --- Autofill -------------------------------------------------------

    fieldKey(el) {
      return (el && (el.name || el.id)) || null;
    }

    resolveField(target) {
      if (!target) return null;
      const F = window.AplyerFill;
      const key = target.fieldKey;
      try {
        if (key) {
          const byName = document.querySelector(`textarea[name="${CSS.escape(key)}"]`);
          if (byName && F.isAnswerableElement(byName)) return byName;
          const byId = document.getElementById(key);
          if (byId && F.isAnswerableElement(byId)) return byId;
        }
      } catch { /* ignore */ }
      try {
        const found = this.extractQuestions() || [];
        const hit = found.find((q) => q.questionId === target.questionId)
          || (target.questionHash
            ? found.find((q) => normalize(q.questionText) === target.questionHash)
            : null);
        if (hit && F.isAnswerableElement(hit.fieldReference)) return hit.fieldReference;
      } catch { /* ignore */ }
      return null;
    }
  }

  function normalize(t) {
    return String(t || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ?]/g, "").trim();
  }

  function clean(t) { return (t || "").replace(/\s+/g, " ").replace(/\*$/, "").replace(/\(optional\)/i, "").trim(); }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36); }
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  }

  window.AplyerAdapters.Lever = LeverAdapter;
})();

// Lever adapter — detects long-form additional information questions on jobs.lever.co.
(function () {
  const Base = window.AplyerAdapters.Base;

  class LeverAdapter extends Base {
    constructor() {
      super("lever");
      this.platformLabel = "Lever";
    }

    matches(loc) {
      const h = loc.hostname;
      return /(^|\.)lever\.co$/.test(h) || h === "jobs.lever.co";
    }

    extractQuestions() {
      const out = [];
      // Lever long-form questions live as textareas inside .application-question / .application-additional.
      const textareas = document.querySelectorAll("textarea");
      textareas.forEach((ta, i) => {
        if (ta.dataset.aplyerSeen === "1") return;
        const label = this._findLabel(ta);
        if (!label) return;
        if (label.length < 8) return;
        const id = ta.name || ta.id || `lever-${i}-${hash(label)}`;
        out.push({
          questionId: id,
          questionText: label,
          fieldReference: ta,
          questionType: "long_form",
        });
      });
      return out;
    }

    _findLabel(el) {
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) return clean(lab.textContent);
      }
      const al = el.getAttribute("aria-label");
      if (al) return clean(al);
      // Walk up looking for .application-question, then its label/heading
      let p = el.parentElement;
      for (let i = 0; i < 6 && p; i++) {
        if (p.classList && (p.classList.contains("application-question") || p.classList.contains("application-additional"))) {
          const q = p.querySelector(".application-question-label, .question-label, label, .text");
          if (q) return clean(q.textContent);
        }
        p = p.parentElement;
      }
      // Fallback: nearest label sibling
      const sibLab = el.closest("li, div, fieldset")?.querySelector("label");
      if (sibLab) return clean(sibLab.textContent);
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
  }

  function clean(t) { return (t || "").replace(/\s+/g, " ").replace(/\*$/, "").replace(/\(optional\)/i, "").trim(); }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36); }

  window.AplyerAdapters.Lever = LeverAdapter;
})();

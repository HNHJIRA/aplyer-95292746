// Greenhouse adapter — long-form essay questions on Greenhouse boards.
(function () {
  const Base = window.AplyerAdapters.Base;

  class GreenhouseAdapter extends Base {
    constructor() {
      super("greenhouse");
      this.platformLabel = "Greenhouse";
      this.adapterVersion = "1.0.0";
    }

    matches(loc) {
      const h = loc.hostname;
      return /(^|\.)greenhouse\.io$/.test(h) ||
        h === "boards.greenhouse.io" ||
        h === "job-boards.greenhouse.io";
    }

    extractQuestions() {
      const results = [];
      let textareas;
      try { textareas = document.querySelectorAll("textarea"); }
      catch { return results; }

      textareas.forEach((ta, i) => {
        try {
          if (!ta || ta.dataset.aplyerSeen === "1") return;
          if (ta.disabled || ta.readOnly) return;
          if (!isVisible(ta)) return;
          const label = this._findLabel(ta);
          if (!label || label.length < 8) return;
          const id = ta.id || ta.name || `gh-${i}-${hash(label)}`;
          results.push({
            questionId: id,
            questionText: label,
            fieldReference: ta,
            questionType: "essay",
          });
        } catch { /* per-field failure must not break the scan */ }
      });
      return results;
    }

    _findLabel(el) {
      try {
        if (el.id) {
          const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (lab) return clean(lab.textContent);
        }
        const lb = el.getAttribute("aria-labelledby");
        if (lb) {
          const node = document.getElementById(lb);
          if (node) return clean(node.textContent);
        }
        const al = el.getAttribute("aria-label");
        if (al) return clean(al);
        let p = el.parentElement;
        for (let i = 0; i < 5 && p; i++) {
          const lab = p.querySelector("label");
          if (lab && lab.textContent && lab.textContent.trim().length > 4) return clean(lab.textContent);
          p = p.parentElement;
        }
      } catch { /* ignore */ }
      return null;
    }

    anchorFor(field) {
      let p = field.parentElement;
      for (let i = 0; i < 4 && p; i++) {
        if (p.classList && (p.classList.contains("field") || p.classList.contains("application-question") || p.tagName === "DIV")) {
          return p;
        }
        p = p.parentElement;
      }
      return field.parentElement || field;
    }
  }

  function clean(t) { return (t || "").replace(/\s+/g, " ").replace(/\*$/, "").replace(/\(required\)/i, "").trim(); }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36); }
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  }

  window.AplyerAdapters.Greenhouse = GreenhouseAdapter;
})();

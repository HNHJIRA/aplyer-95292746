// Greenhouse adapter — detects essay/long-form questions on Greenhouse job boards.
(function () {
  const Base = window.AplyerAdapters.Base;

  class GreenhouseAdapter extends Base {
    constructor() {
      super("greenhouse");
      this.platformLabel = "Greenhouse";
    }

    matches(loc) {
      const h = loc.hostname;
      return /(^|\.)greenhouse\.io$/.test(h) || h === "boards.greenhouse.io" || h === "job-boards.greenhouse.io";
    }

    extractQuestions() {
      const results = [];
      // Greenhouse renders application questions as field rows; long-form answers use <textarea>.
      // Both legacy boards.greenhouse.io and new job-boards.greenhouse.io are supported.
      const textareas = document.querySelectorAll("textarea");
      textareas.forEach((ta, i) => {
        if (ta.dataset.aplyerSeen === "1") return;
        const label = this._findLabel(ta);
        if (!label) return;
        const text = label.trim();
        if (text.length < 8) return; // ignore tiny inputs ("Notes")
        const id = ta.id || ta.name || `gh-${i}-${hash(text)}`;
        results.push({
          questionId: id,
          questionText: text,
          fieldReference: ta,
          questionType: "essay",
        });
      });
      return results;
    }

    _findLabel(el) {
      // Strategy 1: explicit <label for="id">
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) return cleanText(lab.textContent);
      }
      // Strategy 2: aria-labelledby
      const lb = el.getAttribute("aria-labelledby");
      if (lb) {
        const node = document.getElementById(lb);
        if (node) return cleanText(node.textContent);
      }
      // Strategy 3: aria-label
      const al = el.getAttribute("aria-label");
      if (al) return cleanText(al);
      // Strategy 4: walk up to .field / .application-question and find label
      let p = el.parentElement;
      for (let i = 0; i < 5 && p; i++) {
        const lab = p.querySelector("label");
        if (lab && lab.textContent && lab.textContent.trim().length > 4) return cleanText(lab.textContent);
        p = p.parentElement;
      }
      return null;
    }

    anchorFor(field) {
      // Place the button at the end of the field's container row.
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

  function cleanText(t) { return (t || "").replace(/\s+/g, " ").replace(/\*$/, "").replace(/\(required\)/i, "").trim(); }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36); }

  window.AplyerAdapters.Greenhouse = GreenhouseAdapter;
})();

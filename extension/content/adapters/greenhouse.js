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
      // job-boards.greenhouse.io renders custom questions as <textarea>,
      // <input type="text">, and <select> inside fieldsets/divs with class
      // "application-question" or similar. Capture all three.
      let nodes;
      try {
        nodes = document.querySelectorAll(
          'textarea, input[type="text"]:not([autocomplete="off"][aria-autocomplete]), input:not([type]), select'
        );
      } catch { return results; }

      nodes.forEach((el, i) => {
        try {
          if (!el || el.dataset.aplyerSeen === "1") return;
          if (el.disabled || el.readOnly) return;
          if (!isVisible(el)) return;
          // Skip the common identity fields — those are handled by autofill, not Q&A.
          const nm = (el.name || el.id || "").toLowerCase();
          if (/(^|[_-])(first[_-]?name|last[_-]?name|preferred|full[_-]?name|email|phone|tel|mobile|resume|cv|cover[_-]?letter|location|city|country|state|region|address|zip|postal|linkedin|website|portfolio|github|twitter|url)([_-]|$)/.test(nm)) return;
          const label = this._findLabel(el);
          if (!label || label.length < 6) return;
          // Also skip by label text — Greenhouse labels often have no name hint.
          const ll = label.toLowerCase();
          if (/^(first name|last name|preferred (first )?name|full name|email|phone|mobile|country|state|region|city|location|address|zip|postal code|linkedin|website|portfolio|resume|cv|cover letter|locate me)\b/.test(ll)) return;
          const id = el.id || el.name || `gh-${i}-${hash(label)}`;
          const type = el.tagName === "TEXTAREA" ? "essay"
            : el.tagName === "SELECT" ? "select"
            : "short_text";
          results.push({
            questionId: id,
            questionText: label,
            fieldReference: el,
            questionType: type,
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

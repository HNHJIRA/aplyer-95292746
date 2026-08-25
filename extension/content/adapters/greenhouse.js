// Greenhouse adapter — covers job-boards.greenhouse.io and boards.greenhouse.io
// Detects every applicant-facing question: textareas, text/email/tel/url/number
// inputs, native selects, custom comboboxes, and radio/checkbox fieldsets.
// Skips only true autofill identity fields (name/email/phone/resume/links/address).
(function () {
  const Base = window.AplyerAdapters.Base;

  const FIELD_SELECTORS = [
    "textarea",
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[type="url"]',
    'input[type="number"]',
    "input:not([type])",
    "select",
    'button[aria-haspopup="listbox"]',
    '[role="combobox"]',
    "fieldset",
  ].join(",");

  // Hard-skip patterns for autofill-only fields (name, contact, links, address).
  const IDENTITY_NAME_RE = /(^|[_-])(first[_-]?name|last[_-]?name|preferred|full[_-]?name|email|phone|tel|mobile|resume|cv|cover[_-]?letter|location|city|country|state|region|address|zip|postal|linkedin|website|portfolio|github|twitter|url|school|degree)([_-]|$)/i;
  const IDENTITY_LABEL_RE = /^(first name|last name|preferred (first )?name|full name|email|phone|mobile|country|state|region|city|location|address|zip|postal code|linkedin|website|portfolio|resume|cv|cover letter|locate me|school|degree|discipline|start date|end date)\b/i;

  class GreenhouseAdapter extends Base {
    constructor() {
      super("greenhouse");
      this.platformLabel = "Greenhouse";
      this.adapterVersion = "1.3.0";
    }

    matches(loc) {
      const h = loc.hostname;
      return /(^|\.)greenhouse\.io$/.test(h)
        || h === "boards.greenhouse.io"
        || h === "job-boards.greenhouse.io";
    }

    extractQuestions() {
      const results = [];
      const seenWrap = new Set();
      let nodes;
      try { nodes = document.querySelectorAll(FIELD_SELECTORS); }
      catch { return results; }

      nodes.forEach((el, i) => {
        try {
          if (!el || el.dataset.aplyerSeen === "1") return;
          if (!isVisible(el)) return;

          // FIELDSET: only treat as a question if it groups radios/checkboxes.
          if (el.tagName === "FIELDSET") {
            const inner = el.querySelector('input[type="radio"], input[type="checkbox"]');
            if (!inner) return;
            // de-dupe sibling inputs in same fieldset
            if (seenWrap.has(el)) return;
            seenWrap.add(el);
            const label = this._findLabel(el);
            if (!label || label.length < 4) return;
            if (this._isIdentity(el, label)) return;
            const id = el.id || el.getAttribute("name") || `gh-fs-${i}-${hash(label)}`;
            results.push({
              questionId: id,
              questionText: label,
              fieldReference: el,
              questionType: inner.type === "checkbox" ? "checkbox" : "radio",
            });
            return;
          }

          if (el.disabled || el.readOnly) return;

          // De-dupe: one button per question wrapper
          const wrap = this._wrapper(el);
          if (wrap && seenWrap.has(wrap)) return;

          const label = this._findLabel(el);
          if (!label || label.length < 4) return;
          if (this._isIdentity(el, label)) return;

          if (wrap) seenWrap.add(wrap);

          const tag = el.tagName;
          let type = "short_text";
          if (tag === "TEXTAREA") type = "essay";
          else if (tag === "SELECT") type = "select";
          else if (tag === "BUTTON" || el.getAttribute("role") === "combobox") type = "select";

          const id = el.id || el.name || `gh-${i}-${hash(label)}`;
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

    _isIdentity(el, label) {
      const nm = (el.name || el.id || "").toLowerCase();
      if (nm && IDENTITY_NAME_RE.test(nm)) return true;
      if (label && IDENTITY_LABEL_RE.test(label.toLowerCase())) return true;
      return false;
    }

    _wrapper(el) {
      let p = el.parentElement;
      for (let i = 0; i < 8 && p; i++) {
        const cls = (p.className && typeof p.className === "string") ? p.className : "";
        if (
          cls.includes("application-question") ||
          cls.includes("field") ||
          p.tagName === "FIELDSET" ||
          p.getAttribute?.("data-field") ||
          p.getAttribute?.("data-qa")
        ) return p;
        p = p.parentElement;
      }
      return el.parentElement;
    }

    _findLabel(el) {
      try {
        if (el.tagName === "FIELDSET") {
          const lg = el.querySelector(":scope > legend");
          if (lg) return clean(lg.textContent);
        }
        if (el.id) {
          const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (lab) return clean(lab.textContent);
        }
        const lb = el.getAttribute("aria-labelledby");
        if (lb) {
          const txt = lb.split(/\s+/).map((id) => {
            const n = document.getElementById(id);
            return n ? n.textContent : "";
          }).join(" ");
          const t = clean(txt);
          if (t) return t;
        }
        const al = el.getAttribute("aria-label");
        if (al) return clean(al);
        // climb to find a wrapping label or sibling label/legend
        let p = el.parentElement;
        for (let i = 0; i < 6 && p; i++) {
          const lab = p.querySelector("label, legend");
          if (lab && lab.textContent && lab.textContent.trim().length >= 4) {
            return clean(lab.textContent);
          }
          p = p.parentElement;
        }
      } catch { /* ignore */ }
      return null;
    }

    anchorFor(field) {
      return this._wrapper(field) || field.parentElement || field;
    }

    // --- Autofill -------------------------------------------------------

    fieldKey(el) {
      return (el && (el.id || el.getAttribute?.("name"))) || null;
    }

    /** Greenhouse ids are stable per render; never fall back to a global
     *  "first textarea" lookup, which could hit the wrong question. */
    resolveField(target) {
      if (!target) return null;
      const F = window.AplyerFill;
      const key = target.fieldKey;
      try {
        if (key) {
          const byId = document.getElementById(key);
          if (byId && F.isAnswerableElement(byId)) return byId;
          const byName = document.querySelector(`textarea[name="${CSS.escape(key)}"]`);
          if (byName && F.isAnswerableElement(byName)) return byName;
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

  function clean(t) {
    return (t || "")
      .replace(/\s+/g, " ")
      .replace(/\*/g, "")
      .replace(/\(required\)/ig, "")
      .replace(/\(optional\)/ig, "")
      .trim();
  }
  function normalize(t) {
    return String(t || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ?]/g, "").trim();
  }
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

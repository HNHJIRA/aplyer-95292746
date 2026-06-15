// Workday adapter — long-form / essay question detection on Workday
// hosted application portals (*.myworkdayjobs.com, *.workday.com, *.wd*.myworkdaysite.com).
//
// Workday is structurally different from Greenhouse/Lever:
//   • DOM ids are auto-generated and re-shuffled on every re-render, so we
//     anchor on data-automation-id whenever present.
//   • Labels are not <label for="..."> — they're sibling nodes inside a
//     [data-automation-id$="formField"] wrapper, or pointed at via
//     aria-labelledby.
//   • The form re-mounts subtrees on validation, step changes, and
//     "Save & Continue" — buttons must be re-injectable.
//
// This adapter overrides the capability hooks declared on ATSAdapter
// (resolveStableId / proximityLabel / mapFormStructure / onFieldDetached)
// so the orchestrator can rely on stable ids even when the DOM churns.
(function () {
  const Base = window.AplyerAdapters.Base;

  // Workday application questions render as textareas, rich-text editors,
  // text inputs, selects, and radio/checkbox groups inside
  // [data-automation-id$="formField"] wrappers.
  const FIELD_SELECTORS = [
    "textarea",
    'div[contenteditable="true"][data-automation-id]',
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[type="url"]',
    'input[type="number"]',
    "select",
    'button[aria-haspopup="listbox"]',
    'fieldset',
  ].join(",");

  // Identity / autofill fields the user does NOT want a Generate Answer button on.
  const IDENTITY_RE = /(first[\s_-]?name|last[\s_-]?name|legal name|given name|family name|middle name|preferred (first )?name|full name|email|phone|mobile|tel|country|territory|state|region|province|city|location|address|street|zip|postal|linkedin|website|portfolio|github|twitter|facebook|url|resume|cv|cover letter|date of birth|dob|gender|race|ethnicity|veteran|disability|hispanic|citizenship|work authoriz|visa|sponsor|source|how did you hear|salary|compensation|notice period|start date|available|relocate|password|confirm|search|filter)/i;


  class WorkdayAdapter extends Base {
    constructor() {
      super("workday");
      this.platformLabel = "Workday";
      this.adapterVersion = "1.0.0";
      // questionId → { stableId, lastSeenAt }. Used by onFieldDetached
      // so the orchestrator can purge buttons for fields that vanish.
      this._fieldCache = new Map();
    }

    matches(loc) {
      const h = loc.hostname || "";
      // Coverage: myworkdayjobs.com (job seeker), workday.com, myworkdaysite.com,
      // wd1-wd103.myworkdayjobs.com sharded subdomains.
      const hostHit =
        /(^|\.)myworkdayjobs\.com$/.test(h) ||
        /(^|\.)workday\.com$/.test(h) ||
        /(^|\.)myworkdaysite\.com$/.test(h);
      if (hostHit) return true;
      // DOM signature fallback — some employers proxy Workday under a
      // custom hostname while keeping the [data-automation-id] markup.
      try {
        return !!document.querySelector('[data-automation-id="pageHeader"], [data-automation-id="applyFlowWizardContainer"], [data-automation-id^="formField-"]');
      } catch { return false; }
    }

    // --- M3 capability hooks (override base no-ops) -----------------------

    resolveStableId(el) {
      if (!el) return null;
      const auto = el.getAttribute && el.getAttribute("data-automation-id");
      if (auto) return `wd:${auto}`;
      // Walk up: nearest formField wrapper carries a stable suffix.
      let p = el.parentElement;
      for (let i = 0; i < 6 && p; i++) {
        const a = p.getAttribute && p.getAttribute("data-automation-id");
        if (a && /formField/i.test(a)) return `wd:${a}`;
        p = p.parentElement;
      }
      return el.id || el.name || null;
    }

    proximityLabel(el) {
      try {
        // 1. aria-labelledby chain (Workday's preferred wiring).
        const lb = el.getAttribute("aria-labelledby");
        if (lb) {
          const text = lb.split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || "")
            .join(" ");
          const c = clean(text);
          if (c) return c;
        }
        // 2. aria-label.
        const al = el.getAttribute("aria-label");
        if (al) return clean(al);
        // 3. Climb to nearest formField wrapper, then read the explicit
        //    <label> child or the first heading-like node.
        let p = el.parentElement;
        for (let i = 0; i < 8 && p; i++) {
          const a = p.getAttribute && p.getAttribute("data-automation-id");
          if (a && /formField/i.test(a)) {
            const lab = p.querySelector("label");
            if (lab && lab.textContent) return clean(lab.textContent);
            const promptLike = p.querySelector('[data-automation-id$="promptLabel"], [data-automation-id$="label"]');
            if (promptLike && promptLike.textContent) return clean(promptLike.textContent);
            break;
          }
          p = p.parentElement;
        }
        // 4. Fieldset legend / preceding sibling heading.
        const fs = el.closest("fieldset");
        if (fs) {
          const lg = fs.querySelector("legend");
          if (lg && lg.textContent) return clean(lg.textContent);
        }
        // 5. Last resort: previous sibling label-ish text.
        let sib = el.previousElementSibling;
        for (let i = 0; i < 3 && sib; i++) {
          const t = clean(sib.textContent || "");
          if (t.length >= 6 && t.length <= 240) return t;
          sib = sib.previousElementSibling;
        }
      } catch { /* ignore */ }
      return null;
    }

    mapFormStructure() {
      const sections = [];
      try {
        // Workday wizards render each step under an automation-id wrapper.
        const groups = document.querySelectorAll('[data-automation-id$="Section"], [data-automation-id$="Panel"], [data-automation-id="formField-questionSet"]');
        if (!groups.length) {
          return [{ sectionId: "default", fields: this._fieldsIn(document) }];
        }
        groups.forEach((g, i) => {
          const sid = g.getAttribute("data-automation-id") || `wd-section-${i}`;
          sections.push({ sectionId: sid, fields: this._fieldsIn(g) });
        });
      } catch { /* ignore */ }
      return sections.length ? sections : [{ sectionId: "default", fields: [] }];
    }

    onFieldDetached(id) {
      if (!id) return;
      this._fieldCache.delete(id);
    }

    // --- Question extraction ---------------------------------------------

    extractQuestions() {
      const out = [];
      let nodes;
      try { nodes = document.querySelectorAll(FIELD_SELECTORS); }
      catch { return out; }

      const liveIds = new Set();
      const seenWrappers = new Set();
      nodes.forEach((el, i) => {
        try {
          if (!el || el.dataset.aplyerSeen === "1") return;
          if (el.disabled || el.readOnly) return;
          if (!isVisible(el)) return;

          if (el.tagName === "DIV") {
            const aid = el.getAttribute("data-automation-id") || "";
            if (!/richText|textArea|answer|response/i.test(aid)) return;
          }
          if (el.tagName === "FIELDSET") {
            const radios = el.querySelectorAll('input[type="radio"], input[type="checkbox"]');
            if (!radios.length) return;
          }

          // Collapse multiple inner controls inside the same formField wrapper.
          const wrapper = this._formFieldWrapper(el) || el;
          if (seenWrappers.has(wrapper)) return;
          seenWrappers.add(wrapper);

          const label = this.proximityLabel(el);
          if (!label || label.length < 6) return;
          if (IDENTITY_RE.test(label)) return;

          const aid = (el.getAttribute("data-automation-id") || "") + " " +
            ((wrapper.getAttribute && wrapper.getAttribute("data-automation-id")) || "");
          if (IDENTITY_RE.test(aid)) return;

          const stable = this.resolveStableId(el) || `wd-fallback-${i}-${hash(label)}`;
          const questionId = `${stable}#${hash(label)}`;
          liveIds.add(questionId);
          this._fieldCache.set(questionId, { stableId: stable, lastSeenAt: Date.now() });

          let qtype = "short_text";
          if (el.tagName === "TEXTAREA") qtype = "long_form";
          else if (el.tagName === "DIV") qtype = "rich_text";
          else if (el.tagName === "SELECT" || el.getAttribute("aria-haspopup") === "listbox") qtype = "select";
          else if (el.tagName === "FIELDSET") qtype = "choice";

          out.push({
            questionId,
            questionText: label,
            fieldReference: el,
            questionType: qtype,
          });
        } catch { /* per-field failure must not break the scan */ }
      });

      for (const id of Array.from(this._fieldCache.keys())) {
        if (!liveIds.has(id)) this.onFieldDetached(id);
      }
      return out;
    }

    anchorFor(field) {
      return this._formFieldWrapper(field) || field.parentElement || field;
    }

    // --- Internals --------------------------------------------------------

    _formFieldWrapper(el) {
      let p = el;
      for (let i = 0; i < 10 && p; i++) {
        const a = p.getAttribute && p.getAttribute("data-automation-id");
        if (a && /formField/i.test(a)) return p;
        p = p.parentElement;
      }
      return null;
    }

    _fieldsIn(root) {
      try {
        return Array.from(root.querySelectorAll(FIELD_SELECTORS))
          .filter((el) => isVisible(el))
          .map((el) => ({ stableId: this.resolveStableId(el), ref: el }));
      } catch { return []; }
    }
  }

  function clean(t) {
    return (t || "")
      .replace(/\s+/g, " ")
      .replace(/\*$/, "")
      .replace(/\(required\)/i, "")
      .replace(/\(optional\)/i, "")
      .trim();
  }
  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  }

  window.AplyerAdapters.Workday = WorkdayAdapter;
})();

// Aplyer Field Intelligence — v1.12.0
//
// Detects EVERY input on an application form (not just essay questions),
// classifies it, reports it to the background worker, applies the decisions
// the backend returns, and watches for user corrections afterwards.
//
// SAFETY RULES BAKED IN HERE:
// - Never fills a field the user already typed into.
// - Never fills password / identity / financial fields (double-checked
//   client-side even though the backend also refuses them).
// - Never clicks, submits or advances the form.
// - Never invents a value: it only writes what the backend decided.
(function () {
  const log = window.AplyerLog || { info() {}, warn() {} };

  const SENSITIVE_RE =
    /(password|passcode|\bpin\b|\bssn\b|social security|national (insurance|id)|passport|driver'?s? licen[cs]e|\btax\s?(id|number)\b|bank|iban|swift|routing|account number|sort code|credit card|card number|cvv|cvc|mother'?s maiden|date of birth|\bdob\b)/i;

  /* ----------------------------- labels ----------------------------- */

  function labelFor(el) {
    try {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l?.innerText?.trim()) return l.innerText;
      }
      const by = el.getAttribute?.("aria-labelledby");
      if (by) {
        const t = by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.innerText || "")
          .join(" ");
        if (t.trim()) return t;
      }
      const al = el.getAttribute?.("aria-label");
      if (al?.trim()) return al;
      const fs = el.closest?.("fieldset");
      const lg = fs?.querySelector("legend");
      if (lg?.innerText?.trim()) return lg.innerText;
      let p = el.parentElement;
      for (let i = 0; i < 5 && p; i++) {
        const l = p.querySelector("label, legend");
        if (l?.innerText?.trim()) return l.innerText;
        p = p.parentElement;
      }
      const ph = el.getAttribute?.("placeholder");
      if (ph?.trim()) return ph;
    } catch {
      /* ignore */
    }
    return "";
  }

  const clean = (s) => String(s || "").replace(/\s+/g, " ").replace(/\*+$/, "").trim().slice(0, 500);

  /** The shared question for a radio group (legend or nearest group label). */
  function groupLabel(el) {
    const fs = el.closest?.("fieldset");
    const lg = fs?.querySelector("legend");
    if (lg?.innerText?.trim()) return lg.innerText;
    const by = el.closest?.("[role='radiogroup'][aria-label]");
    if (by) return by.getAttribute("aria-label");
    let p = el.parentElement;
    for (let i = 0; i < 5 && p; i++) {
      const l = [...p.querySelectorAll("label, legend")].find(
        (n) => !n.contains(el) && n.innerText?.trim().length > 2 && !n.getAttribute("for"),
      );
      if (l) return l.innerText;
      p = p.parentElement;
    }
    return el.getAttribute?.("aria-label") || el.name || "";
  }

  /* --------------------------- visibility --------------------------- */

  function isVisible(el) {
    if (!el || !el.isConnected || el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  }

  /* ------------------------- classification ------------------------- */

  function isYesNoOptions(options) {
    if (options.length < 2 || options.length > 3) return false;
    const set = new Set(options.map((o) => o.toLowerCase().trim()));
    return set.has("yes") && set.has("no");
  }

  function selectOptions(el) {
    return [...el.options]
      .map((o) => clean(o.label || o.textContent || o.value))
      .filter((v) => v && !/^(select|choose|please select|--)/i.test(v));
  }

  function radioGroupOptions(name, scope) {
    return [...scope.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)].map((r) =>
      clean(labelFor(r) || r.value),
    );
  }

  // Mirror of the server's looksLikeApplicationQuestion(). Kept identical so
  // the extension and the backend agree on what deserves a written answer.
  const ESSAY_PATTERNS = [
    /\b(tell us|describe|explain|share|walk us through|why do you|why are you|what (makes|motivates|excites|interests)|how (would|do) you|give an example|cover letter|elaborate)\b/,
    /\b(experience|motivation|challenge|accomplishment|strength|weakness|project)\b.*\b(about|with|you)\b/,
  ];
  const YES_NO_Q = /^(are|is|do|does|did|have|has|had|will|would|can|could|should|were|was|may)\b/;

  function normalizeQ(text) {
    return String(text || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
  }

  function looksLikeApplicationQuestion(text) {
    const n = normalizeQ(text);
    if (!n) return false;
    const words = n.split(" ").length;
    if (YES_NO_Q.test(n) && words < 12) return false;
    if (words >= 8) return true;
    return ESSAY_PATTERNS.some((re) => re.test(n));
  }

  function classify(el, questionText) {
    const tag = el.tagName;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "TEXTAREA" || el.isContentEditable) {
      return {
        fieldType: looksLikeApplicationQuestion(questionText) ? "ESSAY" : "TEXTAREA",
        options: [],
      };
    }
    if (tag === "SELECT") {
      const options = selectOptions(el);
      return { fieldType: isYesNoOptions(options) ? "YES_NO" : "DROPDOWN", options };
    }
    if (tag !== "INPUT") return { fieldType: "UNKNOWN", options: [] };
    if (type === "file") return { fieldType: "FILE", options: [] };
    if (type === "date" || type === "month") return { fieldType: "DATE", options: [] };
    if (type === "number") return { fieldType: "NUMBER", options: [] };
    if (type === "url") return { fieldType: "URL", options: [] };
    if (type === "radio") {
      const options = el.name ? radioGroupOptions(el.name, document) : [];
      return { fieldType: isYesNoOptions(options) ? "YES_NO" : "RADIO", options };
    }
    if (type === "checkbox") return { fieldType: "CHECKBOX", options: ["Checked", "Unchecked"] };
    if (["text", "email", "tel", "search", ""].includes(type)) {
      return { fieldType: "TEXT", options: [] };
    }
    return { fieldType: "UNKNOWN", options: [] };
  }

  /* ---------------------------- registry ---------------------------- */

  // fieldId -> { el | radios, fieldType, questionText, options }
  const registry = new Map();
  let seq = 0;

  let skipped = 0;

  function scanFields() {
    registry.clear();
    skipped = 0;
    const seenRadioGroups = new Set();
    const nodes = document.querySelectorAll(
      'input, select, textarea, [contenteditable="true"]',
    );
    const fields = [];

    nodes.forEach((el) => {
      if (!isVisible(el)) return;
      const type = (el.getAttribute?.("type") || "").toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button") return;

      // One entry per radio group, not per radio.
      if (type === "radio") {
        if (!el.name || seenRadioGroups.has(el.name)) return;
        seenRadioGroups.add(el.name);
      }

      // A radio's own label is its option ("Yes"), so the question comes
      // from the group container instead.
      const questionText = clean(type === "radio" ? groupLabel(el) : labelFor(el));
      if (questionText.length < 2) return;
      if (SENSITIVE_RE.test(questionText)) {
        skipped += 1;
        return;
      }

      const { fieldType, options } = classify(el, questionText);
      if (fieldType === "FILE" || fieldType === "UNKNOWN") return;

      const fieldId = `f${++seq}`;
      registry.set(fieldId, { el, fieldType, questionText, options, radioName: type === "radio" ? el.name : null });
      fields.push({ fieldId, questionText, fieldType, options, filled: hasValue(el, fieldType) });
    });

    log.info("field-intel", `Scanned ${fields.length} field(s), skipped ${skipped} sensitive`);
    return fields;
  }

  function hasValue(el, fieldType) {
    if (fieldType === "YES_NO" || fieldType === "DROPDOWN" || fieldType === "RADIO") {
      if (el.tagName === "SELECT") return !!el.value && el.selectedIndex > 0;
      if (el.name) {
        return [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)].some(
          (r) => r.checked,
        );
      }
    }
    if (el.isContentEditable) return (el.textContent || "").trim().length > 0;
    return typeof el.value === "string" && el.value.trim().length > 0;
  }

  /* ----------------------------- writing ---------------------------- */

  function nativeSet(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : el.tagName === "SELECT"
          ? window.HTMLSelectElement.prototype
          : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function writeField(entry, value) {
    const { el, fieldType } = entry;
    try {
      if (el.tagName === "SELECT") {
        const opt = [...el.options].find(
          (o) => clean(o.label || o.textContent || o.value).toLowerCase() === String(value).toLowerCase(),
        );
        if (!opt) return { ok: false, code: "option_not_found" };
        nativeSet(el, opt.value);
        return { ok: true };
      }
      if (entry.radioName) {
        const radios = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(entry.radioName)}"]`)];
        const hit = radios.find(
          (r) => clean(labelFor(r) || r.value).toLowerCase() === String(value).toLowerCase(),
        );
        if (!hit) return { ok: false, code: "option_not_found" };
        hit.checked = true;
        hit.dispatchEvent(new Event("input", { bubbles: true }));
        hit.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      if (el.isContentEditable) {
        el.textContent = String(value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return { ok: true };
      }
      if (fieldType === "CHECKBOX") {
        el.checked = String(value).toLowerCase() === "checked";
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      nativeSet(el, String(value));
      return { ok: true };
    } catch (e) {
      log.warn("field-intel", "write failed", String(e));
      return { ok: false, code: "write_failed" };
    }
  }

  /**
   * Applies backend decisions. FILL is written only into empty fields;
   * ASK and SKIP are returned to the side panel for the user to handle.
   */
  function applyDecisions(decisions) {
    const filled = [];
    const ask = [];
    const generate = [];
    for (const d of Array.isArray(decisions) ? decisions : []) {
      const entry = registry.get(d.fieldId);
      if (!entry) continue;
      if (d.action === "GENERATE") {
        if (!hasValue(entry.el, entry.fieldType)) {
          generate.push({
            fieldId: d.fieldId,
            questionText: entry.questionText,
            fieldType: entry.fieldType,
          });
        }
        continue;
      }
      if (d.action !== "FILL" || !d.value) {
        if (d.action === "ASK") {
          ask.push({
            fieldId: d.fieldId,
            questionText: entry.questionText,
            fieldType: entry.fieldType,
            options: entry.options,
          });
        }
        continue;
      }
      if (hasValue(entry.el, entry.fieldType)) continue; // never overwrite the user
      const res = writeField(entry, d.value);
      if (res.ok) {
        watchCorrection(d.fieldId, entry, d.value);
        filled.push({ fieldId: d.fieldId, questionText: entry.questionText, value: d.value });
      }
    }
    log.info(
      "field-intel",
      `Filled ${filled.length}, generating ${generate.length}, asking about ${ask.length}`,
    );
    return { filled, ask, generate };
  }

  /* -------------------------- corrections --------------------------- */

  const watched = new Map();

  function watchCorrection(fieldId, entry, appliedValue) {
    if (watched.has(fieldId)) return;
    const targets = entry.radioName
      ? [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(entry.radioName)}"]`)]
      : [entry.el];

    const onChange = () => {
      const current = entry.radioName
        ? clean(labelFor(targets.find((r) => r.checked) || {}) || "")
        : entry.el.isContentEditable
          ? (entry.el.textContent || "").trim()
          : String(entry.el.value ?? "").trim();
      if (!current || current.toLowerCase() === String(appliedValue).toLowerCase()) return;
      chrome.runtime
        .sendMessage({
          type: "APLYER_FIELD_CORRECTED",
          field: {
            questionText: entry.questionText,
            fieldType: entry.fieldType,
            answerValue: current.slice(0, 500),
            options: entry.options,
          },
        })
        .catch(() => {});
    };

    const handler = debounce(onChange, 700);
    targets.forEach((t) => {
      t.addEventListener("change", handler);
      t.addEventListener("blur", handler);
    });
    watched.set(fieldId, () => targets.forEach((t) => {
      t.removeEventListener("change", handler);
      t.removeEventListener("blur", handler);
    }));
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  /** Writes one answer the user supplied through the side panel. */
  function answerField(fieldId, value) {
    const entry = registry.get(fieldId);
    if (!entry) return { ok: false, code: "field_not_found" };
    const res = writeField(entry, value);
    if (res.ok) watchCorrection(fieldId, entry, value);
    return res;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return false;
    if (msg.type === "APLYER_FI_SCAN") {
      sendResponse({ ok: true, fields: scanFields(), skipped });
      return true;
    }
    if (msg.type === "APLYER_FI_APPLY") {
      sendResponse({ ok: true, ...applyDecisions(msg.decisions) });
      return true;
    }
    if (msg.type === "APLYER_FI_ANSWER") {
      sendResponse(answerField(msg.fieldId, msg.value));
      return true;
    }
    return false;
  });

  window.AplyerFieldIntel = {
    scanFields,
    applyDecisions,
    answerField,
    classify,
    labelFor,
    looksLikeApplicationQuestion,
    skippedCount: () => skipped,
  };
})();

// Aplyer fill engine — the ONLY place that writes generated answers into a
// page. Adapters delegate here so every ATS uses the same framework-safe
// event sequence (native setter + input/change so React/Angular/Vue state
// actually updates).
(function () {
  const MAX_ANSWER_CHARS = 8000;

  /** Field types that may ever receive a generated prose answer. */
  const ANSWERABLE_TYPES = new Set(["essay", "long_form", "rich_text"]);

  function isAnswerableType(t) {
    return ANSWERABLE_TYPES.has(String(t || ""));
  }

  /** True only for elements that are safe targets for generated prose. */
  function isAnswerableElement(el) {
    if (!el || !el.isConnected) return false;
    if (el.disabled || el.readOnly) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (el.getAttribute && el.getAttribute("contenteditable") === "true") return true;
    return false;
  }

  function nativeSetter(el) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    return desc && desc.set ? desc.set : null;
  }

  function dispatch(el, type, init) {
    try { el.dispatchEvent(new Event(type, { bubbles: true, ...(init || {}) })); }
    catch { /* ignore */ }
  }

  function readValue(el) {
    if (!el) return "";
    if (el.getAttribute && el.getAttribute("contenteditable") === "true") {
      return String(el.innerText || el.textContent || "");
    }
    return String(el.value ?? "");
  }

  /**
   * Writes `text` into `el` through the native value setter so React's
   * value tracker is invalidated, then fires input + change.
   * @returns {{ok:boolean, code?:string, previousValue?:string, value?:string}}
   */
  function setValue(el, text) {
    if (!isAnswerableElement(el)) return { ok: false, code: "unsupported_field" };
    const previousValue = readValue(el);
    try {
      el.focus({ preventScroll: false });
    } catch { /* ignore */ }

    if (el.getAttribute && el.getAttribute("contenteditable") === "true") {
      try {
        el.textContent = text;
      } catch { return { ok: false, code: "write_failed" }; }
      try {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      } catch { dispatch(el, "input"); }
      dispatch(el, "change");
      return { ok: true, previousValue, value: readValue(el) };
    }

    const setter = nativeSetter(el);
    try {
      if (setter) setter.call(el, text);
      else el.value = text;
    } catch { return { ok: false, code: "write_failed" }; }

    dispatch(el, "input");
    dispatch(el, "change");

    if (readValue(el) !== text) {
      // Framework rejected/overwrote the write.
      return { ok: false, code: "write_rejected", previousValue };
    }
    return { ok: true, previousValue, value: text };
  }

  function hasMeaningfulText(el) {
    return readValue(el).trim().length >= 2;
  }

  function sanitizeAnswer(answer) {
    if (typeof answer !== "string") return null;
    const trimmed = answer.trim();
    if (!trimmed) return null;
    if (trimmed.length > MAX_ANSWER_CHARS) return null;
    return trimmed;
  }

  window.AplyerFill = {
    MAX_ANSWER_CHARS,
    ANSWERABLE_TYPES,
    isAnswerableType,
    isAnswerableElement,
    readValue,
    setValue,
    hasMeaningfulText,
    sanitizeAnswer,
  };
})();

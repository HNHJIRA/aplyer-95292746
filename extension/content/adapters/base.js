// ATSAdapter — abstract base class shared by all ATS adapters.
// Defines the contract every adapter must satisfy + the optional capability
// hooks that complex ATSs (Workday, iCIMS, SuccessFactors) will need in
// Milestone 3. Implemented as no-op defaults so simple ATSs (Greenhouse,
// Lever) can ignore them.
(function () {
  const ADAPTER_API_VERSION = "1.2.0";

  class ATSAdapter {
    constructor(name) {
      this.name = name;
      this.platformLabel = name;
      this.adapterVersion = "0.0.0";
      this.apiVersion = ADAPTER_API_VERSION;
    }

    // --- Required ---
    /** @returns {boolean} */
    matches(_loc) { return false; }
    /** @returns {Array<{questionId:string, questionText:string, fieldReference:HTMLElement, questionType:string}>} */
    extractQuestions() { return []; }
    /** Find the element to anchor the Generate Answer button next to. */
    anchorFor(field) { return field; }

    // --- Optional capability hooks (Workday-class adapters override these) ---

    /** Resolve a stable id for a field whose DOM id is generated/randomised
     *  on each render (Workday automation-id pattern). Default = element id/name. */
    resolveStableId(el) { return el?.id || el?.name || null; }

    /** Find the nearest label-bearing element using proximity heuristics
     *  (label above, to the left, aria-labelledby chain, fieldset legend).
     *  Used by complex ATSs where labels aren't co-located with inputs. */
    proximityLabel(_el) { return null; }

    /** Walk a multi-step / multi-section form and return logical groups.
     *  Workday uses tabs + accordion sections; Greenhouse/Lever return a
     *  single implicit group. */
    mapFormStructure() { return [{ sectionId: "default", fields: [] }]; }

    /** Hook invoked when a tracked field is removed from the DOM (SPA
     *  re-renders). Adapters can clear caches here. */
    onFieldDetached(_id) { /* no-op */ }

    // --- Autofill API (v1.2.0) -------------------------------------------

    /** Stable, serialisable reference for a field. Never a DOM node. */
    fieldKey(el) { return this.resolveStableId(el); }

    /** True when this field may receive a generated prose answer. */
    isAnswerField(el, questionType) {
      return window.AplyerFill.isAnswerableType(questionType)
        && window.AplyerFill.isAnswerableElement(el);
    }

    /**
     * Re-resolves the live DOM node for a stored target at autofill time.
     * Adapters must never guess: return null when the field cannot be
     * matched with certainty.
     * @param {{questionId:string, fieldKey?:string}} target
     * @returns {HTMLElement|null}
     */
    resolveField(target) {
      if (!target) return null;
      const key = target.fieldKey;
      if (key) {
        try {
          const byId = document.getElementById(key);
          if (byId && window.AplyerFill.isAnswerableElement(byId)) return byId;
          const byName = document.querySelector(`textarea[name="${cssEscape(key)}"]`);
          if (byName && window.AplyerFill.isAnswerableElement(byName)) return byName;
        } catch { /* ignore */ }
      }
      // Fall back to a fresh extraction and match on questionId only.
      try {
        const found = this.extractQuestions() || [];
        const hit = found.find((q) => q.questionId === target.questionId);
        if (hit && window.AplyerFill.isAnswerableElement(hit.fieldReference)) return hit.fieldReference;
      } catch { /* ignore */ }
      return null;
    }

    /**
     * Fills a resolved field. Adapters override only when the platform
     * needs extra handling; the write itself always goes through AplyerFill.
     */
    fillField(el, answer) {
      return window.AplyerFill.setValue(el, answer);
    }
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(String(s));
    return String(s).replace(/["\\\]]/g, "\\$&");
  }

  window.AplyerAdapters = window.AplyerAdapters || {};
  window.AplyerAdapters.Base = ATSAdapter;
  window.AplyerAdapters.API_VERSION = ADAPTER_API_VERSION;
})();

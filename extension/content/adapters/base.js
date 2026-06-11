// ATSAdapter — abstract base class shared by all ATS adapters.
// Defines the contract every adapter must satisfy + the optional capability
// hooks that complex ATSs (Workday, iCIMS, SuccessFactors) will need in
// Milestone 3. Implemented as no-op defaults so simple ATSs (Greenhouse,
// Lever) can ignore them.
(function () {
  const ADAPTER_API_VERSION = "1.1.0";

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
  }

  window.AplyerAdapters = window.AplyerAdapters || {};
  window.AplyerAdapters.Base = ATSAdapter;
  window.AplyerAdapters.API_VERSION = ADAPTER_API_VERSION;
})();

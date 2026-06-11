// Workday adapter — interface scaffolding only. Detection stays disabled
// until Milestone 3; the class exists so future work can extend it without
// shape changes.
(function () {
  const Base = window.AplyerAdapters.Base;
  class WorkdayAdapter extends Base {
    constructor() {
      super("workday");
      this.platformLabel = "Workday";
      this.adapterVersion = "0.0.1-stub";
    }
    matches(_loc) { return false; } // intentionally disabled until M3
    extractQuestions() { return []; }

    // --- M3 prep: capability hooks override the base no-ops ---
    resolveStableId(el) {
      // Workday tags every interactive node with data-automation-id which
      // survives re-renders even when the DOM id changes.
      return el?.getAttribute?.("data-automation-id") || el?.id || null;
    }
    proximityLabel(_el) {
      // M3: walk up to the nearest [data-automation-id$="formField"] and
      // read its <label> child / aria-labelledby chain.
      return null;
    }
    mapFormStructure() {
      // M3: enumerate Workday tabs (My Information, Experience, Questions, …)
      // and return one section per tab so the side panel can present grouped
      // progress.
      return [{ sectionId: "default", fields: [] }];
    }
  }
  window.AplyerAdapters.Workday = WorkdayAdapter;
})();

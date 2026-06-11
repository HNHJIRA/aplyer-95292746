// Workday adapter — placeholder. Full implementation lands in a future milestone.
(function () {
  const Base = window.AplyerAdapters.Base;
  class WorkdayAdapter extends Base {
    constructor() {
      super("workday");
      this.platformLabel = "Workday";
    }
    matches(_loc) { return false; } // disabled until M3+
    extractQuestions() { return []; }
  }
  window.AplyerAdapters.Workday = WorkdayAdapter;
})();

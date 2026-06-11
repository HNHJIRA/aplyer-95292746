// ATSAdapter — abstract base class. Subclasses implement detect/extract.
(function () {
  class ATSAdapter {
    constructor(name) {
      this.name = name;
      this.platformLabel = name;
    }
    /** @returns {boolean} */
    matches(_loc) { return false; }
    /** @returns {Array<{questionId:string, questionText:string, fieldReference:HTMLElement, questionType:string}>} */
    extractQuestions() { return []; }
    /** Find the element to anchor the Generate Answer button next to. */
    anchorFor(field) { return field; }
  }
  window.AplyerAdapters = window.AplyerAdapters || {};
  window.AplyerAdapters.Base = ATSAdapter;
})();

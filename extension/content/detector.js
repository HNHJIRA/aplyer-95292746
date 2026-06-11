// ATS Detection layer — selects an adapter for the current page.
(function () {
  const A = window.AplyerAdapters;
  const log = window.AplyerLog;

  function detect() {
    const candidates = [new A.Greenhouse(), new A.Lever(), new A.Workday()];
    for (const a of candidates) {
      try {
        if (a.matches(window.location)) {
          log.info("detector", `Matched ${a.platformLabel}`, { host: location.hostname });
          return a;
        }
      } catch (e) {
        log.warn("detector", `Adapter ${a.name} threw on matches()`, e);
      }
    }
    log.debug("detector", "No supported ATS on this page", { host: location.hostname });
    return null;
  }

  window.AplyerDetect = detect;
})();

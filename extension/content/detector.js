// ATS Detection layer — selects an adapter for the current page.
//
// Dedicated ATS adapters (Greenhouse, Lever, Workday) are always checked first
// and match on hostname exactly as before. The generic employer-careers adapter
// is only consulted when no ATS matched, and only when it is loaded (it is
// injected by the separate generic content-script entry, never on ATS hosts).
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
    if (A.Generic) {
      try {
        const g = new A.Generic();
        if (g.matches(window.location)) {
          log.info("detector", "Matched employer careers page", { host: location.hostname });
          return g;
        }
      } catch (e) {
        log.warn("detector", "Generic adapter threw on matches()", e);
      }
    }
    log.debug("detector", "No supported ATS on this page", { host: location.hostname });
    return null;
  }

  // Employer forms often render after document_idle. Re-check a few times over
  // ~8s, then stop for good: no long-lived observers on unrelated pages.
  const RETRY_DELAYS_MS = [0, 1000, 2500, 5000, 8000];

  async function detectAsync() {
    const first = detect();
    if (first) return first;
    if (!A.Generic || !window.AplyerGeneric?.hostEligible(window.location)) return null;
    for (let i = 1; i < RETRY_DELAYS_MS.length; i++) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i] - RETRY_DELAYS_MS[i - 1]));
      const a = detect();
      if (a) return a;
    }
    return null;
  }

  window.AplyerDetect = detect;
  window.AplyerDetectAsync = detectAsync;
})();

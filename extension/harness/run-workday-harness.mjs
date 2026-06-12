// Workday fixture-based validation harness.
//
// NOTE: This is *fixture-based* validation, not live-tenant validation. Each
// fixture is a hand-authored Workday-shaped DOM snippet that exercises one of
// the documented Workday quirks (rich-text contenteditable, aria-labelledby
// label resolution, formField wrapper proximity, validation re-render, Save &
// Continue subtree remount, multi-step wizard, hidden-label fallback).
//
// Run:  node extension/harness/run-workday-harness.mjs
// Output: pretty-printed pass/fail table + extension/harness/reports/workday.json
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, "..");

const ADAPTER_FILES = [
  "content/logger.js",
  "content/adapters/base.js",
  "content/adapters/workday.js",
  "content/injector.js",
];

function bootDom(html) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>${html}</body></html>`,
    { url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/app", pretendToBeVisual: true, runScripts: "outside-only" },
  );
  const { window } = dom;
  // jsdom doesn't lay out boxes — fake getBoundingClientRect so isVisible() passes.
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { width: 200, height: 60, top: 0, left: 0, right: 200, bottom: 60, x: 0, y: 0, toJSON() {} };
  };
  // Shim chrome runtime so adapter/injector code doesn't crash.
  window.chrome = { runtime: { sendMessage: () => Promise.resolve(), id: "harness" } };

  const ctx = dom.getInternalVMContext();
  for (const rel of ADAPTER_FILES) {
    const src = fs.readFileSync(path.join(EXT_ROOT, rel), "utf8");
    vm.runInContext(src, ctx, { filename: rel });
  }
  return { dom, window };
}

function makeAdapter(window) {
  const A = window.AplyerAdapters.Workday;
  const ad = new A();
  // Force matches=true regardless of fixture URL.
  ad.matches = () => true;
  return ad;
}

// --- Fixtures ---------------------------------------------------------------

const FIXTURES = [
  {
    id: "WD-01",
    name: "Standard textarea with formField wrapper label",
    expect: { questions: 1, stableId: /^wd:/ },
    html: `
      <div data-automation-id="formField-additionalInformation">
        <label>Why do you want to work at Acme?</label>
        <textarea data-automation-id="additionalInformation"></textarea>
      </div>`,
  },
  {
    id: "WD-02",
    name: "Rich-text contenteditable answer",
    expect: { questions: 1, type: "rich_text" },
    html: `
      <div data-automation-id="formField-coverLetter">
        <label>Cover letter</label>
        <div data-automation-id="richTextAnswer" contenteditable="true" role="textbox"></div>
      </div>`,
  },
  {
    id: "WD-03",
    name: "aria-labelledby chain (no inline label)",
    expect: { questions: 1, textIncludes: "career goals" },
    html: `
      <div data-automation-id="formField-q1">
        <span id="wd-q1-prompt">Describe your career goals for the next five years</span>
        <textarea aria-labelledby="wd-q1-prompt" data-automation-id="q1Answer"></textarea>
      </div>`,
  },
  {
    id: "WD-04",
    name: "Validation re-render keeps stable id (no duplicate injection)",
    expect: { questions: 1, injectionsAfterRerender: 1, sameStableIdAcrossRender: true },
    html: `
      <div id="host">
        <div data-automation-id="formField-strengths">
          <label>What are your strengths?</label>
          <textarea data-automation-id="strengths"></textarea>
        </div>
      </div>`,
    mutate(window) {
      // Workday re-renders the inner textarea after a validation failure;
      // the wrapper's data-automation-id is stable.
      const host = window.document.getElementById("host");
      host.innerHTML = `
        <div data-automation-id="formField-strengths" class="invalid">
          <label>What are your strengths?</label>
          <span class="wd-error">Required</span>
          <textarea data-automation-id="strengths"></textarea>
        </div>`;
    },
  },
  {
    id: "WD-05",
    name: "Save & Continue subtree remount preserves stable id",
    expect: { questions: 1, sameStableIdAcrossRender: true },
    html: `
      <section data-automation-id="myExperiencePanel">
        <div data-automation-id="formField-essay">
          <label>Tell us about a challenging project</label>
          <textarea data-automation-id="essay"></textarea>
        </div>
      </section>`,
    mutate(window) {
      const sec = window.document.querySelector('[data-automation-id="myExperiencePanel"]');
      sec.parentNode.removeChild(sec);
      const fresh = window.document.createElement("section");
      fresh.setAttribute("data-automation-id", "myExperiencePanel");
      fresh.innerHTML = `
        <div data-automation-id="formField-essay">
          <label>Tell us about a challenging project</label>
          <textarea data-automation-id="essay"></textarea>
        </div>`;
      window.document.body.appendChild(fresh);
    },
  },
  {
    id: "WD-06",
    name: "Multi-step wizard — two sections, two questions",
    expect: { questions: 2, sections: ">= 2" },
    html: `
      <div data-automation-id="applyFlowWizardContainer">
        <section data-automation-id="step1Section">
          <div data-automation-id="formField-q1">
            <label>Why this role?</label>
            <textarea data-automation-id="q1"></textarea>
          </div>
        </section>
        <section data-automation-id="step2Section">
          <div data-automation-id="formField-q2">
            <label>Describe a time you led a team</label>
            <textarea data-automation-id="q2"></textarea>
          </div>
        </section>
      </div>`,
  },
  {
    id: "WD-07",
    name: "Hidden inline label, fallback to aria-label",
    expect: { questions: 1, textIncludes: "relocation" },
    html: `
      <div data-automation-id="formField-relocation">
        <textarea data-automation-id="relocationAnswer"
                  aria-label="Are you willing to consider relocation for this role?"></textarea>
      </div>`,
  },
  {
    id: "WD-08",
    name: "Disabled textarea is ignored",
    expect: { questions: 0 },
    html: `
      <div data-automation-id="formField-readonly">
        <label>System-populated field</label>
        <textarea data-automation-id="ro" disabled></textarea>
      </div>`,
  },
  {
    id: "WD-09",
    name: "Repeated extractQuestions calls do not double-emit",
    expect: { questions: 1, doubleScanStable: true },
    html: `
      <div data-automation-id="formField-q">
        <label>Anything else we should know?</label>
        <textarea data-automation-id="qAnswer"></textarea>
      </div>`,
  },
];

// --- Runner ----------------------------------------------------------------

function runFixture(fx) {
  const { window } = bootDom(fx.html);
  const adapter = makeAdapter(window);

  const r = { id: fx.id, name: fx.name, pass: true, notes: [], details: {} };
  function fail(msg) { r.pass = false; r.notes.push("FAIL: " + msg); }

  let q1 = adapter.extractQuestions();
  r.details.firstScanCount = q1.length;

  if (fx.expect.questions != null && q1.length !== fx.expect.questions) {
    fail(`expected ${fx.expect.questions} questions, got ${q1.length}`);
  }
  if (fx.expect.type && q1[0] && q1[0].questionType !== fx.expect.type) {
    fail(`expected type=${fx.expect.type}, got ${q1[0].questionType}`);
  }
  if (fx.expect.stableId && q1[0]) {
    const sid = adapter.resolveStableId(q1[0].fieldReference);
    r.details.stableId = sid;
    if (!fx.expect.stableId.test(sid || "")) fail(`stableId ${sid} did not match ${fx.expect.stableId}`);
  }
  if (fx.expect.textIncludes && q1[0]) {
    if (!q1[0].questionText.toLowerCase().includes(fx.expect.textIncludes.toLowerCase())) {
      fail(`label "${q1[0].questionText}" missing "${fx.expect.textIncludes}"`);
    }
  }

  // Inject buttons, then verify re-injection is suppressed.
  if (q1.length) {
    const inj = window.AplyerInjector.injectButtons(adapter, q1, () => {});
    r.details.firstInjected = inj.injected;

    // 2nd scan — must NOT re-emit the same questions.
    const q2 = adapter.extractQuestions();
    r.details.secondScanCount = q2.length;
    if (fx.expect.doubleScanStable && q2.length !== 0) {
      fail(`second scan should be 0 (already seen), got ${q2.length}`);
    }
  }

  // Multi-step sections check.
  if (fx.expect.sections) {
    const secs = adapter.mapFormStructure();
    r.details.sections = secs.length;
    const want = parseInt(String(fx.expect.sections).replace(/[^0-9]/g, ""), 10);
    if (!(secs.length >= want)) fail(`expected >= ${want} sections, got ${secs.length}`);
  }

  // DOM mutation scenarios (validation re-render, Save & Continue remount).
  if (fx.mutate) {
    const beforeSid = q1[0] ? adapter.resolveStableId(q1[0].fieldReference) : null;
    fx.mutate(window);
    const q3 = adapter.extractQuestions();
    r.details.postMutateCount = q3.length;
    const afterField = q3[0]?.fieldReference;
    const afterSid = afterField ? adapter.resolveStableId(afterField) : null;
    r.details.beforeSid = beforeSid;
    r.details.afterSid = afterSid;
    if (fx.expect.sameStableIdAcrossRender && beforeSid !== afterSid) {
      fail(`stable id changed across render: ${beforeSid} -> ${afterSid}`);
    }
    // Re-injection must succeed (new DOM node) but anchor wrapper is the same wrapper.
    if (afterField) {
      const inj2 = window.AplyerInjector.injectButtons(adapter, q3, () => {});
      r.details.reinjected = inj2.injected;
      const buttons = window.document.querySelectorAll(".aplyer-btn");
      r.details.totalButtonsAfterMutation = buttons.length;
      if (fx.expect.injectionsAfterRerender != null && inj2.injected !== fx.expect.injectionsAfterRerender) {
        fail(`expected ${fx.expect.injectionsAfterRerender} reinjections, got ${inj2.injected}`);
      }
    }
  }

  return r;
}

const results = FIXTURES.map(runFixture);
const passed = results.filter((r) => r.pass).length;

const report = {
  kind: "fixture-based-validation",
  adapter: "workday",
  generatedAt: new Date().toISOString(),
  total: results.length,
  passed,
  failed: results.length - passed,
  results,
};

const outDir = path.join(EXT_ROOT, "harness", "reports");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "workday.json"), JSON.stringify(report, null, 2));

// Console output
console.log("\nWorkday adapter — fixture-based validation");
console.log("==========================================");
for (const r of results) {
  const tag = r.pass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${r.id}  ${r.name}`);
  for (const n of r.notes) console.log("       " + n);
}
console.log(`\n${passed}/${results.length} fixtures passed`);
console.log(`Report: extension/harness/reports/workday.json`);
process.exit(passed === results.length ? 0 : 1);

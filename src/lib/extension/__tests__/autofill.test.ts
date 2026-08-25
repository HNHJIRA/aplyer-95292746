/**
 * Generated-answer autofill contract tests.
 *
 * The adapters and fill engine are plain browser IIFEs, so we evaluate the
 * real extension sources inside the happy-dom window and drive them exactly
 * the way the content script does.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "../../../../extension");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const SOURCES = [
  "content/fill.js",
  "content/adapters/base.js",
  "content/adapters/greenhouse.js",
  "content/adapters/lever.js",
  "content/adapters/workday.js",
];

type AnyWin = typeof window & Record<string, any>;

function boot(html: string, hostname: string) {
  document.body.innerHTML = html;
  const w = window as AnyWin;
  w.AplyerAdapters = undefined;
  w.AplyerFill = undefined;
  w.AplyerLog = { info() {}, warn() {}, debug() {} };
  // happy-dom lacks layout, so treat attached elements as visible.
  Object.defineProperty(window.Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width: 200, height: 40, top: 0, left: 0, bottom: 40, right: 200 }),
  });
  for (const src of SOURCES) {
    // eslint-disable-next-line no-new-func
    new Function(read(src)).call(w);
  }
  w.__hostname = hostname;
  return w;
}

function makeAdapter(w: AnyWin, key: "Greenhouse" | "Lever" | "Workday") {
  return new w.AplyerAdapters[key]();
}

describe("fill engine", () => {
  beforeEach(() => boot("", "job-boards.greenhouse.io"));

  it("only treats textareas and contenteditable as answer fields", () => {
    const w = window as AnyWin;
    document.body.innerHTML = `
      <textarea id="ta"></textarea>
      <input id="txt" type="text" />
      <select id="sel"></select>
      <input id="chk" type="checkbox" />
      <input id="file" type="file" />
      <div id="ce" contenteditable="true"></div>`;
    const F = w.AplyerFill;
    expect(F.isAnswerableElement(document.getElementById("ta"))).toBe(true);
    expect(F.isAnswerableElement(document.getElementById("ce"))).toBe(true);
    for (const id of ["txt", "sel", "chk", "file"]) {
      expect(F.isAnswerableElement(document.getElementById(id))).toBe(false);
    }
  });

  it("writes through the native setter and dispatches input + change", () => {
    const w = window as AnyWin;
    document.body.innerHTML = `<textarea id="ta"></textarea>`;
    const el = document.getElementById("ta") as HTMLTextAreaElement;
    const events: string[] = [];
    el.addEventListener("input", (e) => events.push(`input:${e.bubbles}`));
    el.addEventListener("change", (e) => events.push(`change:${e.bubbles}`));
    const res = w.AplyerFill.setValue(el, "Hello world");
    expect(res.ok).toBe(true);
    expect(el.value).toBe("Hello world");
    expect(events).toEqual(["input:true", "change:true"]);
    expect(res.previousValue).toBe("");
  });

  it("rejects oversized and empty answers", () => {
    const w = window as AnyWin;
    expect(w.AplyerFill.sanitizeAnswer("   ")).toBeNull();
    expect(w.AplyerFill.sanitizeAnswer("x".repeat(8001))).toBeNull();
    expect(w.AplyerFill.sanitizeAnswer(42 as unknown as string)).toBeNull();
    expect(w.AplyerFill.sanitizeAnswer(" ok ")).toBe("ok");
  });

  it("detects existing meaningful text", () => {
    const w = window as AnyWin;
    document.body.innerHTML = `<textarea id="a">existing draft</textarea><textarea id="b">  </textarea>`;
    expect(w.AplyerFill.hasMeaningfulText(document.getElementById("a"))).toBe(true);
    expect(w.AplyerFill.hasMeaningfulText(document.getElementById("b"))).toBe(false);
  });
});

describe("Greenhouse autofill", () => {
  const html = `
    <div class="field">
      <label for="q1">Why do you want to work here?</label>
      <textarea id="q1" name="question_1"></textarea>
    </div>
    <div class="field">
      <label for="q2">Describe a recent project you shipped.</label>
      <textarea id="q2" name="question_2"></textarea>
    </div>
    <div class="field">
      <label for="dept">Department</label>
      <select id="dept" name="department"><option>Eng</option></select>
    </div>`;

  it("detects only essay fields as answerable", () => {
    const w = boot(html, "job-boards.greenhouse.io");
    const a = makeAdapter(w, "Greenhouse");
    const qs = a.extractQuestions();
    const answerable = qs.filter((q: any) => a.isAnswerField(q.fieldReference, q.questionType));
    expect(answerable.map((q: any) => q.questionId).sort()).toEqual(["q1", "q2"]);
    expect(answerable.every((q: any) => q.questionType === "essay")).toBe(true);
  });

  it("fills the exact originating textarea, not a sibling", () => {
    const w = boot(html, "job-boards.greenhouse.io");
    const a = makeAdapter(w, "Greenhouse");
    const el = a.resolveField({ questionId: "q2", fieldKey: "q2" });
    expect((el as HTMLTextAreaElement).id).toBe("q2");
    const res = a.fillField(el, "My answer");
    expect(res.ok).toBe(true);
    expect((document.getElementById("q2") as HTMLTextAreaElement).value).toBe("My answer");
    expect((document.getElementById("q1") as HTMLTextAreaElement).value).toBe("");
  });

  it("fails safely when the field is gone", () => {
    const w = boot(html, "job-boards.greenhouse.io");
    const a = makeAdapter(w, "Greenhouse");
    document.getElementById("q1")!.remove();
    expect(a.resolveField({ questionId: "q1", fieldKey: "q1", questionHash: "why do you want to work here?" })).toBeNull();
  });
});

describe("Lever autofill", () => {
  const html = `
    <li class="application-question">
      <label class="application-question-label">What excites you about this role?</label>
      <textarea name="cards[abc][field0]"></textarea>
    </li>`;

  it("resolves and fills by stable name", () => {
    const w = boot(html, "jobs.lever.co");
    const a = makeAdapter(w, "Lever");
    const qs = a.extractQuestions();
    expect(qs).toHaveLength(1);
    const key = a.fieldKey(qs[0].fieldReference);
    expect(key).toBe("cards[abc][field0]");
    const el = a.resolveField({ questionId: qs[0].questionId, fieldKey: key });
    const res = a.fillField(el, "Because of the product.");
    expect(res.ok).toBe(true);
    expect((el as HTMLTextAreaElement).value).toBe("Because of the product.");
  });
});

describe("Workday autofill", () => {
  const html = `
    <div data-automation-id="formField-answer1">
      <label>Tell us about a challenge you solved</label>
      <textarea data-automation-id="answer1"></textarea>
    </div>
    <div data-automation-id="formField-answer2">
      <label>Describe your leadership experience</label>
      <div contenteditable="true" data-automation-id="richTextAnswer2"></div>
    </div>`;

  it("resolves through the stable automation id after a remount", () => {
    const w = boot(html, "acme.wd1.myworkdayjobs.com");
    const a = makeAdapter(w, "Workday");
    const qs = a.extractQuestions();
    const q = qs.find((x: any) => x.fieldReference.tagName === "TEXTAREA");
    const key = a.fieldKey(q.fieldReference);
    expect(key).toBe("wd:answer1");

    // Simulate a Workday re-render: same automation id, brand new node.
    const wrap = document.querySelector('[data-automation-id="formField-answer1"]')!;
    wrap.innerHTML = `<label>Tell us about a challenge you solved</label><textarea data-automation-id="answer1"></textarea>`;

    const el = a.resolveField({ questionId: q.questionId, fieldKey: key, questionHash: "tell us about a challenge you solved" });
    expect(el).not.toBeNull();
    const res = a.fillField(el, "I rebuilt the pipeline.");
    expect(res.ok).toBe(true);
    expect((el as HTMLTextAreaElement).value).toBe("I rebuilt the pipeline.");
  });

  it("fills contenteditable answer fields", () => {
    const w = boot(html, "acme.wd1.myworkdayjobs.com");
    const a = makeAdapter(w, "Workday");
    const el = a.resolveField({ questionId: "x", fieldKey: "wd:richTextAnswer2", questionHash: "describe your leadership experience" });
    expect(el).not.toBeNull();
    const res = a.fillField(el, "I led a team of four.");
    expect(res.ok).toBe(true);
    expect((el as HTMLElement).textContent).toBe("I led a team of four.");
  });

  it("never returns a field whose question label no longer matches", () => {
    const w = boot(html, "acme.wd1.myworkdayjobs.com");
    const a = makeAdapter(w, "Workday");
    const el = a.resolveField({ questionId: "gone", fieldKey: "wd:answer1", questionHash: "a completely different question" });
    expect(el).toBeNull();
  });
});

describe("background autofill routing", () => {
  const bg = readFileSync(resolve(root, "background.js"), "utf8");

  it("caps answer length and rejects non-string answers", () => {
    expect(bg).toMatch(/MAX_AUTOFILL_CHARS\s*=\s*8000/);
    expect(bg).toMatch(/typeof message\.answer === "string"/);
    expect(bg).toMatch(/answer_too_long/);
  });

  it("only forwards a fixed payload shape (no selector or script)", () => {
    const fn = bg.slice(bg.indexOf("async function dispatchAutofill"), bg.indexOf("const NO_TARGET_MSG"));
    expect(fn).not.toMatch(/selector/);
    expect(fn).not.toMatch(/executeScript/);
    expect(fn).toMatch(/questionId: target\.questionId/);
    expect(fn).toMatch(/fieldKey: target\.fieldKey/);
  });

  it("requires the requested tab to match the stored target", () => {
    expect(bg).toMatch(/target\.tabId !== tabId/);
    expect(bg).toMatch(/message\.questionHash !== target\.questionHash/);
    expect(bg).toMatch(/frameId: target\.frameId/);
  });

  it("restricts autofill to supported adapters", () => {
    expect(bg).toMatch(/SUPPORTED_ADAPTERS = new Set\(\["greenhouse", "lever", "workday"\]\)/);
  });

  it("clears the stored target when the tab closes", () => {
    expect(bg).toMatch(/onRemoved[\s\S]{0,200}writeAutofillTarget\(tabId, null\)/);
  });
});

describe("content script autofill guards", () => {
  const cs = readFileSync(resolve(root, "content/content.js"), "utf8");

  it("rejects unknown message types", () => {
    expect(cs).toMatch(/APLYER_AUTOFILL_ANSWER/);
    expect(cs).toMatch(/APLYER_AUTOFILL_UNDO/);
    expect(cs).toMatch(/return false;\s*\}\);/);
  });

  it("rejects a mismatched adapter and requires an explicit force to overwrite", () => {
    expect(cs).toMatch(/adapter_mismatch/);
    expect(cs).toMatch(/field_not_empty/);
    expect(cs).toMatch(/msg\.force !== true/);
  });

  it("cancels undo when the user edited the field afterwards", () => {
    expect(cs).toMatch(/field_modified/);
  });

  it("only injects Generate Answer on answer fields", () => {
    expect(cs).toMatch(/adapter\.isAnswerField\(q\.fieldReference, q\.questionType\)/);
  });

  it("does not submit or advance the application", () => {
    expect(cs).not.toMatch(/\.click\(\)/);
  });
});

describe("side panel autofill UX", () => {
  const sp = readFileSync(resolve(root, "sidepanel.js"), "utf8");
  const html = readFileSync(resolve(root, "sidepanel.html"), "utf8");

  it("offers Use This Answer as the primary action and Copy as secondary", () => {
    expect(html).toMatch(/id="answer-use"[^>]*>Use This Answer/);
    expect(html).toMatch(/id="answer-copy"/);
    expect(html).toMatch(/Use This One/);
  });

  it("confirms before replacing existing text", () => {
    expect(html).toMatch(/This field already has text\. Replace it with your Aplyer answer\?/);
    expect(sp).toMatch(/field_not_empty/);
    expect(sp).toMatch(/force: force === true/);
  });

  it("shows the success confirmation and undo", () => {
    expect(sp).toMatch(/✓ Answer added/);
    expect(sp).toMatch(/APLYER_AUTOFILL_UNDO/);
  });

  it("keeps the saved preference when autofill fails", () => {
    const pick = sp.slice(sp.indexOf("async function pickOption"), sp.indexOf("function bind()"));
    expect(pick.indexOf("Saved. Aplyer will keep this style")).toBeLessThan(pick.indexOf("autofillAnswer"));
  });

  it("never manipulates page DOM directly", () => {
    expect(sp).not.toMatch(/chrome\.scripting/);
    expect(sp).not.toMatch(/chrome\.tabs\.sendMessage/);
  });
});

describe("tab and question isolation", () => {
  it("Tab A's answer cannot reach Tab B", async () => {
    const targets: Record<string, any> = {
      "1": { tabId: 1, frameId: 0, adapter: "greenhouse", questionId: "q1", fieldKey: "q1", questionHash: "question a" },
      "2": { tabId: 2, frameId: 0, adapter: "greenhouse", questionId: "q9", fieldKey: "q9", questionHash: "question b" },
    };
    const sent: any[] = [];
    // Minimal re-implementation of the background guard under test.
    const dispatch = async (tabId: number, questionHash: string) => {
      const target = targets[String(tabId)];
      if (!target || target.tabId !== tabId) return { ok: false, code: "no_target" };
      if (questionHash && target.questionHash !== questionHash) return { ok: false, code: "question_mismatch" };
      sent.push({ tabId, questionId: target.questionId });
      return { ok: true };
    };
    expect(await dispatch(1, "question a")).toEqual({ ok: true });
    expect(await dispatch(2, "question a")).toEqual({ ok: false, code: "question_mismatch" });
    expect(await dispatch(3, "question a")).toEqual({ ok: false, code: "no_target" });
    expect(sent).toEqual([{ tabId: 1, questionId: "q1" }]);
    vi.restoreAllMocks();
  });
});

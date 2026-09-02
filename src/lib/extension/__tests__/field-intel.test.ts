/**
 * Field Intelligence content-script contract tests.
 * The detector is a plain browser IIFE, so we evaluate the real source
 * inside the happy-dom window exactly as the content script does.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "../../../../extension");
const src = readFileSync(resolve(root, "content/field-intel.js"), "utf8");

type AnyWin = typeof window & Record<string, any>;

const sent: any[] = [];

function boot(html: string) {
  document.body.innerHTML = html;
  const w = window as AnyWin;
  w.AplyerFieldIntel = undefined;
  w.AplyerLog = { info() {}, warn() {} };
  sent.length = 0;
  w.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: (m: any) => {
        sent.push(m);
        return Promise.resolve();
      },
    },
  };
  Object.defineProperty(window.Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width: 200, height: 40, top: 0, left: 0, bottom: 40, right: 200 }),
  });
  // eslint-disable-next-line no-new-func
  new Function(src).call(w);
  return w;
}

const FORM = `
  <label for="fn">First name</label><input id="fn" type="text" />
  <label for="ln">Last name</label><input id="ln" type="text" />
  <label for="em">Email</label><input id="em" type="email" />
  <label for="ph">Phone number</label><input id="ph" type="tel" />
  <label for="gender">Gender</label>
  <select id="gender"><option>Select</option><option>Male</option><option>Female</option><option>Prefer not to say</option></select>
  <label for="spon">Do you require visa sponsorship?</label>
  <select id="spon"><option>Select</option><option>Yes</option><option>No</option></select>
  <label for="ssn">Social Security Number</label><input id="ssn" type="text" />
  <label for="pw">Password</label><input id="pw" type="password" />
  <label for="cv">Resume</label><input id="cv" type="file" />
  <label for="why">Why do you want this role?</label><textarea id="why"></textarea>`;

describe("field detection", () => {
  beforeEach(() => boot(FORM));

  it("detects the basic identity fields job forms ask for", () => {
    const fields = (window as AnyWin).AplyerFieldIntel.scanFields();
    const byQ = Object.fromEntries(fields.map((f: any) => [f.questionText, f.fieldType]));
    expect(byQ["First name"]).toBe("TEXT");
    expect(byQ["Last name"]).toBe("TEXT");
    expect(byQ["Email"]).toBe("TEXT");
    expect(byQ["Phone number"]).toBe("TEXT");
    expect(byQ["Gender"]).toBe("DROPDOWN");
    expect(byQ["Why do you want this role?"]).toBe("TEXTAREA");
  });

  it("classifies a Yes/No dropdown as YES_NO with its options", () => {
    const fields = (window as AnyWin).AplyerFieldIntel.scanFields();
    const spon = fields.find((f: any) => f.questionText.startsWith("Do you require"));
    expect(spon.fieldType).toBe("YES_NO");
    expect(spon.options).toEqual(["Yes", "No"]);
  });

  it("never reports sensitive or file fields", () => {
    const qs = (window as AnyWin).AplyerFieldIntel.scanFields().map((f: any) => f.questionText);
    expect(qs).not.toContain("Social Security Number");
    expect(qs).not.toContain("Password");
    expect(qs).not.toContain("Resume");
  });

  it("groups radios into a single question", () => {
    const w = boot(`
      <fieldset><legend>Are you legally authorized to work?</legend>
        <label for="r1">Yes</label><input id="r1" type="radio" name="auth" value="yes" />
        <label for="r2">No</label><input id="r2" type="radio" name="auth" value="no" />
      </fieldset>`);
    const fields = w.AplyerFieldIntel.scanFields();
    const auth = fields.filter((f: any) => /legally authorized/i.test(f.questionText));
    expect(auth).toHaveLength(1);
    expect(auth[0].fieldType).toBe("YES_NO");
  });
});

describe("applying decisions", () => {
  it("fills only FILL decisions and returns ASK fields to the panel", () => {
    const w = boot(FORM);
    const fields = w.AplyerFieldIntel.scanFields();
    const id = (q: string) => fields.find((f: any) => f.questionText === q).fieldId;
    const res = w.AplyerFieldIntel.applyDecisions([
      { fieldId: id("First name"), action: "FILL", value: "Ada" },
      { fieldId: id("Gender"), action: "ASK", value: null },
      { fieldId: id("Email"), action: "SKIP", value: null },
    ]);
    expect((document.getElementById("fn") as HTMLInputElement).value).toBe("Ada");
    expect((document.getElementById("em") as HTMLInputElement).value).toBe("");
    expect(res.filled.map((f: any) => f.value)).toEqual(["Ada"]);
    expect(res.ask.map((f: any) => f.questionText)).toEqual(["Gender"]);
  });

  it("never overwrites something the user already typed", () => {
    const w = boot(FORM);
    (document.getElementById("fn") as HTMLInputElement).value = "Mine";
    const fields = w.AplyerFieldIntel.scanFields();
    const fid = fields.find((f: any) => f.questionText === "First name").fieldId;
    const res = w.AplyerFieldIntel.applyDecisions([{ fieldId: fid, action: "FILL", value: "Ada" }]);
    expect((document.getElementById("fn") as HTMLInputElement).value).toBe("Mine");
    expect(res.filled).toHaveLength(0);
  });

  it("refuses a dropdown value the live form does not offer", () => {
    const w = boot(FORM);
    const fields = w.AplyerFieldIntel.scanFields();
    const gid = fields.find((f: any) => f.questionText === "Gender").fieldId;
    const res = w.AplyerFieldIntel.applyDecisions([{ fieldId: gid, action: "FILL", value: "Martian" }]);
    expect(res.filled).toHaveLength(0);
    expect((document.getElementById("gender") as HTMLSelectElement).selectedIndex).toBe(0);
  });

  it("selects the matching dropdown option", () => {
    const w = boot(FORM);
    const fields = w.AplyerFieldIntel.scanFields();
    const gid = fields.find((f: any) => f.questionText === "Gender").fieldId;
    w.AplyerFieldIntel.applyDecisions([{ fieldId: gid, action: "FILL", value: "Female" }]);
    expect((document.getElementById("gender") as HTMLSelectElement).value).toBe("Female");
  });
});

describe("correction learning", () => {
  it("reports a corrected value back to the worker", async () => {
    const w = boot(FORM);
    const fields = w.AplyerFieldIntel.scanFields();
    const fid = fields.find((f: any) => f.questionText === "First name").fieldId;
    w.AplyerFieldIntel.applyDecisions([{ fieldId: fid, action: "FILL", value: "Ada" }]);
    const el = document.getElementById("fn") as HTMLInputElement;
    el.value = "Adaeze";
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 900));
    const msg = sent.find((m) => m.type === "APLYER_FIELD_CORRECTED");
    expect(msg?.field.answerValue).toBe("Adaeze");
    expect(msg?.field.questionText).toBe("First name");
  });
});

describe("background wiring", () => {
  const bg = readFileSync(resolve(root, "background.js"), "utf8");

  it("routes Autofill All through the authenticated fetch only", () => {
    const fn = bg.slice(bg.indexOf('message.type === "APLYER_AUTOFILL_ALL"'), bg.indexOf('message.type === "APLYER_ANSWER_FIELD"'));
    expect(fn).toMatch(/authedFetch\("\/api\/public\/field-memory", \{ action: "resolve"/);
    expect(fn).not.toMatch(/executeScript/);
    expect(fn).toMatch(/auth_required/);
  });

  it("saves corrections as learned answers", () => {
    expect(bg).toMatch(/APLYER_FIELD_CORRECTED/);
    expect(bg).toMatch(/source: "correction"/);
  });
});

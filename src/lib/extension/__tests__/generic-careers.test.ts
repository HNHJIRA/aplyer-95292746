/**
 * Generic employer careers-page support (Step 8).
 *
 * Evaluates the real extension sources inside happy-dom, exactly like the
 * content script, and checks that detection is conservative, that ATS
 * detection is unchanged, and that only application questions are offered.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "../../../../extension");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

type AnyWin = typeof window & Record<string, any>;

const ADAPTERS = [
  "content/fill.js",
  "content/adapters/base.js",
  "content/adapters/greenhouse.js",
  "content/adapters/lever.js",
  "content/adapters/generic.js",
  "content/adapters/workday.js",
  "content/detector.js",
];

function boot(html: string, url: string, title = "") {
  const w = window as AnyWin;
  (w as any).happyDOM?.setURL?.(url);
  document.title = title;
  document.body.innerHTML = html;
  for (const k of ["AplyerAdapters", "AplyerFill", "AplyerGeneric", "AplyerDetect", "AplyerDetectAsync"]) w[k] = undefined;
  w.AplyerLog = { info() {}, warn() {}, debug() {} };
  Object.defineProperty(window.Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width: 200, height: 40, top: 0, left: 0, bottom: 40, right: 200 }),
  });
  for (const src of ADAPTERS) {
    // eslint-disable-next-line no-new-func
    new Function(read(src)).call(w);
  }
  return w;
}

const loc = (url: string) => new URL(url);

const APPLICATION = `
  <h1>Senior Product Manager</h1>
  <form id="apply">
    <label for="fn">First name</label><input id="fn" name="first_name" />
    <label for="ln">Last name</label><input id="ln" name="last_name" />
    <label for="em">Email</label><input id="em" type="email" name="email" />
    <label for="ph">Phone</label><input id="ph" type="tel" name="phone" />
    <label for="addr">Address</label><textarea id="addr" name="address"></textarea>
    <label for="li">LinkedIn profile</label><input id="li" name="linkedin" />
    <label for="cv">Resume / CV</label><input id="cv" type="file" name="resume" />
    <label for="why">Why do you want to work at Acme?</label><textarea id="why" name="why_acme"></textarea>
    <label for="cl">Cover letter</label><textarea id="cl" name="cover_letter"></textarea>
    <label for="pw">Password</label><input id="pw" type="password" />
    <button type="submit">Submit application</button>
  </form>`;

const CONTACT_US = `
  <h1>Contact us</h1>
  <form>
    <label for="n">Name</label><input id="n" name="name" />
    <label for="e">Email</label><input id="e" type="email" name="email" />
    <label for="m">How can we help you with your order?</label><textarea id="m" name="message"></textarea>
    <button type="submit">Send</button>
  </form>`;

describe("generic careers page detection", () => {
  it("1. detects an employer application form reached from a job board", () => {
    const w = boot(APPLICATION, "https://careers.acme.com/jobs/123/apply", "Apply | Acme Careers");
    const a = new w.AplyerAdapters.Generic();
    expect(a.matches(loc("https://careers.acme.com/jobs/123/apply"))).toBe(true);
    expect(a.name).toBe("generic");
    expect(a.platformLabel).toBe("Careers page");
  });

  it("2. ignores ordinary non-career pages (contact form, newsletter, no form)", () => {
    let w = boot(CONTACT_US, "https://shop.example.com/contact", "Contact");
    expect(new w.AplyerAdapters.Generic().matches(loc("https://shop.example.com/contact"))).toBe(false);

    w = boot(
      `<form><label for="e">Email</label><input id="e" type="email"/><label for="n">Name</label><input id="n" name="name"/><button>Subscribe</button></form>`,
      "https://blog.example.com/",
      "Blog",
    );
    expect(new w.AplyerAdapters.Generic().matches(loc("https://blog.example.com/"))).toBe(false);

    w = boot(`<article><h1>Our jobs report</h1><p>Text</p></article>`, "https://news.example.com/jobs-report", "Jobs report");
    expect(new w.AplyerAdapters.Generic().matches(loc("https://news.example.com/jobs-report"))).toBe(false);
  });

  it("2b. needs job context: a resume form on a non-job page does nothing", () => {
    const html = APPLICATION.replace("Senior Product Manager", "Upload").replace("Submit application", "Send");
    const w = boot(html, "https://files.example.com/upload", "Upload");
    expect(new w.AplyerAdapters.Generic().matches(loc("https://files.example.com/upload"))).toBe(false);
  });

  it("2c. never runs on job boards, search, or Aplyer itself", () => {
    for (const url of [
      "https://www.linkedin.com/jobs/view/1/apply",
      "https://www.indeed.com/viewjob?jk=1&apply=1",
      "https://www.aplyer.ai/careers/apply",
      "https://aplyer.devssh.xyz/jobs/apply",
    ]) {
      const w = boot(APPLICATION, url, "Apply");
      expect(new w.AplyerAdapters.Generic().matches(loc(url))).toBe(false);
    }
  });

  it("3-5. Workday, Greenhouse and Lever detection are unchanged and win over generic", () => {
    const cases: Array<[string, string]> = [
      ["https://acme.wd5.myworkdayjobs.com/en-US/careers/job/apply", "workday"],
      ["https://job-boards.greenhouse.io/acme/jobs/1", "greenhouse"],
      ["https://jobs.lever.co/acme/1/apply", "lever"],
    ];
    for (const [url, name] of cases) {
      const w = boot(APPLICATION, url, "Apply");
      expect(new w.AplyerAdapters.Generic().matches(loc(url))).toBe(false);
      const detected = w.AplyerDetect();
      expect(detected?.name).toBe(name);
    }
  });

  it("detector falls back to generic only when no ATS matched", () => {
    const w = boot(APPLICATION, "https://careers.acme.com/jobs/123/apply", "Apply");
    expect(w.AplyerDetect()?.name).toBe("generic");
    const w2 = boot(CONTACT_US, "https://shop.example.com/contact", "Contact");
    expect(w2.AplyerDetect()).toBeNull();
  });

  it("6-7. offers only application questions; contact, address and password fields are ignored", () => {
    const w = boot(APPLICATION, "https://careers.acme.com/jobs/123/apply", "Apply");
    const a = new w.AplyerAdapters.Generic();
    a.matches(loc("https://careers.acme.com/jobs/123/apply"));
    const qs = a.extractQuestions();
    const texts = qs.map((q: any) => q.questionText);
    expect(texts).toContain("Why do you want to work at Acme?");
    expect(texts).toContain("Cover letter");
    expect(texts).not.toContain("Address");
    expect(qs.every((q: any) => q.questionType === "long_form")).toBe(true);
    expect(qs.every((q: any) => q.fieldReference.tagName === "TEXTAREA")).toBe(true);
    for (const q of qs) expect(a.isAnswerField(q.fieldReference, q.questionType)).toBe(true);
  });

  it("ignores fields outside the identified application form", () => {
    const html = `<form id="search"><label for="s">Search our site for anything you like</label><textarea id="s"></textarea></form>${APPLICATION}`;
    const w = boot(html, "https://careers.acme.com/jobs/123/apply", "Apply");
    const a = new w.AplyerAdapters.Generic();
    a.matches(loc("https://careers.acme.com/jobs/123/apply"));
    const ids = a.extractQuestions().map((q: any) => q.fieldReference.id);
    expect(ids).not.toContain("s");
  });

  it("8. answer generation target resolves and fills the generic question field", () => {
    const w = boot(APPLICATION, "https://careers.acme.com/jobs/123/apply", "Apply");
    const a = new w.AplyerAdapters.Generic();
    a.matches(loc("https://careers.acme.com/jobs/123/apply"));
    const q = a.extractQuestions().find((x: any) => x.questionText.startsWith("Why"));
    const el = a.resolveField({ questionId: q.questionId, fieldKey: a.fieldKey(q.fieldReference) });
    expect(el).toBe(q.fieldReference);
    const res = a.fillField(el, "Because Acme builds tools I use every day.");
    expect(res.ok).toBe(true);
    expect((el as HTMLTextAreaElement).value).toBe("Because Acme builds tools I use every day.");
  });

  it("background accepts generic autofill targets", () => {
    expect(read("background.js")).toMatch(/SUPPORTED_ADAPTERS = new Set\(\[[^\]]*"generic"/);
  });

  it("manifest keeps the ATS entry unchanged and excludes ATS hosts from the generic entry", () => {
    const m = JSON.parse(read("manifest.json"));
    const [ats, generic] = m.content_scripts;
    expect(ats.js).not.toContain("content/adapters/generic.js");
    expect(ats.matches).toContain("https://*.greenhouse.io/*");
    expect(generic.js[0]).toBe("content/generic-gate.js");
    expect(generic.js).toContain("content/adapters/generic.js");
    for (const host of ats.matches) expect(generic.exclude_matches).toContain(host);
    expect(generic.exclude_matches).toEqual(expect.arrayContaining(["https://*.linkedin.com/*", "https://*.indeed.com/*"]));
    expect(generic.all_frames).toBe(false);
  });
});

describe("field intelligence stays inert on unconfirmed generic pages", () => {
  function bootFi(active: boolean) {
    const w = window as AnyWin;
    document.body.innerHTML = APPLICATION;
    w.AplyerFieldIntel = undefined;
    w.AplyerLog = { info() {}, warn() {} };
    w.__aplyerRequireAdapter = true;
    w.__aplyerAdapterActive = active;
    let listener: any = null;
    w.chrome = { runtime: { onMessage: { addListener: (fn: any) => (listener = fn) }, sendMessage: () => Promise.resolve() } };
    // eslint-disable-next-line no-new-func
    new Function(read("content/field-intel.js")).call(w);
    const ask = (msg: any) => {
      let out: any;
      listener(msg, {}, (r: any) => (out = r));
      return out;
    };
    return { w, ask };
  }

  it("refuses to scan or fill before detection confirms an application", () => {
    const { ask, w } = bootFi(false);
    expect(ask({ type: "APLYER_FI_SCAN" })).toMatchObject({ ok: false, code: "unsupported_page" });
    expect(ask({ type: "APLYER_FI_ANSWER", fieldId: "x", value: "y" })).toMatchObject({ ok: false });
    w.__aplyerRequireAdapter = undefined;
  });

  it("scans normally once the application is confirmed", () => {
    const { ask, w } = bootFi(true);
    const r = ask({ type: "APLYER_FI_SCAN" });
    expect(r.ok).toBe(true);
    expect(r.fields.length).toBeGreaterThan(0);
    w.__aplyerRequireAdapter = undefined;
    w.__aplyerAdapterActive = undefined;
  });
});

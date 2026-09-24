// Generic employer careers-page adapter.
//
// Covers application forms hosted on an employer's own careers site (the page a
// candidate reaches from LinkedIn, Indeed or another job board). Detection is
// deliberately conservative: the adapter only activates when ONE form on the
// page carries every signal of a job application at once. Anything less and it
// does nothing, so ordinary pages (contact forms, newsletters, checkouts,
// sign-ins) are ignored.
//
// Privacy: detection reads form structure and field labels only. It never
// reads, stores or sends the page's body text; the only text that ever leaves
// the page is the label of a question the candidate explicitly asks Aplyer to
// answer (the same contract as the ATS adapters).
(function () {
  const Base = window.AplyerAdapters.Base;

  // Dedicated adapters own these hosts. The generic adapter never runs there.
  const ATS_HOST_RE = /(^|\.)(greenhouse\.io|lever\.co|myworkdayjobs\.com|workday\.com|myworkdaysite\.com)$/i;
  // Job boards, search, mail, social and Aplyer itself: never an employer form.
  const EXCLUDED_HOST_RE =
    /(^|\.)(linkedin\.com|indeed\.com|indeed\.[a-z.]+|glassdoor\.com|glassdoor\.[a-z.]+|ziprecruiter\.com|monster\.com|google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|reddit\.com|amazon\.[a-z.]+|ebay\.[a-z.]+|paypal\.com|aplyer\.ai|devssh\.xyz|lovable\.app|lovable\.dev|chromewebstore\.google\.com)$/i;

  const JOB_CONTEXT_RE =
    /\b(apply|application|applicant|applying|career|careers|job|jobs|position|vacancy|vacancies|requisition|opening|openings|recruiting|recruitment|hiring|candidate)\b/i;
  const RESUME_RE = /\b(resume|résumé|cv|curriculum vitae)\b/i;
  const COVER_LETTER_RE = /\bcover[\s_-]?letter\b/i;
  const EMAIL_RE = /\be-?mail\b/i;
  const NAME_RE = /\b(first[\s_-]?name|last[\s_-]?name|full[\s_-]?name|given[\s_-]?name|family[\s_-]?name|surname|legal[\s_-]?name|your[\s_-]?name|^name$)\b/i;
  const NAME_ATTR_RE = /(^|[_\-\s[])(first[_-]?name|last[_-]?name|full[_-]?name|fname|lname|given[_-]?name|family[_-]?name|surname|name)([_\-\s\]]|$)/i;

  // Short free-text fields that are contact/identity data, never questions.
  const IDENTITY_LABEL_RE =
    /^(first name|last name|preferred (first )?name|full name|legal name|name|e-?mail( address)?|phone( number)?|mobile( number)?|telephone|country|state|province|region|city|town|location|current location|address( line \d)?|street( address)?|zip|zip code|postal code|post code|linkedin( profile| url)?|website|personal website|portfolio( url| link)?|github( profile| url)?|twitter|resume|cv|school|university|degree|discipline|start date|end date)\b/i;
  const SENSITIVE_RE =
    /(password|passcode|\bpin\b|\bssn\b|social security|national (insurance|id)|passport|driver'?s? licen[cs]e|\btax\s?(id|number)\b|bank|iban|swift|routing|account number|sort code|credit card|card number|cvv|cvc|mother'?s maiden|date of birth|\bdob\b)/i;
  const QUESTION_HINT_RE =
    /(\?|\bwhy\b|\bdescribe\b|\btell us\b|\bexplain\b|\bwhat\b|\bhow\b|\bshare\b|motivat|interest|experience|cover letter|additional information|anything else|about yourself|summary)/i;

  function clean(t) {
    return String(t || "")
      .replace(/\s+/g, " ")
      .replace(/\*+\s*$/, "")
      .replace(/\(optional\)/i, "")
      .replace(/\(required\)/i, "")
      .trim()
      .slice(0, 300);
  }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden";
    } catch {
      return false;
    }
  }

  function esc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(String(s));
    return String(s).replace(/["\\\]]/g, "\\$&");
  }

  /** Label text for one field, from explicit associations only. */
  function labelFor(el) {
    try {
      if (el.id) {
        const l = document.querySelector(`label[for="${esc(el.id)}"]`);
        if (l && l.textContent.trim()) return clean(l.textContent);
      }
      const wrap = el.closest && el.closest("label");
      if (wrap && wrap.textContent.trim()) return clean(wrap.textContent);
      const by = el.getAttribute && el.getAttribute("aria-labelledby");
      if (by) {
        const t = by
          .split(/\s+/)
          .map((id) => (document.getElementById(id) || {}).textContent || "")
          .join(" ");
        if (t.trim()) return clean(t);
      }
      const al = el.getAttribute && el.getAttribute("aria-label");
      if (al && al.trim()) return clean(al);
      const fs = el.closest && el.closest("fieldset");
      const lg = fs && fs.querySelector("legend");
      if (lg && lg.textContent.trim()) return clean(lg.textContent);
      let p = el.parentElement;
      for (let i = 0; i < 3 && p; i++) {
        const l = p.querySelector("label, legend");
        if (l && !l.contains(el) && l.textContent.trim() && !l.getAttribute("for")) return clean(l.textContent);
        p = p.parentElement;
      }
      const ph = el.getAttribute && el.getAttribute("placeholder");
      if (ph && ph.trim()) return clean(ph);
    } catch {
      /* ignore */
    }
    return "";
  }

  function attrText(el) {
    return [el.name, el.id, el.getAttribute && el.getAttribute("autocomplete")].filter(Boolean).join(" ");
  }

  function hostEligible(loc) {
    const h = String((loc && loc.hostname) || "").toLowerCase();
    if (!h) return false;
    if (ATS_HOST_RE.test(h)) return false;
    if (EXCLUDED_HOST_RE.test(h)) return false;
    return true;
  }

  /** Page-level job context from the URL, title and main headings only. */
  function hasJobContext(loc, root) {
    try {
      if (JOB_CONTEXT_RE.test(decodeURIComponent(String(loc.pathname || "") + " " + String(loc.search || "")).replace(/[-_/]+/g, " "))) return true;
    } catch { /* ignore */ }
    if (JOB_CONTEXT_RE.test(document.title || "")) return true;
    const heads = document.querySelectorAll("h1, h2");
    for (let i = 0; i < heads.length && i < 12; i++) {
      if (JOB_CONTEXT_RE.test(heads[i].textContent || "")) return true;
    }
    const submits = root.querySelectorAll('button, input[type="submit"]');
    for (let i = 0; i < submits.length && i < 20; i++) {
      const t = submits[i].tagName === "INPUT" ? submits[i].value : submits[i].textContent;
      if (/\b(apply|submit application|send application)\b/i.test(t || "")) return true;
    }
    return false;
  }

  function isQuestionField(el, label) {
    if (!label || label.length < 12) return false;
    if (SENSITIVE_RE.test(label)) return false;
    if (IDENTITY_LABEL_RE.test(label) && !QUESTION_HINT_RE.test(label.replace(IDENTITY_LABEL_RE, ""))) return false;
    if (COVER_LETTER_RE.test(label)) return true;
    return QUESTION_HINT_RE.test(label) || label.length >= 25;
  }

  /** Scores one container. Pure read of form structure + labels. */
  function assessContainer(root) {
    const signals = { email: false, name: false, resume: false, coverLetter: false, questions: 0 };
    let inputs;
    try {
      inputs = root.querySelectorAll('input, textarea, [contenteditable="true"]');
    } catch {
      return signals;
    }
    for (let i = 0; i < inputs.length && i < 400; i++) {
      const el = inputs[i];
      const type = String((el.getAttribute && el.getAttribute("type")) || "").toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button" || type === "password") continue;
      const label = labelFor(el);
      const attrs = attrText(el);
      if (type === "file") {
        if (RESUME_RE.test(label) || RESUME_RE.test(attrs)) signals.resume = true;
        if (COVER_LETTER_RE.test(label) || COVER_LETTER_RE.test(attrs)) signals.coverLetter = true;
        continue;
      }
      if (type === "email" || EMAIL_RE.test(label) || /(^|[_\-\s])e-?mail([_\-\s]|$)/i.test(attrs)) signals.email = true;
      if (NAME_RE.test(label) || NAME_ATTR_RE.test(attrs)) signals.name = true;
      if (el.tagName === "TEXTAREA" || (el.getAttribute && el.getAttribute("contenteditable") === "true")) {
        if (COVER_LETTER_RE.test(label)) signals.coverLetter = true;
        if (RESUME_RE.test(label) && /paste/i.test(label)) signals.resume = true;
        if (isQuestionField(el, label)) signals.questions += 1;
      }
    }
    return signals;
  }

  /**
   * Decides whether this page is an employer job application. Returns the
   * qualifying form (or null). Every one of these must hold for one container:
   *  - host is not an ATS / job board / excluded site,
   *  - the page presents itself as a job/application page,
   *  - the form asks for the candidate's name AND email,
   *  - the form asks for a resume/CV or a cover letter.
   */
  function assessPage(loc) {
    const out = { confident: false, root: null, signals: null };
    if (!hostEligible(loc)) return out;
    let containers = [];
    try {
      containers = Array.from(document.querySelectorAll("form"));
    } catch { /* ignore */ }
    if (!containers.length && document.body) containers = [document.body];
    for (const root of containers) {
      const s = assessContainer(root);
      if (!(s.email && s.name && (s.resume || s.coverLetter))) continue;
      if (!hasJobContext(loc, root)) continue;
      out.confident = true;
      out.root = root;
      out.signals = s;
      return out;
    }
    return out;
  }

  class GenericCareersAdapter extends Base {
    constructor() {
      super("generic");
      this.platformLabel = "Careers page";
      this.adapterVersion = "1.0.0";
      this.root = null;
    }

    matches(loc) {
      const r = assessPage(loc);
      this.root = r.confident ? r.root : null;
      return r.confident;
    }

    _root() {
      if (this.root && this.root.isConnected) return this.root;
      const r = assessPage(window.location);
      this.root = r.confident ? r.root : null;
      return this.root;
    }

    extractQuestions() {
      const out = [];
      const root = this._root();
      if (!root) return out;
      let nodes;
      try {
        nodes = root.querySelectorAll('textarea, [contenteditable="true"]');
      } catch {
        return out;
      }
      nodes.forEach((el, i) => {
        try {
          if (!el || el.dataset.aplyerSeen === "1") return;
          if (el.disabled || el.readOnly) return;
          if (!isVisible(el)) return;
          const label = labelFor(el);
          if (!isQuestionField(el, label)) return;
          const id = el.name || el.id || `generic-${i}-${hash(label)}`;
          out.push({
            questionId: id,
            questionText: label,
            fieldReference: el,
            questionType: "long_form",
          });
        } catch { /* per-field failure must not break the scan */ }
      });
      return out;
    }

    anchorFor(field) {
      return field.parentElement || field;
    }

    fieldKey(el) {
      return (el && (el.name || el.id)) || null;
    }

    resolveField(target) {
      if (!target) return null;
      const F = window.AplyerFill;
      const root = this._root();
      if (!root) return null;
      const key = target.fieldKey;
      try {
        if (key) {
          const byName = root.querySelector(`textarea[name="${esc(key)}"]`);
          if (byName && F.isAnswerableElement(byName)) return byName;
          const byId = document.getElementById(key);
          if (byId && root.contains(byId) && F.isAnswerableElement(byId)) return byId;
        }
      } catch { /* ignore */ }
      try {
        const found = this.extractQuestions() || [];
        const hit = found.find((q) => q.questionId === target.questionId);
        if (hit && F.isAnswerableElement(hit.fieldReference)) return hit.fieldReference;
      } catch { /* ignore */ }
      return null;
    }
  }

  window.AplyerAdapters.Generic = GenericCareersAdapter;
  window.AplyerGeneric = { assessPage, hostEligible, isQuestionField, labelFor };
})();

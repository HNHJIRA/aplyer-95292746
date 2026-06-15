// Aplyer Autofill — fills basic identity fields (name, email, phone,
// location, linkedin, portfolio) from the stored profile across any ATS.
// Generic & label-driven so it works on Greenhouse, Lever, Workday, etc.
(function () {
  const log = window.AplyerLog;
  const STORE_KEY = "aplyer.v1";

  // Field-kind matchers — checked against (name|id|autocomplete|label) text.
  const MATCHERS = [
    { kind: "firstName", re: /(first[\s_-]?name|given[\s_-]?name|fname|forename)/i },
    { kind: "lastName",  re: /(last[\s_-]?name|family[\s_-]?name|surname|lname)/i },
    { kind: "fullName",  re: /(^|\b)(full[\s_-]?name|your[\s_-]?name|legal[\s_-]?name|name)(\b|$)/i },
    { kind: "email",     re: /(e[-\s]?mail)/i },
    { kind: "phone",     re: /(phone|mobile|tel\b|telephone|contact[\s_-]?number)/i },
    { kind: "location",  re: /(current[\s_-]?location|location|city|address)/i },
    { kind: "linkedin",  re: /(linkedin)/i },
    { kind: "portfolio", re: /(portfolio|website|personal[\s_-]?site|url)/i },
    { kind: "github",    re: /(github)/i },
  ];

  async function getProfile() {
    try {
      const res = await chrome.storage.local.get(STORE_KEY);
      return res?.[STORE_KEY]?.profile || null;
    } catch { return null; }
  }

  function valueFor(kind, p) {
    if (!p) return null;
    switch (kind) {
      case "firstName": return p.firstName;
      case "lastName":  return p.lastName;
      case "fullName":  return [p.firstName, p.lastName].filter(Boolean).join(" ");
      case "email":     return p.email;
      case "phone":     return p.phone;
      case "location":  return p.location;
      case "linkedin":  return p.linkedin;
      case "portfolio": return p.portfolio;
      case "github":    return p.github || p.portfolio;
      default: return null;
    }
  }

  function labelTextFor(el) {
    try {
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab?.textContent) return lab.textContent;
      }
      const lb = el.getAttribute?.("aria-labelledby");
      if (lb) {
        const txt = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
        if (txt.trim()) return txt;
      }
      const al = el.getAttribute?.("aria-label");
      if (al) return al;
      const ph = el.getAttribute?.("placeholder");
      if (ph) return ph;
      let p = el.parentElement;
      for (let i = 0; i < 5 && p; i++) {
        const lab = p.querySelector("label");
        if (lab?.textContent) return lab.textContent;
        p = p.parentElement;
      }
    } catch { /* ignore */ }
    return "";
  }

  function classify(el) {
    const haystack = [
      el.name || "",
      el.id || "",
      el.getAttribute?.("autocomplete") || "",
      el.getAttribute?.("data-qa") || "",
      el.getAttribute?.("data-automation-id") || "",
      labelTextFor(el),
    ].join(" ").toLowerCase();
    if (!haystack.trim()) return null;
    // email input type wins
    if ((el.type || "").toLowerCase() === "email") return "email";
    if ((el.type || "").toLowerCase() === "tel") return "phone";
    for (const m of MATCHERS) {
      if (m.re.test(haystack)) return m.kind;
    }
    return null;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  }

  function setValue(el, value) {
    if (!value || el.disabled || el.readOnly) return false;
    try {
      const tag = el.tagName;
      const proto = tag === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value); else el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    } catch { return false; }
  }

  async function autofill() {
    const profile = await getProfile();
    if (!profile) {
      log?.info?.("autofill", "No profile saved yet");
      return { filled: 0, missing: true };
    }
    const inputs = document.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type]), textarea'
    );
    let filled = 0;
    const seenKind = new Set();
    inputs.forEach((el) => {
      if (!isVisible(el)) return;
      const kind = classify(el);
      if (!kind) return;
      // Skip if user already typed something
      if (el.value && el.value.trim().length > 0) return;
      // For fullName, prefer once
      if (kind === "fullName" && (seenKind.has("firstName") || seenKind.has("lastName"))) return;
      const v = valueFor(kind, profile);
      if (!v) return;
      if (setValue(el, v)) { filled++; seenKind.add(kind); }
    });
    log?.info?.("autofill", `Filled ${filled} basic field(s)`);
    return { filled, missing: false };
  }

  window.AplyerAutofill = { autofill, getProfile };
})();

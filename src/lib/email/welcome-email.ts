/**
 * Welcome email content builder.
 *
 * Pure HTML/text construction — no network, no secrets. Kept separate from
 * the Brevo transport (`brevo.server.ts`) so it can be unit-tested freely.
 */

export const WELCOME_SUBJECT = "You're in! Here's what happens next:";
export const WELCOME_SENDER = { name: "Aplyer", email: "dustin@aplyer.ai" };

const SITE = "https://aplyer.ai";

/** Link targets are configurable so a route that is not live yet can be pointed elsewhere. */
export function welcomeLinks() {
  const env = (k: string) =>
    typeof process !== "undefined" ? (process.env?.[k] ?? undefined) : undefined;
  return {
    demo: env("APLYER_DEMO_URL") || `${SITE}/demo`,
    resumeAudit: env("APLYER_RESUME_AUDIT_URL") || `${SITE}/resume-audit`,
    resumeMatch: env("APLYER_RESUME_MATCH_URL") || `${SITE}/resume-match`,
    privacy: env("APLYER_PRIVACY_URL") || `${SITE}/privacy`,
    terms: env("APLYER_TERMS_URL") || `${SITE}/terms`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function greetingFor(firstName?: string | null): string {
  const clean = (firstName ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean || !/^[\p{L}][\p{L}\p{M}'\- .]*$/u.test(clean)) return "Hi there,";
  return `Hi ${clean.split(" ")[0]},`;
}

function button(href: string, label: string, sub: string): string {
  return `
  <tr><td style="padding:0 0 12px 0;">
    <a href="${href}" style="display:block;background:#1DB954;color:#06140A;text-decoration:none;font-weight:700;font-size:16px;line-height:1.3;padding:14px 20px;border-radius:10px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      ${escapeHtml(label)}
    </a>
    <div style="font-size:13px;color:#6B7280;padding:6px 2px 0 2px;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(sub)}</div>
  </td></tr>`;
}

export function buildWelcomeEmailHtml(firstName?: string | null): string {
  const L = welcomeLinks();
  const greeting = escapeHtml(greetingFor(firstName));

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(WELCOME_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#F4F6F8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Welcome to Aplyer!</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB;">

    <tr><td style="background:#0D1829;padding:24px;text-align:center;">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:800;color:#1DB954;letter-spacing:-0.5px;">Aplyer.ai</div>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:3px;color:#E5373A;font-weight:700;padding-top:6px;">STOP SKIPPING JOBS</div>
    </td></tr>

    <tr><td style="padding:28px 24px 8px 24px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <p style="margin:0 0 16px 0;font-size:17px;font-weight:700;">${greeting}</p>
      <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;">Welcome to Aplyer!</p>
      <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;">Being back in the job market at age 50 isn't easy. These long applications have taken its toll, draining me of energy to keep applying so I find myself closing the ones with long questions and simply clicking the LinkedIn Easy Apply button. Does this sound familiar?</p>
      <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;">Problem is we are all doing that making it so hard for us to get an interview.</p>
      <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;">There has to be a better way.</p>
      <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;">I spent 8 years as a recruiter finding people jobs which gave me the experience and inspiration to build Aplyer and stop my job search.</p>
      <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;">Aplyer is a Google Chrome extension that allows you to answer long application questions in your voice, using your resume and writing samples in seconds, without you ever having to leave the company job application page again. No more copying &amp; pasting from ChatGPT!</p>
      <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;">We also autofill basic info. I know this will make your search easier. Founding members get priority access and pricing that will never be offered again.</p>
      <p style="margin:0 0 18px 0;font-size:16px;line-height:1.6;font-weight:700;">If you want to see Aplyer work on your resume before we launch, here are three free tools you can use right now:</p>
    </td></tr>

    <tr><td style="padding:0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${button(L.demo, "Try the Live Demo", "See Aplyer answer a real application question.")}
        ${button(L.resumeAudit, "Resume Red Flag Audit (free)", "Spot the things recruiters quietly screen you out for.")}
        ${button(L.resumeMatch, "Resume Score vs the Job (free)", "See how your resume scores against a specific job post.")}
      </table>
    </td></tr>

    <tr><td style="padding:14px 24px 4px 24px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <p style="margin:0 0 4px 0;font-size:16px;line-height:1.6;">— Dustin Palay<br />Founder, <a href="${SITE}" style="color:#111827;text-decoration:underline;">Aplyer.ai</a></p>
    </td></tr>

    <tr><td style="padding:20px 24px 26px 24px;border-top:1px solid #E5E7EB;font-family:Arial,Helvetica,sans-serif;text-align:center;">
      <div style="font-size:12px;color:#6B7280;letter-spacing:1px;text-transform:uppercase;">Powered by WriteDNA Technology</div>
      <div style="font-size:12px;color:#6B7280;padding-top:10px;">
        <a href="${L.privacy}" style="color:#6B7280;text-decoration:underline;">Privacy Policy</a>
        &nbsp;·&nbsp;
        <a href="${L.terms}" style="color:#6B7280;text-decoration:underline;">Terms</a>
      </div>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;
}

export function buildWelcomeEmailText(firstName?: string | null): string {
  const L = welcomeLinks();
  return [
    "Aplyer.ai — STOP SKIPPING JOBS",
    "",
    greetingFor(firstName),
    "",
    "Welcome to Aplyer!",
    "",
    "Being back in the job market at age 50 isn't easy. These long applications have taken its toll, draining me of energy to keep applying so I find myself closing the ones with long questions and simply clicking the LinkedIn Easy Apply button. Does this sound familiar?",
    "",
    "Problem is we are all doing that making it so hard for us to get an interview.",
    "",
    "There has to be a better way.",
    "",
    "I spent 8 years as a recruiter finding people jobs which gave me the experience and inspiration to build Aplyer and stop my job search.",
    "",
    "Aplyer is a Google Chrome extension that allows you to answer long application questions in your voice, using your resume and writing samples in seconds, without you ever having to leave the company job application page again. No more copying & pasting from ChatGPT!",
    "",
    "We also autofill basic info. I know this will make your search easier. Founding members get priority access and pricing that will never be offered again.",
    "",
    "If you want to see Aplyer work on your resume before we launch, here are three free tools you can use right now:",
    `1. Try the Live Demo — ${L.demo}`,
    `2. Resume Red Flag Audit (free) — ${L.resumeAudit}`,
    `3. Resume Score vs the Job (free) — ${L.resumeMatch}`,
    "",
    "— Dustin Palay",
    "Founder, Aplyer.ai",
    "",
    "Powered by WriteDNA Technology",
    `Privacy Policy: ${L.privacy}`,
    `Terms: ${L.terms}`,
  ].join("\n");
}

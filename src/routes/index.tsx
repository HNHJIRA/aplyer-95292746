import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import rawHtml from "@/legacy/index.html?raw";
import { subscribe } from "@/services/subscribeService";
import { useAuth } from "@/hooks/useAuth";
import { downloadExtension } from "@/lib/download-extension";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tired of Long Job Application Questions? Stop Skipping Jobs." },
      {
        name: "description",
        content:
          "57% of candidates have abandoned an application because it was too long or complicated. Aplyer answers the hard questions in your voice, using your resume, so you can apply for the jobs everyone else skips.",
      },
      {
        property: "og:title",
        content: "Tired of Long Job Application Questions? Stop Skipping Jobs.",
      },
      {
        property: "og:description",
        content:
          "57% of candidates have abandoned an application because it was too long or complicated. Aplyer answers the hard questions in your voice, using your resume, so you can apply for the jobs everyone else skips.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://aplyer.ai" },
      { property: "og:image", content: "https://aplyer.ai/aplyer_og.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://aplyer.ai/aplyer_og.jpg" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,300;0,400;0,700;0,900;1,400;1,700&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap",
      },
    ],
  }),
  component: Index,
});



// Extract <style>...</style> blocks and the contents of <body>...</body>
// from the original HTML so we can render the design pixel-for-pixel inside
// the React shell.
function extractStyleAndBody(html: string) {
  const styleMatches = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi));
  const style = styleMatches.map((m) => m[1]).join("\n");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : html;
  // Strip <script> blocks — we re-attach the handlers in React below
  // (innerHTML-inserted scripts don't execute anyway).
  body = body.replace(/<script[\s\S]*?<\/script>/gi, "");
  return { style, body };
}

const { style: legacyStyle, body: legacyBody } = extractStyleAndBody(rawHtml);

// Layout for the session-aware controls added to the legacy fixed navigation.
const navActionsCss = `
#aplyer-nav-actions{display:flex;align-items:center;gap:18px;flex-wrap:wrap;justify-content:flex-end}
#aplyer-nav-actions a.nav-link{font-family:'Lato',sans-serif;font-size:15px;font-weight:700;color:#0D1829;text-decoration:none;white-space:nowrap}
#aplyer-nav-actions a.nav-link:hover{color:#1DB954}
#aplyer-nav-actions a.nav-cta{background:#1DB954;color:#04140A;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;white-space:nowrap}
#aplyer-nav-actions a.nav-cta:hover{background:#22C55E}
#aplyer-nav-actions button.nav-link{background:none;border:none;cursor:pointer;font-family:'Lato',sans-serif;font-size:15px;font-weight:700;color:#0D1829}
#aplyer-download-ext{display:inline-block;margin-left:12px}
#aplyer-download-ext button{font-family:'Lato',sans-serif;font-size:15px;font-weight:700;color:#000;background:#1DB954;border:none;border-radius:8px;padding:15px 36px;letter-spacing:.02em;cursor:pointer;transition:background .15s}
#aplyer-download-ext button:hover{background:#22C55E}
#aplyer-download-ext button:disabled{opacity:.7;cursor:default}
@media (max-width:520px){#aplyer-download-ext{display:block;margin:12px 0 0}#aplyer-download-ext button{width:100%}}
@media (max-width:900px){
  .nav-inner{flex-wrap:wrap;height:auto;padding-top:12px;padding-bottom:12px;gap:10px}
  #aplyer-nav-actions{gap:12px}
  #aplyer-nav-actions .nav-sep{display:none}
}
@media (max-width:900px){
  .cover{padding-top:150px}
}
@media (max-width:520px){
  .cover{padding-top:170px}
}
`;

/** Green call to action that downloads the Chrome extension package. */
function DownloadExtensionButton() {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");

  async function handleClick() {
    setState("working");
    try {
      await downloadExtension();
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={state === "working"}>
      {state === "working"
        ? "Preparing download…"
        : state === "error"
          ? "Download failed — try again"
          : "Download Extension"}
    </button>
  );
}

/** Session-aware navigation — Foundation auth is the only source of truth. */
function HomeNavActions() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <>
      {loading ? null : user ? (
        <>
          <Link className="nav-cta" to="/dashboard">Dashboard</Link>
          <button type="button" className="nav-link" onClick={handleSignOut}>
            Sign Out
          </button>
        </>
      ) : (
        <>
          <Link className="nav-link" to="/auth">Sign In</Link>
          <Link className="nav-cta" to="/auth">Sign Up</Link>
        </>
      )}
    </>
  );
}

declare global {
  interface Window {
    toggleFAQ: () => void;
    toggleFAQItem: (header: HTMLElement) => void;
    toggleOptional: () => void;
    toggleSocial: () => void;
    aplerSubmit: () => void;
  }
}

function Index() {
  const rootRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);
  const [navHost, setNavHost] = useState<HTMLElement | null>(null);
  const [downloadHost, setDownloadHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Inject the legacy markup client-side to avoid SSR hydration mismatches
    // (the original HTML contains a few stray closing tags that escape any
    // wrapper element when parsed during SSR).
    if (rootRef.current && !rootRef.current.dataset.injected) {
      rootRef.current.innerHTML = legacyBody;
      rootRef.current.dataset.injected = "1";

      // Mount the Foundation session controls inside the legacy navigation.
      const navInner = rootRef.current.querySelector(".nav-inner");
      if (navInner) {
        const host = document.createElement("div");
        host.id = "aplyer-nav-actions";
        navInner.appendChild(host);
        setNavHost(host);
      }

      // Extension download button, right after the demo call to action.
      const demoCta = rootRef.current.querySelector('a[href="/demo"]');
      if (demoCta?.parentElement) {
        const host = document.createElement("span");
        host.id = "aplyer-download-ext";
        demoCta.insertAdjacentElement("afterend", host);
        setDownloadHost(host);
      }
    }







    // ----- toggle handlers (mirroring the original inline scripts) -----
    window.toggleFAQ = () => {
      const body = document.getElementById("faq-body");
      const icon = document.getElementById("faq-icon");
      if (!body || !icon) return;
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      icon.textContent = open ? "+" : "−";
    };

    window.toggleFAQItem = (header: HTMLElement) => {
      const answer = header.nextElementSibling as HTMLElement | null;
      const icon = header.querySelector("span:last-child") as HTMLElement | null;
      if (!answer || !icon) return;
      const open = answer.style.display !== "none";
      answer.style.display = open ? "none" : "block";
      icon.textContent = open ? "+" : "−";
    };

    window.toggleOptional = () => {
      const body = document.getElementById("optional-body");
      const chev = document.getElementById("optional-chevron");
      if (!body || !chev) return;
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      chev.textContent = open ? "＋" : "−";
    };

    window.toggleSocial = () => {
      const body = document.getElementById("social-body");
      const chev = document.getElementById("social-chevron");
      if (!body || !chev) return;
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      chev.textContent = open ? "＋" : "−";
    };

    // ----- submit handler — calls the existing backend endpoint -----
    window.aplerSubmit = async () => {
      if (submittingRef.current) return;

      const emailEl = document.getElementById("aplyer-email") as HTMLInputElement | null;
      const nameEl = document.getElementById("aplyer-name") as HTMLInputElement | null;
      const btn = document.getElementById("aplyer-btn") as HTMLButtonElement | null;
      const errEl = document.getElementById("aplyer-error-msg") as HTMLElement | null;
      if (!emailEl || !btn || !errEl) return;

      const email = emailEl.value.trim();
      const name = nameEl?.value.trim() ?? "";
      const linkedin =
        (document.querySelector('input[name="linkedin"]') as HTMLInputElement | null)?.value.trim() ?? "";
      const facebook =
        (document.querySelector('input[name="facebook"]') as HTMLInputElement | null)?.value.trim() ?? "";
      const instagram =
        (document.querySelector('input[name="instagram"]') as HTMLInputElement | null)?.value.trim() ?? "";
      const tiktok =
        (document.querySelector('input[name="tiktok"]') as HTMLInputElement | null)?.value.trim() ?? "";
      const twitter =
        (document.querySelector('input[name="twitter"]') as HTMLInputElement | null)?.value.trim() ?? "";
      const resumeFile = (document.getElementById("aplyer-resume") as HTMLInputElement | null)?.files?.[0];
      const coverFile = (document.getElementById("aplyer-cover") as HTMLInputElement | null)?.files?.[0];
      const writingSample =
        (document.getElementById("aplyer-sample") as HTMLTextAreaElement | null)?.value.trim() ?? "";

      errEl.style.display = "none";
      if (!email) {
        errEl.textContent = "Please enter your email address.";
        errEl.style.display = "block";
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = "Please enter a valid email address.";
        errEl.style.display = "block";
        return;
      }
      btn.textContent = "Submitting...";
      btn.disabled = true;
      submittingRef.current = true;

      const formData = new FormData();
      formData.append("email", email);
      formData.append("source", "homepage");
      if (name) formData.append("firstName", name);
      if (linkedin) formData.append("linkedin", linkedin);
      if (facebook) formData.append("facebook", facebook);
      if (instagram) formData.append("instagram", instagram);
      if (tiktok) formData.append("tiktok", tiktok);
      if (twitter) formData.append("twitter", twitter);
      if (resumeFile) formData.append("resume", resumeFile);
      if (coverFile) formData.append("coverLetter", coverFile);
      if (writingSample) formData.append("writingSample", writingSample);




      const result = await subscribe(formData);
      if (result.ok) {
        emailEl.style.display = "none";
        if (nameEl) nameEl.style.display = "none";
        const optToggle = document.getElementById("optional-toggle");
        const optBody = document.getElementById("optional-body");
        if (optToggle) optToggle.style.display = "none";
        if (optBody) optBody.style.display = "none";
        btn.style.display = "none";
        const ok = document.getElementById("aplyer-success-msg");
        if (ok) ok.style.display = "block";
      } else {
        errEl.textContent = result.error ?? "Something went wrong. Please try again.";
        errEl.style.display = "block";
        btn.textContent = "Join the Waitlist →";
        btn.disabled = false;
      }
      submittingRef.current = false;
    };
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: legacyStyle + navActionsCss }} />
      <div ref={rootRef} suppressHydrationWarning />
      {navHost ? createPortal(<HomeNavActions />, navHost) : null}
      {downloadHost ? createPortal(<DownloadExtensionButton />, downloadHost) : null}
    </>
  );
}


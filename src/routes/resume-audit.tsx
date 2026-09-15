import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api-base";
import AuditResult from "@/components/audit/AuditResult";
import type { Audit } from "@/components/audit/types";
import { requestToolResult, ToolRequestError, GENERIC_TOOL_ERROR } from "@/lib/tool-stream";


export const Route = createFileRoute("/resume-audit")({
  head: () => ({
    meta: [
      { title: "Resume Red Flag Audit — Aplyer.ai" },
      {
        name: "description",
        content:
          "Upload your resume and get a fast recruiter-style red flag audit. Free, no sign-up, results in seconds.",
      },
      { property: "og:title", content: "Resume Red Flag Audit — Aplyer.ai" },
      {
        property: "og:description",
        content:
          "A real recruiter-style seven-second scan of your resume. Spot the red flags and get specific fixes.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&family=DM+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  component: ResumeAuditPage,
});


const NAVY = "#0a2540";
const GREEN = "#22c55e";
const GREEN_DARK = "#16a34a";
const RED = "#E5373A";
const RED_DARK = "#b91c1c";
const BG = "#ffffff";
const SOFT = "#f4f6f9";
const BORDER = "#e3e7ec";
const TEXT = "#1a2a3a";
const MUTED = "#5a6b7c";

const LOADING_MSGS = [
  "Reading your resume...",
  "Looking for recruiter red flags...",
  "Finding specific fixes...",
  "Building your audit...",
];

const ACCEPTED = ".pdf,.docx,.doc,.txt";
const MAX_BYTES = 10 * 1024 * 1024;

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt")) {
    return await file.text();
  }
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    const mammoth = await import("mammoth/mammoth.browser");
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value || "";
  }
  if (name.endsWith(".pdf")) {
    const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs");
    const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let out = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      out += content.items.map((it: any) => it.str).join(" ") + "\n\n";
    }
    return out;
  }
  throw new Error("Unsupported file type. Please upload PDF, DOCX, DOC, or TXT.");
}

function ResumeAuditPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MSGS[0]);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [preview, setPreview] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [waitState, setWaitState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [waitErr, setWaitErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) return;
    let i = 0;
    setLoadingMsg(LOADING_MSGS[0]);
    const t = setInterval(() => {
      i = (i + 1) % LOADING_MSGS.length;
      setLoadingMsg(LOADING_MSGS[i]);
    }, 1800);
    return () => clearInterval(t);
  }, [loading]);

  function pickFile(f: File | null) {
    setError(null);
    setAudit(null);
    if (!f) {
      setFile(null);
      return;
    }
    const ok = /\.(pdf|docx|doc|txt)$/i.test(f.name);
    if (!ok) {
      setError("Unsupported file type. Please upload PDF, DOCX, DOC, or TXT.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("File is too large. Maximum size is 10 MB.");
      return;
    }
    setFile(f);
  }

  async function runAudit() {
    // One Run action, one request: a second click while a run is in flight is
    // ignored so a stale response can never overwrite the final result.
    if (runningRef.current) return;
    setError(null);
    if (!file) {
      setError("Please upload your resume to continue.");
      return;
    }
    runningRef.current = true;
    setAudit(null);
    setLoading(true);
    try {
      let text = "";
      try {
        text = (await extractText(file)).replace(/\s+/g, " ").trim();
      } catch (e: any) {
        setError(e?.message || "Could not read this file. Try a different format.");
        setLoading(false);
        return;
      }
      if (text.length < 100) {
        setError("We could not extract enough text from this file. Try a different format.");
        setLoading(false);
        return;
      }
      if (text.length > 20000) text = text.slice(0, 20000);

      setPreview("");
      try {
        const data = await requestToolResult<Audit>({
          url: apiUrl("/api/resume-audit"),
          body: { resume: text },
          onPreview: setPreview,
        });
        setAudit(data);
      } catch (e) {
        setPreview("");
        setError(e instanceof ToolRequestError ? e.message : GENERIC_TOOL_ERROR);
      }
    } catch {
      setPreview("");
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function joinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setWaitErr(null);
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
      setWaitErr("Please enter a valid email address.");
      return;
    }
    setWaitState("submitting");
    try {
      const res = await fetch(apiUrl("/api/public/subscribe"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: v, source: "resume-audit" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setWaitState("done");
      } else {
        setWaitState("error");
        setWaitErr(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setWaitState("error");
      setWaitErr("Network error. Please try again.");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",

        background: BG,
        color: TEXT,
        fontFamily: "'Lato', Arial, sans-serif",
      }}
    >
      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          background: "rgba(255,255,255,0.97)",
          backdropFilter: "blur(20px)",
          borderBottom: `1px solid rgba(0,0,0,0.10)`,
        }}
      >
        <div
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            padding: "0 24px",
            height: 68,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <svg width="32" height="32" viewBox="0 0 88 88" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="raNavG" x1="0" y1="44" x2="88" y2="44" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#E5373A" />
                  <stop offset="45%" stopColor="#E5373A" />
                  <stop offset="55%" stopColor="#1DB954" />
                  <stop offset="100%" stopColor="#1DB954" />
                </linearGradient>
              </defs>
              <circle cx="44" cy="44" r="40" fill="#0D1829" stroke="url(#raNavG)" strokeWidth="2" />
              <line x1="22" y1="28" x2="44" y2="44" stroke="#E5373A" strokeWidth="5" strokeLinecap="round" />
              <line x1="22" y1="60" x2="44" y2="44" stroke="#E5373A" strokeWidth="5" strokeLinecap="round" />
              <line x1="44" y1="44" x2="56" y2="56" stroke="#1DB954" strokeWidth="5" strokeLinecap="round" />
              <line x1="56" y1="56" x2="72" y2="28" stroke="#1DB954" strokeWidth="5" strokeLinecap="round" />
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontFamily: "'Lato', sans-serif", fontSize: 26, fontWeight: 700, color: "#1DB954", letterSpacing: "-0.01em", lineHeight: 1 }}>
                Aplyer.ai
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "#E5373A", fontFamily: "'Lato', sans-serif" }}>
                Stop Skipping Jobs
              </span>
            </div>
          </a>
          <a
            href="/#waitlist-form"
            style={{
              background: "#1DB954",
              color: "#000",
              padding: "15px 36px",
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 700,
              textDecoration: "none",
              letterSpacing: "0.02em",
              fontFamily: "'Lato', sans-serif",
            }}
          >
            Join the Waitlist
          </a>
        </div>
      </header>

      <style>{`
        .ra-shell { max-width: ${audit ? 1180 : 820}px; }
        .ra-h1 { font-size: 44px; }
        .ra-grid { grid-template-columns: minmax(0, 1fr) 380px; }
        @media (max-width: 980px) {
          .ra-grid { grid-template-columns: minmax(0, 1fr); }
          .ra-aside { position: static !important; }
        }
        @media (max-width: 640px) {
          .ra-h1 { font-size: 32px; }
          .ra-shell { padding-left: 16px !important; padding-right: 16px !important; }
        }
      `}</style>

      <div
        className="ra-shell"
        style={{ width: "100%", margin: "0 auto", padding: "124px 20px 80px", flex: 1 }}
      >
        <h1
          className="ra-h1"
          style={{
            lineHeight: 1.12,
            color: NAVY,
            margin: "0 0 14px",
            fontWeight: 900,
            letterSpacing: -0.8,
          }}
        >
          Resume Red Flag Audit
        </h1>
        <p style={{ color: MUTED, fontSize: 19, lineHeight: 1.6, margin: "0 0 32px", maxWidth: 720 }}>
          A free tool. See what a recruiter spots in the first seven seconds, and how to fix it. No signup.
        </p>


        {!audit && (
          <>
            {!file ? (
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickFile(e.dataTransfer.files?.[0] ?? null);
                }}
                style={{
                  border: `2px dashed ${dragOver ? GREEN_DARK : GREEN}`,
                  background: dragOver ? "#ecfdf3" : SOFT,
                  borderRadius: 12,
                  padding: "48px 24px",
                  textAlign: "center",
                  cursor: "pointer",
                  color: TEXT,
                  fontSize: 16,
                  transition: "all .15s ease",
                }}
              >
                Drag your resume here, or click. PDF, DOCX, or TXT.
              </div>
            ) : (
              <div
                style={{
                  border: `1px solid ${BORDER}`,
                  background: SOFT,
                  borderRadius: 12,
                  padding: 20,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: "#ecfdf3",
                    color: GREEN_DARK,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 900,
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 12,
                  }}
                >
                  {file.name.split(".").pop()?.toUpperCase().slice(0, 4) || "DOC"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      color: NAVY,
                      fontSize: 15,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {file.name}
                  </div>
                  <div style={{ color: MUTED, fontSize: 13, marginTop: 2 }}>
                    {formatSize(file.size)}
                  </div>
                </div>
                <button
                  onClick={() => inputRef.current?.click()}
                  style={{
                    background: "transparent",
                    border: `1px solid ${BORDER}`,
                    color: NAVY,
                    padding: "8px 14px",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Replace
                </button>
                <button
                  onClick={() => pickFile(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: MUTED,
                    padding: "8px 4px",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              style={{ display: "none" }}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />

            {error && (
              <div
                style={{
                  marginTop: 16,
                  padding: "10px 12px",
                  background: "#fdecec",
                  color: "#9a1f1f",
                  borderRadius: 8,
                  fontSize: 14,
                }}
              >
                {error}
              </div>
            )}

            <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 14 }}>
              <button
                onClick={runAudit}
                disabled={loading || !file}
                style={{
                  background: loading || !file ? "#9bd9ad" : GREEN,
                  color: "white",
                  border: "none",
                  padding: "12px 22px",
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 800,
                  cursor: loading || !file ? "default" : "pointer",
                  fontFamily: "'Lato', Arial, sans-serif",
                  boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
                }}
              >
                {loading ? "Running..." : "Run my audit"}
              </button>
              {loading && <span style={{ color: MUTED, fontSize: 14 }}>{loadingMsg}</span>}
            </div>

            {loading && preview && (
              <div
                data-testid="audit-preview"
                style={{
                  marginTop: 20,
                  padding: "16px 18px",
                  background: SOFT,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 12,
                  color: TEXT,
                  fontSize: 16,
                  lineHeight: 1.65,
                  whiteSpace: "pre-wrap",
                }}
              >
                {preview}
                <span style={{ color: GREEN_DARK, fontWeight: 700 }}>▌</span>
              </div>
            )}

            <p style={{ marginTop: 28, color: MUTED, fontSize: 13, fontStyle: "italic" }}>
              Verified against HR hiring sources, including LinkedIn, Indeed, and Harvard Business Review.
            </p>
          </>
        )}

        {audit && (
          <section
            className="ra-grid"
            style={{
              marginTop: 12,
              display: "grid",
              gap: 32,
              alignItems: "start",
            }}
          >

            <div style={{ minWidth: 0 }}>
              <AuditResult audit={audit} />

              <div style={{ marginTop: 28 }}>
                <button
                  onClick={() => {
                    setAudit(null);
                    setFile(null);
                  }}
                  style={{
                    background: "transparent",
                    border: `1px solid ${BORDER}`,
                    color: NAVY,
                    padding: "12px 18px",
                    borderRadius: 8,
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Audit another resume
                </button>
              </div>
            </div>


            <aside
              className="ra-aside"
              style={{
                position: "sticky",
                top: 88,
                padding: 24,
                background: NAVY,
                color: "white",
                borderRadius: 12,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>
                Get early access to Aplyer
              </h3>
              <p style={{ margin: "8px 0 16px", color: "#cdd6e0", fontSize: 15, lineHeight: 1.5 }}>
                Aplyer writes your job application answers in your own voice. Join the waitlist
                for early access.
              </p>
              {waitState === "done" ? (
                <div
                  style={{
                    background: "rgba(34,197,94,0.18)",
                    color: "#b8e6c2",
                    padding: "10px 12px",
                    borderRadius: 8,
                    fontSize: 15,
                  }}
                >
                  You are on the list. We will be in touch soon.
                </div>
              ) : (
                <form
                  onSubmit={joinWaitlist}
                  style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                >
                  <input
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{
                      flex: "1 1 220px",
                      padding: "12px 14px",
                      borderRadius: 8,
                      border: "1px solid #2a3e5a",
                      background: "#0f2f50",
                      color: "white",
                      fontSize: 15,
                      outline: "none",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={waitState === "submitting"}
                    style={{
                      background: GREEN,
                      color: "white",
                      border: "none",
                      padding: "12px 20px",
                      borderRadius: 8,
                      fontSize: 15,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {waitState === "submitting" ? "Joining..." : "Join the waitlist"}
                  </button>
                </form>
              )}
              {waitErr && (
                <div style={{ marginTop: 10, color: "#ffb4b4", fontSize: 14 }}>{waitErr}</div>
              )}
            </aside>
          </section>
        )}
      </div>

      <footer style={{ borderTop: `1px solid ${BORDER}`, padding: "20px 24px" }}>
        <div
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#1DB954",
              letterSpacing: "0.08em",
              fontFamily: "'Lato', sans-serif",
            }}
          >
            Powered by WriteDNA Technology™
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <a href="#" style={{ fontSize: 13, color: "#333", textDecoration: "none", fontWeight: 400 }}>
              Privacy Policy
            </a>
            <a href="#" style={{ fontSize: 13, color: "#333", textDecoration: "none", fontWeight: 400 }}>
              Terms of Service
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}


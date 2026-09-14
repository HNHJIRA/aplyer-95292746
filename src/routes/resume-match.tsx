import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api-base";
import { requestToolResult, ToolRequestError, GENERIC_TOOL_ERROR } from "@/lib/tool-stream";

export const Route = createFileRoute("/resume-match")({
  head: () => ({
    meta: [
      { title: "Resume Score vs the Job | Aplyer" },
      {
        name: "description",
        content:
          "See how closely your resume matches a job description using AI-powered ATS and recruiter analysis.",
      },
      { property: "og:title", content: "Resume Score vs the Job | Aplyer" },
      {
        property: "og:description",
        content:
          "See how closely your resume matches a job description using AI-powered ATS and recruiter analysis.",
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
  component: ResumeMatchPage,
});

interface PriorityImprovement {
  priority: number;
  title: string;
  recommendation: string;
}
interface MatchReport {
  overallMatch: number;
  atsScore: number;
  keywordCoverage: number;
  summary: string;
  matchingSkills: string[];
  missingKeywords: string[];
  missingSkills: string[];
  strengths: string[];
  weaknesses: string[];
  priorityImprovements: PriorityImprovement[];
  interviewLikelihood: { rating: string; reason: string };
}

const NAVY = "#0a2540";
const GREEN = "#1DB954";
const GREEN_DARK = "#16a34a";
const RED = "#E5373A";
const AMBER = "#d97706";
const BG = "#ffffff";
const SOFT = "#f4f6f9";
const BORDER = "#e3e7ec";
const TEXT = "#1a2a3a";
const MUTED = "#5a6b7c";

const LOADING_MSGS = [
  "Reading your resume...",
  "Parsing the job description...",
  "Comparing keywords and skills...",
  "Running ATS evaluation...",
  "Building your match report...",
];

const ACCEPTED = ".pdf,.docx,.doc,.txt";
const MAX_BYTES = 10 * 1024 * 1024;
const MIN_JD = 100;

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs");
    const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let out = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out += content.items.map((it: any) => it.str).join(" ") + "\n\n";
    }
    return out;
  }
  throw new Error("Unsupported file type. Please upload PDF, DOCX, DOC, or TXT.");
}

function scoreColor(n: number) {
  if (n >= 75) return GREEN;
  if (n >= 50) return AMBER;
  return RED;
}

function ScoreCircle({ value, label }: { value: number; label: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 900;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setDisplay(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const size = 132;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * (display / 100);
  const color = scoreColor(value);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r} stroke={BORDER} strokeWidth={stroke} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke 0.3s" }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
          }}
        >
          <div style={{ fontSize: 32, fontWeight: 900, color: NAVY, lineHeight: 1 }}>{display}</div>
          <div style={{ fontSize: 11, color: MUTED, fontFamily: "'DM Mono', monospace", marginTop: 2 }}>
            / 100
          </div>
        </div>
      </div>
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: MUTED,
          textTransform: "uppercase",
          letterSpacing: 1.2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function Bar({ value, label }: { value: number; label: string }) {
  const color = scoreColor(value);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: MUTED, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 13, color: NAVY, fontWeight: 900 }}>{value}%</span>
      </div>
      <div style={{ height: 8, background: SOFT, borderRadius: 999, overflow: "hidden" }}>
        <div
          style={{
            width: `${value}%`,
            height: "100%",
            background: color,
            borderRadius: 999,
            transition: "width 900ms cubic-bezier(.2,.8,.2,1)",
          }}
        />
      </div>
    </div>
  );
}

function Chip({ text, tone }: { text: string; tone: "good" | "bad" }) {
  const good = tone === "good";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "6px 12px",
        borderRadius: 999,
        background: good ? "#ecfdf3" : "#fdecec",
        color: good ? "#0f6b35" : "#9a1f1f",
        border: `1px solid ${good ? "#bbe9c8" : "#f5c2c2"}`,
        fontSize: 13,
        fontWeight: 700,
        margin: "0 6px 6px 0",
      }}
    >
      {text}
    </span>
  );
}

function track(event: string, props?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  try {
    w.plausible?.(event, props ? { props } : undefined);
    w.gtag?.("event", event, props);
    w.dataLayer?.push?.({ event, ...(props || {}) });
  } catch {
    /* ignore */
  }
}

function ResumeMatchPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [jd, setJd] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MSGS[0]);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MatchReport | null>(null);
  const [preview, setPreview] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [waitState, setWaitState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [waitErr, setWaitErr] = useState<string | null>(null);

  useEffect(() => {
    track("resume_match_page_viewed");
  }, []);

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
    setReport(null);
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
    track("resume_match_resume_uploaded", { size: f.size });
  }

  async function runMatch() {
    setError(null);
    if (!file) {
      setError("Please upload your resume to continue.");
      return;
    }
    if (jd.trim().length < MIN_JD) {
      setError(`Please paste the full job description (at least ${MIN_JD} characters).`);
      return;
    }
    setReport(null);
    setLoading(true);
    track("resume_match_analysis_started");
    try {
      let text = "";
      try {
        text = (await extractText(file)).replace(/\s+/g, " ").trim();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not read this file. Try a different format.";
        setError(msg);
        setLoading(false);
        track("resume_match_analysis_failed", { reason: "extract" });
        return;
      }
      if (text.length < 100) {
        setError("We could not extract enough text from this file. Try a different format.");
        setLoading(false);
        track("resume_match_analysis_failed", { reason: "short_text" });
        return;
      }
      if (text.length > 20000) text = text.slice(0, 20000);

      setPreview("");
      try {
        const data = await requestToolResult<MatchReport>({
          url: apiUrl("/api/resume-match"),
          body: { resume: text, jobDescription: jd.trim() },
          onPreview: setPreview,
        });
        setReport(data);
        track("resume_match_analysis_completed", { overallMatch: data.overallMatch });
      } catch (e) {
        setPreview("");
        setError(e instanceof ToolRequestError ? e.message : GENERIC_TOOL_ERROR);
        track("resume_match_analysis_failed", { reason: "api" });
      }
    } catch {
      setPreview("");
      setError("Network error. Please try again.");
      track("resume_match_analysis_failed", { reason: "network" });
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
        body: JSON.stringify({ email: v, source: "resume-match" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setWaitState("done");
        track("resume_match_waitlist_joined");
      } else {
        setWaitState("error");
        setWaitErr(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setWaitState("error");
      setWaitErr("Network error. Please try again.");
    }
  }

  const canSubmit = !!file && jd.trim().length >= MIN_JD && !loading;

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
                <linearGradient id="rmNavG" x1="0" y1="44" x2="88" y2="44" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#E5373A" />
                  <stop offset="45%" stopColor="#E5373A" />
                  <stop offset="55%" stopColor="#1DB954" />
                  <stop offset="100%" stopColor="#1DB954" />
                </linearGradient>
              </defs>
              <circle cx="44" cy="44" r="40" fill="#0D1829" stroke="url(#rmNavG)" strokeWidth="2" />
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
              background: GREEN,
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

      <div style={{ maxWidth: report ? 1180 : 820, width: "100%", margin: "0 auto", padding: "124px 20px 80px", flex: 1 }}>

        <h1
          style={{
            fontSize: 40,
            lineHeight: 1.15,
            color: NAVY,
            margin: "0 0 12px",
            fontWeight: 900,
            letterSpacing: -0.5,
          }}
        >
          Resume Score vs the Job
        </h1>
        <p style={{ color: MUTED, fontSize: 17, lineHeight: 1.5, margin: "0 0 28px" }}>
          A free tool. See how your resume matches a job description, the way an ATS reads it. No signup.
        </p>

        {!report && (
          <>
            {/* Resume upload */}
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
                  <div style={{ color: MUTED, fontSize: 13, marginTop: 2 }}>{formatSize(file.size)}</div>
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

            {/* Job description */}
            <div style={{ marginTop: 24 }}>
              <label
                htmlFor="jd"
                style={{
                  display: "block",
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 12,
                  color: GREEN_DARK,
                  textTransform: "uppercase",
                  letterSpacing: 1.2,
                  marginBottom: 8,
                }}
              >
                Job Description
              </label>
              <textarea
                id="jd"
                value={jd}
                onChange={(e) => {
                  setJd(e.target.value);
                  if (e.target.value.trim().length >= MIN_JD) track("resume_match_jd_added");
                }}
                placeholder="Paste the full job description here..."
                rows={10}
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  border: `1px solid ${BORDER}`,
                  borderRadius: 12,
                  background: SOFT,
                  color: TEXT,
                  fontSize: 15,
                  lineHeight: 1.55,
                  fontFamily: "'Lato', Arial, sans-serif",
                  resize: "vertical",
                  outline: "none",
                }}
              />
              <div style={{ marginTop: 6, color: MUTED, fontSize: 13 }}>
                {jd.trim().length} / {MIN_JD} characters minimum
              </div>
            </div>

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
                onClick={runMatch}
                disabled={!canSubmit}
                style={{
                  background: !canSubmit ? "#9bd9ad" : GREEN,
                  color: "white",
                  border: "none",
                  padding: "12px 22px",
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 800,
                  cursor: !canSubmit ? "default" : "pointer",
                  fontFamily: "'Lato', Arial, sans-serif",
                  boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
                }}
              >
                {loading ? "Scoring..." : "Score my resume"}
              </button>
              {loading && <span style={{ color: MUTED, fontSize: 14 }}>{loadingMsg}</span>}
            </div>

            {loading && preview && (
              <div
                data-testid="match-preview"
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
              Modeled on how ATS systems and recruiters evaluate resumes for a specific role.
            </p>
          </>
        )}

        {report && (
          <section
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 400px",
              gap: 32,
              alignItems: "start",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 12,
                  color: GREEN_DARK,
                  textTransform: "uppercase",
                  letterSpacing: 1.2,
                  marginBottom: 8,
                }}
              >
                Your Match Report
              </div>

              {/* Score header card */}
              <div
                style={{
                  background: SOFT,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 14,
                  padding: 24,
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: 28,
                  alignItems: "center",
                }}
              >
                <ScoreCircle value={report.overallMatch} label="Overall Match" />
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <Bar value={report.atsScore} label="ATS Compatibility" />
                  <Bar value={report.keywordCoverage} label="Keyword Coverage" />
                </div>
              </div>

              {report.summary && (
                <p
                  style={{
                    marginTop: 18,
                    fontSize: 17,
                    lineHeight: 1.55,
                    color: TEXT,
                  }}
                >
                  {report.summary}
                </p>
              )}

              {/* Matching skills */}
              {(report.matchingSkills?.length ?? 0) > 0 && (
                <>
                  <h2 style={{ color: NAVY, fontSize: 22, margin: "28px 0 12px", fontWeight: 900 }}>
                    Matching Skills
                  </h2>
                  <div>
                    {report.matchingSkills?.map((s, i) => (
                      <Chip key={i} text={s} tone="good" />
                    ))}
                  </div>
                </>
              )}

              {/* Missing keywords */}
              {(report.missingKeywords?.length ?? 0) > 0 && (
                <>
                  <h2 style={{ color: NAVY, fontSize: 22, margin: "28px 0 12px", fontWeight: 900 }}>
                    Missing Keywords
                  </h2>
                  <div>
                    {report.missingKeywords?.map((s, i) => (
                      <Chip key={i} text={s} tone="bad" />
                    ))}
                  </div>
                </>
              )}

              {/* Missing skills */}
              {(report.missingSkills?.length ?? 0) > 0 && (
                <>
                  <h2 style={{ color: NAVY, fontSize: 22, margin: "28px 0 12px", fontWeight: 900 }}>
                    Missing Skills
                  </h2>
                  <div>
                    {report.missingSkills?.map((s, i) => (
                      <Chip key={i} text={s} tone="bad" />
                    ))}
                  </div>
                </>
              )}

              {/* Strengths */}
              {(report.strengths?.length ?? 0) > 0 && (
                <>
                  <h2 style={{ color: NAVY, fontSize: 22, margin: "28px 0 12px", fontWeight: 900 }}>
                    Strengths
                  </h2>
                  <ul style={{ paddingLeft: 20, margin: 0, color: TEXT, fontSize: 16, lineHeight: 1.6 }}>
                    {report.strengths?.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              )}

              {/* Weaknesses */}
              {(report.weaknesses?.length ?? 0) > 0 && (
                <>
                  <h2 style={{ color: NAVY, fontSize: 22, margin: "28px 0 12px", fontWeight: 900 }}>
                    Weaknesses
                  </h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {report.weaknesses?.map((w, i) => (
                      <div
                        key={i}
                        style={{
                          background: "#fff5f5",
                          border: `1px solid #f5c2c2`,
                          borderLeft: `4px solid ${RED}`,
                          borderRadius: 10,
                          padding: "12px 14px",
                          color: TEXT,
                          fontSize: 15,
                          lineHeight: 1.55,
                        }}
                      >
                        {w}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Priority improvements */}
              {(report.priorityImprovements?.length ?? 0) > 0 && (
                <>
                  <h2 style={{ color: NAVY, fontSize: 22, margin: "28px 0 12px", fontWeight: 900 }}>
                    Priority Improvements
                  </h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {report.priorityImprovements?.map((p, i) => (
                      <div
                        key={i}
                        style={{
                          background: BG,
                          border: `1px solid ${BORDER}`,
                          borderLeft: `4px solid ${GREEN}`,
                          borderRadius: 10,
                          padding: 16,
                        }}
                      >
                        <div
                          style={{
                            fontFamily: "'DM Mono', monospace",
                            fontSize: 11,
                            color: GREEN_DARK,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                            marginBottom: 6,
                          }}
                        >
                          Priority {p.priority || i + 1}
                        </div>
                        <div style={{ fontWeight: 700, color: NAVY, fontSize: 16, marginBottom: 6 }}>
                          {p.title}
                        </div>
                        <div style={{ color: TEXT, fontSize: 15, lineHeight: 1.55 }}>
                          {p.recommendation}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Job Description Match */}
              {(() => {
                const score = report.overallMatch ?? 0;
                let tier = "Low";
                let tierColor = RED;
                if (score >= 90) { tier = "Very High"; tierColor = GREEN; }
                else if (score >= 80) { tier = "High"; tierColor = GREEN; }
                else if (score >= 70) { tier = "Medium to High"; tierColor = GREEN; }
                else if (score >= 60) { tier = "Medium"; tierColor = AMBER; }
                else if (score >= 50) { tier = "Low to Medium"; tierColor = AMBER; }
                return (
                  <div
                    style={{
                      marginTop: 28,
                      padding: 18,
                      background: SOFT,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 12,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 11,
                        color: MUTED,
                        textTransform: "uppercase",
                        letterSpacing: 1.2,
                        marginBottom: 6,
                      }}
                    >
                      Job Description Match
                    </div>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 900,
                        color: tierColor,
                        marginBottom: 6,
                      }}
                    >
                      {tier}
                    </div>
                    {report.interviewLikelihood?.reason && (
                      <div style={{ color: TEXT, fontSize: 15, lineHeight: 1.55 }}>
                        {report.interviewLikelihood.reason}
                      </div>
                    )}
                    <div
                      style={{
                        marginTop: 10,
                        fontSize: 12,
                        color: MUTED,
                        fontStyle: "italic",
                        lineHeight: 1.5,
                      }}
                    >
                      This score reflects how closely your resume aligns with the job description. It does not guarantee an interview or hiring outcome.
                    </div>
                  </div>
                );
              })()}

              <div style={{ marginTop: 24 }}>
                <button
                  onClick={() => {
                    setReport(null);
                    setFile(null);
                    setJd("");
                  }}
                  style={{
                    background: "transparent",
                    border: `1px solid ${BORDER}`,
                    color: NAVY,
                    padding: "10px 16px",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Score another resume
                </button>
              </div>
            </div>

            <aside
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
                Aplyer writes your job application answers in your own voice. Join the waitlist for early access.
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
                <form onSubmit={joinWaitlist} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
              color: GREEN,
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


import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, FileText, Upload, CheckCircle2, AlertCircle, X } from "lucide-react";
import { Button } from "../ui/Button";
import { parseResume } from "@/lib/resume/parse";
import { scoreResume } from "@/lib/resume/score";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";
import { syncResumeToBackend } from "@/lib/extension/sync";

type UploadState = "idle" | "uploading" | "success" | "error";

export function ResumeUpload({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { state, update } = useAplyerStore();
  const [status, setStatus] = useState<UploadState>(state.resumeMetadata ? "success" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const meta = state.resumeMetadata;

  async function handleFile(file: File) {
    setError(null);
    const ok = /\.(pdf|docx|doc|txt)$/i.test(file.name);
    if (!ok) {
      setError("Use a PDF or DOCX file.");
      setStatus("error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File must be under 10 MB.");
      setStatus("error");
      return;
    }
    setStatus("uploading");
    try {
      const parsed = await parseResume(file);
      const score = scoreResume(parsed.text);
      const meta = {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || file.name.split(".").pop() || "",
        uploadedAt: new Date().toISOString(),
      };
      await update({
        resumeText: parsed.text,
        resumeMetadata: meta,
        resumeScore: score,
      });
      // best-effort backend sync (no-op if not signed in)
      try { await syncResumeToBackend(file, parsed.text, score, meta); } catch (e) { console.warn("[aplyer] resume sync", e); }
      setStatus("success");
    } catch {
      setError("Could not read this file.");
      setStatus("error");
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  async function removeFile() {
    await update({ resumeText: null, resumeMetadata: null, resumeScore: null });
    setStatus("idle");
  }

  return (
    <div className="flex h-full flex-col px-6 pt-2">
      <Header title="Upload Your Resume" subtitle="PDF or DOCX. Stored locally on your device." />

      <div className="flex-1">
        {status !== "success" ? (
          <motion.label
            htmlFor="resume-file"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`relative flex h-[200px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed bg-paper px-4 text-center transition-all ${
              dragOver ? "border-brand-green bg-brand-green/5" : status === "error" ? "border-brand-red/50" : "border-border hover:border-brand-green/40"
            }`}
          >
            <input
              ref={inputRef}
              id="resume-file"
              type="file"
              accept=".pdf,.docx,.doc,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/10 text-brand-green">
              {status === "uploading" ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : status === "error" ? (
                <AlertCircle className="h-6 w-6 text-brand-red" />
              ) : (
                <Upload className="h-6 w-6" />
              )}
            </div>
            <p className="mt-3 text-[13px] font-semibold text-foreground">
              {status === "uploading" ? "Reading your resume…" : status === "error" ? error : "Drop your resume here"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">or click to browse — PDF, DOCX up to 10 MB</p>
          </motion.label>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-brand-green/25 bg-brand-green/5 p-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-green/15 text-brand-green">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-brand-green" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-brand-green">Stored locally</span>
                </div>
                <p className="mt-1 truncate text-[13px] font-semibold text-foreground">{meta?.fileName}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {meta && formatSize(meta.fileSize)} · {meta && new Date(meta.uploadedAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={removeFile}
                className="rounded-md p-1 text-muted-foreground hover:bg-field hover:text-foreground"
                aria-label="Remove"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}

        <ul className="mt-5 space-y-2 text-[11px] text-muted-foreground">
          <li className="flex items-center gap-2"><Dot /> Your file never leaves this device.</li>
          <li className="flex items-center gap-2"><Dot /> Re-upload anytime to refresh your profile.</li>
          <li className="flex items-center gap-2"><Dot /> Used only when you choose to apply.</li>
        </ul>
      </div>

      <NavRow onBack={onBack} onNext={onNext} nextDisabled={status !== "success"} />
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[20px] font-black tracking-tight text-foreground">{title}</h2>
      <p className="mt-1 text-[12px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-brand-green/60" />;
}

function NavRow({ onBack, onNext, nextDisabled, nextLabel = "Continue" }: { onBack?: () => void; onNext: () => void; nextDisabled?: boolean; nextLabel?: string }) {
  return (
    <div className="mt-4 flex items-center gap-2 pb-1">
      {onBack && (
        <Button variant="ghost" size="md" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      )}
      <Button className="flex-1" size="md" onClick={onNext} disabled={nextDisabled}>
        {nextLabel} <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

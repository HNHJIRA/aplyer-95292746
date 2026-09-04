import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { FileText, Upload, CheckCircle2, AlertCircle, History, TrendingUp, Check, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { parseResume } from "@/lib/resume/parse";
import { scoreResume } from "@/lib/resume/score";
import { ProgressRing } from "@/components/extension/ui/ProgressRing";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/resume")({
  component: ResumePage,
});

async function fetchResumeData() {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user!.id;
  const [current, history, score] = await Promise.all([
    supabase.from("resumes").select("*").eq("user_id", uid).eq("is_current", true).order("uploaded_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("resumes").select("*").eq("user_id", uid).order("uploaded_at", { ascending: false }).limit(10),
    supabase.from("resume_scores").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { uid, current: current.data, history: history.data ?? [], score: score.data };
}

function ResumePage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["resume"], queryFn: fetchResumeData });
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!/\.(pdf|docx|doc|txt)$/i.test(file.name)) throw new Error("Use a PDF, DOCX, or TXT file.");
      if (file.size > 10 * 1024 * 1024) throw new Error("File must be under 10 MB.");
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;

      const parsed = await parseResume(file);
      const score = scoreResume(parsed.text);

      const ext = file.name.split(".").pop() || "pdf";
      const path = `${uid}/${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("resumes").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || `application/${ext}`,
      });
      if (upErr) throw upErr;

      // mark old as not current
      await supabase.from("resumes").update({ is_current: false }).eq("user_id", uid).eq("is_current", true);

      const version = (data?.history.length ?? 0) + 1;
      const { data: inserted, error: insErr } = await supabase
        .from("resumes")
        .insert({
          user_id: uid,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type || ext,
          storage_path: path,
          resume_text: parsed.text.slice(0, 200_000),
          version,
          is_current: true,
        })
        .select()
        .single();
      if (insErr) throw insErr;

      await supabase.from("resume_scores").insert({
        resume_id: inserted.id,
        user_id: uid,
        score: score.score,
        completeness: score.completeness,
        strength: score.strength,
        sections: score.sections,
        strengths: score.strengths,
        suggestions: score.suggestions,
      });
    },
    onSuccess: () => {
      toast.success("Resume uploaded and scored");
      qc.invalidateQueries({ queryKey: ["resume"] });
      qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const meta = data?.current;
  const score = data?.score;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[32px] font-black tracking-tight">Resume</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">Upload PDF or DOCX. We score it locally — your file is private.</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {meta ? (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-brand-green/25 bg-brand-green/5 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-green/15 text-brand-green">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-brand-green" />
                    <span className="font-mono text-[12px] uppercase tracking-[0.16em] text-brand-green">Current resume · v{meta.version}</span>
                  </div>
                  <p className="mt-1 truncate text-[16px] font-bold">{meta.file_name}</p>
                  <p className="mt-0.5 text-[14px] text-muted-foreground">
                    {formatSize(meta.file_size)} · uploaded {new Date(meta.uploaded_at).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => inputRef.current?.click()}
                  className="rounded-lg border border-border bg-paper px-3 py-2 text-[14px] hover:bg-field"
                >
                  Replace
                </button>
              </div>
            </motion.div>
          ) : (
            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false);
                const f = e.dataTransfer.files?.[0]; if (f) upload.mutate(f);
              }}
              className={`flex h-[180px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-paper text-center transition-all ${dragOver ? "border-brand-green bg-brand-green/5" : "border-border hover:border-brand-green/40"}`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/10 text-brand-green">
                {upload.isPending ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Upload className="h-6 w-6" />}
              </div>
              <p className="mt-3 text-[16px] font-semibold">{upload.isPending ? "Uploading…" : "Drop your resume here"}</p>
              <p className="mt-1 text-[14px] text-muted-foreground">PDF, DOCX up to 10 MB</p>
            </label>
          )}
          <input ref={inputRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} />

          {!isLoading && data && data.history.length > 1 && (
            <div className="mt-4 rounded-2xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-[16px] font-bold">Version history</h3>
              </div>
              <ul className="divide-y divide-border">
                {data.history.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2.5 text-[14px]">
                    <span className="truncate text-foreground">v{r.version} · {r.file_name}</span>
                    <span className="text-muted-foreground">{new Date(r.uploaded_at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-brand-green" />
            <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground">Readiness score</span>
          </div>
          {score ? (
            <div className="flex flex-col items-center">
              <ProgressRing value={score.score} label="Score" size={160} />
              <div className="mt-4 grid w-full grid-cols-2 gap-2">
                <Mini label="Complete" v={score.completeness} />
                <Mini label="Strength" v={score.strength} />
              </div>
            </div>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-center text-[14px] text-muted-foreground">
              Upload a resume to generate a score.
            </div>
          )}
        </div>
      </div>

      {score && (
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel title="Strengths" tone="green">
            {score.strengths.length === 0 && <Empty>Add core sections to unlock strengths.</Empty>}
            {score.strengths.map((s) => (
              <Row key={s}><Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-green" /><span>{s}</span></Row>
            ))}
          </Panel>
          <Panel title="Suggestions" tone="amber">
            {score.suggestions.length === 0 && <Empty>No suggestions right now.</Empty>}
            {score.suggestions.map((s) => (
              <Row key={s}><AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#E5B73A]" /><span>{s}</span></Row>
            ))}
          </Panel>
          <ScoreExplainer sections={(score.sections ?? {}) as Record<string, boolean>} />
        </div>
      )}

    </div>
  );
}

function Mini({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-lg border border-border bg-paper p-3 text-center">
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-[18px] font-black">{v}<span className="text-[12px] text-muted-foreground">/100</span></div>
    </div>
  );
}

/** Describes the actual deterministic scorer in src/lib/resume/score.ts. */
const SCORE_SECTIONS: { key: string; label: string; points: number }[] = [
  { key: "experience", label: "Experience", points: 22 },
  { key: "contact", label: "Contact information", points: 18 },
  { key: "skills", label: "Skills", points: 16 },
  { key: "education", label: "Education", points: 14 },
  { key: "summary", label: "Professional summary", points: 10 },
  { key: "certifications", label: "Certifications", points: 8 },
];

function ScoreExplainer({ sections }: { sections: Record<string, boolean> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground">How your score works</span>
      </div>
      <p className="text-[14px] text-sub">
        Your resume is scored on your device from the text in your file — nothing is sent anywhere to
        produce it. Six sections earn points when they're found, and two bonuses are added on top.
      </p>
      <ul className="mt-3 space-y-1.5">
        {SCORE_SECTIONS.map((s) => {
          const found = !!sections[s.key];
          return (
            <li key={s.key} className="flex items-center justify-between gap-2 text-[14px]">
              <span className="flex items-center gap-2">
                {found
                  ? <Check className="h-3.5 w-3.5 flex-shrink-0 text-brand-green" />
                  : <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full border border-border" />}
                <span className={found ? "text-sub" : "text-muted-foreground"}>{s.label}</span>
              </span>
              <span className="font-mono text-[12px] text-muted-foreground">+{s.points}</span>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 text-[13px] font-semibold text-brand-green"
      >
        {open ? "Hide details" : "Show the two bonuses"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-border pt-2 text-[13px] text-muted-foreground">
          <p><span className="text-sub">Length bonus — up to 12 points.</span> Longer, more detailed resumes earn more, one point per 600 characters.</p>
          <p><span className="text-sub">Quantified achievements — up to 8 points.</span> One point for each number or percentage found in your resume.</p>
          <p><span className="text-sub">Complete</span> is how many of the six sections were found. <span className="text-sub">Strength</span> combines your score with how many quantified achievements you included.</p>
        </div>
      )}
    </div>
  );
}


function Panel({ title, tone, children }: { title: string; tone: "green" | "amber"; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${tone === "green" ? "bg-brand-green" : "bg-[#E5B73A]"}`} />
        <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground">{title}</span>
      </div>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}
function Row({ children }: { children: React.ReactNode }) { return <li className="flex items-start gap-2 text-[15px] text-sub">{children}</li>; }
function Empty({ children }: { children: React.ReactNode }) { return <li className="text-[14px] text-muted-foreground">{children}</li>; }

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

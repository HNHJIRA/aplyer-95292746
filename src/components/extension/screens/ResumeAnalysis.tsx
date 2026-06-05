import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "../ui/Button";
import { ProgressRing } from "../ui/ProgressRing";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";

export function ResumeAnalysis({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { state } = useAplyerStore();
  const score = state.resumeScore;

  if (!score) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6">
        <p className="text-[13px] text-muted-foreground">No resume scored yet.</p>
        <Button className="mt-4" onClick={onBack}>Back</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-6 pt-2">
      <div className="mb-3">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-brand-green/25 bg-brand-green/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-brand-green">
          <Sparkles className="h-2.5 w-2.5" /> Resume Analysis
        </div>
        <h2 className="mt-2 text-[20px] font-black tracking-tight text-foreground">Resume Readiness</h2>
        <p className="text-[12px] text-muted-foreground">A snapshot of how your resume performs across ATS basics.</p>
      </div>

      <div className="popup-scroll -mx-6 flex-1 overflow-y-auto px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center justify-center rounded-xl border border-border bg-paper py-5"
        >
          <ProgressRing value={score.score} label="Readiness Score" size={140} />
        </motion.div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Metric label="Strength" value={score.strength} />
          <Metric label="Complete" value={score.completeness} />
        </div>

        <Section title="Strengths" tone="green">
          {score.strengths.length === 0 && <Empty>Add core resume sections to unlock strengths.</Empty>}
          {score.strengths.map((s) => (
            <Row key={s}>
              <Check className="h-3.5 w-3.5 text-brand-green" />
              <span>{s}</span>
            </Row>
          ))}
        </Section>

        <Section title="Suggestions" tone="amber">
          {score.suggestions.map((s) => (
            <Row key={s}>
              <TrendingUp className="h-3.5 w-3.5 text-[#E5B73A]" />
              <span>{s}</span>
            </Row>
          ))}
        </Section>
      </div>

      <div className="mt-3 flex items-center gap-2 pb-1">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button className="flex-1" onClick={onNext}>
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-border bg-paper p-3"
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-[20px] font-black text-foreground">{value}<span className="text-[11px] font-medium text-muted-foreground">/100</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="h-full rounded-full bg-brand-green"
        />
      </div>
    </motion.div>
  );
}

function Section({ title, tone, children }: { title: string; tone: "green" | "amber"; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${tone === "green" ? "bg-brand-green" : "bg-[#E5B73A]"}`} />
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{title}</span>
      </div>
      <div className="rounded-lg border border-border bg-paper p-3">
        <ul className="space-y-2">{children}</ul>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex items-start gap-2 text-[12px] text-sub">{children}</li>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="text-[12px] text-muted-foreground">{children}</li>;
}

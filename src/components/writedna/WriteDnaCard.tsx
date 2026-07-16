import { motion } from "framer-motion";
import { Sparkles, Lock, Unlock } from "lucide-react";
import type { WriteDnaState } from "@/lib/storage/types";
import { stageColor, stageLabel } from "@/lib/writedna";
import { ProgressRing } from "./ProgressRing";

export function WriteDnaCard({
  writeDna,
  onAddSample,
  compact = false,
}: {
  writeDna: WriteDnaState;
  onAddSample?: () => void;
  compact?: boolean;
}) {
  const color = stageColor(writeDna.stage);
  const label = stageLabel(writeDna.stage);
  const locked = writeDna.voiceCardStatus === "locked";
  const unlocked = writeDna.voiceCardStatus === "unlocked";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-paper px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          <Sparkles className="h-2.5 w-2.5" /> Write DNA
        </div>
        <div
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
          style={{ color, background: `${color}18` }}
        >
          {unlocked ? <Unlock className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
          {writeDna.voiceCardStatus}
        </div>
      </div>
      <div className={`mt-3 flex items-center gap-5 ${compact ? "" : "sm:gap-6"}`}>
        <ProgressRing
          value={writeDna.voiceConfidence}
          size={compact ? 110 : 132}
          color={color}
          label="Voice"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold tracking-tight">{label}</div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {locked && writeDna.resumeUploaded
              ? "Add one writing sample to unlock your Voice Card."
              : writeDna.voiceCardStatus === "unlocking"
                ? "You're one qualifying sample away from a Strong DNA."
                : unlocked
                  ? "Your Voice Card is ready. Aplyer will personalize using your tone."
                  : "Upload your resume first — it's the base layer of your DNA."}
          </p>
          <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
            <span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Resume</span>
              <span className="ml-2 text-foreground">{writeDna.resumeUploaded ? "✓" : "—"}</span>
            </span>
            <span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Samples</span>
              <span className="ml-2 text-foreground">{writeDna.writingSampleCount} / 2</span>
            </span>
          </div>
          {onAddSample && !unlocked && writeDna.resumeUploaded && (
            <button
              type="button"
              onClick={onAddSample}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 text-[12px] font-semibold text-[#06140A]"
            >
              Add writing sample
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

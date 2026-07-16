import { useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Plus, ShieldCheck } from "lucide-react";
import { Button } from "../ui/Button";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";
import {
  computeWriteDna,
  countQualifyingSamples,
  stageColor,
  stageLabel,
} from "@/lib/writedna";
import { ProgressRing } from "@/components/writedna/ProgressRing";

interface Props {
  onNext: () => void;
  onBack: () => void;
  onAddSample: () => void;
  onCelebrate: () => void;
}

export function WriteDnaProgress({ onNext, onBack, onAddSample, onCelebrate }: Props) {
  const { state, update } = useAplyerStore();
  const qualifying = countQualifyingSamples(state.writingSamples);
  const resumeUploaded = !!state.resumeMetadata;
  const dna = computeWriteDna({
    resumeUploaded,
    writingSampleCount: qualifying,
    resumeOnly: state.writeDna.resumeOnly,
    celebratedStrong: state.writeDna.celebratedStrong,
  });
  const color = stageColor(dna.stage);

  // Persist current DNA state and fire celebration when Strong is first reached.
  useEffect(() => {
    const nextPatch: Partial<typeof state.writeDna> = {
      voiceConfidence: dna.voiceConfidence,
      writingSampleCount: dna.writingSampleCount,
      resumeUploaded: dna.resumeUploaded,
      voiceCardStatus: dna.voiceCardStatus,
      stage: dna.stage,
    };
    void update({ writeDna: { ...state.writeDna, ...nextPatch } });
    if (dna.stage === "strong" && !state.writeDna.celebratedStrong) {
      onCelebrate();
    }
     
  }, [dna.voiceConfidence, dna.stage]);

  async function chooseResumeOnly() {
    await update({
      writeDna: { ...state.writeDna, resumeOnly: true },
    });
    onNext();
  }

  return (
    <div className="flex h-full flex-col px-6 pt-2">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-field px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          Write DNA
        </div>
        <h2 className="mt-2 text-[20px] font-black tracking-tight">{stageLabel(dna.stage)}</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          The more of your voice we learn, the more human your applications feel.
        </p>
      </div>

      <div className="popup-scroll -mx-6 flex-1 overflow-y-auto px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-4 flex flex-col items-center rounded-2xl border border-border bg-paper py-5"
        >
          <ProgressRing value={dna.voiceConfidence} size={148} color={color} label="Voice" />
          <div className="mt-3 text-[12px] text-muted-foreground">
            {dna.writingSampleCount} / 2 qualifying samples
          </div>
        </motion.div>

        <div className="mt-4 grid gap-2">
          <Step done={dna.resumeUploaded} label="Resume uploaded" />
          <Step done={dna.writingSampleCount >= 1} label="First qualifying sample (100+ chars, 30+ words)" />
          <Step done={dna.writingSampleCount >= 2} label="Second qualifying sample → Strong DNA" />
        </div>

        {dna.voiceCardStatus !== "unlocked" && (
          <button
            type="button"
            onClick={chooseResumeOnly}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-field px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ShieldCheck className="h-3 w-3" /> Continue with resume only
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 pb-1">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {dna.voiceCardStatus === "unlocked" ? (
          <Button className="flex-1" onClick={onNext}>
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button className="flex-1" onClick={onAddSample}>
            <Plus className="h-4 w-4" /> Add writing sample
          </Button>
        )}
      </div>
    </div>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-paper px-3 py-2 text-[12px]">
      <span
        className={`inline-block h-2 w-2 rounded-full ${done ? "bg-brand-green" : "bg-border"}`}
      />
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

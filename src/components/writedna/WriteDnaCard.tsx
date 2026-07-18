import { motion } from "framer-motion";
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { VoiceCardStatus, WriteDnaState } from "@/lib/storage/types";
import { stageColor, stageLabel, voiceCardStatusLabel } from "@/lib/writedna";
import { ProgressRing } from "./ProgressRing";
import {
  retryVoiceCard,
  startVoiceCardGeneration,
} from "@/lib/voicecard.functions";

function statusTone(status: VoiceCardStatus): string {
  switch (status) {
    case "generated":
      return "hsl(var(--brand-green, 142 76% 45%))";
    case "generating":
      return "#5DB0FF";
    case "eligible":
      return "#5DB0FF";
    case "failed":
      return "#E5737A";
    case "stale":
      return "#E5B73A";
    default:
      return "hsl(var(--muted-foreground))";
  }
}

export function WriteDnaCard({
  writeDna,
  onAddSample,
}: {
  writeDna: WriteDnaState;
  onAddSample?: () => void;
}) {
  const color = stageColor(writeDna.stage);
  const badgeColor = statusTone(writeDna.voiceCardStatus);
  const label = stageLabel(writeDna.stage);
  const status = writeDna.voiceCardStatus;
  const [busy, setBusy] = useState(false);
  const retry = useServerFn(retryVoiceCard);
  const start = useServerFn(startVoiceCardGeneration);

  async function handleRetry() {
    if (busy) return;
    setBusy(true);
    try {
      await retry();
      await start();
    } finally {
      setBusy(false);
      // Refresh dashboard queries.
      window.location.reload();
    }
  }

  async function handleRegenerate() {
    if (busy) return;
    setBusy(true);
    try {
      // retryVoiceCard resets stale/failed → eligible; start picks it up.
      await retry();
      await start();
    } finally {
      setBusy(false);
      window.location.reload();
    }
  }

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
          style={{ color: badgeColor, background: `${badgeColor}18` }}
        >
          {status === "generating" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
          {status === "failed" && <AlertTriangle className="h-2.5 w-2.5" />}
          {voiceCardStatusLabel(status)}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-5 sm:gap-6">
        <ProgressRing value={writeDna.voiceConfidence} size={132} color={color} label="Voice" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold tracking-tight">{label}</div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {statusCopy(writeDna)}
          </p>
          <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
            <span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Resume</span>
              <span className="ml-2 text-foreground">{writeDna.resumeUploaded ? "✓" : "—"}</span>
            </span>
            <span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Samples</span>
              <span className="ml-2 text-foreground">{writeDna.qualifyingProseCount} / 2</span>
            </span>
          </div>

          {onAddSample && (status === "locked" || status === "collecting_samples") && writeDna.resumeUploaded && (
            <button
              type="button"
              onClick={onAddSample}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 text-[12px] font-semibold text-[#06140A]"
            >
              Add writing sample
            </button>
          )}
          {status === "failed" && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={busy}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 text-[12px] font-semibold text-[#06140A] disabled:opacity-60"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          )}
          {status === "stale" && (
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={busy}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 text-[12px] font-semibold text-[#06140A] disabled:opacity-60"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate Voice Card
            </button>
          )}
        </div>
      </div>

      {status === "generated" && writeDna.voiceCard && (
        <StructuredVoiceCard card={writeDna.voiceCard} onRegenerate={handleRegenerate} busy={busy} />
      )}
      {status === "failed" && writeDna.voiceCardError && (
        <div className="mt-3 rounded-lg border border-[#E5737A]/30 bg-[#E5737A]/10 p-3 text-[11px] text-[#E5737A]">
          {writeDna.voiceCardError}
        </div>
      )}
    </motion.div>
  );
}

function statusCopy(w: WriteDnaState): string {
  switch (w.voiceCardStatus) {
    case "locked":
      return w.resumeUploaded
        ? "Add one qualifying writing sample to keep unlocking your Voice Card."
        : "Upload your resume first — it's the base layer of your DNA.";
    case "collecting_samples":
      return "One more qualifying sample and you'll be ready to generate your Voice Card.";
    case "eligible":
      return "You have enough writing. Your Voice Card is ready to generate.";
    case "generating":
      return "Analyzing your writing DNA with Claude Haiku 4.5.";
    case "generated":
      return "Your Voice Card is live. Aplyer personalizes answers using this tone.";
    case "failed":
      return "Generation didn't complete. You can retry safely.";
    case "stale":
      return "You added new writing — regenerate to refresh your Voice Card.";
    default:
      return "";
  }
}

function StructuredVoiceCard({
  card,
  onRegenerate,
  busy,
}: {
  card: NonNullable<WriteDnaState["voiceCard"]>;
  onRegenerate: () => void;
  busy: boolean;
}) {
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Headline
          </div>
          <div className="mt-0.5 text-[13px] font-semibold">{card.headline}</div>
        </div>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-paper px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          <RefreshCw className="h-3 w-3" /> Regenerate
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Metric label="Tone" value={card.tone} />
        <Metric label="Cadence" value={card.cadence} />
        <Metric label="Formality" value={card.formality} />
        <Metric label="Vocabulary" value={card.vocabulary_bias} />
      </div>
      <ChipRow label="Distinctive traits" items={card.distinctive_traits} />
      <ChipRow label="Hooks & transitions" items={card.hooks_and_transitions} />
      <ChipRow label="Values signals" items={card.values_signals} />
      <div className="grid gap-2 sm:grid-cols-2">
        <DoAvoid label="Do" items={card.do_and_avoid.do} tone="ok" />
        <DoAvoid label="Avoid" items={card.do_and_avoid.avoid} tone="warn" />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-paper px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[12px]">{value}</div>
    </div>
  );
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {items.map((it, i) => (
          <span key={i} className="rounded-full border border-border bg-paper px-2 py-0.5 text-[11px]">
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

function DoAvoid({ label, items, tone }: { label: string; items: string[]; tone: "ok" | "warn" }) {
  const border = tone === "ok" ? "border-brand-green/30" : "border-[#E5B73A]/30";
  const bg = tone === "ok" ? "bg-brand-green/5" : "bg-[#E5B73A]/5";
  return (
    <div className={`rounded-lg border ${border} ${bg} p-3`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11.5px]">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

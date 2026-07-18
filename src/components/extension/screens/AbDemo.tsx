import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "../ui/Button";
import {
  AB_DEMO_GENERIC,
  AB_DEMO_QUESTION,
  completeAbDemo,
  generateAbDemo,
} from "@/lib/voicecard.functions";

export function AbDemo({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withVoice, setWithVoice] = useState<string>("");
  const [reveal, setReveal] = useState(false);
  const gen = useServerFn(generateAbDemo);
  const complete = useServerFn(completeAbDemo);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = (await gen()) as { question: string; generic: string; withVoice: string };
      setWithVoice(r.withVoice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate demo");
    } finally {
      setLoading(false);
    }
  }, [gen]);

  useEffect(() => {
    void run();
  }, [run]);

  async function finish() {
    try {
      await complete();
    } catch {
      /* non-blocking */
    }
    onDone();
  }

  return (
    <div className="flex h-full flex-col px-6 pt-3">
      <div className="inline-flex items-center gap-1.5 self-start rounded-full border border-brand-green/25 bg-brand-green/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-brand-green">
        <Sparkles className="h-2.5 w-2.5" /> See your voice in action
      </div>
      <h2 className="mt-2 text-[20px] font-black tracking-tight">Generic AI vs. Your Voice</h2>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Same question. Two answers. Yours is written in your DNA.
      </p>

      <div className="popup-scroll -mx-6 mt-3 flex-1 space-y-3 overflow-y-auto px-6">
        <div className="rounded-xl border border-border bg-paper p-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Question
          </div>
          <div className="mt-1 text-[12.5px]">{AB_DEMO_QUESTION}</div>
        </div>

        <Card
          label="Generic AI"
          tone="muted"
          text={AB_DEMO_GENERIC}
        />

        {loading && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-paper p-3 text-[12px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Writing in your voice…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-[#E5B73A]/40 bg-[#E5B73A]/10 p-3 text-[12px]">
            <div className="font-semibold">Couldn't generate demo</div>
            <div className="mt-1 text-muted-foreground">{error}</div>
            <button
              type="button"
              onClick={run}
              className="mt-2 inline-flex items-center gap-1 rounded-md bg-brand-green px-2.5 py-1 text-[11px] font-semibold text-[#06140A]"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && withVoice && (
          <>
            {reveal ? (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card label="With Your Voice Card" tone="brand" text={withVoice} />
              </motion.div>
            ) : (
              <button
                type="button"
                onClick={() => setReveal(true)}
                className="w-full rounded-xl border border-dashed border-brand-green/40 bg-brand-green/5 p-3 text-[12px] font-semibold text-brand-green"
              >
                Reveal your version →
              </button>
            )}
          </>
        )}
      </div>

      <Button className="mb-1 mt-3 w-full" onClick={finish} disabled={loading}>
        Continue <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function Card({ label, text, tone }: { label: string; text: string; tone: "muted" | "brand" }) {
  const border = tone === "brand" ? "border-brand-green/40" : "border-border";
  const bg = tone === "brand" ? "bg-brand-green/5" : "bg-paper";
  const chip = tone === "brand" ? "text-brand-green" : "text-muted-foreground";
  return (
    <div className={`rounded-xl border ${border} ${bg} p-3`}>
      <div className={`font-mono text-[9px] uppercase tracking-[0.16em] ${chip}`}>{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed">{text}</div>
    </div>
  );
}

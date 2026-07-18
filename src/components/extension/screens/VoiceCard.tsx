import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "../ui/Button";
import { supabase } from "@/integrations/supabase/client";
import { hydrateFromBackend } from "@/lib/extension/sync";
import {
  getVoiceCardStateApi,
  retryVoiceCardApi,
  startVoiceCardGenerationApi,
} from "@/lib/extension/voicecard-api";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";

type Status =
  | "locked"
  | "collecting_samples"
  | "eligible"
  | "generating"
  | "generated"
  | "failed"
  | "stale"
  | "unlocking"
  | "unlocked";

interface VoiceCardData {
  headline: string;
  tone: string;
  cadence: string;
  formality: string;
  vocabulary_bias: string;
  distinctive_traits: string[];
  hooks_and_transitions: string[];
  values_signals: string[];
  do_and_avoid: { do: string[]; avoid: string[] };
}

export function VoiceCard({ onDone, onSkipToProfile }: { onDone: () => void; onSkipToProfile?: () => void }) {
  const [status, setStatus] = useState<Status>("eligible");
  const [card, setCard] = useState<VoiceCardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);
  const { state } = useAplyerStore();

  const refresh = useCallback(async () => {
    const p = (await getVoiceCardStateApi()) as {
      voice_card_status: Status;
      voice_card_data: VoiceCardData | null;
      voice_card_error: string | null;
    } | null;
    if (!p) return;
    setStatus(p.voice_card_status);
    setCard(p.voice_card_data);
    setError(p.voice_card_error);
  }, []);

  const beginGeneration = useCallback(async () => {
    if (startedRef.current || busy) return;
    startedRef.current = true;
    setBusy(true);
    setStatus("generating");
    try {
      const res = (await startVoiceCardGenerationApi()) as
        | { status: "generated"; voice_card: VoiceCardData }
        | { status: "in_progress" }
        | { status: "failed"; error?: string };
      if (res.status === "generated") {
        setStatus("generated");
        setCard(res.voice_card);
      } else if (res.status === "failed") {
        setStatus("failed");
        setError(res.error ?? "Generation failed");
      } else {
        await refresh();
      }
    } catch (e) {
      setStatus("failed");
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(false);
      // Mirror final state to local extension storage.
      try {
        await hydrateFromBackend();
      } catch {
        /* ignore */
      }
    }
  }, [busy, refresh]);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
     
  }, []);

  useEffect(() => {
    if ((status === "eligible" || status === "stale") && !startedRef.current) {
      void beginGeneration();
    }
    if (status === "generating") {
      // Poll every 3s until settled.
      const t = setInterval(refresh, 3000);
      return () => clearInterval(t);
    }
  }, [status, beginGeneration, refresh]);

  async function handleRetry() {
    setBusy(true);
    setError(null);
    try {
      await retryVoiceCardApi();
      startedRef.current = false;
      await beginGeneration();
    } finally {
      setBusy(false);
    }
  }

  // Also mark celebration true so returning users don't retrigger animations.
  useEffect(() => {
    if (status === "generated" && !state.writeDna.celebratedStrong) {
      void (async () => {
        const { data: u } = await supabase.auth.getUser();
        if (u.user) {
          await supabase.from("profiles").update({ celebrated_strong: true }).eq("id", u.user.id);
        }
      })();
    }
  }, [status, state.writeDna.celebratedStrong]);

  if (status === "generating") {
    return (
      <Center>
        <Loader2 className="h-10 w-10 animate-spin text-brand-green" />
        <h2 className="mt-4 text-[20px] font-black tracking-tight">Generating your Voice Card…</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">Analyzing your writing DNA with Claude Haiku 4.5.</p>
      </Center>
    );
  }

  if (status === "failed") {
    return (
      <Center>
        <AlertTriangle className="h-10 w-10 text-[#E5B73A]" />
        <h2 className="mt-4 text-[20px] font-black tracking-tight">Generation failed</h2>
        <p className="mt-1 max-w-[300px] text-[12px] text-muted-foreground">
          {error ?? "Something went wrong."}
        </p>
        <Button className="mt-6 w-full" onClick={handleRetry} disabled={busy}>
          <RefreshCw className="h-4 w-4" /> Try again
        </Button>
        {onSkipToProfile && (
          <button
            type="button"
            onClick={onSkipToProfile}
            className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Continue with resume only
          </button>
        )}
      </Center>
    );
  }

  if (status === "generated" && card) {
    return (
      <div className="flex h-full flex-col px-6 pt-3">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-brand-green/25 bg-brand-green/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-brand-green self-start">
          <Sparkles className="h-2.5 w-2.5" /> Voice Card Ready
        </div>
        <h2 className="mt-2 text-[20px] font-black tracking-tight">{card.headline}</h2>
        <div className="popup-scroll -mx-6 mt-3 flex-1 space-y-3 overflow-y-auto px-6 pb-3">
          <Row label="Tone" value={card.tone} />
          <Row label="Cadence" value={card.cadence} />
          <Row label="Formality" value={card.formality} />
          <Row label="Vocabulary" value={card.vocabulary_bias} />
          <Chips label="Distinctive traits" items={card.distinctive_traits} />
          <Chips label="Hooks & transitions" items={card.hooks_and_transitions} />
          <Chips label="Values signals" items={card.values_signals} />
          <div className="rounded-xl border border-border bg-paper p-3 text-[11px]">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Do</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {card.do_and_avoid.do.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
            <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Avoid</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {card.do_and_avoid.avoid.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
        </div>
        <Button className="mb-1 w-full" onClick={onDone}>
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // Fallback (locked/collecting_samples/unlocking/etc — shouldn't reach here from PopupApp).
  return (
    <Center>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Sparkles className="h-8 w-8 text-brand-green" />
      </motion.div>
      <p className="mt-3 text-[13px] text-muted-foreground">Preparing your Voice Card…</p>
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">{children}</div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-paper px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[12px]">{value}</div>
    </div>
  );
}

function Chips({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {items.map((it, i) => (
          <span key={i} className="rounded-full border border-border bg-paper px-2 py-0.5 text-[10.5px]">
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "../ui/Button";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";
import { Confetti } from "@/components/writedna/Confetti";
import { ProgressRing } from "@/components/writedna/ProgressRing";
import { stageColor } from "@/lib/writedna";
import { supabase } from "@/integrations/supabase/client";

export function VoiceCard({ onDone }: { onDone: () => void }) {
  const { state, update } = useAplyerStore();

  useEffect(() => {
    if (!state.writeDna.celebratedStrong) {
      void update({ writeDna: { ...state.writeDna, celebratedStrong: true } });
      void (async () => {
        const { data: u } = await supabase.auth.getUser();
        if (u.user) {
          await supabase
            .from("profiles")
            .update({ celebrated_strong: true })
            .eq("id", u.user.id);
        }
      })();
    }
     
  }, []);

  const color = stageColor("strong");

  return (
    <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
      <Confetti />
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 18 }}
      >
        <ProgressRing value={100} size={168} color={color} label="Strong" />
      </motion.div>

      <div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-brand-green/25 bg-brand-green/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-brand-green">
        <Sparkles className="h-2.5 w-2.5" /> Voice Card Ready
      </div>
      <h2 className="mt-3 text-[22px] font-black tracking-tight">
        Voice Card Ready
      </h2>
      <p className="mt-1 max-w-[300px] text-[12px] text-muted-foreground">
        You have provided enough writing to generate your Voice Card in the next phase.
      </p>

      <Button className="mt-6 w-full" onClick={onDone}>
        Continue <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

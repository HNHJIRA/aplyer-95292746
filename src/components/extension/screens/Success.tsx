import { motion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";
import { Button } from "../ui/Button";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";

export function Success({ onDone }: { onDone: () => void }) {
  const { state } = useAplyerStore();
  const skipped = state.onboardingStatus.skippedWritingSamples;

  return (
    <div className="relative flex h-full flex-col">
      <div className="brand-glow absolute inset-0 -z-0 opacity-80" />
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-7 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className="relative flex h-24 w-24 items-center justify-center"
        >
          <motion.span
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="absolute inset-0 rounded-full bg-brand-green/30"
          />
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-green text-white shadow-[0_10px_40px_-10px_rgba(29,185,84,0.8)]">
            <Check className="h-12 w-12" strokeWidth={3} />
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="mt-7 text-[26px] font-black tracking-tight"
        >
          You&apos;re Ready.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mt-2 text-[15px] text-sub"
        >
          Aplyer is now prepared to assist you when you visit supported job applications.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="mt-6 w-full space-y-2"
        >
          <Row ok>Resume Uploaded</Row>
          <Row ok={!skipped}>{skipped ? "Writing Samples Skipped" : "Writing Samples Saved"}</Row>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55 }}
        className="relative z-10 px-6 pb-6"
      >
        <Button size="lg" className="w-full" onClick={onDone}>
          <Sparkles className="h-4 w-4" /> Go To Dashboard
        </Button>
      </motion.div>
    </div>
  );
}

function Row({ children, ok = true }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-paper px-3 py-2.5">
      <span className="text-[14px] text-foreground">{children}</span>
      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${ok ? "bg-brand-green/20 text-brand-green" : "bg-field text-muted-foreground"}`}>
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    </div>
  );
}

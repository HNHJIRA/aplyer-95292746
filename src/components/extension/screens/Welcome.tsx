import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { LogoMark } from "../Logo";
import { Button } from "../ui/Button";

export function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="relative flex h-full flex-col">
      <div className="brand-glow absolute inset-0 -z-0 opacity-70" />
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-7 pt-4 text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
        >
          <LogoMark size={84} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-brand-green/25 bg-brand-green/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-brand-green"
        >
          <Sparkles className="h-3 w-3" /> Aplyer for Chrome
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="mt-5 text-[28px] font-black leading-[1.1] tracking-tight text-foreground"
        >
          Stop Skipping <span className="text-brand-green">Jobs.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mt-3 text-[15px] leading-relaxed text-sub"
        >
          Apply and sound like yourself on every application.
        </motion.p>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="mt-3 text-[13px] leading-relaxed text-muted-foreground"
        >
          Upload your resume once and let Aplyer assist you across supported job applications.
        </motion.p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55 }}
        className="relative z-10 flex flex-col gap-3 px-6 pb-6"
      >
        <Button size="lg" onClick={onNext} className="w-full">
          Get Started <ArrowRight className="h-4 w-4" />
        </Button>
        <div className="flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <Dot /> Workday <Dot /> Greenhouse <Dot /> Lever
        </div>
      </motion.div>
    </div>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-brand-green/60" />;
}

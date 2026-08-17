import { motion } from "framer-motion";
import { ArrowRight, Lock, RefreshCw } from "lucide-react";
import { LogoMark } from "../Logo";
import { Button } from "../ui/Button";

export function SignIn({
  onSignIn,
  onRefresh,
  checking,
}: {
  onSignIn: () => void;
  onRefresh: () => void;
  checking?: boolean;
}) {
  return (
    <div className="relative flex h-full flex-col">
      <div className="brand-glow absolute inset-0 -z-0 opacity-70" />
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-7 text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
        >
          <LogoMark size={72} />
        </motion.div>

        <div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-brand-green/25 bg-brand-green/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-brand-green">
          <Lock className="h-3 w-3" /> Sign in required
        </div>

        <h1 className="mt-4 text-[24px] font-black leading-tight tracking-tight text-foreground">
          Connect your <span className="text-brand-green">Aplyer</span> account
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-sub">
          Sign in once on the web. Your resume, profile, and writing samples
          stay synced across devices.
        </p>
      </div>

      <div className="relative z-10 flex flex-col gap-2 px-6 pb-6">
        <Button size="lg" onClick={onSignIn} className="w-full">
          Sign in with Aplyer <ArrowRight className="h-4 w-4" />
        </Button>
        <button
          onClick={onRefresh}
          disabled={checking}
          className="inline-flex items-center justify-center gap-1.5 py-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Checking…" : "I've signed in — check again"}
        </button>
      </div>
    </div>
  );
}

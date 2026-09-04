import { motion } from "framer-motion";
import {
  FileText,
  User,
  PenLine,
  Settings as SettingsIcon,
  Sparkles,
  Crown,
  ChevronRight,
  RefreshCcw,
  Upload,
} from "lucide-react";
import { LogoMark } from "../Logo";
import { Button } from "../ui/Button";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";
import { openWebPath } from "@/lib/extension/runtime";

const PLATFORMS = [
  { name: "Greenhouse", color: "#1DB954" },
  { name: "Lever", color: "#E5373A" },
  { name: "Workday", color: "#3B82F6" },
];

export function Dashboard({ onResume, onProfile, onSettings }: { onResume: () => void; onProfile: () => void; onSettings?: () => void }) {
  const openSettings = onSettings ?? (() => openWebPath("/dashboard/settings"));

  const openSubscription = () => openWebPath("/dashboard/subscription");
  const { state } = useAplyerStore();
  const profileFields = state.profile ? Object.values(state.profile).filter(Boolean).length : 0;
  const profilePct = Math.round((profileFields / 7) * 100);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-paper/60 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <LogoMark size={28} />
          <div className="leading-none">
            <p className="text-[15px] font-bold text-brand-green">Aplyer.ai</p>
            <p className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.16em] text-brand-red">Stop Skipping Jobs</p>
          </div>
        </div>
        <button
          onClick={openSettings}
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-field hover:text-foreground"
          aria-label="Settings"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="popup-scroll flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
        {/* 1. Connection / account */}
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-green/25 bg-brand-green/5 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-green" />
            <span className="truncate text-[13px] font-semibold text-brand-green">Connected</span>
            <span className="truncate text-[12px] text-muted-foreground">{state.profile?.email || "Signed in"}</span>
          </span>
        </div>

        {/* 2. Resume status */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-xl border border-border bg-paper p-3"
        >
          <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center">
            <svg className="-rotate-90" width={48} height={48}>
              <circle cx={24} cy={24} r={20} stroke="rgba(0,0,0,0.08)" strokeWidth={5} fill="none" />
              <motion.circle
                cx={24}
                cy={24}
                r={20}
                stroke="#1DB954"
                strokeWidth={5}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 20}
                initial={{ strokeDashoffset: 2 * Math.PI * 20 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 20 * (1 - (state.resumeScore?.score ?? 0) / 100) }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </svg>
            <span className="absolute text-[13px] font-black">{state.resumeScore?.score ?? 0}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand-green">Resume</p>
            <p className="truncate text-[14px] font-bold leading-tight">
              {state.resumeMetadata?.fileName ?? "No resume on file"}
            </p>
            <p className="truncate text-[12px] text-muted-foreground">{getReadinessLabel(state.resumeScore?.score ?? 0)}</p>
          </div>
          <button
            onClick={onResume}
            className="flex-shrink-0 rounded-md border border-border bg-field px-2.5 py-1.5 text-[12px] font-semibold hover:border-brand-green/30"
          >
            {state.resumeMetadata ? "Replace" : "Upload"}
          </button>
        </motion.div>

        {/* 3. What Aplyer can do here + primary action */}
        <div className="rounded-xl border border-border bg-paper p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">On job pages</div>
          <p className="mt-1 text-[13px] leading-snug text-foreground">
            Open a job application on a supported site and Aplyer's side panel appears — use{" "}
            <span className="font-semibold">Autofill All</span> for your details and{" "}
            <span className="font-semibold">Generate Answer</span> for written questions.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <span key={p.name} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-field px-2 py-0.5 text-[12px]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
                {p.name}
              </span>
            ))}
          </div>
        </div>

        <Button size="sm" className="w-full" onClick={() => openWebPath("/dashboard")}>
          Open Aplyer dashboard
        </Button>

        {/* 4. Current state */}
        <div className="grid grid-cols-3 gap-2">
          <StatusCard icon={<User className="h-4 w-4" />} label="Profile" value={`${profilePct}%`} ok={profilePct >= 80} onClick={onProfile} />
          <StatusCard icon={<PenLine className="h-4 w-4" />} label="Samples" value={`${state.writingSamples.length}`} ok={state.writingSamples.length > 0} />
          <StatusCard icon={<Crown className="h-4 w-4" />} label="Plan" value={state.subscriptionStatus.tier.toUpperCase()} ok onClick={openSubscription} />
        </div>

        {/* 5. Secondary actions */}
        <div className="rounded-xl border border-border bg-paper p-2.5">
          <div className="space-y-1.5">
            <QuickAction icon={<Upload className="h-4 w-4" />} label="Re-upload resume" onClick={onResume} />
            <QuickAction icon={<User className="h-4 w-4" />} label="Edit profile" onClick={onProfile} />
            <QuickAction icon={<RefreshCcw className="h-4 w-4" />} label="Re-run resume analysis" onClick={onResume} />
            <QuickAction icon={<SettingsIcon className="h-4 w-4" />} label="Settings" onClick={openSettings} />
          </div>
        </div>

        {/* Pro upsell */}
        {state.subscriptionStatus.tier === "free" && (
          <div className="rounded-xl border border-brand-red/30 bg-gradient-to-br from-[#1a0e10] to-paper p-3">
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-red/15 text-brand-red">
                <Crown className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold">Aplyer Pro — $29 / month</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">AI answer generation, Voice Card and Autofill All.</p>
              </div>
            </div>
            <Button size="sm" className="mt-2 w-full" onClick={openSubscription}>See plans</Button>
          </div>
        )}
      </div>

    </div>
  );
}

function getReadinessLabel(score: number) {
  if (score >= 85) return "Excellent — ready to apply";
  if (score >= 65) return "Solid — minor improvements";
  if (score >= 40) return "Needs work — fix the basics";
  if (score > 0) return "Limited — add core sections";
  return "Upload a resume to begin";
}

function StatusCard({ icon, label, value, ok, onClick }: { icon: React.ReactNode; label: string; value: string; ok: boolean; onClick?: () => void }) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      onClick={onClick}
      className="flex flex-col gap-1.5 rounded-xl border border-border bg-paper p-3 text-left transition hover:border-brand-green/30"
    >
      <div className="flex items-center justify-between">
        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${ok ? "bg-brand-green/10 text-brand-green" : "bg-brand-red/10 text-brand-red"}`}>
          {icon}
        </span>
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-brand-green" : "bg-brand-red"}`} />
      </div>
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-[16px] font-bold">{value}</p>
      </div>
    </motion.button>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg border border-transparent bg-field px-3 py-2 text-left transition hover:border-brand-green/20 hover:bg-field-2"
    >
      <span className="flex items-center gap-2.5 text-[14px] text-foreground">
        <span className="text-brand-green">{icon}</span>
        {label}
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}

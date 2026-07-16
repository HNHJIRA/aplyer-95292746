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
            <p className="text-[13px] font-bold text-brand-green">Aplyer.ai</p>
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

      <div className="popup-scroll flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {/* Hero score card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-xl border border-brand-green/20 bg-gradient-to-br from-paper to-field p-4"
        >
          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-green/10 blur-2xl" />
          <div className="relative flex items-center gap-4">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <svg className="-rotate-90" width={64} height={64}>
                <circle cx={32} cy={32} r={28} stroke="rgba(255,255,255,0.06)" strokeWidth={6} fill="none" />
                <motion.circle
                  cx={32}
                  cy={32}
                  r={28}
                  stroke="#1DB954"
                  strokeWidth={6}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 28}
                  initial={{ strokeDashoffset: 2 * Math.PI * 28 }}
                  animate={{ strokeDashoffset: 2 * Math.PI * 28 * (1 - (state.resumeScore?.score ?? 0) / 100) }}
                  transition={{ duration: 1, ease: "easeOut" }}
                />
              </svg>
              <span className="absolute text-[16px] font-black">{state.resumeScore?.score ?? 0}</span>
            </div>
            <div className="flex-1">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-brand-green">Resume Readiness</p>
              <p className="mt-0.5 text-[14px] font-bold leading-tight">{getReadinessLabel(state.resumeScore?.score ?? 0)}</p>
              <p className="text-[11px] text-muted-foreground">{state.resumeMetadata?.fileName ?? "No resume on file"}</p>
            </div>
          </div>
        </motion.div>

        {/* Status grid */}
        <div className="grid grid-cols-2 gap-2">
          <StatusCard icon={<FileText className="h-4 w-4" />} label="Resume" value={state.resumeMetadata ? "Active" : "Missing"} ok={!!state.resumeMetadata} onClick={onResume} />
          <StatusCard icon={<User className="h-4 w-4" />} label="Profile" value={`${profilePct}%`} ok={profilePct >= 80} onClick={onProfile} />
          <StatusCard icon={<PenLine className="h-4 w-4" />} label="Samples" value={`${state.writingSamples.length}`} ok={state.writingSamples.length > 0} />
          <StatusCard icon={<Crown className="h-4 w-4" />} label="Plan" value={state.subscriptionStatus.tier.toUpperCase()} ok onClick={openSubscription} />
        </div>

        {/* Supported platforms */}
        <div className="rounded-xl border border-border bg-paper p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Supported Platforms</span>
            <span className="font-mono text-[9px] text-brand-green">Ready</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <span key={p.name} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-field px-2 py-1 text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
                {p.name}
              </span>
            ))}
          </div>
        </div>

        {/* Quick actions */}
        <div className="rounded-xl border border-border bg-paper p-3">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Quick Actions</div>
          <div className="space-y-1.5">
            <QuickAction icon={<Upload className="h-4 w-4" />} label="Re-upload Resume" onClick={onResume} />
            <QuickAction icon={<User className="h-4 w-4" />} label="Edit Profile" onClick={onProfile} />
            <QuickAction icon={<RefreshCcw className="h-4 w-4" />} label="Re-run Resume Analysis" onClick={onResume} />
            
          </div>
        </div>

        {/* Pro upsell */}
        {state.subscriptionStatus.tier === "free" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-xl border border-brand-red/30 bg-gradient-to-br from-[#1a0e10] to-paper p-3"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-red/15 text-brand-red">
                <Crown className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-bold">Unlock Aplyer Pro</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Unlimited apps, advanced AI models, priority support.</p>
              </div>
            </div>
            <Button size="sm" className="mt-2.5 w-full" onClick={openSubscription}>Upgrade</Button>
          </motion.div>
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
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-[14px] font-bold">{value}</p>
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
      <span className="flex items-center gap-2.5 text-[12px] text-foreground">
        <span className="text-brand-green">{icon}</span>
        {label}
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}

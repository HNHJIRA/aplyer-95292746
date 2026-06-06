import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  FileText,
  User as UserIcon,
  BookOpen,
  TrendingUp,
  Chrome,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  component: DashboardHome,
});

async function fetchOverview() {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user!.id;
  const [profile, resume, score, samples, subscription] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
    supabase
      .from("resumes")
      .select("*")
      .eq("user_id", uid)
      .eq("is_current", true)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("resume_scores")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("writing_samples").select("id", { count: "exact", head: true }).eq("user_id", uid),
    supabase.from("subscriptions").select("*").eq("user_id", uid).maybeSingle(),
  ]);
  return {
    user: userData.user!,
    profile: profile.data,
    resume: resume.data,
    score: score.data,
    samplesCount: samples.count ?? 0,
    subscription: subscription.data,
  };
}

function DashboardHome() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard-overview"], queryFn: fetchOverview });

  if (isLoading || !data) {
    return <div className="space-y-3"><Skeleton h={28} w={260} /><Skeleton h={120} /><Skeleton h={180} /></div>;
  }

  const fullName = [data.profile?.first_name, data.profile?.last_name].filter(Boolean).join(" ");
  const firstName = data.profile?.first_name || data.user.email?.split("@")[0] || "there";

  const profileFields = ["first_name", "last_name", "phone", "location", "linkedin"] as const;
  const completed = profileFields.filter((k) => data.profile?.[k]).length;
  const profileCompletion = Math.round((completed / profileFields.length) * 100);

  const steps = [
    { done: !!data.profile?.first_name, label: "Create account" },
    { done: !!data.resume, label: "Upload resume" },
    { done: profileCompletion >= 80, label: "Complete profile" },
    { done: data.samplesCount > 0, label: "Add writing samples" },
  ];

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-brand-green/25 bg-brand-green/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-brand-green">
          <Sparkles className="h-2.5 w-2.5" /> Welcome back
        </div>
        <h1 className="mt-3 text-[28px] font-black tracking-tight">
          Hey {firstName}, ready to apply faster?
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Aplyer is set up to assist you on Workday, Greenhouse, and Lever.
        </p>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Resume" value={data.resume ? "Uploaded" : "Missing"} icon={<FileText className="h-4 w-4" />} tone={data.resume ? "green" : "muted"} />
        <Stat label="Resume score" value={data.score ? `${data.score.score}/100` : "—"} icon={<TrendingUp className="h-4 w-4" />} tone={data.score ? "green" : "muted"} />
        <Stat label="Profile" value={`${profileCompletion}%`} icon={<UserIcon className="h-4 w-4" />} tone={profileCompletion >= 80 ? "green" : "amber"} />
        <Stat label="Writing samples" value={String(data.samplesCount)} icon={<BookOpen className="h-4 w-4" />} tone={data.samplesCount > 0 ? "green" : "muted"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[17px] font-bold tracking-tight">Setup checklist</h2>
              <p className="text-[12px] text-muted-foreground">Complete these to unlock full autofill power.</p>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {steps.filter((s) => s.done).length} / {steps.length}
            </span>
          </div>
          <ul className="mt-4 space-y-2.5">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3 rounded-lg border border-border bg-paper px-4 py-3">
                {s.done ? (
                  <CheckCircle2 className="h-4 w-4 text-brand-green" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={`text-[13px] ${s.done ? "text-foreground" : "text-sub"}`}>{s.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-brand-green/25 bg-gradient-to-br from-brand-green/15 to-transparent p-6">
          <Chrome className="h-6 w-6 text-brand-green" />
          <h3 className="mt-3 text-[16px] font-bold tracking-tight">Install Chrome extension</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Run Aplyer on any careers page. Sync your dashboard data automatically.
          </p>
          <a
            href="/aplyer-extension.zip"
            download
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-green px-3.5 py-2.5 text-[12px] font-semibold text-[#06140A]"
          >
            Download extension <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <QuickAction href="/dashboard/resume" title="Update your resume" desc="Upload a new version, refresh your score." />
        <QuickAction href="/dashboard/profile" title="Finish your profile" desc="Used to autofill applications instantly." />
      </div>

      {fullName && (
        <p className="text-center text-[11px] text-muted-foreground">
          Signed in as <span className="text-foreground">{data.user.email}</span> · {data.subscription?.tier ?? "free"} plan
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: "green" | "amber" | "muted" }) {
  const toneCls = tone === "green" ? "text-brand-green" : tone === "amber" ? "text-[#E5B73A]" : "text-muted-foreground";
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
        <span className={toneCls}>{icon}</span>
      </div>
      <div className="mt-2 text-[22px] font-black tracking-tight">{value}</div>
    </motion.div>
  );
}

function QuickAction({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <a
      href={href}
      className="group flex items-center justify-between rounded-xl border border-border bg-card p-5 transition-all hover:border-brand-green/40"
    >
      <div>
        <div className="text-[14px] font-bold tracking-tight">{title}</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">{desc}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-brand-green" />
    </a>
  );
}

function Skeleton({ h, w }: { h: number; w?: number }) {
  return <div className="animate-pulse rounded-xl bg-field" style={{ height: h, width: w ? w : undefined }} />;
}

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, ExternalLink, FileText, LogOut, RefreshCw, Settings as SettingsIcon, Sparkles, Wifi, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  APP_WEB_URL,
  getExtensionSession,
  isExtensionRuntime,
  openAuthInTab,
  openWebPath,
  signOutExtension,
  type ExtensionSession,
} from "@/lib/extension/runtime";
import { ensureSupabaseSession } from "@/lib/extension/sync";
import { SignIn } from "./screens/SignIn";
import { LogoMark } from "./Logo";

interface Status {
  resumeName: string | null;
  resumeUploadedAt: string | null;
  tier: string;
  syncedAt: string | null;
}

export function PopupApp() {
  const inExtension = isExtensionRuntime();
  const [session, setSession] = useState<ExtensionSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(!inExtension);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<Status>({
    resumeName: null,
    resumeUploadedAt: null,
    tier: "free",
    syncedAt: null,
  });
  const [online, setOnline] = useState<boolean>(typeof navigator === "undefined" ? true : navigator.onLine);

  const refreshSession = useCallback(async () => {
    if (!inExtension) {
      // Web preview: use supabase session directly
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          user: { id: data.session.user.id, email: data.session.user.email },
        });
      } else {
        setSession(null);
      }
      setSessionChecked(true);
      return;
    }
    setChecking(true);
    try {
      const s = await getExtensionSession();
      setSession(s);
      await ensureSupabaseSession(s);
    } finally {
      setChecking(false);
      setSessionChecked(true);
    }
  }, [inExtension]);

  const refreshStatus = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const [{ data: resume }, { data: sub }] = await Promise.all([
      supabase
        .from("resumes")
        .select("file_name, uploaded_at")
        .eq("user_id", u.user.id)
        .eq("is_current", true)
        .maybeSingle(),
      supabase
        .from("subscriptions")
        .select("tier")
        .eq("user_id", u.user.id)
        .maybeSingle(),
    ]);
    setStatus({
      resumeName: resume?.file_name ?? null,
      resumeUploadedAt: resume?.uploaded_at ?? null,
      tier: sub?.tier ?? "free",
      syncedAt: new Date().toISOString(),
    });
  }, []);

  useEffect(() => {
    refreshSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (globalThis as any).chrome;
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && "aplyer.session.v1" in changes) {
        const next = changes["aplyer.session.v1"].newValue as ExtensionSession | undefined;
        setSession(next ?? null);
        ensureSupabaseSession(next ?? null);
      }
    };
    c?.storage?.onChanged?.addListener(onChanged);
    return () => c?.storage?.onChanged?.removeListener(onChanged);
  }, [refreshSession]);

  useEffect(() => {
    if (session) void refreshStatus();
  }, [session, refreshStatus]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function handleSignOut() {
    if (inExtension) await signOutExtension();
    await supabase.auth.signOut();
    setSession(null);
  }

  if (!sessionChecked) {
    return <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Loading…</div>;
  }

  if (!session) {
    return (
      <SignIn
        onSignIn={() => (inExtension ? openAuthInTab(APP_WEB_URL) : (window.location.href = "/auth"))}
        onRefresh={refreshSession}
        checking={checking}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex h-full flex-col bg-background text-foreground"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <LogoMark size={28} />
          <div className="leading-tight">
            <div className="text-[13px] font-black tracking-tight">Aplyer</div>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Companion</div>
          </div>
        </div>
        <button
          onClick={refreshSession}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-field hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Account */}
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green/15 text-brand-green">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold">{session.user.email ?? "Signed in"}</div>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-brand-green">Connected</div>
          </div>
        </div>
      </div>

      {/* Status cards */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
        <StatusRow
          icon={online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          label="Sync"
          value={online ? (status.syncedAt ? "Up to date" : "Ready") : "Offline"}
          tone={online ? "ok" : "warn"}
        />
        <StatusRow
          icon={<FileText className="h-3.5 w-3.5" />}
          label="Resume"
          value={status.resumeName ?? "Not uploaded"}
          tone={status.resumeName ? "ok" : "warn"}
        />
        <StatusRow
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Plan"
          value={status.tier === "free" ? "Free" : status.tier}
          tone="neutral"
        />
      </div>

      {/* Actions */}
      <div className="border-t border-border p-3 space-y-2">
        <button
          onClick={() => openWebPath("/dashboard")}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-green px-3 py-2.5 text-[12px] font-semibold text-[#06140A] hover:bg-brand-green-2"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open Dashboard
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => openWebPath("/dashboard/settings")}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-foreground hover:bg-field"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            Settings
          </button>
          <button
            onClick={handleSignOut}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground hover:bg-field hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function StatusRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "ok"
      ? "text-brand-green"
      : tone === "warn"
      ? "text-brand-red"
      : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={toneClass}>{icon}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      </div>
      <span className="max-w-[180px] truncate text-[12px] font-medium text-foreground">{value}</span>
    </div>
  );
}

import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const [s, setS] = useState({ notifications: true, autofill_enabled: true, telemetry: false, ai_provider: "claude-sonnet" });
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data } = await supabase.from("user_settings").select("*").eq("user_id", u.user!.id).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (data) setS({
      notifications: data.notifications,
      autofill_enabled: data.autofill_enabled,
      telemetry: data.telemetry,
      ai_provider: data.ai_provider,
    });
  }, [data]);

  async function save() {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("user_settings").upsert({ user_id: u.user!.id, ...s }, { onConflict: "user_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[32px] font-black tracking-tight">Settings</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">Manage your preferences and AI engine.</p>
      </div>

      {isLoading ? <div className="h-[300px] animate-pulse rounded-2xl bg-card" /> : (
        <div className="space-y-3">
          <Section title="Preferences">
            <Toggle label="Email notifications" desc="Updates about your account and applications." value={s.notifications} onChange={(v) => setS({ ...s, notifications: v })} />
            <Toggle label="Autofill on supported ATS" desc="Aplyer fills fields when you visit Workday, Greenhouse, Lever." value={s.autofill_enabled} onChange={(v) => setS({ ...s, autofill_enabled: v })} />
            <Toggle label="Anonymous telemetry" desc="Help us improve. Never shares your resume or answers." value={s.telemetry} onChange={(v) => setS({ ...s, telemetry: v })} />
          </Section>

          <Section title="AI engine">
            <div className="flex items-center justify-between rounded-lg border border-border bg-paper px-4 py-3">
              <div className="pr-4">
                <div className="text-[15px] font-semibold">AI-powered answer generation</div>
                <div className="mt-0.5 text-[13px] text-muted-foreground">Aplyer generates answers for supported job applications.</div>
              </div>
              <div className="flex-shrink-0 rounded-full bg-brand-green/15 px-3 py-1 text-[13px] font-semibold text-brand-green">Active</div>
            </div>
          </Section>

          <div className="flex justify-end">
            <button onClick={save} disabled={saving} className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-green px-5 text-[15px] font-semibold text-[#06140A] hover:bg-brand-green-2 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="text-[16px] font-bold tracking-tight">{title}</h3>
      <div className="mt-3 space-y-2.5">{children}</div>
    </div>
  );
}

function Toggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-paper px-4 py-3">
      <div className="pr-4">
        <div className="text-[15px] font-semibold">{label}</div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">{desc}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${value ? "bg-brand-green" : "bg-field"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${value ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

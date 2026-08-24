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
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-black tracking-tight">Settings</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Manage your preferences and AI engine.</p>
      </div>

      {isLoading ? <div className="h-[300px] animate-pulse rounded-2xl bg-card" /> : (
        <div className="space-y-4">
          <Section title="Preferences">
            <Toggle label="Email notifications" desc="Updates about your account and applications." value={s.notifications} onChange={(v) => setS({ ...s, notifications: v })} />
            <Toggle label="Autofill on supported ATS" desc="Aplyer fills fields when you visit Workday, Greenhouse, Lever." value={s.autofill_enabled} onChange={(v) => setS({ ...s, autofill_enabled: v })} />
            <Toggle label="Anonymous telemetry" desc="Help us improve. Never shares your resume or answers." value={s.telemetry} onChange={(v) => setS({ ...s, telemetry: v })} />
          </Section>

          <Section title="AI engine">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Preferred provider</span>
              <select
                value={s.ai_provider}
                onChange={(e) => setS({ ...s, ai_provider: e.target.value })}
                className="h-11 w-full rounded-lg border border-border bg-paper px-3 text-[13px]"
              >
                <option value="claude-sonnet">Claude Sonnet (default)</option>
                <option value="openai-gpt5" disabled>OpenAI GPT-5 (soon)</option>
                <option value="gemini-2-5-pro" disabled>Gemini 2.5 Pro (soon)</option>
              </select>
              <p className="mt-2 text-[11px] text-muted-foreground">AI answer generation is active on supported job applications.</p>
            </label>
          </Section>

          <div className="flex justify-end">
            <button onClick={save} disabled={saving} className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-green px-5 text-[13px] font-semibold text-[#06140A] hover:bg-brand-green-2 disabled:opacity-60">
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
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function Toggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-paper p-4">
      <div className="pr-4">
        <div className="text-[13px] font-semibold">{label}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{desc}</div>
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

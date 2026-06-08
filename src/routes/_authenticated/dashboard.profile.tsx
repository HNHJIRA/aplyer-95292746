import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Loader2, Save } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CountryCitySelect, formatLocation, parseLocation } from "@/components/ui/CountryCitySelect";

export const Route = createFileRoute("/_authenticated/dashboard/profile")({
  component: ProfilePage,
});

const schema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  location: z.string().trim().max(160).optional().or(z.literal("")),
  linkedin: z.string().trim().max(255).optional().or(z.literal("")),
  portfolio: z.string().trim().max(255).optional().or(z.literal("")),
  website: z.string().trim().max(255).optional().or(z.literal("")),
});

type Form = z.infer<typeof schema>;

const EMPTY: Form = { first_name: "", last_name: "", email: "", phone: "", location: "", linkedin: "", portfolio: "", website: "" };

function ProfilePage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [loc, setLoc] = useState<{ country: string; city: string }>({ country: "", city: "" });
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data: p } = await supabase.from("profiles").select("*").eq("id", u.user!.id).maybeSingle();
      return { user: u.user!, profile: p };
    },
  });

  useEffect(() => {
    if (data) {
      setForm({
        first_name: data.profile?.first_name ?? "",
        last_name: data.profile?.last_name ?? "",
        email: data.profile?.email ?? data.user.email ?? "",
        phone: data.profile?.phone ?? "",
        location: data.profile?.location ?? "",
        linkedin: data.profile?.linkedin ?? "",
        portfolio: data.profile?.portfolio ?? "",
        website: data.profile?.website ?? "",
      });
    }
  }, [data]);

  async function save() {
    const parsed = schema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Check inputs"); return; }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("profiles").upsert({ id: u.user!.id, ...parsed.data }, { onConflict: "id" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Profile saved");
    qc.invalidateQueries({ queryKey: ["profile"] });
    qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-black tracking-tight">Profile</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Used to autofill applications across Workday, Greenhouse, and Lever.</p>
      </div>

      {isLoading ? (
        <div className="h-[400px] animate-pulse rounded-2xl bg-card" />
      ) : (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="First name" value={form.first_name} onChange={(v) => setForm({ ...form, first_name: v })} />
            <Field label="Last name" value={form.last_name} onChange={(v) => setForm({ ...form, last_name: v })} />
            <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
            <Field label="Phone" value={form.phone || ""} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field label="Location" value={form.location || ""} onChange={(v) => setForm({ ...form, location: v })} placeholder="City, Country" />
            <Field label="LinkedIn" value={form.linkedin || ""} onChange={(v) => setForm({ ...form, linkedin: v })} placeholder="linkedin.com/in/you" />
            <Field label="Portfolio" value={form.portfolio || ""} onChange={(v) => setForm({ ...form, portfolio: v })} placeholder="https://" />
            <Field label="Website" value={form.website || ""} onChange={(v) => setForm({ ...form, website: v })} placeholder="https://" />
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-green px-5 text-[13px] font-semibold text-[#06140A] hover:bg-brand-green-2 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save changes
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-lg border border-border bg-paper px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-brand-green/60 focus:outline-none"
      />
    </label>
  );
}

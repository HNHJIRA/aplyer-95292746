import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Plus, Trash2, BookOpen, Loader2 } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/writing")({
  component: WritingPage,
});

const TYPES = [
  { v: "cover_letter", l: "Cover Letter" },
  { v: "professional_email", l: "Professional Email" },
  { v: "linkedin_post", l: "LinkedIn Post" },
  { v: "blog", l: "Blog" },
  { v: "essay", l: "Essay" },
  { v: "career_summary", l: "Career Summary" },
  { v: "free_text", l: "Free Text" },
  { v: "other", l: "Other" },
] as const;

const schema = z.object({
  type: z.enum([
    "cover_letter",
    "professional_email",
    "linkedin_post",
    "blog",
    "essay",
    "career_summary",
    "free_text",
    "other",
  ]),
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(20).max(20000),
});

function WritingPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "cover_letter" as const, title: "", content: "" });

  const { data: samples = [], isLoading } = useQuery({
    queryKey: ["writing_samples"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data } = await supabase.from("writing_samples").select("*").eq("user_id", u.user!.id).order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check inputs");
      const { data: u } = await supabase.auth.getUser();
      const wc = parsed.data.content.split(/\s+/).filter(Boolean).length;
      const { error } = await supabase.from("writing_samples").insert({ user_id: u.user!.id, ...parsed.data, word_count: wc });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sample saved");
      setForm({ type: "cover_letter", title: "", content: "" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["writing_samples"] });
      qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("writing_samples").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["writing_samples"] }); toast.success("Deleted"); },
  });

  const totalWords = samples.reduce((a, s) => a + (s.word_count ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-black tracking-tight">Writing samples</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">Optional. We'll use these later to match your voice.</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-green px-3.5 text-[14px] font-semibold text-[#06140A] hover:bg-brand-green-2"
        >
          <Plus className="h-4 w-4" /> Add sample
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Documents" value={samples.length.toString()} />
        <Stat label="Total words" value={totalWords.toLocaleString()} />
        <Stat label="Last updated" value={samples[0] ? new Date(samples[0].updated_at).toLocaleDateString() : "—"} />
      </div>

      {open && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-[16px] font-bold">New sample</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground">Type</span>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}
                className="h-11 w-full rounded-lg border border-border bg-paper px-3 text-[15px] focus:outline-none"
              >
                {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground">Title</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Product PM cover letter" className="h-11 w-full rounded-lg border border-border bg-paper px-3 text-[15px] focus:outline-none" />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1.5 block font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground">Content</span>
            <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={8} placeholder="Paste your sample here…" className="w-full rounded-lg border border-border bg-paper px-3 py-2.5 text-[15px] focus:outline-none" />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-border bg-paper px-4 py-2 text-[14px] hover:bg-field">Cancel</button>
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2 text-[14px] font-semibold text-[#06140A]"
            >
              {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save sample
            </button>
          </div>
        </motion.div>
      )}

      {isLoading ? (
        <div className="h-[200px] animate-pulse rounded-2xl bg-card" />
      ) : samples.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-paper py-10">
          <BookOpen className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-[16px] font-semibold">No writing samples yet</p>
          <p className="mt-1 text-[14px] text-muted-foreground">Add a cover letter or bio to help Aplyer match your voice later.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {samples.map((s) => (
            <motion.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-green">{TYPES.find((t) => t.v === s.type)?.l ?? s.type}</div>
                  <div className="mt-1 truncate text-[16px] font-bold">{s.title}</div>
                </div>
                <button onClick={() => remove.mutate(s.id)} className="rounded-md p-1 text-muted-foreground hover:bg-field hover:text-brand-red">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 line-clamp-3 text-[14px] text-muted-foreground">{s.content}</p>
              <div className="mt-3 flex items-center gap-3 text-[13px] text-muted-foreground">
                <span>{s.word_count} words</span>
                <span>·</span>
                <span>{new Date(s.updated_at).toLocaleDateString()}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-[22px] font-black">{value}</div>
    </div>
  );
}

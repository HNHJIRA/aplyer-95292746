import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Plus, Trash2, FileText, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { useAplyerStore } from "@/lib/storage/useAplyerStore";
import {
  syncWritingSampleToBackend,
  deleteWritingSampleFromBackend,
  hydrateFromBackend,
} from "@/lib/extension/sync";
import type { WritingSample, WritingSampleType } from "@/lib/storage/types";

const TYPES: { id: WritingSampleType; label: string }[] = [
  { id: "cover_letter", label: "Cover Letter" },
  { id: "linkedin_post", label: "LinkedIn Post" },
  { id: "professional_email", label: "Email" },
  { id: "blog", label: "Blog" },
  { id: "essay", label: "Essay" },
  { id: "free_text", label: "Free Text" },
  { id: "career_summary", label: "Career Summary" },
  { id: "other", label: "Other" },
];

const MAX = 10_000;
const MIN_CHARS = 100;
const MIN_WORDS = 30;

export function WritingSamples({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { state, update, reload } = useAplyerStore();

  // Restore draft (persists across popup close / tab switch).
  const draft = state.writingSampleDraft;
  const [adding, setAdding] = useState<boolean>(!!draft?.isOpen);
  const [type, setType] = useState<WritingSampleType>(draft?.type ?? "cover_letter");
  const [title, setTitle] = useState<string>(draft?.title ?? "");
  const [content, setContent] = useState<string>(draft?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  // If persisted state changes (e.g. hydration after mount), reflect it once.
  useEffect(() => {
    if (hydratedRef.current) return;
    if (state.writingSampleDraft) {
      hydratedRef.current = true;
      setAdding(!!state.writingSampleDraft.isOpen);
      setType(state.writingSampleDraft.type);
      setTitle(state.writingSampleDraft.title);
      setContent(state.writingSampleDraft.content);
    }
  }, [state.writingSampleDraft]);

  // Persist draft on any change (debounced via microtask batching).
  useEffect(() => {
    const timer = setTimeout(() => {
      void update({
        writingSampleDraft: adding || title || content
          ? { type, title, content, isOpen: adding, updatedAt: new Date().toISOString() }
          : null,
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [adding, type, title, content, update]);

  const samples = state.writingSamples;
  const totalWords = samples.reduce((a, s) => a + s.wordCount, 0);

  const trimmed = content.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  const qualifies = trimmed.length >= MIN_CHARS && wordCount >= MIN_WORDS;

  async function clearDraft() {
    await update({ writingSampleDraft: null });
    setAdding(false);
    setTitle("");
    setContent("");
    setType("cover_letter");
  }

  async function save() {
    if (!qualifies || saving) return;
    setSaving(true);
    const optimistic: WritingSample = {
      id: crypto.randomUUID(),
      type,
      title: title || TYPES.find((t) => t.id === type)!.label,
      content: content.slice(0, MAX),
      wordCount,
      createdAt: new Date().toISOString(),
    };
    try {
      const persisted = await syncWritingSampleToBackend(optimistic);
      const finalSample: WritingSample = persisted
        ? {
            id: persisted.id,
            type: (persisted.type as WritingSampleType) ?? optimistic.type,
            title: persisted.title ?? optimistic.title,
            content: persisted.content ?? optimistic.content,
            wordCount: persisted.word_count ?? optimistic.wordCount,
            createdAt: persisted.created_at ?? optimistic.createdAt,
          }
        : optimistic;
      await update({ writingSamples: [...samples, finalSample] });
      await hydrateFromBackend();
      await reload();
      await clearDraft();
    } catch (e) {
      console.warn("[aplyer] failed to save writing sample", e);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setRemovingId(id);
    try {
      await deleteWritingSampleFromBackend(id);
      await update({ writingSamples: samples.filter((s) => s.id !== id) });
      await hydrateFromBackend();
      await reload();
    } catch (e) {
      console.warn("[aplyer] failed to delete writing sample", e);
    } finally {
      setRemovingId(null);
    }
  }

  async function skip() {
    await update({ onboardingStatus: { ...state.onboardingStatus, skippedWritingSamples: true } });
    onNext();
  }

  async function continueNext() {
    await update({ onboardingStatus: { ...state.onboardingStatus, skippedWritingSamples: samples.length === 0 } });
    onNext();
  }

  return (
    <div className="flex h-full flex-col px-6 pt-2">
      <div className="mb-3">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-field px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          Optional
        </div>
        <h2 className="mt-2 text-[20px] font-black tracking-tight">Help Aplyer Learn Your Voice</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">Upload previous writing samples to improve future personalization.</p>
      </div>

      <div className="popup-scroll -mx-6 flex-1 overflow-y-auto px-6">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Samples" value={samples.length} />
          <Stat label="Words" value={totalWords} />
          <Stat label="Status" value={samples.length > 0 ? "Saved" : "Empty"} small />
        </div>

        <AnimatePresence mode="wait">
          {adding ? (
            <motion.div
              key="add"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="mt-4 rounded-xl border border-border bg-paper p-3"
            >
              <div className="flex flex-wrap gap-1.5">
                {TYPES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setType(t.id)}
                    className={`rounded-md border px-2.5 py-1 text-[11px] transition ${type === t.id ? "border-brand-green/50 bg-brand-green/10 text-brand-green" : "border-border bg-field text-sub hover:text-foreground"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (optional)"
                maxLength={80}
                className="mt-3 h-9 w-full rounded-lg border border-border bg-field px-3 text-[12px] placeholder:text-dim focus:border-brand-green/60 focus:outline-none focus:ring-2 focus:ring-brand-green/20"
              />
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value.slice(0, MAX))}
                placeholder="Paste your sample here…"
                rows={6}
                className="mt-2 w-full resize-none rounded-lg border border-border bg-field p-3 text-[12px] leading-relaxed placeholder:text-dim focus:border-brand-green/60 focus:outline-none focus:ring-2 focus:ring-brand-green/20"
              />
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {content.length.toLocaleString()} / {MAX.toLocaleString()} chars · {wordCount} words ·{" "}
                  <span className={qualifies ? "text-brand-green" : "text-[#E5B73A]"}>
                    {qualifies ? "Qualifies for Write DNA" : `Need ${MIN_CHARS}+ chars & ${MIN_WORDS}+ words`}
                  </span>
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => void clearDraft()} disabled={saving}>Cancel</Button>
                  <Button size="sm" onClick={() => void save()} disabled={!qualifies || saving}>
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    {saving ? "Saving…" : "Save Sample"}
                  </Button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 space-y-2">
              {samples.length === 0 && (
                <div className="rounded-xl border border-dashed border-border bg-paper p-5 text-center">
                  <p className="text-[12px] text-muted-foreground">No samples yet — totally optional.</p>
                </div>
              )}
              {samples.map((s) => (
                <div key={s.id} className="flex items-start gap-3 rounded-lg border border-border bg-paper p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-green/10 text-brand-green">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold">{s.title}</p>
                    <p className="text-[10px] text-muted-foreground">{TYPES.find((t) => t.id === s.type)?.label} · {s.wordCount} words</p>
                  </div>
                  <button
                    onClick={() => void remove(s.id)}
                    disabled={removingId === s.id}
                    className="rounded-md p-1 text-muted-foreground hover:bg-field hover:text-brand-red disabled:opacity-50"
                  >
                    {removingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ))}
              <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add Writing Sample
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-3 flex items-center gap-2 pb-1">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button variant="secondary" onClick={() => void skip()}>Skip</Button>
        <Button className="flex-1" onClick={() => void continueNext()}>Continue <ArrowRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: number | string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-paper p-2.5">
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-black text-foreground ${small ? "text-[13px]" : "text-[18px]"}`}>{value}</div>
    </div>
  );
}

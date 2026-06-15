// Helpers to mirror extension data to Supabase when a session is available.
import { supabase } from "@/integrations/supabase/client";
import type { ExtensionSession } from "@/lib/extension/runtime";
import { storage } from "@/lib/storage/storage";
import type {
  AplyerState,
  Profile,
  ResumeMetadata,
  ResumeScore,
  WritingSample,
} from "@/lib/storage/types";

export async function ensureSupabaseSession(session: ExtensionSession | null) {
  if (!session) return false;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token === session.access_token) return true;
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) {
      console.warn("[aplyer] setSession failed", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[aplyer] ensureSupabaseSession error", e);
    return false;
  }
}

export async function syncProfileToBackend(profile: Profile, userEmail?: string | null) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("profiles").upsert(
    {
      id: u.user.id,
      first_name: profile.firstName,
      last_name: profile.lastName,
      email: profile.email || userEmail || "",
      phone: profile.phone,
      linkedin: profile.linkedin,
      portfolio: profile.portfolio,
      location: profile.location,
    },
    { onConflict: "id" },
  );
}

export async function syncResumeToBackend(
  file: File,
  text: string,
  score: ResumeScore,
  meta: ResumeMetadata,
) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  const uid = u.user.id;
  const ext = file.name.split(".").pop() || "pdf";
  const path = `${uid}/${Date.now()}-${file.name.replace(/\s+/g, "_")}`;

  const { error: upErr } = await supabase.storage
    .from("resumes")
    .upload(path, file, { upsert: false, contentType: file.type || `application/${ext}` });
  if (upErr) throw upErr;

  await supabase.from("resumes").update({ is_current: false }).eq("user_id", uid).eq("is_current", true);

  const { data: prev } = await supabase
    .from("resumes")
    .select("version")
    .eq("user_id", uid)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (prev?.version ?? 0) + 1;

  const { data: inserted, error: insErr } = await supabase
    .from("resumes")
    .insert({
      user_id: uid,
      file_name: meta.fileName,
      file_size: meta.fileSize,
      file_type: meta.fileType || ext,
      storage_path: path,
      resume_text: text.slice(0, 200_000),
      version,
      is_current: true,
    })
    .select()
    .single();
  if (insErr) throw insErr;

  await supabase.from("resume_scores").insert({
    resume_id: inserted.id,
    user_id: uid,
    score: score.score,
    completeness: score.completeness,
    strength: score.strength,
    sections: score.sections,
    strengths: score.strengths,
    suggestions: score.suggestions,
  });
}

export async function syncWritingSampleToBackend(sample: WritingSample) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("writing_samples").insert({
    user_id: u.user.id,
    title: sample.title,
    type: sample.type,
    content: sample.content,
    word_count: sample.wordCount,
  });
}

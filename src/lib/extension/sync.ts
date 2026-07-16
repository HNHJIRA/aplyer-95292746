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

/**
 * Pull existing user data from backend into extension local storage.
 * If the user already has a resume + profile, mark onboarding complete so
 * returning users don't see the welcome wizard again.
 */
export async function hydrateFromBackend(): Promise<AplyerState | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const uid = u.user.id;

  const [profileRes, resumeRes, samplesRes, subRes, settingsRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
    supabase
      .from("resumes")
      .select("*, resume_scores(*)")
      .eq("user_id", uid)
      .eq("is_current", true)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("writing_samples").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    supabase.from("subscriptions").select("*").eq("user_id", uid).maybeSingle(),
    supabase.from("user_settings").select("*").eq("user_id", uid).maybeSingle(),
  ]);

  const current = await storage.getState();
  const patch: Partial<AplyerState> = {};

  const p = profileRes.data as (Record<string, unknown> & { [k: string]: unknown }) | null;
  if (p) {
    patch.profile = {
      firstName: (p.first_name as string) ?? "",
      lastName: (p.last_name as string) ?? "",
      email: (p.email as string) ?? u.user.email ?? "",
      phone: (p.phone as string) ?? "",
      linkedin: (p.linkedin as string) ?? "",
      portfolio: (p.portfolio as string) ?? "",
      location: (p.location as string) ?? "",
    };
    // Hydrate WriteDNA columns if present.
    if ("voice_confidence" in p) {
      const stage =
        !p.resume_uploaded
          ? "idle"
          : (p.writing_sample_count as number) === 0
            ? "building"
            : (p.writing_sample_count as number) === 1
              ? "good"
              : "strong";
      patch.writeDna = {
        ...current.writeDna,
        stage: stage as typeof current.writeDna.stage,
        voiceConfidence: Number(p.voice_confidence ?? 0),
        writingSampleCount: Number(p.writing_sample_count ?? 0),
        resumeUploaded: !!p.resume_uploaded,
        resumeOnly: !!p.resume_only,
        voiceCardStatus: (p.voice_card_status as typeof current.writeDna.voiceCardStatus) ?? "locked",
        celebratedStrong: !!p.celebrated_strong,
      };
    }
  }

  const r = resumeRes.data as
    | (Record<string, unknown> & { resume_scores?: Array<Record<string, unknown>> })
    | null;
  if (r) {
    patch.resumeText = (r.resume_text as string) ?? null;
    patch.resumeMetadata = {
      fileName: r.file_name as string,
      fileSize: Number(r.file_size ?? 0),
      fileType: (r.file_type as string) ?? "",
      uploadedAt: (r.uploaded_at as string) ?? new Date().toISOString(),
    };
    const sc = Array.isArray(r.resume_scores) ? r.resume_scores[0] : undefined;
    if (sc) {
      patch.resumeScore = {
        score: Number(sc.score ?? 0),
        completeness: Number(sc.completeness ?? 0),
        strength: Number(sc.strength ?? 0),
        readiness: Number(sc.score ?? 0),
        sections: (sc.sections as ResumeScore["sections"]) ?? {
          contact: false, experience: false, skills: false,
          education: false, summary: false, certifications: false,
        },
        strengths: (sc.strengths as string[]) ?? [],
        suggestions: (sc.suggestions as string[]) ?? [],
      };
    }
  }

  if (samplesRes.data?.length) {
    patch.writingSamples = samplesRes.data.map((s) => ({
      id: s.id,
      type: s.type as WritingSample["type"],
      title: s.title,
      content: s.content,
      wordCount: s.word_count,
      createdAt: s.created_at,
    }));
  }

  if (subRes.data) {
    patch.subscriptionStatus = {
      tier: (subRes.data.tier as "free" | "pro" | "enterprise") ?? "free",
      renewsAt: subRes.data.renews_at ?? undefined,
    };
  }

  if (settingsRes.data) {
    patch.settings = {
      ...current.settings,
      notifications: settingsRes.data.notifications,
      autofillEnabled: settingsRes.data.autofill_enabled,
      telemetry: settingsRes.data.telemetry,
    };
  }

  // If returning user already has resume + profile, skip the wizard.
  const hasResume = !!patch.resumeMetadata || !!current.resumeMetadata;
  const hasProfile = !!patch.profile || !!current.profile;
  if (hasResume && hasProfile && !current.onboardingStatus.completed) {
    patch.onboardingStatus = {
      completed: true,
      currentStep: "done",
      startedAt: current.onboardingStatus.startedAt ?? new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  return await storage.patch(patch);
}

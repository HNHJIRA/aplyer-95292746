// Server-side, one-time lazy repair of resumes whose stored `resume_text` is
// not real text (legacy naive extraction stored raw PDF/DOCX bytes).
//
// Uses the SAME canonical extractor as upload — no second parser. Writes go
// through the privileged client because `resumes.resume_text` must stay
// server-trusted for the P0 fact inventory.
import { extractResumeText, looksLikeBinaryResumeText } from "./extract";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

const MIN_USABLE_CHARS = 100;

export function needsTextRepair(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return t.length < MIN_USABLE_CHARS || looksLikeBinaryResumeText(t);
}

/**
 * Re-extracts text for a stored resume from its original file in storage.
 * Returns the repaired text, or null when the file cannot be re-read.
 */
export async function repairResumeText(
  admin: Db,
  resume: { id: string; storage_path?: string | null; file_name?: string | null },
): Promise<string | null> {
  if (!resume.storage_path) return null;
  try {
    const { data, error } = await admin.storage.from("resumes").download(resume.storage_path);
    if (error || !data) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const text = await extractResumeText(bytes, resume.file_name ?? resume.storage_path);
    if (!text || text.trim().length < MIN_USABLE_CHARS || looksLikeBinaryResumeText(text)) return null;
    await admin
      .from("resumes")
      .update({ resume_text: text.slice(0, 200_000) })
      .eq("id", resume.id);
    return text;
  } catch (e) {
    console.warn(JSON.stringify({ evt: "resume_text_repair_failed", resumeId: resume.id, msg: String(e).slice(0, 200) }));
    return null;
  }
}

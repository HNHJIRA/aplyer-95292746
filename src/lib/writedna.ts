import type { WriteDnaState, WriteDnaStage, WritingSample, WritingSampleType, VoiceCardStatus } from "@/lib/storage/types";

export const QUALIFYING_MIN_CHARS = 100;
export const QUALIFYING_MIN_WORDS = 30;
export const BULLET_HEAVY_THRESHOLD = 0.6;

const ALLOWED_TYPES: WritingSampleType[] = [
  "cover_letter",
  "linkedin_post",
  "professional_email",
  "blog",
  "essay",
  "free_text",
  "career_summary",
  "other",
];

export function countWords(text: string): number {
  const t = (text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

function isBulletHeavy(content: string): boolean {
  const lines = content.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 3) return false;
  const bulletRe = /^(\-|\*|•|\d+\.)\s/;
  const bulletCount = lines.filter((l) => bulletRe.test(l)).length;
  return bulletCount / lines.length > BULLET_HEAVY_THRESHOLD;
}

export function isQualifyingProse(content: string, type?: WritingSampleType | string): boolean {
  const c = (content || "").trim();
  if (c.length < QUALIFYING_MIN_CHARS) return false;
  if (countWords(c) < QUALIFYING_MIN_WORDS) return false;
  if (type && !ALLOWED_TYPES.includes(type as WritingSampleType)) return false;
  if (isBulletHeavy(c)) return false;
  return true;
}

export function countQualifyingSamples(samples: WritingSample[]): number {
  return samples.filter((s) => isQualifyingProse(s.content, s.type)).length;
}

export function computeWriteDna(input: {
  resumeUploaded: boolean;
  qualifyingProseCount: number;
  writingSampleCount?: number;
  resumeOnly?: boolean;
  celebratedStrong?: boolean;
  voiceCardStatus?: VoiceCardStatus;
  voiceCard?: WriteDnaState["voiceCard"];
  voiceCardGeneratedAt?: string | null;
}): WriteDnaState {
  const { resumeUploaded, qualifyingProseCount } = input;
  const writingSampleCount = input.writingSampleCount ?? qualifyingProseCount;
  let voiceConfidence = 0;
  let stage: WriteDnaStage = "idle";
  let derivedStatus: VoiceCardStatus = "locked";

  if (!resumeUploaded) {
    stage = "idle";
    voiceConfidence = 0;
    derivedStatus = "locked";
  } else if (qualifyingProseCount === 0) {
    stage = "building";
    voiceConfidence = 35;
    derivedStatus = "locked";
  } else if (qualifyingProseCount === 1) {
    stage = "good";
    voiceConfidence = 70;
    derivedStatus = "collecting_samples";
  } else {
    stage = "strong";
    voiceConfidence = 90;
    derivedStatus = "eligible";
  }

  const voiceCardStatus = input.voiceCardStatus ?? derivedStatus;
  if (voiceCardStatus === "generated") voiceConfidence = 100;

  return {
    stage,
    voiceConfidence,
    resumeUploaded,
    writingSampleCount,
    qualifyingProseCount,
    resumeOnly: !!input.resumeOnly && qualifyingProseCount === 0,
    voiceCardStatus,
    voiceCard: input.voiceCard ?? null,
    voiceCardGeneratedAt: input.voiceCardGeneratedAt ?? null,
    celebratedStrong: !!input.celebratedStrong,
  };
}

export function stageLabel(stage: WriteDnaStage): string {
  switch (stage) {
    case "idle":
      return "Waiting for your resume";
    case "building":
      return "Building your Write DNA";
    case "good":
      return "Good — one more to make it Strong";
    case "strong":
      return "Strong Write DNA";
  }
}

export function stageColor(stage: WriteDnaStage): string {
  switch (stage) {
    case "idle":
      return "hsl(var(--muted-foreground))";
    case "building":
      return "#E5B73A";
    case "good":
      return "#5DB0FF";
    case "strong":
      return "hsl(var(--brand-green, 142 76% 45%))";
  }
}

export function voiceCardStatusLabel(status: VoiceCardStatus): string {
  switch (status) {
    case "locked":
      return "Locked";
    case "collecting_samples":
      return "Collecting samples";
    case "eligible":
      return "Ready to generate";
    case "generating":
      return "Generating your Voice Card…";
    case "generated":
      return "Voice Card ready";
    case "failed":
      return "Generation failed — try again";
    case "stale":
      return "New writing detected — regenerate";
    case "unlocking":
      return "Almost there";
    case "unlocked":
      return "Unlocked";
  }
}

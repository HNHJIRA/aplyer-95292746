import type { WriteDnaState, WriteDnaStage, WritingSample } from "@/lib/storage/types";

export const QUALIFYING_MIN_CHARS = 100;
export const QUALIFYING_MIN_WORDS = 30;

export function countWords(text: string): number {
  const t = (text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

export function isQualifyingProse(content: string): boolean {
  const c = (content || "").trim();
  return c.length >= QUALIFYING_MIN_CHARS && countWords(c) >= QUALIFYING_MIN_WORDS;
}

export function countQualifyingSamples(samples: WritingSample[]): number {
  return samples.filter((s) => isQualifyingProse(s.content)).length;
}

export function computeWriteDna(input: {
  resumeUploaded: boolean;
  writingSampleCount: number;
  resumeOnly?: boolean;
  celebratedStrong?: boolean;
}): WriteDnaState {
  const { resumeUploaded, writingSampleCount } = input;
  let voiceConfidence = 0;
  let voiceCardStatus: WriteDnaState["voiceCardStatus"] = "locked";
  let stage: WriteDnaStage = "idle";

  if (!resumeUploaded) {
    voiceConfidence = 0;
    stage = "idle";
    voiceCardStatus = "locked";
  } else if (writingSampleCount === 0) {
    voiceConfidence = 35;
    stage = "building";
    voiceCardStatus = "locked";
  } else if (writingSampleCount === 1) {
    voiceConfidence = 70;
    stage = "good";
    voiceCardStatus = "unlocking";
  } else {
    voiceConfidence = 100;
    stage = "strong";
    voiceCardStatus = "unlocked";
  }

  return {
    stage,
    voiceConfidence,
    resumeUploaded,
    writingSampleCount,
    resumeOnly: !!input.resumeOnly && writingSampleCount === 0,
    voiceCardStatus,
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
